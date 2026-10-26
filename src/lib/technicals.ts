import { PineRuntime, math, ta, type Bar, type PineContext, type Series } from "@nemesis-oss/pine-ts";
import {
  averageAction, rateAdx, rateAwesome, rateBullBear, rateCci, rateIchimoku, rateMacd, rateMomentum,
  rateMovingAverage, rateRsi, rateStochastic, rateStochRsi, rateUltimate, rateWilliams, type Action, type Pair,
} from "@/lib/technical-ratings";

/**
 * TradingView's Technicals summary for one symbol and timeframe, computed
 * with pine-ts on the latest bar (the forming one included, as TradingView does).
 */

export interface TechnicalRow {
  readonly name: string;
  readonly value: number;
  readonly action: Action;
}

export type PivotStyle = "CLASSIC" | "FIBONACCI" | "CAMARILLA" | "WOODIE" | "DE_MARK";
export const PIVOT_STYLES: readonly PivotStyle[] = ["CLASSIC", "FIBONACCI", "CAMARILLA", "WOODIE", "DE_MARK"];

export interface Technicals {
  readonly oscillators: readonly TechnicalRow[];
  readonly movingAverages: readonly TechnicalRow[];
  /** Pivot levels from the previous bar, per style: [P, R1, R2, R3, S1, S2, S3] (NaN when the style has none). */
  readonly pivots: Readonly<Record<PivotStyle, readonly number[]>>;
  readonly oscillatorScore: number;
  readonly movingAverageScore: number;
  readonly summaryScore: number;
}

const MA_LENGTHS = [10, 20, 30, 50, 100, 200] as const;
const pair = (series: Series<number>): Pair => ({ now: series.at(0) ?? Number.NaN, prev: series.at(1) ?? Number.NaN });
const value = (series: Series<number>, offset = 0): number => series.at(offset) ?? Number.NaN;

/** Builds the rating rows for the current bar; must run inside a PineRuntime script. */
const evaluateBar = (ctx: PineContext): Omit<Technicals, "oscillatorScore" | "movingAverageScore" | "summaryScore"> => {
  const close = value(ctx.close);
  const isUptrend = close > value(ta.sma(ctx.close, 50));
  return {
    oscillators: oscillatorRows(ctx, isUptrend),
    movingAverages: [...movingAverageRows(ctx, close), ichimokuRow(ctx, close)],
    pivots: Object.fromEntries(PIVOT_STYLES.map((style) => [style, pivotLevels(ctx, style)])) as Record<PivotStyle, number[]>,
  };
};

function oscillatorRows(ctx: PineContext, isUptrend: boolean): TechnicalRow[] {
  const rsi = ta.rsi(ctx.close, 14);
  const stochK = ta.sma(ta.stoch(ctx.close, ctx.high, ctx.low, 14), 3);
  const stochD = ta.sma(stochK, 3);
  const cci = ta.cci(ctx.close, 20);
  const { plusDI, minusDI, adx } = ta.dmi(14, 14);
  const ao = ctx.series("technicals.ao", () => value(ta.sma(ctx.hl2, 5)) - value(ta.sma(ctx.hl2, 34)));
  const mom = ta.mom(ctx.close, 10);
  const { macdLine, signalLine } = ta.macd(ctx.close, 12, 26, 9);
  const rsiK = ta.sma(ta.stoch(rsi, rsi, rsi, 14), 3);
  const rsiD = ta.sma(rsiK, 3);
  const wpr = ta.wpr(14);
  const ema13 = ta.ema(ctx.close, 13);
  const bull = ctx.series("technicals.bull", () => value(ctx.high) - value(ema13));
  const bear = ctx.series("technicals.bear", () => value(ctx.low) - value(ema13));
  const uo = ultimateOscillator(ctx);
  return [
    { name: "Relative Strength Index (14)", value: value(rsi), action: rateRsi(pair(rsi)) },
    { name: "Stochastic %K (14, 3, 3)", value: value(stochK), action: rateStochastic(value(stochK), value(stochD)) },
    { name: "Commodity Channel Index (20)", value: value(cci), action: rateCci(pair(cci)) },
    { name: "Average Directional Index (14)", value: value(adx), action: rateAdx(pair(adx), value(plusDI), value(minusDI)) },
    { name: "Awesome Oscillator", value: value(ao), action: rateAwesome(value(ao), value(ao, 1), value(ao, 2)) },
    { name: "Momentum (10)", value: value(mom), action: rateMomentum(pair(mom)) },
    { name: "MACD Level (12, 26)", value: value(macdLine), action: rateMacd(value(macdLine), value(signalLine)) },
    { name: "Stochastic RSI Fast (3, 3, 14, 14)", value: value(rsiK), action: rateStochRsi(value(rsiK), value(rsiD), isUptrend) },
    { name: "Williams Percent Range (14)", value: value(wpr), action: rateWilliams(pair(wpr)) },
    { name: "Bull Bear Power", value: value(bull) + value(bear), action: rateBullBear(pair(bear), pair(bull), isUptrend) },
    { name: "Ultimate Oscillator (7, 14, 28)", value: value(uo), action: rateUltimate(value(uo)) },
  ];
}

