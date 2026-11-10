import {
  CLASSIFIER_VERSION,
  classifyInteractions,
  type DataGap,
  type LiquidityInteraction,
  type LiquidityOutcome,
  type OutcomeOptions,
  type OutcomeStats,
  type OutcomeStatsFilter,
  type OutcomeTrade,
  type OutcomeWall,
  type PricePoint,
} from "./liquidity-outcomes";
import type { WallTransitionRow } from "./market-recorder";

/** Same band the wall search uses, so a "touch" matches what the monitor calls nearby. */
const PROXIMITY_PCT = 0.5;
const REACTION_PCT = 0.2;
const WINDOW_MS = 5 * 60 * 1000;

export const ENOUGH_OUTCOMES = 20;

export const OUTCOME_SCAN_OPTIONS: OutcomeOptions = {
  proximityPct: PROXIMITY_PCT,
  reversalPct: REACTION_PCT,
  breakoutPct: REACTION_PCT,
  evaluationWindowMs: WINDOW_MS,
  consumedPct: 50,
  priceTolerance: 0.01,
};

export interface InteractionInsert {
  readonly wallId: string;
  readonly symbol: string;
  readonly side: OutcomeWall["side"];
  readonly levelPrice: number;
  readonly detectedAt: number;
  readonly startAt: number;
  readonly resolvedAt: number | null;
  readonly outcome: LiquidityInteraction["outcome"];
  readonly mfePct: number | null;
  readonly maePct: number | null;
  readonly classifierVersion: string;
}

export interface ScanInput {
  readonly transitions: readonly WallTransitionRow[];
  readonly trades: readonly OutcomeTrade[];
  readonly path: readonly PricePoint[];
  readonly gapTimes?: readonly number[];
  readonly gaps?: readonly DataGap[];
  readonly restartTimes?: readonly number[];
  readonly options?: OutcomeOptions;
}

interface ScanLife { readonly symbol: string; readonly wall: OutcomeWall }

const kindRank = (kind: string): number => {
  if (kind === "detected") return 0;
  if (kind === "removed" || kind === "pulled" || kind === "unobserved") return 2;
  return 1;
};

const byTime = (rows: readonly WallTransitionRow[]): WallTransitionRow[] =>
  [...rows].sort((left, right) => left.at - right.at || kindRank(left.kind) - kindRank(right.kind));

const isSide = (side: string): side is OutcomeWall["side"] => side === "bid" || side === "ask";

const startLife = (row: WallTransitionRow): ScanLife | undefined => {
  if (row.kind !== "detected" || !isSide(row.side) || !(row.price > 0)) return undefined;
  return { symbol: row.symbol, wall: { id: row.wallId, side: row.side, price: row.price, detectedAt: row.at } };
};

const withRemoval = (life: ScanLife, row: WallTransitionRow): ScanLife => {
  if (life.wall.removedAt != null) return life;
  if (row.kind === "unobserved") {
    return { symbol: life.symbol, wall: { ...life.wall, removedAt: row.at, endedUnobserved: true } };
  }
  if (row.kind !== "removed" && row.kind !== "pulled") return life;
  const removedQuantity = row.price > 0 && row.notional > 0 ? row.notional / row.price : undefined;
  return { symbol: life.symbol, wall: { ...life.wall, removedAt: row.at, removedQuantity } };
};

const toRestartRow = (at: number, symbol: string, wallId: string): WallTransitionRow => ({
  wallId, symbol, side: "bid", price: 0, kind: "unobserved", notional: 0, at, detectorVersion: "1",
});

const foldLives = (rows: readonly WallTransitionRow[], restarts: readonly number[] = []): ScanLife[] => {
  const lives: ScanLife[] = [];
  const symbol = rows[0]?.symbol ?? "";
  const wallId = rows[0]?.wallId ?? "";
  const restartRows = restarts.map((at) => toRestartRow(at, symbol, wallId));
  const sorted = byTime([...rows, ...restartRows]);
  let open: ScanLife | undefined;
  for (const row of sorted) {
    if (row.kind === "detected") {
      if (open?.wall.removedAt != null) lives.push(open);
      if (open == null || open.wall.removedAt != null) open = startLife(row);
      continue;
    }
    if (open != null) open = withRemoval(open, row);
  }
  if (open != null) lives.push(open);
  return lives;
};

