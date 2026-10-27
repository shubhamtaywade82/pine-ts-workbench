import { describe, expect, it } from "bun:test";
import {
  calculateFibPrice,
  computeMeasureStats,
  FIB_LEVELS,
  formatMeasureDuration,
} from "./user-drawings";

describe("formatMeasureDuration", () => {
  it("formats minutes cleanly", () => {
    expect(formatMeasureDuration(60_000)).toBe("1m");
    expect(formatMeasureDuration(15 * 60_000)).toBe("15m");
  });

  it("formats hours and remaining minutes", () => {
    expect(formatMeasureDuration(60 * 60_000)).toBe("1h");
    expect(formatMeasureDuration(90 * 60_000)).toBe("1h 30m");
  });

  it("formats days and remaining hours", () => {
    expect(formatMeasureDuration(24 * 60 * 60_000)).toBe("1d");
    expect(formatMeasureDuration(30 * 60 * 60_000)).toBe("1d 6h");
  });
});

describe("computeMeasureStats", () => {
  it("computes upward price delta and percentage", () => {
    const p1 = { time: 1000, price: 100 };
    const p2 = { time: 5000, price: 110 };
    const stats = computeMeasureStats(p1, p2, 1000);

    expect(stats.priceDelta).toBe(10);
    expect(stats.pctDelta).toBeCloseTo(10);
    expect(stats.barCount).toBe(4);
  });

  it("computes downward price delta and percentage", () => {
    const p1 = { time: 1000, price: 200 };
    const p2 = { time: 3000, price: 150 };
    const stats = computeMeasureStats(p1, p2, 1000);

    expect(stats.priceDelta).toBe(-50);
    expect(stats.pctDelta).toBeCloseTo(-25);
    expect(stats.barCount).toBe(2);
  });
});

describe("calculateFibPrice", () => {
  it("calculates accurate retracement levels", () => {
    const low = 100;
    const high = 200;
    expect(calculateFibPrice(low, high, 0.0)).toBe(100);
    expect(calculateFibPrice(low, high, 0.5)).toBe(150);
    expect(calculateFibPrice(low, high, 0.618)).toBe(161.8);
    expect(calculateFibPrice(low, high, 1.0)).toBe(200);
  });

  it("includes classic TradingView fib ratios", () => {
    const ratios = FIB_LEVELS.map((lvl) => lvl.ratio);
    expect(ratios).toEqual([0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0]);
  });
});
