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

/** Merges every offset's series into one book per bar, oldest first. Bars without the ATM call and put are dropped. */
export const buildBook = (series: readonly OffsetSide[]): BookRow[] => {
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
  return dropMixedExtremes([...bars.values()]
    .filter((b): b is Draft & { atm: number } => b.atm !== undefined && b.ivs.length === 2)
    .sort((a, b) => a.time - b.time)
    .map((b) => ({ time: b.time, spot: b.spot, atm: b.atm, iv: (b.ivs[0]! + b.ivs[1]!) / 2, ce: b.ce, pe: b.pe })));
};

/** Bars where the at-the-money strike changed keep only their closes; see `closesOnly`. Rows must be oldest first. */
export const dropMixedExtremes = (rows: readonly BookRow[]): BookRow[] =>
  rows.map((row, i) => (i > 0 && rows[i - 1]!.atm !== row.atm ? { ...row, ce: closesOnly(row.ce), pe: closesOnly(row.pe) } : row));

/**
 * A rolling series follows an offset, not a contract: in a bar where the money moved, each offset's high and low
 * mix two strikes, and only the close belongs to the strike the bar is labelled with. Those bars keep their closes.
 */
const closesOnly = (quotes: Readonly<Record<string, Quote>>): Record<string, Quote> =>
  Object.fromEntries(Object.entries(quotes).map(([strike, q]) => [strike, { high: q.close, low: q.close, close: q.close }]));

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
}

export type ExitReason = "target" | "stop" | "time" | "lost track" | "day end";

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
  const stop = rules.stopPct === undefined ? Number.NEGATIVE_INFINITY : entryPrice * (1 - rules.stopPct / 100);
  let best = entryPrice; let worst = entryPrice; let peakTime = start.time; let last = { time: start.time, price: entryPrice };
  const done = (time: number, price: number, exitReason: ExitReason): Trade => ({
    side: rules.side, strike, entryTime: start.time, entryPrice, exitTime: time, exitPrice: price, returnPct: pct(price, entryPrice), exitReason,
    mfePct: pct(best, entryPrice), maePct: pct(worst, entryPrice), minutesToPeak: Math.round((peakTime - start.time) / 60_000),
  });
  for (const row of day.slice(startIndex + 1)) {
    const quote = row[book][String(strike)];
    if (quote === undefined) return done(last.time, last.price, "lost track");
    if (quote.low < worst) worst = quote.low;
    // A bar that opened below the stop could not have sold at the stop: take the best price it offered instead.
    if (quote.low <= stop) return done(row.time, Math.min(stop, quote.high), "stop");
    if (quote.high > best) { best = quote.high; peakTime = row.time; }
    if (quote.high >= target) return done(row.time, target, "target");
    last = { time: row.time, price: quote.close };
    if (sessionMinute(row.time) >= rules.exitMinute) return done(row.time, quote.close, "time");
  }
  return done(last.time, last.price, "day end");
};
