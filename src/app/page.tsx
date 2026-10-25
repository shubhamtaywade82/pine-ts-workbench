"use client";

import { useCallback, useState, useEffect, useMemo, useRef } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import type { Bar } from "@nemesis-oss/pine-ts";
import { SUPPORTED_SYMBOLS, type SymbolOption, type ChartInterval } from "@/lib/public-binance-feed";
import { MemoizedChartCell, type CellSettings } from "@/components/chart/chart-cell";
import { nextInstanceId, type MountedIndicator } from "@/components/chart/indicator-sidebar";
import { PineEditor } from "@/components/editor/pine-editor";
import { useBacktest, StrategyCodeTab, StrategyTester } from "@/components/strategy/strategy-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TradeMarker } from "@/components/chart/chart-workbench";
import type { BacktestTrade } from "@/lib/strategy-runner";
import { SettingsDialog, loadSettings, type BinanceSettings, DEFAULT_SETTINGS } from "@/components/trading/settings-dialog";
import { AlertSettingsDialog } from "@/components/alerts/alert-settings-dialog";
import { loadAlertSettings, type AlertSettings, DEFAULT_ALERT_SETTINGS } from "@/lib/alert-sinks";
import {
  loadLayouts, saveCurrentLayout, deleteLayout, layoutToCells, findSymbol, loadWorkspace, saveWorkspace,
  type SavedLayout, type Workspace,
} from "@/lib/saved-layouts";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { LayoutGrid, Plus, Sun, Moon, Save, Code2, FlaskConical } from "lucide-react";
import type { ChartOverlay } from "@/components/chart/chart-workbench";

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

type GridLayout = 1 | 2 | 4 | 6;

const LAYOUT_OPTIONS: { value: GridLayout; label: string; cols: number; rows: number }[] = [
  { value: 1, label: "1 chart", cols: 1, rows: 1 },
  { value: 2, label: "2 charts", cols: 2, rows: 1 },
  { value: 4, label: "4 charts", cols: 2, rows: 2 },
  { value: 6, label: "6 charts", cols: 3, rows: 2 },
];

interface CellConfig extends CellSettings {
  readonly id: string;
}

let cellCounter = 0;
const newCellId = () => `cell-${++cellCounter}`;

const defaultIndicators = (): MountedIndicator[] => [
  { instanceId: nextInstanceId("sma"), indicatorId: "sma", indicatorName: "Simple Moving Average", inputs: { source: "close", length: 20 }, pane: "main" },
];

const newCell = (symbol: SymbolOption, interval: ChartInterval = "1m"): CellConfig =>
  ({ id: newCellId(), symbol, interval, indicators: defaultIndicators() });

/** Plot values per editor bar → chart overlays; constant plots become dashed levels. */
const toEditorOverlays = (
  results: Record<string, Array<number | undefined>>,
  plots: { id: string; color: string; kind: string }[],
  bars: readonly Bar[],
): ChartOverlay[] => plots.map((plot) => {
  const values = results[plot.id] ?? [];
  const data: { time: number; value: number }[] = [];
  for (let i = 0; i < bars.length; i++) {
    const value = values[i];
    if (value === undefined || Number.isNaN(value)) continue;
    data.push({ time: bars[i]!.time, value });
  }
  return {
    instanceId: `editor:${plot.id}`,
    indicatorId: `editor.${plot.id}`,
    indicatorName: `Custom (${plot.id})`,
    color: plot.color,
    isLevel: plot.kind === "hline",
    data,
  };
});

/** Expands or collapses a panel to match `isOpen` (panels stay mounted either way). */
const syncPanel = (panel: ImperativePanelHandle | null, isOpen: boolean) => {
  if (panel === null || panel.isExpanded() === isOpen) return;
  if (isOpen) panel.expand();
  else panel.collapse();
};

