"use client";

import { useCallback, useState, useEffect, useMemo } from "react";
import { STUB_BARS } from "@/lib/stub-bars";
import { SUPPORTED_SYMBOLS, type SymbolOption, type ChartInterval } from "@/lib/public-binance-feed";
import { ChartCell } from "@/components/chart/chart-cell";
import { PineEditor } from "@/components/editor/pine-editor";
import { StrategyPanel } from "@/components/strategy/strategy-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TradeMarker } from "@/components/chart/chart-workbench";
import type { BacktestTrade } from "@/lib/strategy-runner";
import { SettingsDialog, loadSettings, type BinanceSettings, DEFAULT_SETTINGS } from "@/components/trading/settings-dialog";
import { AlertSettingsDialog } from "@/components/alerts/alert-settings-dialog";
import { loadAlertSettings, type AlertSettings, DEFAULT_ALERT_SETTINGS } from "@/lib/alert-sinks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Card, CardContent } from "@/components/ui/card";
import { LayoutGrid, Plus, Minus } from "lucide-react";
import type { ChartOverlay } from "@/components/chart/chart-workbench";

/**
 * Chart workbench — Wave 18. Multi-chart grid.
 *
 * The page manages N independent ChartCell instances in a grid (1, 2, 4, or 6).
 * Each cell has its own symbol, timeframe, bars, stream, indicators, and overlays.
 * Clicking a cell makes it "active" — the shared editor below operates on the
 * active cell's bars.
 *
 * Layout selector: 1 chart (full), 2 charts (side-by-side), 4 charts (2×2),
 * 6 charts (3×2). A "+" button adds a cell (up to 6); "×" removes a cell.
 *
 * The editor panel at the bottom is shared — it runs the custom indicator
 * against the ACTIVE cell's bars and pushes the results as overlays to that cell.
 */

type GridLayout = 1 | 2 | 4 | 6;

const LAYOUT_OPTIONS: { value: GridLayout; label: string; cols: number; rows: number }[] = [
  { value: 1, label: "1 chart", cols: 1, rows: 1 },
  { value: 2, label: "2 charts", cols: 2, rows: 1 },
  { value: 4, label: "4 charts", cols: 2, rows: 2 },
  { value: 6, label: "6 charts", cols: 3, rows: 2 },
];

interface CellConfig {
  readonly id: string;
  readonly symbol: SymbolOption;
  readonly interval: ChartInterval;
}

let cellCounter = 0;
const newCellId = () => `cell-${++cellCounter}`;

