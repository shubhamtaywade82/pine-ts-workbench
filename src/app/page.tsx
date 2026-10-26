"use client";

import { useCallback, useState, useEffect, useMemo, useRef } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import type { Bar } from "@nemesis-oss/pine-ts";
import type { ChartDrawing } from "@/components/chart/script-drawings-primitive";
import { NO_DRAWINGS, toChartDrawings, toEditorOverlays } from "@/lib/editor-output";
import { MemoizedChartCell } from "@/components/chart/chart-cell";
import { TopToolbar, LAYOUT_OPTIONS, type GridLayout } from "@/components/chart/top-toolbar";
import { useChartGrid, newCell } from "@/hooks/use-chart-grid";
import { ChartSettingsDialog } from "@/components/chart/chart-settings-dialog";
import { DEFAULT_CHART_SETTINGS, loadChartSettings, saveChartSettings, type ChartSettings } from "@/lib/chart-settings";
import { PineEditor, SCRIPT_TEMPLATES, legacyScripts } from "@/components/editor/pine-editor";
import { useScriptLibrary } from "@/hooks/use-script-library";
import { createScriptIndicator } from "@/components/chart/indicator-dialogs";
import { currentCode } from "@/lib/script-library";
import { isOverlayScript } from "@/lib/indicator-runner";
import { useBacktest, StrategyTester } from "@/components/strategy/strategy-panel";
import type { TradeMarker } from "@/components/chart/chart-workbench";
import type { BacktestTrade } from "@/lib/strategy-runner";
import { loadSettings, type BinanceSettings, DEFAULT_SETTINGS } from "@/components/trading/settings-dialog";
import { loadAlertSettings, type AlertSettings, DEFAULT_ALERT_SETTINGS } from "@/lib/alert-sinks";
import {
  saveCurrentLayout, layoutToCells, findSymbol, loadWorkspace, saveWorkspace,
  type SavedLayout, type Workspace,
} from "@/lib/saved-layouts";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Code2, FlaskConical } from "lucide-react";
import type { ChartOverlay, IndicatorAction } from "@/components/chart/chart-workbench";

/**
 * Chart workbench — Wave 18. Multi-chart grid.
 *
 * The page manages N independent ChartCell instances in a grid (1, 2, 4, or 6).
 * Each cell has its own symbol, timeframe, bars, stream, indicators, and overlays.
 * Clicking a cell makes it "active" — the Pine Editor (right panel) and the
 * Strategy Tester (bottom panel) operate on the active cell's bars. Both panels
 * are toggled from the bottom toolbar, as on TradingView.
 *
 * Layout selector: 1 chart (full), 2 charts (side-by-side), 4 charts (2×2),
 * 6 charts (3×2). A "+" button adds a cell (up to 6); "×" removes a cell.
 *
 * The whole workspace (grid, symbols, timeframes, indicators, panels, theme)
 * is auto-saved to localStorage and restored on load.
 */

/** Expands or collapses a panel to match `isOpen` (panels stay mounted either way). */
const syncPanel = (panel: ImperativePanelHandle | null, isOpen: boolean) => {
  if (panel === null || panel.isExpanded() === isOpen) return;
  if (isOpen) panel.expand();
  else panel.collapse();
};

