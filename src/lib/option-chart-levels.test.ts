import { describe, expect, it } from "bun:test";
import type { Bar } from "@nemesis-oss/pine-ts";
import type { ChartDrawing } from "@/components/chart/script-drawings-primitive";
import { optionLevelDrawings } from "./option-chart-levels";
import { summarizeChain } from "./option-chain";

const MIN = 60_000;
const bars: Bar[] = Array.from({ length: 100 }, (_, i) => ({ time: i * 5 * MIN, open: 100, high: 101, low: 99, close: 100, volume: 1, isClosed: true }));
const leg = (ltp: number, oi: number, theta = -1) => ({ last_price: ltp, oi, previous_oi: oi, greeks: { theta, gamma: 0.01 } });
const summary = summarizeChain({
  lastPrice: 100,
  strikes: [
    { strike: 90, put: leg(1, 500) }, { strike: 95, put: leg(2, 300) },
    { strike: 100, call: leg(3, 100), put: leg(3, 100) },
    { strike: 105, call: leg(2, 300) }, { strike: 110, call: leg(1, 500) },
  ],
}, undefined, { expiry: "2026-11-27", now: Date.UTC(2026, 10, 13) })!;
const span = { startTime: bars[20]!.time, lastTime: bars.at(-1)!.time };
const drawings = optionLevelDrawings(summary, span, 5 * MIN);
const lines = drawings.filter((d): d is Extract<ChartDrawing, { kind: "shape-line" }> => d.kind === "shape-line");
const labels = drawings.filter((d): d is Extract<ChartDrawing, { kind: "label" }> => d.kind === "label");

describe("optionLevelDrawings", () => {
  it("draws the walls at their strikes, the strongest solid and thicker", () => {
    const callWall = lines.find((l) => l.y1 === 110)!;
    const secondCall = lines.find((l) => l.y1 === 105)!;
    expect(callWall).toMatchObject({ style: "solid", width: 2, color: "#f23645" });
    expect(secondCall).toMatchObject({ style: "dashed", width: 1 });
    expect(lines.find((l) => l.y1 === 90)).toMatchObject({ style: "solid", color: "#089981" });
  });

  it("draws max pain and the expected range from the straddle", () => {
    expect(lines.some((l) => l.y1 === summary.maxPain && l.color === "#f7b731")).toBe(true);
    const box = drawings.find((d) => d.kind === "shape-box") as Extract<ChartDrawing, { kind: "shape-box" }>;
    expect(box.top).toBe(summary.analytics.upperBreakeven!);
    expect(box.bottom).toBe(summary.analytics.lowerBreakeven!);
  });

  it("runs the lines past the last bar so they read as levels ahead", () => {
    const lastBar = bars.at(-1)!.time;
    expect(lines.every((l) => l.to > lastBar && l.from <= lastBar)).toBe(true);
  });

  it("labels each line with its name and size", () => {
    const text = labels.map((l) => l.text);
    expect(text).toContain("Call wall 110 · 500");
    expect(text).toContain("Put wall 90 · 500");
    expect(text.some((t) => t.startsWith("Max pain"))).toBe(true);
    expect(text.some((t) => t.startsWith("Expected range"))).toBe(true);
  });

  it("draws nothing without bars", () => {
    expect(optionLevelDrawings(summary, undefined, 5 * MIN)).toEqual([]);
  });
});
