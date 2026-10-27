"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { registry, type Bar, type ScriptDrawings } from "@nemesis-oss/pine-ts";
import { type ChartInterval, type SymbolOption } from "@/lib/public-binance-feed";
import { ChartWorkbench, type ChartOverlay, type ChartSubPane, type IndicatorAction, type TradeMarker } from "@/components/chart/chart-workbench";
import { IndicatorSettingsDialog, indicatorLabel, type MountedIndicator } from "@/components/chart/indicator-dialogs";
import type { ChartDrawing } from "@/components/chart/script-drawings-primitive";
import type { ChartSettings } from "@/lib/chart-settings";
import { Button } from "@/components/ui/button";
import { loadLibrary, currentCode, EMPTY_SETTINGS } from "@/lib/script-library";
import { toChartDrawings } from "@/lib/editor-output";
import { runIndicatorCode } from "@/lib/indicator-runner";
import { X } from "lucide-react";
import { useLiveBars, type LiveStatus } from "@/hooks/use-live-bars";

// A self-contained chart cell: symbol, timeframe, bars, overlays, sub-panes.
const INDICATOR_COLORS: Record<string, string> = {
  sma: "#1e88e5", ema: "#ff6d00", rsi: "#7e57c2", macd: "#1e88e5",
  bb: "#7e57c2", obv: "#26a69a", vwap: "#eab308", supertrend: "#22c55e",
  stoch: "#2196f3", atr: "#b388ff", kc: "#2196f3", sar: "#2962ff",
  mfi: "#26a69a", wma: "#9c27b0", hma: "#00bcd4", cci: "#e91e63",
  wpr: "#009688", dmi: "#ff007f",
  smc_structure: "#2962ff", smc_fvg: "#089981", smc_ob: "#00b0ff", smc_liquidity: "#d500f9",
};
const FALLBACK_COLOR = "#1e88e5";

interface IndicatorRunResult {
  readonly plots: Record<string, Array<number | undefined>>;
  readonly meta: { readonly plots: readonly { id: string; kind: string; color?: string; isHidden?: boolean; display?: string }[] } | undefined;
  /** SMC drawings of a saved script (built-ins draw none). */
  readonly drawings?: ScriptDrawings;
  /** Intervals a saved script shows on (its Visibility tab); undefined = all. */
  readonly visibleIntervals?: readonly ChartInterval[];
}

/** A saved "My scripts" indicator, run with the inputs, plot styles and visibility saved in its settings. */
const runSavedScript = async (scriptId: string, bars: readonly Bar[]): Promise<IndicatorRunResult | undefined> => {
  const script = loadLibrary().find((s) => s.id === scriptId);
  if (script === undefined) return undefined;
  const { inputs, plotStyles, visibleIntervals } = script.settings ?? EMPTY_SETTINGS;
  const run = await runIndicatorCode(currentCode(script), bars, inputs);
  const plots = run.plots.map((p) => ({
    ...p,
    kind: p.kind === "hline" ? "line" : p.kind,
    color: plotStyles[p.id]?.color ?? p.color,
    isHidden: plotStyles[p.id]?.isHidden === true,
  }));
  return { plots: run.results, meta: { plots }, drawings: run.drawings, visibleIntervals };
};

/** Runs one mounted indicator over `bars`: a registry built-in, or a saved "My scripts" indicator. */
const runMounted = async (m: MountedIndicator, bars: readonly Bar[]): Promise<IndicatorRunResult | undefined> => {
  if (m.scriptId !== undefined) return runSavedScript(m.scriptId, bars);
  const meta = registry.metadata(m.indicatorId);
  const instance = registry.instantiate(m.indicatorId, m.inputs);
  if (!instance || !meta) return undefined;
  const perPlot: Record<string, Array<number | undefined>> = {};
  let barIndex = 0;
  for await (const r of instance.run(bars as never)) {
    for (const [plotId, value] of Object.entries(r)) (perPlot[plotId] ??= [])[barIndex] = value;
    barIndex++;
  }
  return { plots: perPlot, meta, drawings: instance.drawings };
};

/** What the page stores (and persists) per chart cell. */
export interface CellSettings {
  readonly symbol: SymbolOption;
  readonly interval: ChartInterval;
  readonly indicators: readonly MountedIndicator[];
}

