import { describe, expect, test } from "bun:test";
import type { Bar } from "@nemesis-oss/pine-ts";
import { computeTechnicals } from "./technicals";

/** A steady uptrend with a small wobble: every MA trails price, so all MAs rate buy. */
const uptrend = (count: number): Bar[] =>
  Array.from({ length: count }, (_, i) => {
    const close = 100 + i * 0.5 + Math.sin(i) * 0.2;
    return { time: i * 3_600_000, open: close - 0.3, high: close + 0.5, low: close - 0.8, close, volume: 10 + (i % 5), isClosed: true };
  });

describe("computeTechnicals", () => {
  test("should rate 11 oscillators and 15 moving averages on the last bar", async () => {
    const technicals = await computeTechnicals(uptrend(300));
    expect(technicals.oscillators).toHaveLength(11);
    expect(technicals.movingAverages).toHaveLength(15);
    const simpleAndExponential = technicals.movingAverages.filter((row) => /^(Simple|Exponential) Moving Average/.test(row.name));
    expect(simpleAndExponential.every((row) => row.action === 1)).toBe(true);
    expect(technicals.movingAverageScore).toBeGreaterThan(0.5);
  });

  test("should compute classic pivots from the previous bar", async () => {
    const bars = uptrend(60);
    const previous = bars.at(-2)!;
    const { pivots } = await computeTechnicals(bars);
    const pivot = (previous.high + previous.low + previous.close) / 3;
    expect(pivots.CLASSIC[0]).toBeCloseTo(pivot, 9);
    expect(pivots.CLASSIC[1]).toBeCloseTo(2 * pivot - previous.low, 9);
    expect(pivots.CLASSIC[4]).toBeCloseTo(2 * pivot - previous.high, 9);
    expect(Number.isNaN(pivots.DE_MARK[2]!)).toBe(true);
  });

  test("should leave indicators without enough history neutral", async () => {
    const technicals = await computeTechnicals(uptrend(20));
    const sma200 = technicals.movingAverages.find((row) => row.name === "Simple Moving Average (200)")!;
    expect(Number.isNaN(sma200.value)).toBe(true);
    expect(sma200.action).toBe(0);
  });
});
