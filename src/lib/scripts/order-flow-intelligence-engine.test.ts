import { describe, expect, it } from "bun:test";
import type { Bar } from "@nemesis-oss/pine-ts";
import { runIndicatorCode } from "@/lib/indicator-runner";
import { runBacktest } from "@/lib/strategy-runner";
import {
  ORDER_FLOW_INTELLIGENCE_ENGINE,
  ORDER_FLOW_INTELLIGENCE_STRATEGY,
} from "./order-flow-intelligence-engine";

const ONE_MINUTE = 60_000;

const createSyntheticBars = (count: number): Bar[] => {
  let close = 50_000;
  return Array.from({ length: count }, (_, i) => {
    const open = close;
    // Inject a sudden impulsive expansion at bar 10 to guarantee a pristine FVG gap
    if (i === 10) {
      close = open + 100;
      return {
        time: i * ONE_MINUTE,
        open,
        high: close,
        low: open,
        close,
        volume: 8000,
        isClosed: true,
      };
    }
    if (i === 11) {
      close = open + 50;
      return {
        time: i * ONE_MINUTE,
        open: open + 20,
        high: close + 10,
        low: open + 15,
        close,
        volume: 6000,
        isClosed: true,
      };
    }

    const wave = Math.sin(i / 10) * 10;
    close = Math.max(100, open + wave);
    const high = Math.max(open, close) + 2;
    const low = Math.min(open, close) - 2;
    return {
      time: i * ONE_MINUTE,
      open,
      high,
      low,
      close,
      volume: 500 + (i % 6 === 0 ? 3000 : 200),
      isClosed: true,
    };
  });
};

describe("Order Flow + Market Structure Confluence Engine template", () => {
  it("compiles and runs indicator on bars with FVG boxes, labels, and HUD dashboard", async () => {
    const bars = createSyntheticBars(120);
    const run = await runIndicatorCode(ORDER_FLOW_INTELLIGENCE_ENGINE, bars);

    expect(run.drawings.table).toBeDefined();
    expect(run.drawings.table?.rows.length).toBeGreaterThanOrEqual(6);
    const boxes = run.drawings.shapes.filter((s) => s.kind === "box");
    expect(boxes.length).toBeGreaterThanOrEqual(1);
  });

  it("compiles and executes automated strategy backtest cleanly", async () => {
    const bars = createSyntheticBars(200);
    const result = await runBacktest(ORDER_FLOW_INTELLIGENCE_STRATEGY, bars);

    expect(result.ok).toBe(true);
    expect(result.summary?.initialCapital).toBe(50_000);
    expect(result.equityCurve).toHaveLength(200);
  });
});