export interface ChartCellProps extends CellSettings {
  readonly cellId: string;
  readonly onChange: (cellId: string, patch: Partial<CellSettings>) => void;
  readonly isActive: boolean;
  readonly onActivate: (cellId: string) => void;
  readonly onRemove?: (cellId: string) => void;
  readonly canRemove: boolean;
  readonly editorOverlays: ChartOverlay[];
  readonly editorDrawings?: readonly ChartDrawing[];
  /** The editor script declared `overlay: true`: its plots go on the price pane. */
  readonly isEditorOverlay?: boolean;
  readonly chartSettings: ChartSettings;
  readonly onChartSettingsChange: (settings: ChartSettings) => void;
  readonly onOpenChartSettings: () => void;
  readonly tradeMarkers?: TradeMarker[];
  /** Receives this cell's bars while it is active, so the editor runs on what the chart shows. */
  readonly onActiveBarsChange?: (bars: readonly Bar[]) => void;
  /** Legend actions on the Pine Editor script's pane, which the page owns. */
  readonly onEditorScriptAction?: (action: IndicatorAction) => void;
}

/** Sub-pane id of the Pine Editor script's plots. */
const EDITOR_PANE_ID = "editor";

export function ChartCell({
  cellId, symbol, interval, indicators: mounted, onChange,
  isActive, onActivate, onRemove, canRemove, editorOverlays, editorDrawings, isEditorOverlay = false, chartSettings, onChartSettingsChange, onOpenChartSettings, tradeMarkers, onActiveBarsChange, onEditorScriptAction,
}: ChartCellProps) {
  const { bars, status, error, loadOlder, subscribe } = useLiveBars(symbol.binanceSymbol, interval);
  const [runResults, setRunResults] = useState<Record<string, IndicatorRunResult>>({});
  const [settingsInstanceId, setSettingsInstanceId] = useState<string | null>(null);

  const setIndicators = useCallback((update: (prev: readonly MountedIndicator[]) => readonly MountedIndicator[]) => {
    onChange(cellId, { indicators: update(mounted) });
  }, [onChange, cellId, mounted]);

  const onIndicatorAction = useCallback((ownerId: string, action: IndicatorAction) => {
    if (ownerId === EDITOR_PANE_ID) { onEditorScriptAction?.(action); return; }
    if (action === "settings") { setSettingsInstanceId(ownerId); return; }
    setIndicators((prev) => action === "remove"
      ? prev.filter((m) => m.instanceId !== ownerId)
      : prev.map((m) => (m.instanceId === ownerId ? { ...m, isHidden: !m.isHidden } : m)));
  }, [onEditorScriptAction, setIndicators]);

  const onSettingsInputChange = useCallback((inputName: string, value: number | string | boolean) => {
    setIndicators((prev) => prev.map((m) => (m.instanceId === settingsInstanceId
      ? { ...m, inputs: { ...m.inputs, [inputName]: value } }
      : m)));
  }, [setIndicators, settingsInstanceId]);

  // Drive indicators.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: Record<string, IndicatorRunResult> = {};
      for (const m of mounted) {
        try {
          const result = await runMounted(m, bars);
          if (result !== undefined) out[m.instanceId] = result;
        } catch {
          // A saved script that no longer compiles draws nothing; the Pine Editor reports the error.
        }
      }
      if (!cancelled) setRunResults(out);
    })();
    return () => { cancelled = true; };
  }, [bars, mounted]);

  const { mainOverlays, subPanes } = useMemo(() => {
    return computeOverlays(bars, mounted, runResults, interval);
  }, [bars, mounted, runResults, interval]);
  const drawings = useMemo(
    () => [...(editorDrawings ?? []), ...scriptDrawings(bars, mounted, runResults, interval)],
    [editorDrawings, bars, mounted, runResults, interval],
  );

  // The page runs the editor + backtest on these bars. Hand them over when the
  // series changes (new bar, older page, switch, forming close) at the 1/s
  // snapshot rate, never per stream tick — that would re-render the whole workspace.
  const notifiedRef = useRef<string | null>(null);
  const wasActiveRef = useRef(false);
  useEffect(() => {
    if (!isActive) { wasActiveRef.current = false; return; }
    const first = bars[0];
    const last = bars[bars.length - 1];
    if (first === undefined || last === undefined) { notifiedRef.current = null; return; }
    // The forming bar's close too: the editor's indicator then follows live ticks (at the 1/s snapshot rate).
    const signature = `${symbol.binanceSymbol}:${interval}:${first.time}:${last.time}:${bars.length}:${last.close}`;
    if (wasActiveRef.current && signature === notifiedRef.current) return;
    wasActiveRef.current = true;
    notifiedRef.current = signature;
    onActiveBarsChange?.(bars);
  }, [isActive, bars, onActiveBarsChange, symbol.binanceSymbol, interval]);

  // Non-overlay editor plots get a sub-pane, so oscillators (RSI etc.) don't squash the price scale.
  const allMainOverlays = isEditorOverlay ? [...mainOverlays, ...editorOverlays] : mainOverlays;
  const allSubPanes = editorOverlays.length > 0 && !isEditorOverlay
    ? [...subPanes, { paneId: EDITOR_PANE_ID, title: "Custom", overlays: editorOverlays }]
    : subPanes;

  return (
    <div
      // Highlight only matters when there are several charts to pick from, as on TradingView.
      className={`relative flex h-full flex-col border ${isActive && canRemove ? "border-primary" : "border-transparent"}`}
      onClick={() => onActivate(cellId)}
    >
      {/* Symbol, interval and Indicators live in the page's top toolbar, as on TradingView. */}
      <div className="absolute right-16 top-1 z-10 flex items-center gap-1.5">
        <LiveBadge status={status} />
        <span className="text-[10px] text-muted-foreground">{bars.length} bars</span>
        {canRemove && onRemove && (
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); onRemove(cellId); }}>
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Chart body */}
      <div className="flex-1 overflow-hidden px-1 pb-1">
        {bars.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {error ?? `Loading ${symbol.displayName} from Binance…`}
          </div>
        ) : (
          <ChartWorkbench title={`${symbol.displayName} · ${interval} · Binance`} interval={interval} bars={bars} subscribeBars={subscribe} onNeedOlderBars={loadOlder} onIndicatorAction={onIndicatorAction} mainOverlays={allMainOverlays} subPanes={allSubPanes} tradeMarkers={tradeMarkers} drawings={drawings} depthSymbol={symbol.binanceSymbol} settings={chartSettings} onSettingsChange={onChartSettingsChange} onOpenSettings={onOpenChartSettings} />
        )}
      </div>
      <IndicatorSettingsDialog
        indicator={mounted.find((m) => m.instanceId === settingsInstanceId)}
        onClose={() => setSettingsInstanceId(null)}
        onInputChange={onSettingsInputChange}
      />
    </div>
  );
}

