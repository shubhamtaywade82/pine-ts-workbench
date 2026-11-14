/**
 * How sure a lab result is. The same tests the options-trading-agent's research uses (Wilson interval, best-session
 * share), plus a bootstrap interval on the average return, so a bucket of four trades cannot pass for an edge.
 */

const Z95 = 1.959964;
const BOOTSTRAP_RESAMPLES = 2000;
/** Fewer trades than this cannot say anything about an average, so the bucket is marked too small outright. */
export const MIN_TRADES_FOR_VERDICT = 8;
/** A result where one day supplied more than this share of all gains rests on that day. */
export const ONE_DAY_SHARE = 0.5;

export interface Interval { readonly low: number; readonly high: number }
export type Verdict = "Positive" | "Negative" | "Unclear" | "Too few trades";

/** Wilson score interval for a proportion, in percent: honest at small samples and near 0% or 100%. */
export const wilsonPct = (successes: number, n: number): Interval => {
  if (n === 0) return { low: 0, high: 100 };
  const p = successes / n;
  const denominator = 1 + (Z95 * Z95) / n;
  const centre = p + (Z95 * Z95) / (2 * n);
  const margin = Z95 * Math.sqrt((p * (1 - p)) / n + (Z95 * Z95) / (4 * n * n));
  return { low: Math.max(0, (centre - margin) / denominator) * 100, high: Math.min(1, (centre + margin) / denominator) * 100 };
};

/** Mulberry32: a small deterministic generator, so the same trades always give the same interval. */
const seeded = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Percentile-bootstrap interval of the mean, 95% by default. A smaller `alpha` widens it: dividing 0.05 by the
 * number of results compared keeps the chance of any false "Positive" near 5%. Undefined for fewer than two values.
 */
export const bootstrapMeanInterval = (values: readonly number[], seed = 1, alpha = 0.05): Interval | undefined => {
  if (values.length < 2) return undefined;
  const random = seeded(seed);
  const means: number[] = [];
  for (let r = 0; r < BOOTSTRAP_RESAMPLES; r += 1) {
    let sum = 0;
    for (let i = 0; i < values.length; i += 1) sum += values[Math.floor(random() * values.length)]!;
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  const tail = Math.min(BOOTSTRAP_RESAMPLES - 1, Math.floor((alpha / 2) * BOOTSTRAP_RESAMPLES));
  return { low: means[tail]!, high: means[BOOTSTRAP_RESAMPLES - 1 - tail]! };
};

/** The largest share of all positive returns that one trade (one day, as the lab trades once a day) supplied. */
export const bestShare = (values: readonly number[]): number | undefined => {
  const positive = values.filter((v) => v > 0);
  const total = positive.reduce((s, v) => s + v, 0);
  return total <= 0 ? undefined : Math.max(...positive) / total;
};

/** The win rate at which the observed average win and loss would break even; undefined without both. */
export const breakevenWinRate = (values: readonly number[]): number | undefined => {
  const wins = values.filter((v) => v > 0);
  const losses = values.filter((v) => v <= 0);
  if (wins.length === 0 || losses.length === 0) return undefined;
  const avgWin = wins.reduce((s, v) => s + v, 0) / wins.length;
  const avgLoss = -losses.reduce((s, v) => s + v, 0) / losses.length;
  return avgWin + avgLoss <= 0 ? undefined : (avgLoss / (avgWin + avgLoss)) * 100;
};

export const verdictOf = (trades: number, interval: Interval | undefined): Verdict => {
  if (trades < MIN_TRADES_FOR_VERDICT || interval === undefined) return "Too few trades";
  if (interval.low > 0) return "Positive";
  if (interval.high < 0) return "Negative";
  return "Unclear";
};
