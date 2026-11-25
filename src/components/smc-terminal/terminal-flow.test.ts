import { describe, expect, it } from "bun:test";
import { analyzeFlow } from "./terminal-flow";
import type { Swing } from "./terminal-smc";
import type { Bar } from "./terminal-types";

const bar = (o: number, c: number, v: number, buyR: number, range = 1): Bar => ({
  t: 0, o, h: Math.max(o, c) + range / 2, l: Math.min(o, c) - range / 2, c, v, buyR, path: [o, c],
});

/** 20 balanced bars so the rolling baseline is volume 100, range ~1. */
const baseline = (price: number): Bar[] => Array.from({ length: 20 }, () => bar(price, price, 100, 0.5));

describe("analyzeFlow", () => {
  it("should mark bullish absorption when heavy selling fails to move price down", () => {
    const bars = [...baseline(100), bar(100, 99.9, 300, 0.2)];
    const { marks } = analyzeFlow(bars, bars.length, []);
    expect(marks).toEqual([expect.objectContaining({ kind: "absorb", dir: "bull", idx: 20 })]);
  });

  it("should not mark absorption when heavy selling drives price down", () => {
    const bars = [...baseline(100), bar(100, 97, 300, 0.2)];
    expect(analyzeFlow(bars, bars.length, []).marks).toEqual([]);
  });

  it("should mark bullish exhaustion when volume fades after a drop", () => {
    const drop = [99, 98, 97, 96, 95, 94].map((p) => bar(p + 1, p, 100, 0.4));
    const fade = [bar(94, 93.9, 60, 0.5), bar(93.9, 93.9, 40, 0.5), bar(93.9, 94, 20, 0.52)];
    const bars = [...baseline(100), ...drop, ...fade];
    const marks = analyzeFlow(bars, bars.length, []).marks.filter((m) => m.kind === "exhaust");
    expect(marks).toEqual([expect.objectContaining({ dir: "bull", fromIdx: 25, idx: 27 })]);
  });

  it("should find bullish CVD divergence on a lower low with a higher CVD low", () => {
    const bars = [bar(10, 9, 100, 0.1), bar(9, 9.5, 100, 0.9), bar(9.5, 8.5, 100, 0.4)];
    const swings: Swing[] = [{ idx: 0, price: 8.5, kind: "low" }, { idx: 2, price: 8, kind: "low" }];
    expect(analyzeFlow(bars, bars.length, swings).divergences).toEqual([{ dir: "bull", fromIdx: 0, toIdx: 2 }]);
  });
});