export default function Home() {
  const grid = useChartGrid();
  const { layout, cells, activeCellId, replaceGrid, onCellChange } = grid;
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [chartSettings, setChartSettings] = useState<ChartSettings>(DEFAULT_CHART_SETTINGS);
  const [isChartSettingsOpen, setIsChartSettingsOpen] = useState(false);
  useEffect(() => setChartSettings(loadChartSettings()), []);
  const onChartSettingsChange = useCallback((next: ChartSettings) => {
    setChartSettings(next);
    saveChartSettings(next);
  }, []);
  const openChartSettings = useCallback(() => setIsChartSettingsOpen(true), []);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isTesterOpen, setIsTesterOpen] = useState(false);
  // Cells render only after the saved workspace is applied, so a reload doesn't
  // load BTC 1m first and then jump to the saved symbol.
  const [isRestored, setIsRestored] = useState(false);
  const editorPanelRef = useRef<ImperativePanelHandle>(null);
  const testerPanelRef = useRef<ImperativePanelHandle>(null);
  const isMobile = useIsMobile();

  // Shared settings.
  const [settings, setSettings] = useState<BinanceSettings>(DEFAULT_SETTINGS);
  useEffect(() => setSettings(loadSettings()), []);
  const [alertSettings, setAlertSettings] = useState<AlertSettings>(DEFAULT_ALERT_SETTINGS);
  useEffect(() => setAlertSettings(loadAlertSettings()), []);

  // Editor state — shared, operates on the active cell's bars.
  const [editorOverlays, setEditorOverlays] = useState<ChartOverlay[]>([]);
  const [editorDrawings, setEditorDrawings] = useState<ChartDrawing[]>([]);
  // Legend eye / × on the editor script's pane; "Add to chart" in the editor puts it back.
  const [isEditorScriptHidden, setIsEditorScriptHidden] = useState(false);
  const [isEditorScriptOnChart, setIsEditorScriptOnChart] = useState(true);
  const shownEditorOverlays = useMemo(() => (isEditorScriptOnChart
    ? editorOverlays.map((o) => ({ ...o, ownerId: "editor", isHidden: isEditorScriptHidden }))
    : []), [editorOverlays, isEditorScriptOnChart, isEditorScriptHidden]);
  const [backtestTrades, setBacktestTrades] = useState<BacktestTrade[]>([]);
  // The active cell's bars (for the editor and the backtest).
  const [editorBars, setEditorBars] = useState<readonly Bar[]>([]);
  // Strategy code from the Pine Editor; null until the editor opens a strategy.
  const [strategyCode, setStrategyCode] = useState<string | null>(null);
  const backtest = useBacktest(editorBars, strategyCode, setBacktestTrades);
  const scripts = useScriptLibrary(SCRIPT_TEMPLATES, legacyScripts);
  const { addToActiveCell } = grid;
  const onAddScript = useCallback((scriptId: string) => {
    const script = scripts.library.find((s) => s.id === scriptId);
    if (script !== undefined) addToActiveCell(createScriptIndicator(script, isOverlayScript(currentCode(script))));
  }, [scripts.library, addToActiveCell]);

  // Convert backtest trades → trade markers for the active chart cell. Wave 21.
  const tradeMarkers = useMemo<TradeMarker[]>(() => {
    return backtestTrades.flatMap((t) => [
      { time: t.entryTime, type: "entry" as const, direction: t.direction as "long" | "short", price: t.entryPrice },
      { time: t.exitTime, type: "exit" as const, direction: t.direction as "long" | "short", price: t.exitPrice, profit: t.profit },
    ]);
  }, [backtestTrades]);

  // Restore the last workspace once, after mount (localStorage isn't available during SSR).
  useEffect(() => {
    const workspace = loadWorkspace();
    if (workspace !== null) {
      const restored = workspace.cells.map((c) => ({ ...newCell(findSymbol(c.symbolProduct), c.interval), indicators: c.indicators }));
      replaceGrid(workspace.layout as GridLayout, restored, workspace.activeCellIndex);
      setIsEditorOpen(workspace.isEditorOpen);
      setIsTesterOpen(workspace.isTesterOpen);
      setTheme(workspace.theme);
      document.documentElement.classList.toggle("dark", workspace.theme === "dark");
    }
    setIsRestored(true);
  }, [replaceGrid]);

  useEffect(() => {
    if (!isRestored) return;
    saveWorkspace({
      layout,
      cells: cells.map((c) => ({ symbolProduct: c.symbol.binanceSymbol, interval: c.interval, indicators: c.indicators })),
      activeCellIndex: Math.max(0, cells.findIndex((c) => c.id === activeCellId)),
      isEditorOpen, isTesterOpen, theme,
    });
  }, [isRestored, layout, cells, activeCellId, isEditorOpen, isTesterOpen, theme]);

  // Before restore, syncing (and the panels' own collapse callbacks) would overwrite the saved open state.
  useEffect(() => { if (isRestored) syncPanel(editorPanelRef.current, isEditorOpen); }, [isRestored, isEditorOpen]);
  useEffect(() => { if (isRestored) syncPanel(testerPanelRef.current, isTesterOpen); }, [isRestored, isTesterOpen]);

  const onEditorScriptAction = useCallback((action: IndicatorAction) => {
    if (action === "toggle-visibility") setIsEditorScriptHidden((hidden) => !hidden);
    else if (action === "remove") setIsEditorScriptOnChart(false);
    else setIsEditorOpen(true);
  }, []);

  // Grid CSS — responsive: 1 column on mobile, layout-based on desktop.
  const layoutConfig = LAYOUT_OPTIONS.find((l) => l.value === layout)!;
  const gridStyle = {
    display: "grid" as const,
    // minmax(0, …): a bare 1fr track never shrinks below the chart canvas, so opening a panel would overflow it.
    gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : `repeat(${layoutConfig.cols}, minmax(0, 1fr))`,
    gridTemplateRows: isMobile ? `repeat(${cells.length}, minmax(0, 1fr))` : `repeat(${layoutConfig.rows}, minmax(0, 1fr))`,
    gap: "4px",
  };

  const onSaveLayout = useCallback((name: string) => {
    saveCurrentLayout(name, layout, cells.map((c) => ({ symbol: c.symbol, interval: c.interval })));
  }, [layout, cells]);

  const onLoadLayout = useCallback((saved: SavedLayout) => {
    replaceGrid(saved.layout as GridLayout, layoutToCells(saved).map((c) => newCell(c.symbol, c.interval)));
  }, [replaceGrid]);

  // Toggle theme.
  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      return next;
    });
  }, []);

  return (
    <div className={`flex h-screen flex-col bg-background text-foreground ${theme === "dark" ? "dark" : ""}`}>
      <TopToolbar
        activeCell={grid.activeCell}
        onActiveCellChange={(patch) => onCellChange(grid.activeCell.id, patch)}
        onAddIndicator={grid.onAddIndicator}
        scripts={scripts}
        onAddScript={onAddScript}
        onOpenScript={(id) => { scripts.open(id); setIsEditorOpen(true); }}
        layout={layout}
        onLayoutChange={grid.onLayoutChange}
        canAddCell={grid.canAddCell}
        onAddCell={grid.onAddCell}
        onSaveLayout={onSaveLayout}
        onLoadLayout={onLoadLayout}
        theme={theme}
        onToggleTheme={toggleTheme}
        onAlertSettingsSaved={setAlertSettings}
        onSettingsSaved={setSettings}
        onOpenChartSettings={openChartSettings}
      />
      <ChartSettingsDialog
        open={isChartSettingsOpen} settings={chartSettings}
        onOpenChange={setIsChartSettingsOpen} onApply={onChartSettingsChange}
      />

      {/* Body: [chart grid | Pine Editor] over Strategy Tester, as on TradingView */}
      <ResizablePanelGroup direction="vertical" autoSaveId="workbench-vertical" className="flex-1">
        <ResizablePanel defaultSize={70} minSize={30} order={1}>
          <ResizablePanelGroup direction="horizontal" autoSaveId="workbench-horizontal">
            <ResizablePanel defaultSize={70} minSize={30} order={1}>
              <div className="h-full p-1" style={gridStyle}>
                {isRestored && cells.map((cell) => (
                  <MemoizedChartCell
                    key={cell.id}
                    cellId={cell.id}
                    symbol={cell.symbol}
                    interval={cell.interval}
                    indicators={cell.indicators}
                    onChange={onCellChange}
                    isActive={cell.id === activeCellId}
                    onActivate={grid.setActiveCellId}
                    onRemove={grid.onRemoveCell}
                    canRemove={cells.length > 1}
                    editorOverlays={cell.id === activeCellId ? shownEditorOverlays : []}
                    editorDrawings={cell.id === activeCellId && isEditorScriptOnChart && !isEditorScriptHidden ? editorDrawings : NO_DRAWINGS}
                    onEditorScriptAction={onEditorScriptAction}
                    tradeMarkers={cell.id === activeCellId ? tradeMarkers : []}
                    onActiveBarsChange={setEditorBars}
                    chartSettings={chartSettings}
                    onChartSettingsChange={onChartSettingsChange}
                    onOpenChartSettings={openChartSettings}
                  />
                ))}
              </div>
            </ResizablePanel>
            <ResizableHandle />
            {/* Collapsed rather than unmounted: a closed editor keeps its script on the chart. */}
            <ResizablePanel
              ref={editorPanelRef} order={2} defaultSize={30} minSize={20} collapsible collapsedSize={0}
              onCollapse={() => isRestored && setIsEditorOpen(false)} onExpand={() => isRestored && setIsEditorOpen(true)}
            >
              <div className="h-full border-l border-border">
                <PineEditor
                  bars={editorBars}
                  onResults={(results, plots, drawings) => {
                    setEditorOverlays(toEditorOverlays(results, plots, editorBars));
                    setEditorDrawings(toChartDrawings(drawings, editorBars));
                  }}
                  onStrategyCode={(code) => {
                    // Open the tester for the first strategy only, so closing it sticks.
                    if (strategyCode === null) setIsTesterOpen(true);
                    setStrategyCode(code);
                    setEditorOverlays([]);
                    setEditorDrawings([]);
                  }}
                  onAddToChart={() => setIsEditorScriptOnChart(true)}
                  onClose={() => setIsEditorOpen(false)}
                  scripts={scripts}
                />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel
          ref={testerPanelRef} order={2} defaultSize={30} minSize={15} collapsible collapsedSize={0}
          onCollapse={() => isRestored && setIsTesterOpen(false)} onExpand={() => isRestored && setIsTesterOpen(true)}
        >
          <StrategyTester result={backtest.result} />
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Bottom toolbar — TradingView keeps its panel toggles here. */}
      <footer className="flex h-8 shrink-0 items-center gap-1 border-t border-border px-2">
        <Button
          variant={isTesterOpen ? "secondary" : "ghost"} size="sm" className="h-6 text-xs"
          onClick={() => setIsTesterOpen((v) => !v)}
        >
          <FlaskConical className="mr-1 h-3.5 w-3.5" /> Strategy Tester
        </Button>
        <Button
          variant={isEditorOpen ? "secondary" : "ghost"} size="sm" className="h-6 text-xs"
          onClick={() => setIsEditorOpen((v) => !v)}
        >
          <Code2 className="mr-1 h-3.5 w-3.5" /> Pine Editor
        </Button>
      </footer>

    </div>
  );
}
