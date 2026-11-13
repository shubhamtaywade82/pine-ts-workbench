import { describe, expect, it } from "bun:test";
import type { Bar } from "@nemesis-oss/pine-ts";
import { countSessionGaps, IST_OFFSET_MS, isSessionClosed, lastTradeTime } from "./session-bars";

const MIN = 60_000;
const bar = (time: number, price: number, volume = 100): Bar =>
  ({ time, open: price, high: price + 1, low: price - 1, close: price, volume, isClosed: true });
const flat = (time: number, price: number, volume: number): Bar =>
  ({ time, open: price, high: price, low: price, close: price, volume, isClosed: false });

describe("lastTradeTime", () => {
  it("finds the last real minute when the source repeats it and ends on a placeholder", () => {
    const minutes = [bar(0, 100, 50), bar(MIN, 101, 70), bar(2 * MIN, 101, 70), bar(3 * MIN, 101, 70), flat(4 * MIN, 101, 0)];
    expect(lastTradeTime(minutes)).toBe(MIN);
  });

  it("sees through a closing tick that changes the last copy's prices", () => {
    const minutes = [bar(0, 100, 50), bar(MIN, 101, 70), bar(2 * MIN, 101, 70), bar(3 * MIN, 101, 70), { ...bar(4 * MIN, 101, 70), close: 100.5, low: 100.5 }];
    expect(lastTradeTime(minutes)).toBe(MIN);
  });

  it("finds it when only the placeholder follows the last real minute", () => {
    expect(lastTradeTime([bar(0, 100, 50), bar(MIN, 101, 70), flat(2 * MIN, 101, 0)])).toBe(MIN);
  });

  it("is undefined while the market is live, even if two minutes happen to share a volume", () => {
    expect(lastTradeTime([bar(0, 100, 50), bar(MIN, 101, 90), bar(2 * MIN, 102, 80)])).toBeUndefined();
    expect(lastTradeTime([bar(0, 100, 50), bar(MIN, 101, 90), bar(2 * MIN, 102, 90)])).toBeUndefined();
  });

  it("is undefined with no bars or one bar", () => {
    expect(lastTradeTime([])).toBeUndefined();
    expect(lastTradeTime([bar(0, 100)])).toBeUndefined();
  });

  it("keeps a flat bar that actually traded", () => {
    expect(lastTradeTime([bar(0, 100, 50), flat(MIN, 100, 25)])).toBeUndefined();
  });
});

describe("countSessionGaps", () => {
  // 09:15 IST on a Monday and Tuesday, as UTC ms.
  const mondayOpen = Date.UTC(2026, 10, 9, 3, 45);
  const tuesdayOpen = mondayOpen + 24 * 60 * MIN;

  it("ignores the overnight break between sessions", () => {
    const bars = [bar(mondayOpen + 375 * MIN, 1), bar(tuesdayOpen, 1)];
    expect(countSessionGaps(bars, MIN, IST_OFFSET_MS)).toBe(0);
  });

  it("counts a hole inside one trading day", () => {
    const bars = [bar(mondayOpen, 1), bar(mondayOpen + MIN, 1), bar(mondayOpen + 5 * MIN, 1)];
    expect(countSessionGaps(bars, MIN, IST_OFFSET_MS)).toBe(1);
  });

  it("splits days at local midnight, not UTC midnight", () => {
    // 23:50 UTC is 05:20 IST the next day: the same IST day as 00:10 UTC.
    const before = Date.UTC(2026, 10, 9, 23, 50);
    const bars = [bar(before, 1), bar(before + 20 * MIN, 1)];
    expect(countSessionGaps(bars, MIN, IST_OFFSET_MS)).toBe(1);
  });
});

describe("isSessionClosed", () => {
  const now = Date.UTC(2026, 10, 13, 10, 0);

  it("is closed once the source reports trading stopped", () => {
    expect(isSessionClosed({ hasClosed: true, lastBarTime: now - MIN, now, intervalMs: MIN })).toBe(true);
  });

  it("is closed when the newest bar is much older than a live feed leaves it", () => {
    expect(isSessionClosed({ hasClosed: false, lastBarTime: now - 20 * 60 * MIN, now, intervalMs: MIN })).toBe(true);
  });

  it("is open while bars are fresh, even a few minutes behind", () => {
    expect(isSessionClosed({ hasClosed: false, lastBarTime: now - 2 * MIN, now, intervalMs: MIN })).toBe(false);
    expect(isSessionClosed({ hasClosed: false, lastBarTime: now - 12 * MIN, now, intervalMs: 5 * MIN })).toBe(false);
    expect(isSessionClosed({ hasClosed: false, lastBarTime: now - 16 * MIN, now, intervalMs: 5 * MIN })).toBe(true);
  });

  it("does not judge daily bars by age", () => {
    expect(isSessionClosed({ hasClosed: false, lastBarTime: now - 36 * 60 * MIN, now, intervalMs: 24 * 60 * MIN })).toBe(false);
  });

  it("has nothing to judge before any bar exists", () => {
    expect(isSessionClosed({ hasClosed: false, lastBarTime: undefined, now, intervalMs: MIN })).toBe(false);
  });
});
