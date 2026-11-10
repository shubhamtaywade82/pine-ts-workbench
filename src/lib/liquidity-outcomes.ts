export const CLASSIFIER_VERSION = "1";

/** A later touch counts only after price is outside this many proximity bands. */
const RETOUCH_BAND = 2;

export type LiquidityOutcome =
  "TURNED" | "BROKE" | "PULLED_BEFORE_TOUCH" | "NO_REACTION" | "UNRESOLVED" | "CONSUMED";

export interface OutcomeWall {
  readonly id: string; readonly side: "bid" | "ask"; readonly price: number;
  readonly detectedAt: number; readonly removedAt?: number; readonly removedQuantity?: number;
  readonly endedUnobserved?: boolean;
}

export interface PricePoint { readonly at: number; readonly price: number }
export interface OutcomeTrade { readonly at: number; readonly price: number; readonly quantity: number }
export interface DataGap { readonly from: number; readonly to: number }

export interface OutcomeOptions {
  readonly proximityPct: number; readonly reversalPct: number; readonly breakoutPct: number;
  readonly evaluationWindowMs: number; readonly consumedPct: number; readonly priceTolerance: number;
}

export interface OutcomeContext {
  readonly gaps: readonly DataGap[];
  readonly options: OutcomeOptions;
  readonly now: number;
}

export interface LiquidityInteraction {
  readonly wallId: string;
  readonly side: OutcomeWall["side"];
  readonly levelPrice: number;
  readonly detectedAt: number;
  readonly startAt: number;
  readonly resolvedAt: number | null;
  readonly outcome: LiquidityOutcome;
  readonly maxFavorableExcursionPct: number;
  readonly maxAdverseExcursionPct: number;
  readonly classifierVersion: string;
}

export interface OutcomeStatsFilter { readonly classifierVersion?: string }

export interface OutcomeStats {
  readonly counts: Record<LiquidityOutcome, number>;
  readonly n: number;
  readonly turnedPct: number | null;
  readonly brokePct: number | null;
  readonly turnedCi: { low: number; high: number } | null;
  readonly brokeCi: { low: number; high: number } | null;
  readonly from: number | null;
  readonly to: number | null;
  readonly avgFavorableExcursionPct: number | null;
  readonly avgAdverseExcursionPct: number | null;
  readonly medianResolutionMs: number | null;
  readonly classifierVersions: readonly string[];
  readonly classifierVersion: string;
}

interface EpisodeSearch {
  readonly wall: OutcomeWall;
  readonly path: readonly PricePoint[];
  readonly trades: readonly OutcomeTrade[];
  readonly context: OutcomeContext;
  readonly first: PricePoint;
}

interface EpisodeWindow { readonly search: EpisodeSearch; readonly startAt: number; readonly endAt: number }

interface RowFields {
  readonly startAt: number;
  readonly resolvedAt: number | null;
  readonly outcome: LiquidityOutcome;
  readonly mfe: number;
  readonly mae: number;
}

const distancePct = (price: number, level: number): number => (Math.abs(price - level) / level) * 100;

const favorablePct = (side: OutcomeWall["side"], price: number, level: number): number =>
  side === "bid" ? ((price - level) / level) * 100 : ((level - price) / level) * 100;

const rowOf = (wall: OutcomeWall, fields: RowFields): LiquidityInteraction => ({
  wallId: wall.id, side: wall.side, levelPrice: wall.price, detectedAt: wall.detectedAt,
  startAt: fields.startAt, resolvedAt: fields.resolvedAt, outcome: fields.outcome,
  maxFavorableExcursionPct: fields.mfe, maxAdverseExcursionPct: fields.mae,
  classifierVersion: CLASSIFIER_VERSION,
});

const findTouch = (path: readonly PricePoint[], wall: OutcomeWall, options: OutcomeOptions, now: number): PricePoint | undefined => {
  for (const point of path) {
    // Same timestamp as detection is the print that found the wall, not a later approach.
    if (point.at <= wall.detectedAt || point.at > now) continue;
    if (distancePct(point.price, wall.price) <= options.proximityPct) return point;
  }
  return undefined;
};

const findRetouch = (search: EpisodeSearch, afterAt: number): PricePoint | undefined => {
  const level = search.wall.price;
  const band = search.context.options.proximityPct * RETOUCH_BAND;
  let priceThen = level;
  let seenAt = Number.NEGATIVE_INFINITY;
  for (const point of search.path) {
    if (point.at > afterAt || point.at < seenAt) continue;
    priceThen = point.price;
    seenAt = point.at;
  }
  let left = distancePct(priceThen, level) > band;
  for (const point of search.path) {
    if (point.at <= afterAt || point.at > search.context.now) continue;
    const distance = distancePct(point.price, level);
    if (!left) {
      left = distance > band;
      continue;
    }
    if (distance <= search.context.options.proximityPct) return point;
  }
  return undefined;
};

const gapOverlaps = (gaps: readonly DataGap[], start: number, end: number, now: number): boolean =>
  gaps.some((gap) => gap.from <= now && gap.from < end && gap.to > start);

const firstCross = (episode: EpisodeWindow): { outcome: "TURNED" | "BROKE"; at: number } | undefined => {
  const limit = Math.min(episode.endAt, episode.search.context.now);
  for (const point of episode.search.path) {
    if (point.at < episode.startAt || point.at > limit) continue;
    const move = favorablePct(episode.search.wall.side, point.price, episode.search.wall.price);
    if (move >= episode.search.context.options.reversalPct) return { outcome: "TURNED", at: point.at };
    if (-move >= episode.search.context.options.breakoutPct) return { outcome: "BROKE", at: point.at };
  }
  return undefined;
};