export default function Home() {
  const [layout, setLayout] = useState<GridLayout>(1);
  const [cells, setCells] = useState<CellConfig[]>(() => [newCell(SUPPORTED_SYMBOLS[0]!)]);
  const [activeCellId, setActiveCellId] = useState<string>(cells[0]?.id ?? "");
  const [savedLayouts, setSavedLayouts] = useState<SavedLayout[]>([]);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [layoutName, setLayoutName] = useState("");
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorTab, setEditorTab] = useState<Workspace["editorTab"]>("indicator");
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
  const [backtestTrades, setBacktestTrades] = useState<BacktestTrade[]>([]);
  // The active cell's bars (for the editor and the backtest).
  const [editorBars, setEditorBars] = useState<readonly Bar[]>([]);
  const backtest = useBacktest(editorBars, setBacktestTrades);

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
      setLayout(workspace.layout as GridLayout);
      setCells(restored);
      setActiveCellId((restored[workspace.activeCellIndex] ?? restored[0]!).id);
      setIsEditorOpen(workspace.isEditorOpen);
      setEditorTab(workspace.editorTab);
      setIsTesterOpen(workspace.isTesterOpen);
      setTheme(workspace.theme);
      document.documentElement.classList.toggle("dark", workspace.theme === "dark");
    }
    setIsRestored(true);
  }, []);

  useEffect(() => {
    if (!isRestored) return;
    saveWorkspace({
      layout,
      cells: cells.map((c) => ({ symbolProduct: c.symbol.binanceSymbol, interval: c.interval, indicators: c.indicators })),
      activeCellIndex: Math.max(0, cells.findIndex((c) => c.id === activeCellId)),
      isEditorOpen, editorTab, isTesterOpen, theme,
    });
  }, [isRestored, layout, cells, activeCellId, isEditorOpen, editorTab, isTesterOpen, theme]);

  // Before restore, syncing (and the panels' own collapse callbacks) would overwrite the saved open state.
  useEffect(() => { if (isRestored) syncPanel(editorPanelRef.current, isEditorOpen); }, [isRestored, isEditorOpen]);
  useEffect(() => { if (isRestored) syncPanel(testerPanelRef.current, isTesterOpen); }, [isRestored, isTesterOpen]);

  const onCellChange = useCallback((cellId: string, patch: Partial<CellSettings>) => {
    setCells((prev) => prev.map((c) => (c.id === cellId ? { ...c, ...patch } : c)));
  }, []);

  // Layout change: add/remove cells to match the layout.
  const onLayoutChange = useCallback((newLayout: GridLayout) => {
    setLayout(newLayout);
    setCells((prev) => {
      if (prev.length < newLayout) {
        const additions: CellConfig[] = [];
        for (let i = prev.length; i < newLayout; i++) {
          additions.push(newCell(SUPPORTED_SYMBOLS[i % SUPPORTED_SYMBOLS.length]!));
        }
        return [...prev, ...additions];
      }
      if (prev.length > newLayout) {
        return prev.slice(0, newLayout);
      }
      return prev;
    });
  }, []);

  const onRemoveCell = useCallback((cellId: string) => {
    setCells((prev) => {
      const next = prev.filter((c) => c.id !== cellId);
      if (next.length === 0) return prev; // keep at least 1
      if (activeCellId === cellId) setActiveCellId(next[0]!.id);
      setLayout(next.length as GridLayout);
      return next;
    });
  }, [activeCellId]);

  const onAddCell = useCallback(() => {
    if (cells.length >= 6) return;
    const added = newCell(SUPPORTED_SYMBOLS[cells.length % SUPPORTED_SYMBOLS.length]!);
    setCells((prev) => [...prev, added]);
    setLayout(Math.min(cells.length + 1, 6) as GridLayout);
    setActiveCellId(added.id);
  }, [cells.length]);

  // Grid CSS — responsive: 1 column on mobile, layout-based on desktop.
  const layoutConfig = LAYOUT_OPTIONS.find((l) => l.value === layout)!;
  const gridStyle = {
    display: "grid" as const,
    // minmax(0, …): a bare 1fr track never shrinks below the chart canvas, so opening a panel would overflow it.
    gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : `repeat(${layoutConfig.cols}, minmax(0, 1fr))`,
    gridTemplateRows: isMobile ? `repeat(${cells.length}, minmax(0, 1fr))` : `repeat(${layoutConfig.rows}, minmax(0, 1fr))`,
    gap: "4px",
  };

  // Load saved layouts on mount.
  useEffect(() => { setSavedLayouts(loadLayouts()); }, []);

  // Save current layout.
  const onSaveLayout = useCallback(() => {
    if (!layoutName.trim()) return;
    const cellConfigs = cells.map((c) => ({ symbol: c.symbol, interval: c.interval }));
    saveCurrentLayout(layoutName.trim(), layout, cellConfigs);
    setSavedLayouts(loadLayouts());
    setLayoutName("");
    setShowSaveDialog(false);
  }, [layoutName, layout, cells]);

  // Load a saved layout.
  const onLoadLayout = useCallback((id: string) => {
    const saved = savedLayouts.find((l) => l.id === id);
    if (!saved) return;
    const cellConfigs = layoutToCells(saved);
    setLayout(saved.layout as GridLayout);
    const loaded = cellConfigs.map((c) => newCell(c.symbol, c.interval));
    setCells(loaded);
    setActiveCellId(loaded[0]!.id);
  }, [savedLayouts]);

  // Delete a saved layout.
  const onDeleteLayout = useCallback((id: string) => {
    deleteLayout(id);
    setSavedLayouts(loadLayouts());
  }, []);

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
      {/* Header */}
      <header className="flex h-12 items-center justify-between border-b border-border bg-card px-2 sm:px-4">
        <div className="flex items-center gap-1 sm:gap-2">
          <span className="text-xs sm:text-sm font-semibold">pine-ts</span>
          <span className="hidden sm:inline text-xs text-muted-foreground">Wave 24</span>
        </div>
        <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
          {/* Layout selector */}
          <Select value={String(layout)} onValueChange={(v) => onLayoutChange(Number(v) as GridLayout)}>
            <SelectTrigger className="h-8 w-28 text-xs">
              <LayoutGrid className="h-3 w-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LAYOUT_OPTIONS.map((l) => (
                <SelectItem key={l.value} value={String(l.value)}>{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Saved layouts dropdown — hidden on mobile */}
          <Select value="" onValueChange={(v) => v && onLoadLayout(v)}>
            <SelectTrigger className="hidden sm:flex h-8 w-28 text-xs">
              <Save className="h-3 w-3 mr-1" />
              <span className="text-xs text-muted-foreground">Layouts</span>
            </SelectTrigger>
            <SelectContent>
              {savedLayouts.map((l) => (
                <SelectItem key={l.id} value={l.id} className="flex items-center justify-between">
                  {l.name} ({l.layout} charts)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Save current layout — hidden on mobile */}
          <Button variant="outline" size="sm" className="hidden sm:flex" onClick={() => setShowSaveDialog(true)}>
            <Save className="h-3 w-3 mr-1" /> Save
          </Button>
          {/* Add cell */}
          <Button variant="outline" size="sm" onClick={onAddCell} disabled={cells.length >= 6}>
            <Plus className="h-3 w-3 mr-1" /> Add
          </Button>
          {/* Theme toggle */}
          <Button variant="ghost" size="sm" onClick={toggleTheme}>
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <AlertSettingsDialog onSaved={setAlertSettings} />
          <SettingsDialog onSaved={setSettings} />
        </div>
      </header>

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
                    onActivate={setActiveCellId}
                    onRemove={onRemoveCell}
                    canRemove={cells.length > 1}
                    editorOverlays={cell.id === activeCellId ? editorOverlays : []}
                    tradeMarkers={cell.id === activeCellId ? tradeMarkers : []}
                    onActiveBarsChange={setEditorBars}
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
              <Tabs value={editorTab} onValueChange={(v) => setEditorTab(v as Workspace["editorTab"])} className="flex h-full flex-col gap-0 border-l border-border">
                <TabsList className="h-8 w-full justify-start rounded-none border-b border-border bg-transparent p-0">
                  <TabsTrigger value="indicator" className="text-xs">Indicator</TabsTrigger>
                  <TabsTrigger value="strategy" className="text-xs">Strategy</TabsTrigger>
                </TabsList>
                <TabsContent value="indicator" forceMount className="m-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
                  <PineEditor bars={editorBars} onResults={(results, plots) => setEditorOverlays(toEditorOverlays(results, plots, editorBars))} />
                </TabsContent>
                <TabsContent value="strategy" forceMount className="m-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
                  <StrategyCodeTab backtest={backtest} />
                </TabsContent>
              </Tabs>
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

      {/* Save layout dialog */}
      {showSaveDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowSaveDialog(false)}>
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-sm font-semibold">Save Layout</h3>
            <input
              type="text"
              placeholder="Layout name (e.g. My Watchlist)"
              value={layoutName}
              onChange={(e) => setLayoutName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSaveLayout()}
              className="mb-3 w-64 rounded border border-border px-2 py-1 text-xs"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowSaveDialog(false)}>Cancel</Button>
              <Button size="sm" onClick={onSaveLayout} disabled={!layoutName.trim()}>Save</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