/** Larry Williams' Ultimate Oscillator: weighted buying-pressure averages over 7, 14 and 28 bars. */
function ultimateOscillator(ctx: PineContext): Series<number> {
  const priorClose = () => value(ctx.close, 1);
  const buyingPressure = ctx.series("technicals.uo.bp", () => value(ctx.close) - Math.min(value(ctx.low), priorClose()));
  const trueRange = ctx.series("technicals.uo.tr", () => Math.max(value(ctx.high), priorClose()) - Math.min(value(ctx.low), priorClose()));
  const average = (length: number) => value(math.sum(buyingPressure, length)) / value(math.sum(trueRange, length));
  return ctx.series("technicals.uo", () => (100 * (4 * average(7) + 2 * average(14) + average(28))) / 7);
}

function movingAverageRows(ctx: PineContext, close: number): TechnicalRow[] {
  const rows: TechnicalRow[] = [];
  for (const length of MA_LENGTHS) {
    const ema = value(ta.ema(ctx.close, length));
    const sma = value(ta.sma(ctx.close, length));
    rows.push({ name: `Exponential Moving Average (${length})`, value: ema, action: rateMovingAverage(ema, close) });
    rows.push({ name: `Simple Moving Average (${length})`, value: sma, action: rateMovingAverage(sma, close) });
  }
  const vwma = value(ta.vwma(ctx.close, 20));
  const hma = value(ta.hma(ctx.close, 9));
  rows.push({ name: "Volume Weighted Moving Average (20)", value: vwma, action: rateMovingAverage(vwma, close) });
  rows.push({ name: "Hull Moving Average (9)", value: hma, action: rateMovingAverage(hma, close) });
  return rows;
}

/** Ichimoku (9, 26, 52, 26): the cloud at the current bar was projected 25 bars ago. */
function ichimokuRow(ctx: PineContext, close: number): TechnicalRow {
  const midpoint = (length: number) => (value(ta.highest(ctx.high, length)) + value(ta.lowest(ctx.low, length))) / 2;
  const conversion = ctx.series("technicals.ichimoku.conversion", () => midpoint(9));
  const base = ctx.series("technicals.ichimoku.base", () => midpoint(26));
  const leadA = ctx.series("technicals.ichimoku.leadA", () => (value(conversion) + value(base)) / 2);
  const leadB = ctx.series("technicals.ichimoku.leadB", () => midpoint(52));
  const lines = { conversion: value(conversion), base: value(base), leadA: value(leadA, 25), leadB: value(leadB, 25) };
  return { name: "Ichimoku Base Line (9, 26, 52, 26)", value: lines.base, action: rateIchimoku(lines, close) };
}

/** [P, R1, R2, R3, S1, S2, S3] from the previous bar (pine-ts orders levels P, R1, S1, R2, S2, R3, S3, ...; 0 = none). */
function pivotLevels(ctx: PineContext, style: PivotStyle): number[] {
  // An anchor on every bar makes each bar a pivot period, so levels come from the bar before.
  const everyBar = ta.rising(ctx.bar_index, 1);
  const levels = ta.pivot_point_levels(style, everyBar);
  const at = (index: number) => { const level = levels.get(index); return level === 0 ? Number.NaN : level; };
  return [at(0), at(1), at(3), at(5), at(2), at(4), at(6)];
}

/** Runs the indicators over `bars` and rates the last one. */
export async function computeTechnicals(bars: readonly Bar[]): Promise<Technicals> {
  const provider = {
    getHistoricalBars: async () => bars,
    streamBars: () => ({ [Symbol.asyncIterator]: async function* () { yield* []; } }),
    getSymbolInfo: async () => ({ ticker: "TECHNICALS", timezone: "UTC", type: "crypto" as const }),
  };
  let latest: ReturnType<typeof evaluateBar> | undefined;
  const runtime = new PineRuntime({ provider, symbol: "TECHNICALS", timeframe: "1" });
  await runtime.run((ctx) => { latest = evaluateBar(ctx); }, bars as Bar[]);
  if (latest === undefined) throw new Error("Technicals need at least one bar");
  const oscillatorScore = averageAction(latest.oscillators.map((r) => r.action));
  const movingAverageScore = averageAction(latest.movingAverages.map((r) => r.action));
  return { ...latest, oscillatorScore, movingAverageScore, summaryScore: (oscillatorScore + movingAverageScore) / 2 };
}
