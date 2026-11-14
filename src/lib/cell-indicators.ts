import { registry, type Bar, type ScriptDrawings } from "@nemesis-oss/pine-ts";
import type { ChartInterval } from "@/lib/public-binance-feed";
import type { ChartOverlay, ChartSubPane } from "@/components/chart/chart-workbench";
import { indicatorLabel, type MountedIndicator } from "@/components/chart/indicator-dialogs";
import type { ChartDrawing } from "@/components/chart/script-drawings-primitive";
import { loadLibrary, currentCode, EMPTY_SETTINGS } from "@/lib/script-library";
import { toChartDrawings } from "@/lib/editor-output";
import type { LiveRunner } from "@/lib/indicator-runner";
import { createScriptRunner, type ScriptRunner } from "@/lib/script-worker-client";
import type { HtfSource } from "@/lib/htf-bars";

export const INDICATOR_COLORS: Record<string, string> = {
  sma: "#1e88e5", ema: "#ff6d00", rsi: "#7e57c2", macd: "#1e88e5",
  bb: "#7e57c2", obv: "#26a69a", vwap: "#eab308", supertrend: "#22c55e",
  stoch: "#2196f3", atr: "#b388ff", kc: "#2196f3", sar: "#2962ff",
  mfi: "#26a69a", wma: "#9c27b0", hma: "#00bcd4", cci: "#e91e63",
  wpr: "#009688", dmi: "#ff007f", alma: "#00e5ff", alma_ribbon: "#facc15",
  smc_structure: "#2962ff", smc_fvg: "#089981", smc_ob: "#00b0ff", smc_liquidity: "#d500f9",
};
export const FALLBACK_COLOR = "#1e88e5";

export interface IndicatorRunResult {
  readonly plots: Record<string, Array<number | undefined>>;
  readonly meta: { readonly plots: readonly { id: string; kind: string; color?: string; isHidden?: boolean; display?: string }[] } | undefined;
  readonly drawings?: ScriptDrawings;
  readonly alerts?: readonly { readonly message: string; readonly barIndex?: number; readonly barTime?: number }[];
  readonly visibleIntervals?: readonly ChartInterval[];
}

export const runSavedScript = async (
  runLive: LiveRunner,
  scriptId: string,
  bars: readonly Bar[],
): Promise<IndicatorRunResult | undefined> => {
  const script = loadLibrary().find((s) => s.id === scriptId);
  if (script === undefined) return undefined;
  const { inputs, plotStyles, visibleIntervals } = script.settings ?? EMPTY_SETTINGS;
  const run = await runLive(currentCode(script), bars, inputs);
  const plots = run.plots.map((p) => ({
    ...p,
    kind: p.kind === "hline" ? "line" : p.kind,
    color: plotStyles[p.id]?.color ?? p.color,
    isHidden: plotStyles[p.id]?.isHidden === true,
  }));
  return { plots: run.results, meta: { plots }, drawings: run.drawings, alerts: run.alerts, visibleIntervals };
};

interface ConfirmedCache {
  readonly key: string;
  readonly plots: Record<string, Array<number | undefined>>;
  readonly drawings?: ScriptDrawings;
  readonly meta: IndicatorRunResult["meta"];
}

const confirmedCache = new Map<string, ConfirmedCache>();

const executeInstance = async (
  indicatorId: string,
  inputs: Record<string, unknown> | undefined,
  bars: readonly Bar[],
): Promise<{ plots: Record<string, Array<number | undefined>>; drawings?: ScriptDrawings; meta: IndicatorRunResult["meta"] } | undefined> => {
  const meta = registry.metadata(indicatorId);
  const instance = registry.instantiate(indicatorId, inputs);
  if (!instance || !meta) return undefined;
  const perPlot: Record<string, Array<number | undefined>> = {};
  let barIndex = 0;
  for await (const r of instance.run(bars as never)) {
    for (const [plotId, value] of Object.entries(r)) (perPlot[plotId] ??= [])[barIndex] = value;
    barIndex++;
  }
  return { plots: perPlot, drawings: instance.drawings, meta };
};

