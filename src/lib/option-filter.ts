import type { Bar } from "@nemesis-oss/pine-ts";
import type { ChainSummary } from "./option-chain";

/**
 * A rule-based filter for someone who only ever BUYS options: which side, if any, the evidence supports.
 * Every input, point and threshold is listed in the result so it can be checked and disagreed with.
 * It reads positioning, trend and premium cost; it does not forecast, and it is not advice.
 */

export interface VixReading {
  readonly level: number;
  readonly previousClose: number;
  readonly changePct: number;
  /** Share of the last year's closes at or below today's level, 0-100. High means premiums are rich. */
  readonly percentile: number;
}

export interface Trend {
  readonly direction: "up" | "down" | "flat";
  /** Last close against its 20-bar average, in percent. */
  readonly closeVsAveragePct: number;
}

export type LongSide = "CE" | "PE" | "NONE";

export interface Factor {
  readonly text: string;
  /** Which way it pushes: toward calls, toward puts, or just context. */
  readonly leans: "calls" | "puts" | "context";
}

export interface LongOptionFilter {
  readonly side: LongSide;
  readonly label: "CALLS only" | "PUTS only" | "No long options";
  /** Positive supports calls, negative supports puts. */
  readonly points: number;
  readonly factors: readonly Factor[];
  /** Reasons not to buy even when a direction shows. */
  readonly blockers: readonly string[];
}

const TREND_BARS = 20;
const SLOPE_LOOKBACK = 5;
/** Points needed, either way, before a side is named. */
const POINTS_NEEDED = 2;
/** Premiums are called rich at or above this VIX percentile, cheap at or below the low one. */
const VIX_RICH_PERCENTILE = 80;
const VIX_CHEAP_PERCENTILE = 30;
/** Within this distance (percent) of the wall a long option would run into, there is no room to run. */
const WALL_TOO_CLOSE_PCT = 0.3;
/** Expiry within this many days with a straddle losing this share of itself a day is mostly decay. */
const DECAY_DAYS = 1;
const DECAY_SHARE = 0.3;

