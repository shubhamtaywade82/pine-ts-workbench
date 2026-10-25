/**
 * Stub data provider for the chart workbench — returns synthetic BTCUSDT
 * 1-day bars. Lets the workbench run end-to-end without needing real
 * Binance/DhanHQ credentials. Wave 14b will swap this for the real
 * BinanceProvider / DhanHQProvider behind a config flag.
 *
 * Bars use IST-day-aligned timestamps so they line up with the daily
 * timeframe convention (1 bar = 86_400_000 ms). The price series follows
 * a random walk seeded for reproducibility.
 */

import type { Bar } from "@nemesis-oss/pine-ts";

const DAY_MS = 86_400_000;
const BAR_COUNT = 200;
const SEED_PRICE = 40_000;

/** Mulberry32 PRNG for deterministic random walks. */
const mulberry32 = (seed: number): (() => number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};

/**
 * Returns `count` synthetic BTC bars, oldest first, starting at `startMs`.
 * The price follows a small-drift random walk ±0.5%/day; volume oscillates.
 */
export const generateBars = (
  count: number = BAR_COUNT,
  startMs: number = Date.UTC(2024, 0, 1),
  seedPrice: number = SEED_PRICE,
): Bar[] => {
  const rng = mulberry32(42);
  const bars: Bar[] = [];
  let prevClose = seedPrice;
  for (let i = 0; i < count; i += 1) {
    const time = startMs + i * DAY_MS;
    // ±0.5% drift, slightly biased upward to look like a bull trend.
    const change = (rng() - 0.48) * 0.01;
    const close = prevClose * (1 + change);
    const open = prevClose;
    const high = Math.max(open, close) * (1 + rng() * 0.005);
    const low = Math.min(open, close) * (1 - rng() * 0.005);
    const volume = 1000 + Math.floor(rng() * 5000);
    bars.push({ time, open, high, low, close, volume, isClosed: true });
    prevClose = close;
  }
  return bars;
};

/** Default 200-bar BTC feed, computed once per module load. */
export const STUB_BARS: Bar[] = generateBars();
