"use client";

/**
 * Saved layouts — Wave 23. Persists chart grid configurations (layout size +
 * per-cell symbol + timeframe) to localStorage. Users can save the current
 * layout, load a saved one, or delete it.
 *
 * Default layouts: "Single BTC" (1 chart), "Crypto Watch" (4 charts:
 * BTC/ETH/SOL/BNB), "Dual View" (2 charts: BTC + ETH).
 */

import { SUPPORTED_SYMBOLS, type SymbolOption, type ChartInterval } from "@/lib/public-binance-feed";
import type { MountedIndicator } from "@/components/chart/indicator-dialogs";

export interface SavedCellConfig {
  readonly symbolProduct: string;
  readonly interval: ChartInterval;
}

export interface SavedLayout {
  readonly id: string;
  readonly name: string;
  readonly layout: number;
  readonly cells: readonly SavedCellConfig[];
}

const STORAGE_KEY = "pine-ts-workbench-layouts";

export const DEFAULT_LAYOUTS: SavedLayout[] = [
  {
    id: "default-single",
    name: "Single BTC",
    layout: 1,
    cells: [{ symbolProduct: "BTCUSDT", interval: "1m" }],
  },
  {
    id: "default-dual",
    name: "Dual View",
    layout: 2,
    cells: [
      { symbolProduct: "BTCUSDT", interval: "1m" },
      { symbolProduct: "ETHUSDT", interval: "1m" },
    ],
  },
  {
    id: "default-crypto",
    name: "Crypto Watch",
    layout: 4,
    cells: [
      { symbolProduct: "BTCUSDT", interval: "1m" },
      { symbolProduct: "ETHUSDT", interval: "1m" },
      { symbolProduct: "SOLUSDT", interval: "1m" },
      { symbolProduct: "BNBUSDT", interval: "1m" },
    ],
  },
];

export const loadLayouts = (): SavedLayout[] => {
  if (typeof window === "undefined") return DEFAULT_LAYOUTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_LAYOUTS;
    const saved = JSON.parse(raw) as SavedLayout[];
    return [...DEFAULT_LAYOUTS, ...saved.filter((s) => !s.id.startsWith("default-"))];
  } catch {
    return DEFAULT_LAYOUTS;
  }
};

export const saveLayouts = (layouts: SavedLayout[]): void => {
  if (typeof window === "undefined") return;
  try {
    const custom = layouts.filter((l) => !l.id.startsWith("default-"));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
  } catch { /* ignore */ }
};

export const saveCurrentLayout = (
  name: string,
  layout: number,
  cells: { symbol: SymbolOption; interval: ChartInterval }[],
): SavedLayout => {
  const id = `custom-${Date.now()}`;
  const saved: SavedLayout = {
    id,
    name,
    layout,
    cells: cells.map((c) => ({ symbolProduct: c.symbol.binanceSymbol, interval: c.interval })),
  };
  const all = loadLayouts();
  saveLayouts([...all, saved]);
  return saved;
};

export const deleteLayout = (id: string): void => {
  if (id.startsWith("default-")) return;
  const all = loadLayouts();
  saveLayouts(all.filter((l) => l.id !== id));
};

/** Layouts saved before the Binance switch store Coinbase ids ("BTC-USD"); map them to "BTCUSDT". */
export const findSymbol = (symbolProduct: string): SymbolOption => {
  const binanceSymbol = symbolProduct.replace(/-USD$/, "USDT");
  return SUPPORTED_SYMBOLS.find((s) => s.binanceSymbol === binanceSymbol) ?? SUPPORTED_SYMBOLS[0]!;
};

/** Converts a SavedLayout's cell configs back to runtime cell configs. */
export const layoutToCells = (saved: SavedLayout): { symbol: SymbolOption; interval: ChartInterval }[] => {
  return saved.cells.map((c) => ({
    symbol: findSymbol(c.symbolProduct),
    interval: c.interval,
  }));
};

// ---------- last workspace (auto-saved, restored on load) ----------

const WORKSPACE_KEY = "pine-ts-workbench-workspace";

export interface WorkspaceCell {
  readonly symbolProduct: string;
  readonly interval: ChartInterval;
  readonly indicators: readonly MountedIndicator[];
}

/** Everything the user picked last time, so a reload lands where they left off. */
export interface Workspace {
  readonly layout: number;
  readonly cells: readonly WorkspaceCell[];
  readonly activeCellIndex: number;
  readonly isEditorOpen: boolean;
  readonly isTesterOpen: boolean;
  readonly theme: "dark" | "light";
}

/** Saved workspace, or null on first visit / unreadable storage. */
export const loadWorkspace = (): Workspace | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(WORKSPACE_KEY);
    if (raw === null) return null;
    const workspace = JSON.parse(raw) as Workspace;
    return workspace.cells.length > 0 ? workspace : null;
  } catch {
    return null; // Corrupt JSON or blocked storage: start from defaults.
  }
};

export const saveWorkspace = (workspace: Workspace): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
  } catch { /* Storage full or blocked: the workspace just won't survive a reload. */ }
};
