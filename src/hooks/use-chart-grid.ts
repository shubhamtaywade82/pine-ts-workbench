"use client";

import { useCallback, useState } from "react";
import { SUPPORTED_SYMBOLS, type ChartInterval, type SymbolOption } from "@/lib/public-binance-feed";
import type { CellSettings } from "@/components/chart/chart-cell";
import { createMountedIndicator, nextInstanceId, type MountedIndicator } from "@/components/chart/indicator-dialogs";
import { LAYOUT_OPTIONS, type GridLayout } from "@/components/chart/top-toolbar";
import { loadWatchlist, symbolsToFill } from "@/lib/symbol-catalog";

export interface CellConfig extends CellSettings {
  readonly id: string;
}

// TradingView Ultimate's layout cap.
const MAX_CELLS = 16;

let cellCounter = 0;
const newCellId = () => `cell-${++cellCounter}`;

const defaultIndicators = (): MountedIndicator[] => [
  { instanceId: nextInstanceId("sma"), indicatorId: "sma", indicatorName: "Simple Moving Average", inputs: { source: "close", length: 20 }, pane: "main" },
];

export const newCell = (symbol: SymbolOption, interval: ChartInterval = "1m"): CellConfig =>
  ({ id: newCellId(), symbol, interval, indicators: defaultIndicators() });

/** Smallest grid that fits `count` cells: 5 charts use the 3×2 grid, 13 the 4×4. */
const layoutFor = (count: number): GridLayout => LAYOUT_OPTIONS.find((l) => l.value >= count)?.value ?? 16;

const symbolForSlot = (index: number): SymbolOption => SUPPORTED_SYMBOLS[index % SUPPORTED_SYMBOLS.length]!;

/** The chart grid: its layout, cells, and which cell the toolbar and editor act on. */
export function useChartGrid() {
  const [layout, setLayout] = useState<GridLayout>(1);
  const [cells, setCells] = useState<CellConfig[]>(() => [newCell(symbolForSlot(0))]);
  const [activeCellId, setActiveCellId] = useState<string>(cells[0]?.id ?? "");
  const activeCell = cells.find((c) => c.id === activeCellId) ?? cells[0]!;

  /** Replaces the whole grid (workspace restore, saved layout load). */
  const replaceGrid = useCallback((nextLayout: GridLayout, nextCells: CellConfig[], activeIndex = 0) => {
    setLayout(nextLayout);
    setCells(nextCells);
    setActiveCellId((nextCells[activeIndex] ?? nextCells[0]!).id);
  }, []);

  const onCellChange = useCallback((cellId: string, patch: Partial<CellSettings>) => {
    setCells((prev) => prev.map((c) => (c.id === cellId ? { ...c, ...patch } : c)));
  }, []);

  /** Adds an indicator instance to the active chart. */
  const addToActiveCell = useCallback((added: MountedIndicator) => {
    setCells((prev) => prev.map((c) => (c.id === activeCell.id ? { ...c, indicators: [...c.indicators, added] } : c)));
  }, [activeCell.id]);

  const onAddIndicator = useCallback((indicatorId: string) => {
    const added = createMountedIndicator(indicatorId);
    if (added !== undefined) addToActiveCell(added);
  }, [addToActiveCell]);

  /** Shrinking never drops the active chart; growing fills the new cells from the watchlist, in order. */
  const onLayoutChange = useCallback((nextLayout: GridLayout) => {
    setLayout(nextLayout);
    setCells((prev) => {
      if (prev.length > nextLayout) {
        const kept = prev.slice(0, nextLayout);
        const active = prev.find((c) => c.id === activeCellId);
        if (active !== undefined && !kept.includes(active)) kept[nextLayout - 1] = active;
        return kept;
      }
      const shown = prev.map((c) => c.symbol.ticker);
      return [...prev, ...symbolsToFill(shown, loadWatchlist(), nextLayout - prev.length).map((s) => newCell(s))];
    });
  }, [activeCellId]);

  const onRemoveCell = useCallback((cellId: string) => {
    setCells((prev) => {
      const next = prev.filter((c) => c.id !== cellId);
      if (next.length === 0) return prev;
      if (activeCellId === cellId) setActiveCellId(next[0]!.id);
      setLayout(layoutFor(next.length));
      return next;
    });
  }, [activeCellId]);

  const onAddCell = useCallback(() => {
    if (cells.length >= MAX_CELLS) return;
    const [next] = symbolsToFill(cells.map((c) => c.symbol.ticker), loadWatchlist(), 1);
    const added = newCell(next!);
    setCells((prev) => [...prev, added]);
    setLayout(layoutFor(cells.length + 1));
    setActiveCellId(added.id);
  }, [cells]);

  return {
    layout, cells, activeCellId, activeCell, canAddCell: cells.length < MAX_CELLS,
    setActiveCellId, replaceGrid, onCellChange, onAddIndicator, addToActiveCell, onLayoutChange, onRemoveCell, onAddCell,
  };
}
