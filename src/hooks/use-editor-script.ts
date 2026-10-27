"use client";

import { useCallback, useMemo, useState } from "react";
import type { Bar, InputConfig } from "@nemesis-oss/pine-ts";
import type { ChartOverlay, IndicatorAction, TradeMarker } from "@/components/chart/chart-workbench";
import { SCRIPT_TEMPLATES, legacyScripts, type IndicatorRun } from "@/components/editor/pine-editor";
import type { ScriptSettingsDialogProps } from "@/components/editor/script-settings-dialog";
import { useBacktest } from "@/components/strategy/strategy-panel";
import { useScriptLibrary } from "@/hooks/use-script-library";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { NO_DRAWINGS, toChartDrawings, toEditorOverlays } from "@/lib/editor-output";
import type { ChartInterval } from "@/lib/public-binance-feed";
import type { ScriptSettings } from "@/lib/script-library";
import type { BacktestTrade } from "@/lib/strategy-runner";

/**
 * Everything around the Pine Editor's script: the library, its indicator
 * output on the active chart (styled by its settings), the strategy backtest,
 * and the settings dialog.
 */
export function useEditorScript(onOpenEditor: () => void, onOpenTester: () => void) {
  const scripts = useScriptLibrary(SCRIPT_TEMPLATES, legacyScripts);
  const { settings } = scripts;
  const [editorBars, setEditorBars] = useState<readonly Bar[]>([]);
  const [run, setRun] = useState<IndicatorRun | null>(null);
  const [isHidden, setIsHidden] = usePersistedState("editor-script-hidden", false);
  const [isOnChart, setIsOnChart] = usePersistedState("editor-script-on-chart", true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // Strategy code from the Pine Editor; null until the editor opens a strategy.
  const [strategyCode, setStrategyCode] = useState<string | null>(null);
  const [trades, setTrades] = useState<BacktestTrade[]>([]);
  const backtest = useBacktest(editorBars, strategyCode, settings, setTrades);

  const overlays = useMemo(() => styledOverlays(run, editorBars, settings), [run, editorBars, settings]);
  const drawings = useMemo(() => (run === null ? NO_DRAWINGS : toChartDrawings(run.drawings, editorBars)), [run, editorBars]);
  const tradeMarkers = useMemo(() => toTradeMarkers(trades), [trades]);

  const onStrategyCode = useCallback((code: string) => {
    // Open the tester for the first strategy only, so closing it sticks.
    if (strategyCode === null) onOpenTester();
    setStrategyCode(code);
    setRun(null);
  }, [strategyCode, onOpenTester]);

  // An indicator replaced the strategy in the editor: its trade markers go with it.
  const onIndicatorRun = useCallback((next: IndicatorRun) => {
    setRun(next);
    setStrategyCode(null);
    setTrades([]);
  }, []);

  const onScriptAction = useCallback((action: IndicatorAction) => {
    if (action === "toggle-visibility") setIsHidden((hidden) => !hidden);
    else if (action === "remove") setIsOnChart(false);
    else setIsSettingsOpen(true);
  }, [setIsHidden, setIsOnChart]);

  /** What the active chart shows of the script, honouring the legend and the Visibility tab. */
  const chartOutput = (interval: ChartInterval) => {
    const isVisible = isOnChart && (settings.visibleIntervals?.includes(interval) ?? true);
    return {
      overlays: isVisible ? overlays.map((o) => ({ ...o, ownerId: "editor", isHidden: isHidden || o.isHidden === true })) : [],
      drawings: isVisible && !isHidden ? drawings : NO_DRAWINGS,
      isOverlay: run?.isOverlay === true,
    };
  };

  const isStrategy = scripts.active?.kind === "strategy";
  const settingsDialog: ScriptSettingsDialogProps = {
    open: isSettingsOpen,
    onOpenChange: setIsSettingsOpen,
    title: scripts.active?.name ?? "Untitled script",
    kind: isStrategy ? "strategy" : "indicator",
    declaredInputs: (isStrategy ? backtest.result?.declaredInputs : run?.inputs) ?? NO_INPUTS,
    declaration: backtest.result?.declaration ?? {},
    plots: run?.plots ?? [],
    settings,
    onApply: scripts.setSettings,
  };

  return {
    scripts, editorBars, setEditorBars, backtest, tradeMarkers, chartOutput, onScriptAction, settingsDialog, strategyCode,
    openSettings: () => setIsSettingsOpen(true),
    editorProps: {
      bars: editorBars,
      onResults: onIndicatorRun,
      onStrategyCode,
      onAddToChart: () => setIsOnChart(true),
      scripts,
      onOpenSettings: () => { onOpenEditor(); setIsSettingsOpen(true); },
    },
  };
}

const NO_INPUTS: readonly InputConfig[] = [];

/** Editor overlays with the Style tab's colour and visibility per plot. */
const styledOverlays = (run: IndicatorRun | null, bars: readonly Bar[], settings: ScriptSettings): ChartOverlay[] => {
  if (run === null) return [];
  const plots = run.plots.map((plot) => ({ ...plot, color: settings.plotStyles[plot.id]?.color ?? plot.color }));
  return toEditorOverlays(run.results, plots, bars).map((overlay, i) => ({
    ...overlay,
    isHidden: settings.plotStyles[plots[i]!.id]?.isHidden === true,
  }));
};

const toTradeMarkers = (trades: readonly BacktestTrade[]): TradeMarker[] =>
  trades.flatMap((t) => [
    { time: t.entryTime, type: "entry" as const, direction: t.direction as "long" | "short", price: t.entryPrice },
    { time: t.exitTime, type: "exit" as const, direction: t.direction as "long" | "short", price: t.exitPrice, profit: t.profit },
  ]);
