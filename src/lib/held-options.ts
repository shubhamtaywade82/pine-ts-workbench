/**
 * Follows one bought option contract through a day even as the money moves away from it. Dhan's rolling series
 * gives each bar's ATM±n strikes with their real strike numbers, so a contract bought at the money is found again
 * at whatever offset it has drifted to, for as long as it stays within the strikes fetched.
 */

import { IST_OFFSET_MS } from "./rolling-options";

export interface Quote { readonly high: number; readonly low: number; readonly close: number }

/** One bar: spot, the at-the-money strike, ATM IV, and every fetched strike's call and put quote. */
export interface BookRow {
  readonly time: number;
  readonly spot: number;
  readonly atm: number;
  readonly iv: number;
  readonly ce: Readonly<Record<string, Quote>>;
  readonly pe: Readonly<Record<string, Quote>>;
  /** The underlying's high and low over the bar, when fetched. */
  readonly range?: SpotRange | undefined;
}

export interface OffsetSide {
  readonly side: "CALL" | "PUT";
  readonly offset: number;
  readonly timestamp?: readonly number[];
  readonly strike?: readonly number[];
  readonly high?: readonly number[];
  readonly low?: readonly number[];
  readonly close?: readonly number[];
  readonly spot?: readonly number[];
  readonly iv?: readonly number[];
}

/** The underlying's high and low over one bar. */
export interface SpotRange { readonly high: number; readonly low: number }

/**
 * Merges every offset's series into one book per bar, oldest first, then repairs bars whose highs and lows mix
 * strikes (see `repairMixedExtremes`). Bars without the ATM call and put are dropped.
 */
export const buildBook = (series: readonly OffsetSide[], spot: ReadonlyMap<number, SpotRange> = new Map()): BookRow[] => {
  type Draft = { time: number; spot: number; atm?: number; ivs: number[]; ce: Record<string, Quote>; pe: Record<string, Quote> };
  const bars = new Map<number, Draft>();
  for (const s of series) {
    (s.timestamp ?? []).forEach((seconds, i) => {
      const strike = s.strike?.[i];
      const close = s.close?.[i];
      if (strike === undefined || close === undefined) return;
      const time = seconds * 1000;
      const bar = bars.get(time) ?? { time, spot: 0, ivs: [], ce: {}, pe: {} };
      bar.spot ||= s.spot?.[i] ?? 0;
      (s.side === "CALL" ? bar.ce : bar.pe)[String(strike)] = { high: s.high?.[i] ?? close, low: s.low?.[i] ?? close, close };
      if (s.offset === 0) { bar.atm = strike; bar.ivs.push(s.iv?.[i] ?? 0); }
      bars.set(time, bar);
    });
  }
  return repairMixedExtremes([...bars.values()]
    .filter((b): b is Draft & { atm: number } => b.atm !== undefined && b.ivs.length === 2)
    .sort((a, b) => a.time - b.time)
    .map((b) => ({ time: b.time, spot: b.spot, atm: b.atm, iv: (b.ivs[0]! + b.ivs[1]!) / 2, ce: b.ce, pe: b.pe, range: spot.get(b.time) })));
};

/** The gap between listed strikes: the smallest difference between neighbours in the bar. */
export const strikeStep = (row: BookRow): number | undefined => {
  const strikes = Object.keys(row.ce).map(Number).sort((a, b) => a - b);
  const gaps = strikes.slice(1).map((s, i) => s - strikes[i]!).filter((g) => g > 0);
  return gaps.length === 0 ? undefined : Math.min(...gaps);
};

/**
 * Whether every offset followed one contract for the whole bar. A rolling series follows an offset, not a contract:
 * when the money crosses a strike boundary inside a bar, that bar's highs and lows mix two strikes. With the
 * underlying's range, any crossing is caught, including one that went and came back; without it, only a change of
 * strike from the previous bar is.
 */
export const isSingleStrikeBar = (row: BookRow, previous: BookRow | undefined): boolean => {
  const step = strikeStep(row);
  if (row.range === undefined || step === undefined) return previous === undefined || previous.atm === row.atm;
  const atmAt = (price: number): number => Math.round(price / step) * step;
  return atmAt(row.range.low) === row.atm && atmAt(row.range.high) === row.atm;
};

/** Rows with mixed highs and lows rebuilt from their closes; rows must be oldest first. */
export const repairMixedExtremes = (rows: readonly BookRow[]): BookRow[] =>
  rows.map((row, i) => (isSingleStrikeBar(row, rows[i - 1]) ? row : { ...row, ce: estimatedExtremes(row, "ce"), pe: estimatedExtremes(row, "pe") }));

/**
 * Each contract's high and low re-estimated from its own close and the underlying's range, through the delta its
 * neighbours' closes imply: (price one strike below − one strike above) ÷ two steps. Without the range, or without
 * neighbours, the close alone stands for the bar: no invented extreme can trigger a stop or a target.
 */
const estimatedExtremes = (row: BookRow, book: "ce" | "pe"): Record<string, Quote> => {
  const quotes = row[book];
  const step = strikeStep(row);
  return Object.fromEntries(Object.entries(quotes).map(([key, q]) => {
    const strike = Number(key);
    const below = step === undefined ? undefined : quotes[String(strike - step)]?.close;
    const above = step === undefined ? undefined : quotes[String(strike + step)]?.close;
    if (row.range === undefined || below === undefined || above === undefined) return [key, { high: q.close, low: q.close, close: q.close }];
    const delta = (below - above) / (2 * step!);
    const moves = [delta * (row.range.high - row.spot), delta * (row.range.low - row.spot)];
    return [key, { high: q.close + Math.max(0, ...moves), low: Math.max(0.05, q.close + Math.min(0, ...moves)), close: q.close }];
  }));
};