export default function Home() {
  const [layout, setLayout] = useState<GridLayout>(1);
  const [cells, setCells] = useState<CellConfig[]>([
    { id: newCellId(), symbol: SUPPORTED_SYMBOLS[0]!, interval: "1m" },
  ]);
  const [activeCellId, setActiveCellId] = useState<string>(cells[0]?.id ?? "");

  // Shared settings.
  const [settings, setSettings] = useState<BinanceSettings>(DEFAULT_SETTINGS);
  useEffect(() => setSettings(loadSettings()), []);
  const [alertSettings, setAlertSettings] = useState<AlertSettings>(DEFAULT_ALERT_SETTINGS);
  useEffect(() => setAlertSettings(loadAlertSettings()), []);

  // Editor state — shared, operates on the active cell's bars.
  const [editorOverlays, setEditorOverlays] = useState<ChartOverlay[]>([]);
  const [editorPlots, setEditorPlots] = useState<{ id: string; color: string; kind: string }[]>([]);
  const [backtestTrades, setBacktestTrades] = useState<BacktestTrade[]>([]);

  // Convert backtest trades → trade markers for the active chart cell. Wave 21.
  const tradeMarkers = useMemo<TradeMarker[]>(() => {
    return backtestTrades.flatMap((t) => [
      { time: t.entryTime, type: "entry" as const, direction: t.direction as "long" | "short", price: t.entryPrice },
      { time: t.exitTime, type: "exit" as const, direction: t.direction as "long" | "short", price: t.exitPrice, profit: t.profit },
    ]);
  }, [backtestTrades]);

  const activeCell = cells.find((c) => c.id === activeCellId) ?? cells[0];

  // Layout change: add/remove cells to match the layout.
  const onLayoutChange = useCallback((newLayout: GridLayout) => {
    setLayout(newLayout);
    setCells((prev) => {
      if (prev.length < newLayout) {
        const additions: CellConfig[] = [];
        for (let i = prev.length; i < newLayout; i++) {
          additions.push({
            id: newCellId(),
            symbol: SUPPORTED_SYMBOLS[i % SUPPORTED_SYMBOLS.length]!,
            interval: "1m",
          });
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
    const newCell: CellConfig = {
      id: newCellId(),
      symbol: SUPPORTED_SYMBOLS[cells.length % SUPPORTED_SYMBOLS.length]!,
      interval: "1m",
    };
    setCells((prev) => [...prev, newCell]);
    setLayout(Math.min(cells.length + 1, 6) as GridLayout);
    setActiveCellId(newCell.id);
  }, [cells.length]);

  // Grid CSS.
  const layoutConfig = LAYOUT_OPTIONS.find((l) => l.value === layout)!;
  const gridStyle = {
    display: "grid",
    gridTemplateColumns: `repeat(${layoutConfig.cols}, 1fr)`,
    gridTemplateRows: `repeat(${layoutConfig.rows}, 1fr)`,
    gap: "4px",
  };

  // The active cell's bars (for the editor). We pass empty overlays to non-active
  // cells and the editor overlays to the active cell.
  // Since ChartCell manages its own bars internally, we need a way to get the
  // active cell's bars for the editor. For simplicity, the editor uses stub bars
  // as a fallback — in a production app, ChartCell would expose its bars via a
  // ref or callback. Wave 18b can wire this properly.
  const editorBars = STUB_BARS;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex h-12 items-center justify-between border-b border-border bg-card px-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">pine-ts Workbench</span>
          <span className="text-xs text-muted-foreground">Wave 18 — multi-chart grid</span>
        </div>
        <div className="flex items-center gap-2">
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
          {/* Add cell */}
          <Button variant="outline" size="sm" onClick={onAddCell} disabled={cells.length >= 6}>
            <Plus className="h-3 w-3 mr-1" /> Add
          </Button>
          <AlertSettingsDialog onSaved={setAlertSettings} />
          <SettingsDialog onSaved={setSettings} />
        </div>
      </header>

      {/* Body: chart grid (top) + editor (bottom) */}
      <ResizablePanelGroup direction="vertical" className="flex-1">
        {/* Chart grid */}
        <ResizablePanel defaultSize={65} minSize={30}>
          <div className="h-full p-1" style={gridStyle}>
            {cells.map((cell) => (
              <ChartCell
                key={cell.id}
                cellId={cell.id}
                isActive={cell.id === activeCellId}
                onActivate={setActiveCellId}
                onRemove={onRemoveCell}
                canRemove={cells.length > 1}
                editorOverlays={cell.id === activeCellId ? editorOverlays : []}
                tradeMarkers={cell.id === activeCellId ? tradeMarkers : []}
              />
            ))}
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        {/* Bottom panel: Indicator editor + Strategy backtest tabs */}
        <ResizablePanel defaultSize={35} minSize={15}>
          <Tabs defaultValue="indicator" className="flex h-full flex-col">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="indicator" className="text-xs">Indicator Editor</TabsTrigger>
              <TabsTrigger value="strategy" className="text-xs">Strategy Backtest</TabsTrigger>
            </TabsList>
            <TabsContent value="indicator" className="flex-1 overflow-hidden m-0">
              <PineEditor
                bars={editorBars}
                onResults={(results) => {
                  const overlays: ChartOverlay[] = (Object.keys(results).length > 0 && editorPlots.length > 0)
                    ? editorPlots.map((plot) => {
                        const vals = results[plot.id] ?? [];
                        const data: { time: number; value: number }[] = [];
                        for (let i = 0; i < editorBars.length; i++) {
                          const v = vals[i];
                          if (v === undefined || Number.isNaN(v)) continue;
                          data.push({ time: editorBars[i]!.time, value: v });
                        }
                        return {
                          instanceId: `editor:${plot.id}`,
                          indicatorId: `editor.${plot.id}`,
                          indicatorName: `Custom (${plot.id})`,
                          color: plot.color,
                          data,
                        } as ChartOverlay;
                      })
                    : [];
                  setEditorOverlays(overlays);
                }}
                onMetadata={setEditorPlots}
              />
            </TabsContent>
            <TabsContent value="strategy" className="flex-1 overflow-y-auto m-0">
              <StrategyPanel bars={editorBars} onTradesChange={setBacktestTrades} />
            </TabsContent>
          </Tabs>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
