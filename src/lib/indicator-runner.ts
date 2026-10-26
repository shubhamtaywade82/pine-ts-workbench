import type { Bar, IndicatorScript, PineContext, ScriptDrawings } from "@nemesis-oss/pine-ts";
import { ta, PineRuntime } from "@nemesis-oss/pine-ts";
import { loadScript, ScriptCompileError } from "@/lib/script-loader";

/**
 * Runs Pine Editor indicator code on bars: a concise `indicator()` script, or
 * a legacy `calculate({ ta, ctx, inputs })` function. Strategies are rejected
 * here; the Strategy Tester runs them.
 */

// TradingView's default plot colours, assigned in plot order.
const PLOT_COLORS = ["#2962ff", "#ff9800", "#e040fb", "#089981", "#f23645", "#00bcd4"];
const LEVEL_COLOR = "#787b86";

type CalculateFn = (args: { ta: typeof ta; ctx: PineContext; inputs: Record<string, unknown> }) =>
  Record<string, number | undefined>;

export type PlotSpec = { id: string; color: string; kind: string };
export type ScriptRun = {
  results: Record<string, Array<number | undefined>>;
  plots: PlotSpec[];
  drawings: ScriptDrawings;
  firstBarError: string | null;
};

const NO_DRAWINGS: ScriptDrawings = { lines: [], boxes: [] };

const runIndicator = async (script: IndicatorScript, bars: readonly Bar[]): Promise<ScriptRun> => {
  const output = await script.run(bars);
  const results = Object.fromEntries(Object.entries(output.values).map(([id, values]) => [id, [...values]]));
  const plots = output.plots.map((plot, i) => ({
    id: plot.id,
    kind: plot.kind,
    color: plot.color ?? (plot.kind === "hline" ? LEVEL_COLOR : PLOT_COLORS[i % PLOT_COLORS.length]!),
  }));
  return { results, plots, drawings: output.drawings, firstBarError: null };
};

/** Runs a legacy `calculate` function on every bar; collects plot values and the first per-bar error. */
const runLegacy = async (calculateFn: CalculateFn, bars: readonly Bar[]): Promise<ScriptRun> => {
  const results: Record<string, Array<number | undefined>> = {};
  let firstBarError: string | null = null;
  const provider = {
    getHistoricalBars: async () => bars,
    streamBars: () => ({ [Symbol.asyncIterator]: async function* () { yield* []; } }),
    getSymbolInfo: async () => ({ ticker: "EDITOR", timezone: "UTC", type: "crypto" as const }),
  };
  const runtime = new PineRuntime({ provider, symbol: "EDITOR", timeframe: "1" });
  let barIndex = 0;
  await runtime.run((ctx: PineContext) => {
    try {
      for (const [plotId, value] of Object.entries(calculateFn({ ta, ctx, inputs: { length: 14 } }))) {
        (results[plotId] ??= [])[barIndex] = value;
      }
    } catch (err) {
      firstBarError ??= `Bar ${barIndex}: ${err instanceof Error ? err.message : String(err)}`;
    }
    barIndex++;
  }, bars as never);
  return { results, plots: derivePlots(results), drawings: NO_DRAWINGS, firstBarError };
};

/** One plot per returned key; a key that is the same number on every bar is a level (hline). */
const derivePlots = (results: Record<string, Array<number | undefined>>): PlotSpec[] =>
  Object.entries(results).map(([id, values], i) => {
    const defined = values.filter((v): v is number => v !== undefined && !Number.isNaN(v));
    const isLevel = defined.length > 0 && defined.every((v) => v === defined[0]);
    return { id, color: isLevel ? LEVEL_COLOR : PLOT_COLORS[i % PLOT_COLORS.length]!, kind: isLevel ? "hline" : "line" };
  });

export const runIndicatorCode = (userCode: string, bars: readonly Bar[]): Promise<ScriptRun> => {
  const loaded = loadScript<CalculateFn>(userCode, "calculate");
  if (loaded.kind === "indicator") return runIndicator(loaded.script, bars);
  if (loaded.kind === "legacy") return runLegacy(loaded.fn, bars);
  throw new ScriptCompileError("This is a strategy; open it in the Strategy tab.", null);
};

