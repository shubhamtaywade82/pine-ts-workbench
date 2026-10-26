"use client";

import { useCallback, useState } from "react";
import { SUPPORTED_SYMBOLS, type ChartInterval, type SymbolOption } from "@/lib/public-binance-feed";
import type { CellSettings } from "@/components/chart/chart-cell";
import { createMountedIndicator, nextInstanceId, type MountedIndicator } from "@/components/chart/indicator-dialogs";
import { LAYOUT_OPTIONS, type GridLayout } from "@/components/chart/top-toolbar";

export interface CellConfig extends CellSettings {
  readonly id: string;
}

const MAX_CELLS = 6;

let cellCounter = 0;
const newCellId = () => `cell-${++cellCounter}`;

const defaultIndicators = (): MountedIndicator[] => [
  { instanceId: nextInstanceId("sma"), indicatorId: "sma", indicatorName: "Simple Moving Average", inputs: { source: "close", length: 20 }, pane: "main" },
];

export const newCell = (symbol: SymbolOption, interval: ChartInterval = "1m"): CellConfig =>
  ({ id: newCellId(), symbol, interval, indicators: defaultIndicators() });

/** Smallest grid that fits `count` cells: 3 charts use the 2×2 grid, 5 the 3×2. */
const layoutFor = (count: number): GridLayout => LAYOUT_OPTIONS.find((l) => l.value >= count)?.value ?? 6;

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

  const onLayoutChange = useCallback((nextLayout: GridLayout) => {
    setLayout(nextLayout);
    setCells((prev) => {
      if (prev.length > nextLayout) return prev.slice(0, nextLayout);
      const additions = Array.from({ length: nextLayout - prev.length }, (_, i) => newCell(symbolForSlot(prev.length + i)));
      return [...prev, ...additions];
    });
  }, []);

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
    const added = newCell(symbolForSlot(cells.length));
    setCells((prev) => [...prev, added]);
    setLayout(layoutFor(cells.length + 1));
    setActiveCellId(added.id);
  }, [cells.length]);

  return {
    layout, cells, activeCellId, activeCell, canAddCell: cells.length < MAX_CELLS,
    setActiveCellId, replaceGrid, onCellChange, onAddIndicator, addToActiveCell, onLayoutChange, onRemoveCell, onAddCell,
  };
}
