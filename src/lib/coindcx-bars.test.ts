import { describe, expect, it } from "bun:test";
import type { Bar } from "@nemesis-oss/pine-ts";
import { aggregateBars, isCoindcxInterval, isCoindcxPair } from "./coindcx-bars";

const MIN = 60_000;
const bar = (time: number, open: number, high: number, low: number, close: number, volume = 1): Bar =>
  ({ time, open, high, low, close, volume, isClosed: true });

describe("aggregateBars", () => {
  it("merges 1m candles into one 5m candle with the right open, high, low, close and volume", () => {
    const minutes = [bar(0, 10, 12, 9, 11), bar(MIN, 11, 15, 10, 14), bar(2 * MIN, 14, 14, 8, 9), bar(3 * MIN, 9, 10, 9, 10), bar(4 * MIN, 10, 11, 10, 11)];

    const [merged, ...rest] = aggregateBars(minutes, "5m", 10 * MIN);

    expect(rest).toEqual([]);
    expect(merged).toEqual({ time: 0, open: 10, high: 15, low: 8, close: 11, volume: 5, isClosed: true });
  });

  it("drops an opening bucket the data starts inside, and keeps the forming one open", () => {
    const minutes = Array.from({ length: 12 }, (_, i) => bar((3 + i) * MIN, 1, 1, 1, 1));

    const merged = aggregateBars(minutes, "5m", 14 * MIN);

    expect(merged.map((b) => b.time)).toEqual([5 * MIN, 10 * MIN]);
    expect(merged.map((b) => b.isClosed)).toEqual([true, false]);
  });

  it("starts weekly candles on Monday", () => {
    const DAY = 86_400_000;
    const monday = Date.UTC(2026, 10, 9);
    const days = Array.from({ length: 14 }, (_, i) => bar(monday + i * DAY, 1, 1, 1, 1));

    expect(aggregateBars(days, "1w", monday + 20 * DAY).map((b) => b.time)).toEqual([monday, monday + 7 * DAY]);
  });
});

describe("CoinDCX support checks", () => {
  it("accepts native and buildable intervals and rejects ones it cannot serve", () => {
    for (const ok of ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"]) expect(isCoindcxInterval(ok)).toBe(true);
    for (const bad of ["1s", "1M", "7m"]) expect(isCoindcxInterval(bad)).toBe(false);
  });

  it("accepts only well-formed pair ids", () => {
    expect(isCoindcxPair("B-BTC_USDT")).toBe(true);
    expect(isCoindcxPair("I-CELO_INR")).toBe(true);
    expect(isCoindcxPair("../etc/passwd")).toBe(false);
    expect(isCoindcxPair("btc")).toBe(false);
  });
});