export const MARKET_OPEN_MINUTE = 9 * 60 + 15;
/** Minutes after the 09:15 open, in IST. */
export const sessionMinute = (time: number): number => {
  const ist = new Date(time + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes() - MARKET_OPEN_MINUTE;
};

export type Side = "CE" | "PE";

export interface TradeRules {
  readonly side: Side;
  /** Minutes after the open to buy: the first bar at or after it. */
  readonly entryMinute: number;
  /** Exit when the premium is up this much, in percent. */
  readonly targetPct?: number;
  /** Exit when the premium is down this much, in percent (a positive number). */
  readonly stopPct?: number;
  /** Minutes after the open to exit at the latest. */
  readonly exitMinute: number;
  /** How the stop follows the premium up. */
  readonly trail?: Trail;
  /** The trade's reason is gone, judged on a bar's close (for example the underlying back inside a broken range). */
  readonly isInvalidated?: (row: BookRow) => boolean;
}

/**
 * Trailing rules, all on the option's premium. "breakeven" moves the stop to the entry once the premium is up
 * `afterPct`; "giveback" then keeps it `givebackPct` below the best price; "step" raises it by `stepPct` of the
 * entry for every `stepPct` the best price gains, as a broker's trailing jump does.
 */
export type Trail =
  | { readonly kind: "breakeven"; readonly afterPct: number }
  | { readonly kind: "giveback"; readonly afterPct: number; readonly givebackPct: number }
  | { readonly kind: "step"; readonly stepPct: number };

/** The stop for a best price so far. The best price never falls, so neither does the stop. */
export const trailedStop = (trail: Trail | undefined, entry: number, best: number, initialStop: number): number => {
  const gainPct = (best / entry - 1) * 100;
  if (trail === undefined) return initialStop;
  if (trail.kind === "step") return initialStop + Math.max(0, Math.floor(gainPct / trail.stepPct)) * (trail.stepPct / 100) * entry;
  if (gainPct < trail.afterPct) return initialStop;
  return Math.max(initialStop, trail.kind === "breakeven" ? entry : best * (1 - trail.givebackPct / 100));
};

export type ExitReason = "target" | "stop" | "trailing stop" | "invalidated" | "time" | "lost track" | "day end";

export interface Trade {
  readonly side: Side;
  readonly strike: number;
  readonly entryTime: number;
  readonly entryPrice: number;
  readonly exitTime: number;
  readonly exitPrice: number;
  readonly returnPct: number;
  readonly exitReason: ExitReason;
  /** Best gain on the way, from bar highs, in percent. */
  readonly mfePct: number;
  /** Worst drawdown on the way, from bar lows, in percent. */
  readonly maePct: number;
  readonly minutesToPeak: number;
}

const pct = (price: number, entry: number): number => ((price - entry) / entry) * 100;

/**
 * Buys the at-the-money contract at the entry bar and holds it until a rule exits it. A bar is checked against its
 * low before its high, so a bar that touched both the stop and the target counts as stopped: the cautious reading.
 */
export const simulateDay = (day: readonly BookRow[], rules: TradeRules): Trade | undefined => {
  const startIndex = day.findIndex((r) => sessionMinute(r.time) >= rules.entryMinute);
  const start = day[startIndex];
  if (start === undefined || sessionMinute(start.time) >= rules.exitMinute) return undefined;
  const book = rules.side === "CE" ? "ce" : "pe";
  const strike = start.atm;
  const entryPrice = start[book][String(strike)]?.close;
  if (entryPrice === undefined || entryPrice <= 0) return undefined;
  const target = rules.targetPct === undefined ? Number.POSITIVE_INFINITY : entryPrice * (1 + rules.targetPct / 100);
  const initialStop = rules.stopPct === undefined ? Number.NEGATIVE_INFINITY : entryPrice * (1 - rules.stopPct / 100);
  let stop = initialStop; let best = entryPrice; let worst = entryPrice; let peakTime = start.time; let last = { time: start.time, price: entryPrice };
  const done = (time: number, price: number, exitReason: ExitReason): Trade => ({
    side: rules.side, strike, entryTime: start.time, entryPrice, exitTime: time, exitPrice: price, returnPct: pct(price, entryPrice), exitReason,
    mfePct: pct(best, entryPrice), maePct: pct(worst, entryPrice), minutesToPeak: Math.round((peakTime - start.time) / 60_000),
  });
  for (const row of day.slice(startIndex + 1)) {
    const quote = row[book][String(strike)];
    if (quote === undefined) return done(last.time, last.price, "lost track");
    worst = Math.min(worst, quote.low);
    // A bar that opened below the stop could not have sold at the stop: take the best price it offered instead.
    if (quote.low <= stop) return done(row.time, Math.min(stop, quote.high), stop > initialStop ? "trailing stop" : "stop");
    if (quote.high > best) { best = quote.high; peakTime = row.time; }
    if (quote.high >= target) return done(row.time, target, "target");
    // Moved on this bar's high, the stop takes effect from the next bar: within a bar the order of high and low is unknown.
    stop = trailedStop(rules.trail, entryPrice, best, initialStop);
    if (rules.isInvalidated?.(row) === true) return done(row.time, quote.close, "invalidated");
    last = { time: row.time, price: quote.close };
    if (sessionMinute(row.time) >= rules.exitMinute) return done(row.time, quote.close, "time");
  }
  return done(last.time, last.price, "day end");
};