const livesFrom = (rows: readonly WallTransitionRow[], restarts: readonly number[] = []): ScanLife[] => {
  const groups = new Map<string, WallTransitionRow[]>();
  for (const row of rows) {
    const list = groups.get(row.wallId);
    if (list == null) groups.set(row.wallId, [row]);
    else list.push(row);
  }
  return [...groups.values()].flatMap((group) => foldLives(group, restarts));
};

const gapRanges = (gapTimes: readonly number[], resumes: readonly number[], now: number) => {
  const later = [...resumes].sort((left, right) => left - right);
  return gapTimes.map((from) => ({ from, to: later.find((at) => at > from) ?? now }));
};

const keepStored = (episode: LiquidityInteraction, now: number, windowMs: number, endedUnobserved?: boolean): boolean => {
  if (episode.outcome !== "UNRESOLVED") return episode.resolvedAt != null;
  // An unobserved wall has ended and will never be evaluated further.
  if (endedUnobserved) return true;
  return now - episode.startAt >= windowMs;
};

const toInsert = (symbol: string, row: LiquidityInteraction): InteractionInsert => ({
  wallId: row.wallId,
  symbol,
  side: row.side,
  levelPrice: row.levelPrice,
  detectedAt: row.detectedAt,
  startAt: row.startAt,
  resolvedAt: row.resolvedAt,
  outcome: row.outcome,
  mfePct: row.maxFavorableExcursionPct,
  maePct: row.maxAdverseExcursionPct,
  classifierVersion: row.classifierVersion,
});

export interface ScanOptions {
  readonly now: number;
  readonly tradesFrom: number;
  readonly storedWallIds: ReadonlySet<string>;
}

const wantsLife = (life: ScanLife, scan: ScanOptions): boolean => {
  // Already stored for this classifier version: a re-derived startAt would insert a duplicate each scan.
  if (scan.storedWallIds.has(life.wall.id)) return false;
  // The removal was inside earlier scans' trade window, so those scans already judged this wall.
  if (life.wall.removedAt != null && life.wall.removedAt < scan.tradesFrom) return false;
  return true;
};

export const scanInteractions = (input: ScanInput, scan: ScanOptions): InteractionInsert[] => {
  const options = input.options ?? OUTCOME_SCAN_OPTIONS;
  const path = [...input.path].sort((left, right) => left.at - right.at);
  const gaps = input.gaps ?? gapRanges(input.gapTimes ?? [], path.map((point) => point.at), scan.now);
  const found: InteractionInsert[] = [];
  for (const life of livesFrom(input.transitions, input.restartTimes)) {
    if (!wantsLife(life, scan)) continue;
    // One interaction per wall life: only the first episode is ever stored (spec §13.4).
    const [episode] = classifyInteractions(life.wall, path, input.trades, { gaps, options, now: scan.now });
    if (episode !== undefined && keepStored(episode, scan.now, options.evaluationWindowMs, life.wall.endedUnobserved)) {
      found.push(toInsert(life.symbol, episode));
    }
  }
  return found;
};

export const interactionWrite = (row: InteractionInsert) => ({
  where: {
    wallId_startAt_classifierVersion: {
      wallId: row.wallId,
      startAt: row.startAt,
      classifierVersion: row.classifierVersion,
    },
  },
  // A resolved row is immutable. A new classifierVersion is a different key, so it inserts.
  update: {},
  create: row,
});

/** Two-sided 95% normal quantile. 1.96 reproduces the published 56/100 Wilson check. */
const WILSON_Z_95 = 1.96;