// React.memo: prevents re-render when parent state changes but this cell's
// props haven't changed (e.g. when another cell is activated). Wave 23.
export const MemoizedChartCell = memo(ChartCell);

const LIVE_BADGE: Record<LiveStatus, { label: string; dotClass: string }> = {
  loading: { label: "Loading", dotClass: "bg-[#787b86]" },
  live: { label: "Live", dotClass: "bg-[#089981] animate-pulse" },
  reconnecting: { label: "Reconnecting…", dotClass: "bg-[#ff9800]" },
};

function LiveBadge({ status }: { status: LiveStatus }) {
  const { label, dotClass } = LIVE_BADGE[status];
  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
      <span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} />{label}
    </span>
  );
}

/** A plot with the same value on every bar (RSI's 70/30 bands) is drawn as a dashed level, as on TradingView. */
const isConstant = (data: readonly { value?: number }[]): boolean => {
  const withVal = data.filter((d): d is { value: number } => d.value !== undefined);
  return withVal.length > 1 && withVal.every((d) => d.value === withVal[0]!.value);
};

const isShownOn = (result: IndicatorRunResult, interval: ChartInterval): boolean =>
  result.visibleIntervals?.includes(interval) ?? true;

/** Saved scripts' drawings in chart time, for the scripts shown and not hidden in the legend. */
function scriptDrawings(
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

function computeOverlays(
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
