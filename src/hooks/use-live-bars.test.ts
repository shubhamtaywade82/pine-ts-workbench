import { describe, expect, it } from "bun:test";
import { countBarGaps, applyTrade, feedHealth, mergeBar, shouldPublishBars, type LiveTrade } from "./use-live-bars";
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

describe("feedHealth (tick age without a render per trade)", () => {
  const base = { status: "live" as const, intervalMs: 60_000, gapCount: 2, lastBarTime: 120_000 };

  it("should report the age of the last tick at the heartbeat time", () => {
    const health = feedHealth({ ...base, lastTickAt: 10_000, now: 12_500 });
    expect(health).toEqual({ lastTickAgeMs: 2_500, isStale: false, gapCount: 2, lastBarTime: 120_000 });
  });

  it("should flag a live feed as stale after three intervals without a tick", () => {
    expect(feedHealth({ ...base, lastTickAt: 0, now: 180_001 }).isStale).toBe(true);
    expect(feedHealth({ ...base, lastTickAt: 0, now: 180_000 }).isStale).toBe(false);
  });

  it("should not report an age or staleness before the first tick or while reconnecting", () => {
    expect(feedHealth({ ...base, lastTickAt: undefined, now: 999_999 })).toMatchObject({ lastTickAgeMs: undefined, isStale: false });
    expect(feedHealth({ ...base, status: "reconnecting", lastTickAt: 0, now: 999_999 }).isStale).toBe(false);
  });
});

describe("shouldPublishBars (React sees bar opens and closes, not every tick)", () => {
  const forming = bar(60_000);

  it("should publish when a new bar opens or the history length changes", () => {
    expect(shouldPublishBars([bar(0)], [bar(0), forming])).toBe(true);
    expect(shouldPublishBars([], [bar(0)])).toBe(true);
  });

  it("should publish when the last bar closes", () => {
    expect(shouldPublishBars([bar(0), forming], [bar(0), { ...forming, isClosed: true }])).toBe(true);
  });

  it("should publish when older history is prepended", () => {
    expect(shouldPublishBars([forming], [bar(0), forming])).toBe(true);
  });

  it("should not publish an intrabar tick on the forming bar", () => {
    expect(shouldPublishBars([bar(0), forming], [bar(0), { ...forming, close: 101, volume: 3 }])).toBe(false);
  });

  it("should not publish the same array twice", () => {
    const bars = [bar(0), forming];
    expect(shouldPublishBars(bars, bars)).toBe(false);
  });
});
