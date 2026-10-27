import type { Bar, HtfBarLoader, IndicatorScript, InputConfig, InputsBag, LiveIndicator, PineContext, ScriptDrawings, ScriptOutput } from "@nemesis-oss/pine-ts";
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
  /** `overlay: true` scripts plot on the price pane. */
  isOverlay: boolean;
  /** Inputs the script declared, for the settings dialog (none for legacy scripts). */
  inputs: readonly InputConfig[];
  firstBarError: string | null;
};

const NO_DRAWINGS: ScriptDrawings = { lines: [], boxes: [], shapes: [], table: undefined, bgcolors: [], barcolors: [] };

const runIndicator = async (script: IndicatorScript, bars: readonly Bar[], inputs: InputsBag, getHtfBars?: HtfBarLoader): Promise<ScriptRun> =>
  toScriptRun(script, await runWithKnownInputs((bag) => script.run(bars, { inputs: bag, getHtfBars }), inputs));

const toScriptRun = (script: IndicatorScript, output: ScriptOutput): ScriptRun => {
  const results = Object.fromEntries(Object.entries(output.values).map(([id, values]) => [id, [...values]]));
  // display: none / data_window plots exist for values (scores, alerts), not for the chart.
  const shown = output.plots.filter((plot) => plot.display !== "none" && plot.display !== "data_window");
  const plots = shown.map((plot, i) => ({
    id: plot.id,
    kind: plot.kind,
    color: plot.color ?? (plot.kind === "hline" ? LEVEL_COLOR : PLOT_COLORS[i % PLOT_COLORS.length]!),
  }));
  return { results, plots, drawings: output.drawings, isOverlay: script.options.overlay === true, inputs: output.inputs, firstBarError: null };
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
  return { results, plots: derivePlots(results), drawings: NO_DRAWINGS, isOverlay: false, inputs: [], firstBarError };
};

/** One plot per returned key; a key that is the same number on every bar is a level (hline). */
const derivePlots = (results: Record<string, Array<number | undefined>>): PlotSpec[] =>
  Object.entries(results).map(([id, values], i) => {
    const defined = values.filter((v): v is number => v !== undefined && !Number.isNaN(v));
    const isLevel = defined.length > 0 && defined.every((v) => v === defined[0]);
    return { id, color: isLevel ? LEVEL_COLOR : PLOT_COLORS[i % PLOT_COLORS.length]!, kind: isLevel ? "hline" : "line" };
  });

/**
 * Runs with the saved input values; when the code no longer declares one of
 * them (an input was renamed or removed), runs again on the code's defaults.
 */
export const runWithKnownInputs = async <T>(run: (inputs: InputsBag) => Promise<T>, inputs: InputsBag): Promise<T> => {
  try {
    return await run(inputs);
  } catch (err) {
    if (Object.keys(inputs).length === 0 || !(err instanceof Error) || !err.message.startsWith("Unknown input override")) throw err;
    return run({});
  }
};

export const runIndicatorCode = (userCode: string, bars: readonly Bar[], inputs: InputsBag = {}, getHtfBars?: HtfBarLoader): Promise<ScriptRun> => {
  const loaded = loadScript<CalculateFn>(userCode, "calculate");
  if (loaded.kind === "indicator") return runIndicator(loaded.script, bars, inputs, getHtfBars);
  if (loaded.kind === "legacy") return runLegacy(loaded.fn, bars);
  throw new ScriptCompileError("This is a strategy; it runs in the Strategy Tester.", null);
};


/** Whether indicator code declares `overlay: true` (draws on the price pane); false when it does not compile. */
export const isOverlayScript = (userCode: string): boolean => {
  try {
    const loaded = loadScript<CalculateFn>(userCode, "calculate");
    return loaded.kind === "indicator" && loaded.script.options.overlay === true;
  } catch {
    return false;
  }
};

export type LiveRunner = (userCode: string, bars: readonly Bar[], inputs?: InputsBag) => Promise<ScriptRun>;

/**
 * One script slot on a live chart (the Pine Editor, or a saved script on a
 * chart). While the code and inputs stay the same, a snapshot re-executes only
 * the forming bar (or the bar that just closed and the new one) instead of all
 * history. Calls are queued, since a live run must see updates in order.
 */
export const createLiveRunner = (getHtfBars?: HtfBarLoader): LiveRunner => {
  let key: string | undefined;
  let current: { script: IndicatorScript; live: LiveIndicator<ScriptOutput> } | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  const runOnce = async (userCode: string, bars: readonly Bar[], inputs: InputsBag): Promise<ScriptRun> => {
    const nextKey = `${userCode}\u0000${JSON.stringify(inputs)}`;
    if (nextKey !== key || current === undefined) {
      key = undefined;
      current = undefined;
      const loaded = loadScript<CalculateFn>(userCode, "calculate");
      if (loaded.kind !== "indicator") return runIndicatorCode(userCode, bars, inputs, getHtfBars);
      const live = await runWithKnownInputs((bag) => loaded.script.live(bars, { inputs: bag, getHtfBars }), inputs);
      current = { script: loaded.script, live };
      key = nextKey;
    }
    return toScriptRun(current.script, await current.live.update(bars));
  };

  return (userCode, bars, inputs = {}) => {
    const run = queue.then(() => runOnce(userCode, bars, inputs));
    queue = run.catch(() => undefined);
    return run;
  };
};

