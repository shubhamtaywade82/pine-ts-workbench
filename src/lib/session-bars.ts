import type { Bar } from "@nemesis-oss/pine-ts";

/** India has no daylight saving, so a fixed offset is exact. */
export const IST_OFFSET_MS = 19_800_000;
const DAY_MS = 86_400_000;

const isFlat = (bar: Bar): boolean => bar.open === bar.high && bar.high === bar.low && bar.low === bar.close;

// Four minutes in a row with the exact same nonzero volume does not happen while a market trades.
const MIN_REPEATED_VOLUMES = 2;

/**
 * The start time of the last minute that really traded, once a source has stopped trading and is repeating
 * itself. After the close Dhan emits one copy per minute of the last real bar (same volume, and prices that
 * may differ by a closing tick), then a zero-volume flat placeholder. Drawn as candles they fake volume and a
 * market still moving. Undefined while the market is live. Needs 1-minute bars covering the last real trade:
 * larger intervals sum the copies into candles that no longer look like repeats, so they are cut at this time
 * instead. Session markets only: on a 24/7 market a repeated or flat candle can be real.
 */
export const lastTradeTime = (minuteBars: readonly Bar[]): number | undefined => {
  let end = minuteBars.length;
  const last = minuteBars[end - 1];
  const before = minuteBars[end - 2];
  const hasPlaceholder = last !== undefined && before !== undefined && last.volume === 0 && isFlat(last) && last.close === before.close;
  if (hasPlaceholder) end -= 1;
  let first = end - 1;
  while (first >= 1 && minuteBars[first]!.volume > 0 && minuteBars[first]!.volume === minuteBars[first - 1]!.volume) first -= 1;
  if (!hasPlaceholder && end - 1 - first < MIN_REPEATED_VOLUMES) return undefined;
  // An index's price can keep moving for a minute or two after its volume field freezes: keep those bars.
  let lastMoving = first;
  while (lastMoving + 1 < end && minuteBars[lastMoving + 1]!.close !== minuteBars[lastMoving]!.close) lastMoving += 1;
  return minuteBars[lastMoving]?.time;
};

/**
 * Missing-bar gaps inside a trading day. The break between one session's close and the next open (overnight,
 * weekend, holiday) is not missing data, so a gap only counts when both bars fall on the same local day.
 */
export const countSessionGaps = (bars: readonly Bar[], intervalMs: number, utcOffsetMs: number): number => {
  const day = (time: number): number => Math.floor((time + utcOffsetMs) / DAY_MS);
  let gaps = 0;
  for (let i = 1; i < bars.length; i += 1) {
    const before = bars[i - 1]!;
    const after = bars[i]!;
    if (after.time > before.time + intervalMs && day(before.time) === day(after.time)) gaps += 1;
  }
  return gaps;
};

// A live feed leaves the newest bar at most one interval old, plus provider lag; beyond this, nothing is trading.
const MARKET_CLOSED_GRACE_MS = 5 * 60_000;
const LONGEST_CHECKED_INTERVAL_MS = 3_600_000;

/**
 * Whether a session market has stopped trading: the source reports it stopped, or the newest
 * bar is far older than a live feed would leave it. Daily and larger bars are never this fresh, so they
 * are not judged by age.
 */
export const isSessionClosed = (input: {
  readonly hasClosed: boolean;
  readonly lastBarTime: number | undefined;
  readonly now: number;
  readonly intervalMs: number;
}): boolean => {
  const { hasClosed, lastBarTime, now, intervalMs } = input;
  if (hasClosed) return true;
  return lastBarTime !== undefined && intervalMs <= LONGEST_CHECKED_INTERVAL_MS
    && now - lastBarTime > intervalMs * 2 + MARKET_CLOSED_GRACE_MS;
};

/**
 * Merges consecutive bars into bigger ones, restarting at each trading day's first bar. NSE builds its 2h and
 * 4h candles this way from hourly bars (09:15-13:15, then the rest of the day), not from clock-aligned buckets.
 */
export const groupSessionBars = (bars: readonly Bar[], groupSize: number, utcOffsetMs = IST_OFFSET_MS): Bar[] => {
  const grouped: Bar[] = [];
  let day = Number.NaN;
  let inGroup = 0;
  for (const bar of bars) {
    const barDay = Math.floor((bar.time + utcOffsetMs) / DAY_MS);
    const held = grouped.at(-1);
    if (held === undefined || barDay !== day || inGroup === groupSize) {
      grouped.push({ ...bar });
      day = barDay;
      inGroup = 1;
    } else {
      grouped[grouped.length - 1] = { ...held, high: Math.max(held.high, bar.high), low: Math.min(held.low, bar.low), close: bar.close, volume: held.volume + bar.volume, isClosed: bar.isClosed };
      inGroup += 1;
    }
  }
  return grouped;
};
