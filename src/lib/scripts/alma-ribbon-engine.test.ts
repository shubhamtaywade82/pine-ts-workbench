import { describe, expect, it } from "bun:test";
import type { Bar } from "@nemesis-oss/pine-ts";
import { runIndicatorCode } from "@/lib/indicator-runner";
import { runBacktest } from "@/lib/strategy-runner";
import { ALMA_RIBBON_ENGINE, toAlmaStrategy } from "./alma-ribbon-engine";

const ONE_HOUR = 3_600_000;

const createTrendingBars = (count: number): Bar[] => {
  let close = 100;
  return Array.from({ length: count }, (_, i) => {
    const trend = Math.sin(i / 30) * 2;
    const open = close;
    close = Math.max(10, open + trend + (i % 2 === 0 ? 0.3 : -0.2));
    const high = Math.max(open, close) + 0.5;
    const low = Math.min(open, close) - 0.5;
    return {
      time: i * ONE_HOUR,
      open,
      high,
      low,
      close,
      volume: 1000 + (i % 10) * 100,
      isClosed: true,
    };
  });
};

describe("ALMA Ribbon & Confluence Engine template", () => {
  it("runs on bars and generates all 4 ALMA plots and HUD table", async () => {
    const bars = createTrendingBars(300);
    const run = await runIndicatorCode(ALMA_RIBBON_ENGINE, bars);

    expect(run.plots).toHaveLength(4);
    const fastValues = run.results["Fast ALMA"]!;
    expect(fastValues).toHaveLength(300);

    // After warm-up (macro length 150), values are defined numbers
    expect(fastValues[200]).toBeDefined();
    expect(Number.isFinite(fastValues[200])).toBe(true);

    // Drawings include HUD table
    expect(run.drawings.table).toBeDefined();
    expect(run.drawings.table?.rows.length).toBeGreaterThanOrEqual(5);
  });

  it("converts to backtestable strategy and executes trades", async () => {
    const bars = createTrendingBars(400);
    const strategyCode = toAlmaStrategy(ALMA_RIBBON_ENGINE);
    const result = await runBacktest(strategyCode, bars);

    expect(result.ok).toBe(true);
    expect(result.summary?.initialCapital).toBe(10_000);
    expect(result.equityCurve).toHaveLength(400);
  });
});
