"use client";

import { useCallback, useState, useEffect, useRef } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { NO_DRAWINGS } from "@/lib/editor-output";
import { MemoizedChartCell } from "@/components/chart/chart-cell";
import { TopToolbar, LAYOUT_OPTIONS, type GridLayout } from "@/components/chart/top-toolbar";
import { useChartGrid, newCell } from "@/hooks/use-chart-grid";
import { useEditorScript } from "@/hooks/use-editor-script";
import { ChartSettingsDialog } from "@/components/chart/chart-settings-dialog";
import { DEFAULT_CHART_SETTINGS, loadChartSettings, saveChartSettings, type ChartSettings } from "@/lib/chart-settings";
import { quoteAssetOf, SUPPORTED_SYMBOLS } from "@/lib/public-binance-feed";
import { PineEditor } from "@/components/editor/pine-editor";
import { ScriptSettingsDialog } from "@/components/editor/script-settings-dialog";
import { createScriptIndicator } from "@/components/chart/indicator-dialogs";
import { currentCode } from "@/lib/script-library";
import { isOverlayScript } from "@/lib/indicator-runner";
import { StrategyTester } from "@/components/strategy/strategy-panel";
import { RightSidebar, type RightPanel } from "@/components/chart/right-sidebar";
import { TechnicalsPanel } from "@/components/technicals/technicals-panel";
import type { ChartOverlay, TradeMarker } from "@/components/chart/chart-workbench";
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

// Stable empties, so inactive cells' memoised props don't change every render.
const NO_OVERLAYS: ChartOverlay[] = [];
const NO_MARKERS: TradeMarker[] = [];

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
  // The right panel (Pine Editor or Technicals); `isEditorOpen` is whether it is expanded.
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [rightPanel, setRightPanel] = useState<RightPanel>("editor");
  const onSelectRightPanel = useCallback((panel: RightPanel) => {
    setIsEditorOpen((isOpen) => !(isOpen && panel === rightPanel));
    setRightPanel(panel);
  }, [rightPanel]);
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

  const editor = useEditorScript(useCallback(() => { setIsEditorOpen(true); setRightPanel("editor"); }, []), useCallback(() => setIsTesterOpen(true), []));
  const { scripts } = editor;
  const { addToActiveCell } = grid;
  const onAddScript = useCallback((scriptId: string) => {
    const script = scripts.library.find((s) => s.id === scriptId);
    if (script !== undefined) addToActiveCell(createScriptIndicator(script, isOverlayScript(currentCode(script))));
  }, [scripts.library, addToActiveCell]);
  const activeOutput = editor.chartOutput(grid.activeCell.interval);

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
        onOpenScript={(id) => { scripts.open(id); setIsEditorOpen(true); setRightPanel("editor"); }}
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
      <ScriptSettingsDialog {...editor.settingsDialog} />
      <ChartSettingsDialog
        open={isChartSettingsOpen} settings={chartSettings} quoteAsset={quoteAssetOf(cells.find((c) => c.id === activeCellId)?.symbol.binanceSymbol ?? SUPPORTED_SYMBOLS[0]!.binanceSymbol)}
        onOpenChange={setIsChartSettingsOpen} onApply={onChartSettingsChange}
      />

      {/* Body: [chart grid | Pine Editor] over Strategy Tester, as on TradingView */}
      <div className="flex min-h-0 flex-1">
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
                    editorOverlays={cell.id === activeCellId ? activeOutput.overlays : NO_OVERLAYS}
                    editorDrawings={cell.id === activeCellId ? activeOutput.drawings : NO_DRAWINGS}
                    isEditorOverlay={activeOutput.isOverlay}
                    onEditorScriptAction={editor.onScriptAction}
                    tradeMarkers={cell.id === activeCellId ? editor.tradeMarkers : NO_MARKERS}
                    onActiveBarsChange={editor.setEditorBars}
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
                {/* Hidden, not unmounted: the editor keeps running its script on the chart. */}
                <div className={rightPanel === "editor" ? "h-full" : "hidden"}>
                  <PineEditor {...editor.editorProps} onClose={() => setIsEditorOpen(false)} />
                </div>
                {rightPanel === "technicals" && (
                  <TechnicalsPanel key={grid.activeCell.symbol.binanceSymbol} symbol={grid.activeCell.symbol.binanceSymbol} initialInterval={grid.activeCell.interval} />
                )}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel
          ref={testerPanelRef} order={2} defaultSize={30} minSize={15} collapsible collapsedSize={0}
          onCollapse={() => isRestored && setIsTesterOpen(false)} onExpand={() => isRestored && setIsTesterOpen(true)}
        >
          <StrategyTester
            result={editor.backtest.result}
            onOpenSettings={editor.openSettings}
            strategyCode={editor.strategyCode}
            onApplyCode={editor.scripts.setDraft}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
      <RightSidebar active={rightPanel} isOpen={isEditorOpen} onSelect={onSelectRightPanel} />
      </div>

      {/* Bottom toolbar — TradingView keeps its panel toggles here. */}
      <footer className="flex h-8 shrink-0 items-center gap-1 border-t border-border px-2">
        <Button
          variant={isTesterOpen ? "secondary" : "ghost"} size="sm" className="h-6 text-xs"
          onClick={() => setIsTesterOpen((v) => !v)}
        >
          <FlaskConical className="mr-1 h-3.5 w-3.5" /> Strategy Tester
        </Button>
        <Button
          variant={isEditorOpen && rightPanel === "editor" ? "secondary" : "ghost"} size="sm" className="h-6 text-xs"
          onClick={() => onSelectRightPanel("editor")}
        >
          <Code2 className="mr-1 h-3.5 w-3.5" /> Pine Editor
        </Button>
      </footer>

    </div>
  );
}