const average = (values: readonly number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;

/** VIX level and how rich it is, from daily closes oldest first. Undefined with fewer than two closes. */
export const vixReading = (dailyBars: readonly Bar[]): VixReading | undefined => {
  const last = dailyBars.at(-1);
  const previous = dailyBars.at(-2);
  if (last === undefined || previous === undefined) return undefined;
  const history = dailyBars.slice(0, -1).map((b) => b.close);
  return {
    level: last.close,
    previousClose: previous.close,
    changePct: previous.close === 0 ? 0 : ((last.close - previous.close) / previous.close) * 100,
    percentile: history.length === 0 ? 50 : (history.filter((close) => close <= last.close).length / history.length) * 100,
  };
};

/** Direction of the underlying: the last close against its 20-bar average, and which way that average is heading. */
export const trendOf = (bars: readonly Bar[]): Trend | undefined => {
  if (bars.length < TREND_BARS + SLOPE_LOOKBACK) return undefined;
  // Only the last few bars matter; mapping a 5000-bar history on every tick would be wasted work.
  const closes = bars.slice(-(TREND_BARS + SLOPE_LOOKBACK)).map((b) => b.close);
  const now = average(closes.slice(-TREND_BARS));
  const before = average(closes.slice(0, TREND_BARS));
  const last = closes[closes.length - 1]!;
  const direction = last > now && now > before ? "up" : last < now && now < before ? "down" : "flat";
  return { direction, closeVsAveragePct: ((last - now) / now) * 100 };
};

const directionPoints = (score: number): number => (score >= 25 ? 2 : score >= 10 ? 1 : score <= -25 ? -2 : score <= -10 ? -1 : 0);

const pointsFactors = (summary: ChainSummary, trend: Trend | undefined): { points: number; factors: Factor[] } => {
  const factors: Factor[] = [];
  const { bias } = summary.analytics;
  const chainPoints = directionPoints(bias.score);
  factors.push({ text: `Chain positioning ${bias.label.toLowerCase()} (${bias.score > 0 ? "+" : ""}${bias.score})`, leans: chainPoints > 0 ? "calls" : chainPoints < 0 ? "puts" : "context" });
  let points = chainPoints;
  if (trend !== undefined) {
    const trendPoints = trend.direction === "up" ? 1 : trend.direction === "down" ? -1 : 0;
    points += trendPoints;
    factors.push({ text: `Underlying ${trend.direction === "flat" ? "has no clear trend" : `trending ${trend.direction}`}: ${trend.closeVsAveragePct.toFixed(2)}% from its 20-bar average`, leans: trendPoints > 0 ? "calls" : trendPoints < 0 ? "puts" : "context" });
  }
  return { points, factors };
};

const blockersFor = (summary: ChainSummary, side: LongSide, vix: VixReading | undefined): string[] => {
  const blockers: string[] = [];
  const { analytics, straddle } = summary;
  if (vix !== undefined && vix.percentile >= VIX_RICH_PERCENTILE) blockers.push(`Premiums are rich: India VIX ${vix.level.toFixed(1)} is at the ${vix.percentile.toFixed(0)}th percentile of its last year`);
  if (analytics.daysToExpiry !== undefined && analytics.daysToExpiry < DECAY_DAYS && straddle !== undefined && analytics.straddleThetaPerDay !== undefined && analytics.straddleThetaPerDay / straddle >= DECAY_SHARE) {
    blockers.push(`Expiry decay: the ATM straddle loses ${((analytics.straddleThetaPerDay / straddle) * 100).toFixed(0)}% of itself a day`);
  }
  const wall = side === "CE" ? analytics.resistances[0] : side === "PE" ? analytics.supports[0] : undefined;
  if (wall !== undefined && Math.abs(wall.distancePct) < WALL_TOO_CLOSE_PCT) {
    blockers.push(`No room: the ${side === "CE" ? "call" : "put"} wall at ${wall.strike} is only ${Math.abs(wall.distancePct).toFixed(2)}% away`);
  }
  return blockers;
};

/** Which long option side the evidence supports, if any, with every reason shown. */
export const longOptionFilter = (input: { readonly summary: ChainSummary; readonly trend: Trend | undefined; readonly vix: VixReading | undefined }): LongOptionFilter => {
  const { summary, trend, vix } = input;
  const { points, factors } = pointsFactors(summary, trend);
  if (vix !== undefined) {
    const cheap = vix.percentile <= VIX_CHEAP_PERCENTILE;
    factors.push({ text: `India VIX ${vix.level.toFixed(1)} (${vix.changePct > 0 ? "+" : ""}${vix.changePct.toFixed(1)}%), ${vix.percentile.toFixed(0)}th percentile of the last year${cheap ? ": premiums are cheap" : ""}`, leans: "context" });
  }
  const gammaFlip = summary.analytics.gammaFlip;
  if (gammaFlip !== undefined) factors.push({ text: `Spot is ${summary.spot < gammaFlip ? "below" : "above"} the gamma flip ${gammaFlip}: moves tend to be ${summary.spot < gammaFlip ? "amplified" : "damped"}`, leans: "context" });
  const named: LongSide = points >= POINTS_NEEDED ? "CE" : points <= -POINTS_NEEDED ? "PE" : "NONE";
  const blockers = blockersFor(summary, named, vix);
  const side: LongSide = blockers.length > 0 ? "NONE" : named;
  if (named === "NONE") blockers.push("No clear direction: positioning and trend do not agree strongly enough");
  return { side, label: side === "CE" ? "CALLS only" : side === "PE" ? "PUTS only" : "No long options", points, factors, blockers };
};

/** The one line a small display shows under the verdict: the first thing stopping a trade, else what supports the side. */
export const hudReason = (filter: LongOptionFilter): string | undefined => {
  const blocker = filter.blockers[0];
  if (blocker !== undefined) return blocker;
  const wanted = filter.side === "CE" ? "calls" : "puts";
  return filter.factors.find((f) => f.leans === wanted)?.text ?? filter.factors[0]?.text;
};
