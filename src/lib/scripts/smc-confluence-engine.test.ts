import { describe, expect, it } from "bun:test";
import type { Bar } from "@nemesis-oss/pine-ts";
import { createLiveRunner, runIndicatorCode } from "@/lib/indicator-runner";
import { toChartDrawings } from "@/lib/editor-output";
import { runBacktest } from "@/lib/strategy-runner";
import { SMC_CONFLUENCE_ENGINE, SMC_CONFLUENCE_STRATEGY } from "./smc-confluence-engine";

const FIVE_MINUTES = 300_000;

/** Deterministic 5m bars: a slow sine trend with noise, so swings, sweeps and gaps all occur. */
const syntheticBars = (count: number): Bar[] => {
  let seed = 7;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  let close = 100;
  return Array.from({ length: count }, (_, i) => {
    const open = close;
    close = Math.max(1, open + Math.sin(i / 120) * 0.15 + noise() * 0.6);
    const high = Math.max(open, close) + Math.abs(noise()) * 0.4;
    const low = Math.min(open, close) - Math.abs(noise()) * 0.4;
    return { time: i * FIVE_MINUTES, open, high, low, close, volume: 100 + Math.abs(noise()) * 900, isClosed: true };
  });
};

describe("SMC Confluence Engine template", () => {
  it("runs on 5m bars and produces scores, drawings and the dashboard", async () => {
    const run = await runIndicatorCode(SMC_CONFLUENCE_ENGINE, syntheticBars(3000));
    const longScores = run.results["CE Long Score"]!.filter((x) => x !== undefined);
    expect(longScores.length).toBe(3000);
    expect(Math.max(...(longScores as number[]))).toBeGreaterThan(30);
    expect(run.drawings.shapes.length).toBeGreaterThan(10);
    expect(run.drawings.table?.rows.length).toBe(16);
    expect(run.drawings.bgcolors.length).toBeGreaterThan(0);
    expect(run.drawings.barcolors.length).toBeGreaterThan(0);
    const chartDrawings = toChartDrawings(run.drawings, syntheticBars(3000));
    const barcolorDrawings = chartDrawings.filter((d) => d.kind === "barcolor");
    expect(barcolorDrawings.length).toBeGreaterThan(0);
    expect(barcolorDrawings[0]?.color).toBeDefined();
    expect(run.inputs.length).toBeGreaterThan(40);
  });
});

describe("SMC Confluence Engine on a live runner", () => {
  it("gives the same output as a full run after a tick and a new bar", async () => {
    const bars = syntheticBars(600).map((bar, i, all) => (i === all.length - 1 ? { ...bar, isClosed: false } : bar));
    const runLive = createLiveRunner();
    await runLive(SMC_CONFLUENCE_ENGINE, bars);
    const last = bars.at(-1)!;
    const ticked = [...bars.slice(0, -1), { ...last, close: last.close + 0.4, high: Math.max(last.high, last.close + 0.4) }];
    expect(await runLive(SMC_CONFLUENCE_ENGINE, ticked)).toEqual(await runIndicatorCode(SMC_CONFLUENCE_ENGINE, ticked));
    const next = [...ticked.slice(0, -1), { ...ticked.at(-1)!, isClosed: true }, { ...last, time: last.time + FIVE_MINUTES, isClosed: false }];
    expect(await runLive(SMC_CONFLUENCE_ENGINE, next)).toEqual(await runIndicatorCode(SMC_CONFLUENCE_ENGINE, next));
  });
});

describe("SMC Confluence Strategy template", () => {
  it("runs backtest cleanly on bars producing performance metrics and equity curve", async () => {
    const res = await runBacktest(SMC_CONFLUENCE_STRATEGY, syntheticBars(1000));
    expect(res.ok).toBe(true);
    expect(res.summary?.initialCapital).toBe(10_000);
    expect(res.equityCurve?.length).toBe(1000);
    expect(Array.isArray(res.trades)).toBe(true);
    expect(res.trades?.length).toBeGreaterThan(0);
    expect(res.summary?.totalTrades).toBeGreaterThan(0);
  });

  it("executes profitable confluence trades over multi-swing cycles", async () => {
    const res = await runBacktest(SMC_CONFLUENCE_STRATEGY, syntheticBars(3000));
    expect(res.ok).toBe(true);
    expect(res.trades?.length).toBeGreaterThanOrEqual(5);
    expect(res.summary?.winRate).toBeGreaterThanOrEqual(40);
    expect(res.summary?.profitFactor).toBeGreaterThan(1.0);
  });
});