export const wilsonInterval = (successes: number, total: number): { low: number; high: number } | null => {
  if (!(total > 0)) return null;
  const z2 = WILSON_Z_95 * WILSON_Z_95;
  const proportion = successes / total;
  const denom = 1 + z2 / total;
  const centre = proportion + z2 / (2 * total);
  const margin = WILSON_Z_95 * Math.sqrt((proportion * (1 - proportion)) / total + z2 / (4 * total * total));
  const low = Math.max(0, Math.min(1, (centre - margin) / denom));
  const high = Math.max(0, Math.min(1, (centre + margin) / denom));
  return { low, high };
};

const tally = (rows: readonly LiquidityInteraction[]): Record<LiquidityOutcome, number> => {
  const counts: Record<LiquidityOutcome, number> =
    { TURNED: 0, BROKE: 0, PULLED_BEFORE_TOUCH: 0, NO_REACTION: 0, UNRESOLVED: 0, CONSUMED: 0 };
  for (const row of rows) counts[row.outcome] += 1;
  return counts;
};

const span = (rows: readonly LiquidityInteraction[]): { from: number | null; to: number | null } => {
  let from: number | null = null;
  let to: number | null = null;
  for (const row of rows) {
    const end = row.resolvedAt ?? row.startAt;
    from = from == null || row.startAt < from ? row.startAt : from;
    to = to == null || end > to ? end : to;
  }
  return { from, to };
};

const mean = (rows: readonly LiquidityInteraction[], pick: (row: LiquidityInteraction) => number): number | null => {
  if (rows.length === 0) return null;
  let sum = 0;
  for (const row of rows) sum += pick(row);
  return sum / rows.length;
};

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  const right = sorted[mid];
  const left = sorted[mid - 1];
  if (right == null) return null;
  return sorted.length % 2 === 1 || left == null ? right : (left + right) / 2;
};

const resolutionSamples = (rows: readonly LiquidityInteraction[]): number[] => {
  const samples: number[] = [];
  for (const row of rows) if (row.resolvedAt != null) samples.push(row.resolvedAt - row.startAt);
  return samples;
};

const versionsPresent = (rows: readonly LiquidityInteraction[]): string[] =>
  [...new Set(rows.map((row) => row.classifierVersion))].sort();

export const outcomeStats = (interactions: readonly LiquidityInteraction[], filter: OutcomeStatsFilter = {}): OutcomeStats => {
  const classifierVersion = filter.classifierVersion ?? CLASSIFIER_VERSION;
  const matched = interactions.filter((row) => row.classifierVersion === classifierVersion);
  // Rates ignore UNRESOLVED. The date range still covers every filtered episode.
  const counted = matched.filter((row) => row.outcome !== "UNRESOLVED");
  const counts = tally(matched);
  const n = counted.length;
  const range = span(matched);
  return {
    counts, n, from: range.from, to: range.to, classifierVersion,
    turnedPct: n > 0 ? counts.TURNED / n : null,
    brokePct: n > 0 ? counts.BROKE / n : null,
    turnedCi: wilsonInterval(counts.TURNED, n),
    brokeCi: wilsonInterval(counts.BROKE, n),
    avgFavorableExcursionPct: mean(counted, (row) => row.maxFavorableExcursionPct),
    avgAdverseExcursionPct: mean(counted, (row) => row.maxAdverseExcursionPct),
    medianResolutionMs: median(resolutionSamples(counted)),
    classifierVersions: versionsPresent(interactions),
  };
};

export interface TurnBreakShare {
  readonly turned: number;
  readonly broke: number;
  readonly total: number;
  readonly turnedPct: number;
  readonly brokePct: number;
  readonly ci: { low: number; high: number } | null;
}

export const turnBreakShare = (turned: number, broke: number): TurnBreakShare | null => {
  const total = turned + broke;
  if (!(total > 0)) return null;
  return {
    turned,
    broke,
    total,
    turnedPct: turned / total,
    brokePct: broke / total,
    ci: wilsonInterval(turned, total),
  };
};

export const sessionCount = (starts: readonly number[]): number =>
  new Set(starts.map((at) => new Date(at).toISOString().slice(0, 10))).size;

export { CLASSIFIER_VERSION };
