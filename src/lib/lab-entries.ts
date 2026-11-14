import { sessionMinute, simulateDay, type BookRow, type Side, type Trade } from "./held-options";

/**
 * Entry signals and trading costs for the Long CE/PE lab. Signals read the underlying only, bar by bar, and enter
 * on the bar after the signal, so nothing a bar shows is used before that bar has closed.
 */

/** "time": buy both sides at a fixed minute. "orb": the first close beyond the 15-minute opening range. */
export type EntryMode = "time" | "orb" | "orb-twap";

/** The opening range is 09:15–09:30. */
export const OPENING_RANGE_MINUTES = 15;
/** No new breakout entries after 14:00: too little session left for a long option to pay. */
export const LAST_SIGNAL_MINUTE = 14 * 60 - (9 * 60 + 15);

export interface EntrySignal { readonly side: Side; readonly entryMinute: number; readonly rangeHigh: number; readonly rangeLow: number }

/**
 * The session's single breakout: the first bar after the opening range that closes above its high (calls) or below
 * its low (puts). With `withTwap`, the session's running average price must also have risen since the range closed
 * (calls) or fallen (puts); if not, the day has no trade. Indices have no volume, so the average is time-weighted, a
 * stand-in for VWAP. The opening range is built from bar closes, the only underlying price the rolling data carries.
 *
 * Price above the average is not tested: every close before the first breakout lies inside the range, so the
 * breakout close is always above their average. That filter would pass every breakout and compare nothing.
 */
export const orbSignal = (day: readonly BookRow[], withTwap: boolean): EntrySignal | undefined => {
  const range = day.filter((r) => sessionMinute(r.time) < OPENING_RANGE_MINUTES);
  // A range missing its first bar is a different, narrower level.
  if (range.length === 0 || sessionMinute(range[0]!.time) !== 0) return undefined;
  const high = Math.max(...range.map((r) => r.spot));
  const low = Math.min(...range.map((r) => r.spot));
  let total = 0;
  let twapAtRangeEnd = 0;
  for (const [i, row] of day.entries()) {
    total += row.spot;
    const minute = sessionMinute(row.time);
    if (minute < OPENING_RANGE_MINUTES) { twapAtRangeEnd = total / (i + 1); continue; }
    if (minute > LAST_SIGNAL_MINUTE) return undefined;
    const side: Side | undefined = row.spot > high ? "CE" : row.spot < low ? "PE" : undefined;
    if (side === undefined) continue;
    const twap = total / (i + 1);
    if (withTwap && (side === "CE" ? twap <= twapAtRangeEnd : twap >= twapAtRangeEnd)) return undefined;
    const next = day[i + 1];
    return next === undefined ? undefined : { side, entryMinute: sessionMinute(next.time), rangeHigh: high, rangeLow: low };
  }
  return undefined;
};

/** Scalps open from 09:30 to 14:30 and are closed by 15:15 at the latest. */
const SCALP_FIRST_MINUTE = OPENING_RANGE_MINUTES;
const SCALP_LAST_ENTRY_MINUTE = 14 * 60 + 30 - (9 * 60 + 15);
const SESSION_EXIT_MINUTE = 15 * 60 + 15 - (9 * 60 + 15);

export interface ScalpRules {
  /** A close beyond the highest or lowest close of this many earlier bars is a momentum signal. */
  readonly lookbackBars: number;
  readonly targetPct: number;
  readonly stopPct: number;
  readonly maxHoldMinutes: number;
}

const momentumSide = (day: readonly BookRow[], i: number, lookback: number): Side | undefined => {
  if (i < lookback) return undefined;
  const prior = day.slice(i - lookback, i).map((r) => r.spot);
  const spot = day[i]!.spot;
  return spot > Math.max(...prior) ? "CE" : spot < Math.min(...prior) ? "PE" : undefined;
};

/**
 * Every scalp in a session, one position at a time: on each momentum signal, buy the at-the-money option on the
 * next bar and hold it to the target, the stop or the hold limit. The next signal is looked for from the bar after
 * the exit, so a position is never opened on the bar that closed the last one.
 */
export const scalpDay = (day: readonly BookRow[], rules: ScalpRules): Trade[] => {
  const trades: Trade[] = [];
  let closedAt = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < day.length - 1; i++) {
    const minute = sessionMinute(day[i]!.time);
    if (day[i]!.time <= closedAt || minute < SCALP_FIRST_MINUTE || minute > SCALP_LAST_ENTRY_MINUTE) continue;
    const side = momentumSide(day, i, rules.lookbackBars);
    if (side === undefined) continue;
    const entryMinute = sessionMinute(day[i + 1]!.time);
    const exitMinute = Math.min(entryMinute + rules.maxHoldMinutes, SESSION_EXIT_MINUTE);
    const trade = simulateDay(day, { side, entryMinute, targetPct: rules.targetPct, stopPct: rules.stopPct, exitMinute });
    if (trade === undefined) continue;
    trades.push(trade);
    closedAt = trade.exitTime;
  }
  return trades;
};

// Charges per round trip for index options on Dhan, as assumed for 2026; check against the current schedules.
const BROKERAGE_PER_ORDER_INR = 20;
/** STT on the sell side's premium: 0.15% from 1 April 2026, per NSE. */
const STT_SELL_RATE = 0.0015;
/** NSE transaction charge on premium turnover. */
const EXCHANGE_RATE = 0.0003503;
const SEBI_RATE = 0.000001;
/** Stamp duty on the buy side. */
const STAMP_BUY_RATE = 0.00003;
const GST_RATE = 0.18;

/** Broker and statutory charges for buying one lot at `entry` and selling at `exit`, as a percent of the entry cost. */
export const chargesPct = (entry: number, exit: number, lotSize: number): number => {
  const bought = entry * lotSize;
  const sold = exit * lotSize;
  const brokerage = 2 * BROKERAGE_PER_ORDER_INR;
  const exchange = (bought + sold) * EXCHANGE_RATE;
  const sebi = (bought + sold) * SEBI_RATE;
  const total = brokerage + exchange + sebi + sold * STT_SELL_RATE + bought * STAMP_BUY_RATE + GST_RATE * (brokerage + exchange + sebi);
  return (total / bought) * 100;
};
