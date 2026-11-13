import type { Bar } from "@nemesis-oss/pine-ts";
import type { ChartInterval } from "@/lib/public-binance-feed";

const CANDLES_URL = "https://public.coindcx.com/market_data/candles";
const MAX_RAW_CANDLES = 1000;
const DAY_MS = 86_400_000;
// Only the sizes this module reads or builds. The server does not use the browser feed's table.
const INTERVAL_MS: Readonly<Record<string, number>> = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "1d": DAY_MS, "1w": 7 * DAY_MS,
};
// Epoch day 0 was a Thursday; weeks start on Monday, four days later, like Binance's.
const MONDAY_OFFSET_MS = 4 * DAY_MS;

/** CoinDCX serves only these candle sizes (anything else is a 422). */
const NATIVE: ReadonlySet<string> = new Set(["1m", "15m", "1h", "1d"]);

/** Other chart intervals, built from the largest native size that divides them evenly. */
const DERIVED_FROM: Readonly<Record<string, ChartInterval>> = { "3m": "1m", "5m": "1m", "30m": "15m", "2h": "1h", "4h": "1h", "1w": "1d" };

export const isCoindcxInterval = (interval: string): interval is ChartInterval => NATIVE.has(interval) || interval in DERIVED_FROM;

/** CoinDCX pair id such as "B-BTC_USDT" or "I-CELO_INR". */
export const isCoindcxPair = (pair: string): boolean => /^[A-Z]-[A-Z0-9]+_[A-Z0-9]+$/.test(pair);

interface RawCandle { readonly time: number; readonly open: number; readonly high: number; readonly low: number; readonly close: number; readonly volume: number }

const bucketStart = (time: number, intervalMs: number, interval: ChartInterval): number =>
  interval === "1w" ? Math.floor((time - MONDAY_OFFSET_MS) / intervalMs) * intervalMs + MONDAY_OFFSET_MS : Math.floor(time / intervalMs) * intervalMs;

/**
 * Merges oldest-first candles into bigger ones. The oldest bucket is dropped when the data starts
 * inside it, since a candle missing its opening minutes would carry a wrong open and high/low.
 */
export const aggregateBars = (bars: readonly Bar[], interval: ChartInterval, now: number): Bar[] => {
  const intervalMs = INTERVAL_MS[interval];
  const merged = new Map<number, Bar>();
  for (const bar of bars) {
    const start = bucketStart(bar.time, intervalMs, interval);
    const held = merged.get(start);
    merged.set(start, held === undefined
      ? { ...bar, time: start, isClosed: start + intervalMs <= now }
      : { ...held, high: Math.max(held.high, bar.high), low: Math.min(held.low, bar.low), close: bar.close, volume: held.volume + bar.volume });
  }
  const first = bars[0];
  const result = [...merged.values()];
  return first !== undefined && result[0] !== undefined && first.time > result[0].time ? result.slice(1) : result;
};

/** Candles for a CoinDCX pair, oldest first. The API returns newest first. */
export const fetchCoindcxBars = async (pair: string, interval: ChartInterval, limit: number, now = Date.now()): Promise<readonly Bar[]> => {
  const native = DERIVED_FROM[interval] ?? interval;
  const factor = INTERVAL_MS[interval] / INTERVAL_MS[native];
  const url = `${CANDLES_URL}?pair=${encodeURIComponent(pair)}&interval=${native}&limit=${Math.min(limit * factor, MAX_RAW_CANDLES)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (!res.ok) throw new Error(`CoinDCX candles ${url}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  const rows = (await res.json()) as readonly RawCandle[];
  const raw = rows
    .map((r): Bar => ({ time: r.time, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume, isClosed: r.time + INTERVAL_MS[native] <= now }))
    .reverse();
  return native === interval ? raw : aggregateBars(raw, interval, now);
};
