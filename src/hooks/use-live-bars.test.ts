import { describe, expect, it } from "bun:test";
import { countBarGaps, applyTrade, mergeBar, type LiveTrade } from "./use-live-bars";
import type { Bar } from "@nemesis-oss/pine-ts";

const bar = (time: number, partial: Partial<Bar> = {}): Bar => ({
  time,
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 1,
  isClosed: false,
  ...partial,
});

describe("countBarGaps (data-quality warnings)", () => {
  it("returns 0 for a contiguous history", () => {
    const bars = [bar(0), bar(60_000), bar(120_000), bar(180_000)];
    expect(countBarGaps(bars, 60_000)).toBe(0);
  });

  it("counts each hole in the timeline once", () => {
    const bars = [bar(0), bar(60_000), bar(300_000), bar(360_000), bar(1_000_000)];
    // 120s→300s (one gap) and 360s→1000s (one gap) = 2.
    expect(countBarGaps(bars, 60_000)).toBe(2);
  });

  it("ignores a single missing bar as zero-width (equal times replace)", () => {
    const bars = [bar(0), bar(60_000), bar(60_000)];
    expect(countBarGaps(bars, 60_000)).toBe(0);
  });

  it("handles short histories", () => {
    expect(countBarGaps([], 60_000)).toBe(0);
    expect(countBarGaps([bar(0)], 60_000)).toBe(0);
  });
});

describe("mergeBar + applyTrade (out-of-order protection)", () => {
  it("drops trades older than the forming bar", () => {
    const bars = [bar(60_000)];
    const stale: LiveTrade = { id: 1, time: 30_000, price: 100, quantity: 1, aggressor: "buy" };
    const merged = mergeBar(bars, applyTrade(bars[0]!, stale, 60_000));
    expect(merged[0]!.close).toBe(100);
  });

  it("opens the next candle when a trade is past the interval", () => {
    const bars = [bar(0, { close: 100 })];
    const next: LiveTrade = { id: 2, time: 130_000, price: 105, quantity: 2, aggressor: "sell" };
    const merged = mergeBar(bars, applyTrade(bars[0]!, next, 60_000));
    expect(merged.at(-1)!.time).toBe(120_000);
    expect(merged.at(-1)!.open).toBe(105);
  });
});
