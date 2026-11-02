import { describe, expect, test } from "bun:test";
import type { Bar } from "@nemesis-oss/pine-ts";
import { computeAlertContext, estimate24hBars } from "./alert-context";

const MINUTE = 60_000;
const bars = (count: number): Bar[] =>
  Array.from({ length: count }, (_, i) => ({
    time: i * MINUTE, open: 100 + i * 0.1, high: 101 + i * 0.1, low: 99 + i * 0.1,
    close: 100.5 + i * 0.1, volume: 1000 + i, isClosed: i < count - 1,
  }));

describe("computeAlertContext", () => {
  test("derives price, rsi, sma, volumes and forming bar time", async () => {
    const ctx = await computeAlertContext(bars(60), MINUTE, "BTCUSDT");
    expect(ctx).toBeDefined();
    expect(ctx!.symbol).toBe("BTCUSDT");
    expect(ctx!.price).toBeCloseTo(100.5 + 59 * 0.1, 6);
    expect(ctx!.rsi).toBeGreaterThan(0);
    expect(ctx!.sma).toBeGreaterThan(0);
    expect(ctx!.volume).toBe(1000 + 59);
    expect(ctx!.barTime).toBe(59 * MINUTE);
    // Uptrend so macdHist > -inf, defined.
    expect(ctx!.macdHist).toBeDefined();
  });

  test("returns undefined for empty bars", async () => {
    expect(await computeAlertContext([], MINUTE, "BTCUSDT")).toBeUndefined();
  });

  test("24h bar estimate matches the interval", () => {
    expect(estimate24hBars(MINUTE)).toBe(1440);
    expect(estimate24hBars(3_600_000)).toBe(24);
    expect(estimate24hBars(60_000)).toBe(1440);
  });
});