export const runMounted = async (
  m: MountedIndicator,
  bars: readonly Bar[],
  runners: Map<string, ScriptRunner>,
  htf?: HtfSource,
): Promise<IndicatorRunResult | undefined> => {
  if (m.scriptId !== undefined) {
    let runner = runners.get(m.instanceId);
    if (runner === undefined) runners.set(m.instanceId, (runner = createScriptRunner(htf)));
    return runSavedScript(runner.run, m.scriptId, bars);
  }
  if (bars.length === 0) return undefined;

  const isForming = bars.at(-1)?.isClosed === false;
  const confirmedEnd = isForming ? bars.length - 1 : bars.length;
  if (confirmedEnd <= 0) return executeInstance(m.indicatorId, m.inputs, bars);

  // Confirmed history is immutable; cache results across forming-bar ticks.
  // Keyed on prices as well as times: two symbols share bar times, and the render after a symbol change
  // still holds the old bars, so a symbol prop in the key would cache old prices under the new symbol.
  const lastConfirmed = bars[confirmedEnd - 1];
  const confirmedKey = `${m.instanceId}:${m.indicatorId}:${JSON.stringify(m.inputs)}:${bars[0]?.time}:${bars[0]?.open}:${lastConfirmed?.time}:${lastConfirmed?.close}:${confirmedEnd}`;
  let cached = confirmedCache.get(m.instanceId);
  if (!cached || cached.key !== confirmedKey) {
    const executed = await executeInstance(m.indicatorId, m.inputs, bars.slice(0, confirmedEnd));
    if (!executed) return undefined;
    cached = { key: confirmedKey, ...executed };
    confirmedCache.set(m.instanceId, cached);
  }

  if (!isForming) return { plots: cached.plots, meta: cached.meta, drawings: cached.drawings };

  // Forming bar: run only on the recent lookback slice (e.g. 250 bars) instead of all history.
  const lookback = bars.slice(-Math.min(bars.length, 250));
  const formingResult = await executeInstance(m.indicatorId, m.inputs, lookback);
  if (!formingResult) return { plots: cached.plots, meta: cached.meta, drawings: cached.drawings };

  const perPlot: Record<string, Array<number | undefined>> = {};
  for (const [plotId, series] of Object.entries(cached.plots)) {
    const lastVal = formingResult.plots[plotId]?.at(-1);
    perPlot[plotId] = [...series, lastVal];
  }
  return { plots: perPlot, meta: cached.meta, drawings: formingResult.drawings ?? cached.drawings };
};

export const isConstant = (data: readonly { value?: number }[]): boolean => {
  let firstVal: number | undefined;
  let count = 0;
  for (let i = 0; i < data.length; i++) {
    const val = data[i]!.value;
    if (val !== undefined) {
      if (firstVal === undefined) firstVal = val;
      else if (val !== firstVal) return false;
      count++;
    }
  }
  return count > 1;
};

export const isShownOn = (result: IndicatorRunResult, interval: ChartInterval): boolean =>
  result.visibleIntervals?.includes(interval) ?? true;

export function scriptDrawings(
  bars: readonly Bar[],
  mounted: readonly MountedIndicator[],
  runResults: Record<string, IndicatorRunResult>,
  interval: ChartInterval,
): ChartDrawing[] {
  return mounted.flatMap((m) => {
    const result = runResults[m.instanceId];
    if (result?.drawings === undefined || m.isHidden === true || !isShownOn(result, interval)) return [];
    return toChartDrawings(result.drawings, bars);
  });
}

export function computeOverlays(
  bars: readonly { time: number }[],
  mounted: readonly MountedIndicator[],
  runResults: Record<string, IndicatorRunResult>,
  interval: ChartInterval,
): { mainOverlays: ChartOverlay[]; subPanes: ChartSubPane[] } {
  const mainOverlays: ChartOverlay[] = [];
  const subPanes: ChartSubPane[] = [];
  for (const m of mounted) {
    const result = runResults[m.instanceId];
    if (!result || !result.meta || !isShownOn(result, interval)) continue;
    const paneOverlays: ChartOverlay[] = [];
    for (const plot of result.meta.plots) {
      if (plot.kind !== "line" && plot.kind !== "histogram") continue;
      if (plot.display === "none") continue;
      const seriesValues = result.plots[plot.id] ?? [];
      const data: { time: number; value?: number }[] = [];
      for (let i = 0; i < bars.length; i++) {
        const v = seriesValues[i];
        data.push(v === undefined || Number.isNaN(v) ? { time: bars[i]!.time } : { time: bars[i]!.time, value: v });
      }
      paneOverlays.push({
        instanceId: `${m.instanceId}:${plot.id}`,
        indicatorId: `${m.indicatorId}.${plot.id}`,
        indicatorName: indicatorLabel(m),
        color: plot.color ?? INDICATOR_COLORS[m.indicatorId] ?? FALLBACK_COLOR,
        ownerId: m.instanceId,
        isHidden: m.isHidden === true || plot.isHidden === true,
        isLevel: isConstant(data),
        data,
      });
    }
    if (paneOverlays.length === 0 && result.drawings) {
      paneOverlays.push({
        instanceId: `${m.instanceId}:drawings`,
        indicatorId: m.indicatorId,
        indicatorName: indicatorLabel(m),
        color: INDICATOR_COLORS[m.indicatorId] ?? FALLBACK_COLOR,
        ownerId: m.instanceId,
        isHidden: m.isHidden === true,
        data: [],
      });
    }
    if (m.pane === "main") mainOverlays.push(...paneOverlays);
    else subPanes.push({ paneId: m.instanceId, title: indicatorLabel(m), overlays: paneOverlays });
  }
  return { mainOverlays, subPanes };
}