const tradedWhileUp = (episode: EpisodeWindow, trade: OutcomeTrade, removedAt: number): boolean => {
  const { search, startAt } = episode;
  return trade.at >= startAt && trade.at <= removedAt && trade.at <= search.context.now
    && Math.abs(trade.price - search.wall.price) <= search.context.options.priceTolerance;
};

const consumptionAt = (episode: EpisodeWindow): number | undefined => {
  const removedAt = episode.search.wall.removedAt;
  const removedQty = episode.search.wall.removedQuantity;
  if (removedAt == null || removedQty == null || !(removedQty > 0)) return undefined;
  if (removedAt < episode.startAt || removedAt > episode.endAt) return undefined;
  const need = (removedQty * episode.search.context.options.consumedPct) / 100;
  // Trades are not promised in order. A print after the pull is not evidence the wall was hit.
  const hits = episode.search.trades.filter((trade) => tradedWhileUp(episode, trade, removedAt));
  hits.sort((left, right) => left.at - right.at);
  let filled = 0;
  for (const trade of hits) {
    filled += trade.quantity;
    if (filled >= need) return Math.max(removedAt, trade.at);
  }
  return undefined;
};

const excursions = (episode: EpisodeWindow, until: number): { mfe: number; mae: number } => {
  let mfe = 0;
  let mae = 0;
  for (const point of episode.search.path) {
    if (point.at < episode.startAt || point.at > until || point.at > episode.search.context.now) continue;
    const move = favorablePct(episode.search.wall.side, point.price, episode.search.wall.price);
    if (move > mfe) mfe = move;
    if (-move > mae) mae = -move;
  }
  return { mfe, mae };
};

const finish = (episode: EpisodeWindow, resolvedAt: number | null, outcome: LiquidityOutcome, until: number): LiquidityInteraction => {
  const move = excursions(episode, until);
  return rowOf(episode.search.wall, { startAt: episode.startAt, resolvedAt, outcome, mfe: move.mfe, mae: move.mae });
};

const sawInside = (episode: EpisodeWindow): boolean => {
  const limit = Math.min(episode.endAt, episode.search.context.now);
  // The opening print only starts the window. Later prints are what show a turn, a break, or silence.
  return episode.search.path.some((point) => point.at > episode.startAt && point.at <= limit);
};

const judgeEpisode = (search: EpisodeSearch, startAt: number): LiquidityInteraction => {
  const endAt = startAt + search.context.options.evaluationWindowMs;
  const episode = { search, startAt, endAt };
  const open = search.context.now - startAt < search.context.options.evaluationWindowMs;
  // A hole can hide the earlier threshold, so a contaminated window is not a turn or a break.
  if (gapOverlaps(search.context.gaps, startAt, endAt, search.context.now)) {
    return finish(episode, null, "UNRESOLVED", Math.min(endAt, search.context.now));
  }
  const consumed = consumptionAt(episode);
  if (consumed != null) return finish(episode, consumed, "CONSUMED", consumed);
  const cross = firstCross(episode);
  if (cross != null) {
    if (search.wall.endedUnobserved && search.wall.removedAt != null && cross.at > search.wall.removedAt) {
      return finish(episode, null, "UNRESOLVED", search.wall.removedAt);
    }
    return finish(episode, cross.at, cross.outcome, cross.at);
  }
  if (open || !sawInside(episode)) return finish(episode, null, "UNRESOLVED", Math.min(endAt, search.context.now));
  if (search.wall.endedUnobserved && search.wall.removedAt != null && search.wall.removedAt <= endAt) {
    return finish(episode, null, "UNRESOLVED", search.wall.removedAt);
  }
  return finish(episode, endAt, "NO_REACTION", endAt);
};

const collectEpisodes = (search: EpisodeSearch): LiquidityInteraction[] => {
  const found: LiquidityInteraction[] = [];
  let touch: PricePoint | undefined = search.first;
  const windowMs = search.context.options.evaluationWindowMs;
  while (touch != null) {
    if (search.wall.removedAt != null && search.wall.removedAt < touch.at) break;
    const episode = judgeEpisode(search, touch.at);
    found.push(episode);
    const open = episode.outcome === "UNRESOLVED" && search.context.now - episode.startAt < windowMs;
    if (open) break;
    touch = findRetouch(search, episode.resolvedAt ?? episode.startAt + windowMs);
  }
  return found;
};

export const classifyInteractions = (
  wall: OutcomeWall,
  points: readonly PricePoint[],
  trades: readonly OutcomeTrade[],
  context: OutcomeContext,
): LiquidityInteraction[] => {
  if (!(wall.price > 0)) return [];
  const path = [...points].sort((left, right) => left.at - right.at);
  // A removal after `now` has not happened on this pass.
  const visible = wall.removedAt == null || wall.removedAt <= context.now ? wall : { ...wall, removedAt: undefined };
  if (visible.removedAt != null && visible.removedAt <= visible.detectedAt) return [];
  const first = findTouch(path, visible, context.options, context.now);
  const removedAt = visible.removedAt;
  if (removedAt != null && (first == null || removedAt < first.at)) {
    if (visible.endedUnobserved) {
      return [rowOf(visible, { startAt: removedAt, resolvedAt: null, outcome: "UNRESOLVED", mfe: 0, mae: 0 })];
    }
    return [rowOf(visible, { startAt: removedAt, resolvedAt: removedAt, outcome: "PULLED_BEFORE_TOUCH", mfe: 0, mae: 0 })];
  }
  if (first == null) return [];
  return collectEpisodes({ wall: visible, path, trades, context, first });
};

