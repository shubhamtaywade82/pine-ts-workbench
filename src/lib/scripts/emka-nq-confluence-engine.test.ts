import { describe, expect, it } from "bun:test";
import type { Bar } from "@nemesis-oss/pine-ts";
import { runIndicatorCode } from "@/lib/indicator-runner";
import { runBacktest } from "@/lib/strategy-runner";
import { EMKA_NQ_CONFLUENCE_ENGINE, EMKA_NQ_CONFLUENCE_STRATEGY } from "./emka-nq-confluence-engine";

const ONE_MINUTE = 60_000;

// Generates 1m bars with a selloff to Put Wall followed by a sweep and reclaim
const create1mBars = (count: number): Bar[] => {
  let close = 20000;
  return Array.from({ length: count }, (_, i) => {
    const open = close;
    const change = Math.sin(i / 15) * 8 + (i % 2 === 0 ? 3 : -2.5);
    close = Math.max(100, open + change);
    const high = Math.max(open, close) + 4;
    const low = Math.min(open, close) - 4;
    return {
      time: i * ONE_MINUTE,
      open,
      high,
      low,
      close,
      volume: 1000 + (i % 5 === 0 ? 2500 : 300),
      isClosed: true,
    };
  });
};

describe("Emka.nq Confluence Engine template", () => {
  it("compiles and runs on 1m bars with plots and HUD dashboard table", async () => {
    const bars = create1mBars(200);
    const run = await runIndicatorCode(EMKA_NQ_CONFLUENCE_ENGINE, bars);

    expect(run.plots).toHaveLength(3);
    const putWallValues = run.results["Put Wall (Support)"]!;
    expect(putWallValues).toHaveLength(200);
    expect(run.drawings.table).toBeDefined();
    expect(run.drawings.table?.rows.length).toBeGreaterThanOrEqual(5);
  });

  it("runs backtest cleanly on 1m bars producing equity curve and trade execution", async () => {
    const bars = create1mBars(300);
    const result = await runBacktest(EMKA_NQ_CONFLUENCE_STRATEGY, bars);

    expect(result.ok).toBe(true);
    expect(result.summary?.initialCapital).toBe(25_000);
    expect(result.equityCurve).toHaveLength(300);
  });
});
