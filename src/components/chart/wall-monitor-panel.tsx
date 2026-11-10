"use client";

import { useEffect, useRef, useState } from "react";
import type { BinanceSymbol } from "@/lib/public-binance-feed";
import { quoteAssetOf } from "@/lib/public-binance-feed";
import { subscribeBook, subscribeDepthWalls } from "@/lib/depth-feed-browser";
import type { DepthFeedState, DepthWallsUpdate } from "@/lib/depth-feed";
import type { BookView } from "@/lib/depth-walls";
import { wallOptionsFor, type Wall, type WallFrame } from "@/lib/depth-walls";
import { bucketizeWindow } from "@/lib/price-buckets";
import { fallbackTickSize, loadTickSize } from "@/lib/symbol-catalog";
import { LiquidityBaseline } from "@/lib/liquidity-baseline";
import type { LifecycleWall } from "@/lib/wall-lifecycle";
import type { ChartSettings } from "@/lib/chart-settings";
import {
  BigLevelsBody,
  bigLevelsModel,
  pulledEvents,
  reachedProximityPct,
  type BigLevelInput,
  type MonitorSnapshot,
} from "@/components/chart/wall-monitor-rows";

const BASELINE_SAMPLES = 60;
const BASELINE_MIN = 10;
const RENDER_MS = 250;
const PULLED_CAP = 30;

const windowNotionals = (book: BookView, tick: number, windowPct: number): number[] => {
  const buckets = bucketizeWindow(book, { tickSize: tick, bucketTicks: 1, windowPct });
  if (buckets === undefined) return [];
  return [...buckets.bids, ...buckets.asks].map((bucket) => bucket.notional);
};

interface MonitorBox {
  baseline: LiquidityBaseline;
  tick: number | undefined;
  lastSampleAt: number;
  previous: LifecycleWall[];
  pulled: { side: Wall["side"]; price: number; notional: number; at: number }[];
  held: Set<string>;
}

const freshBox = (): MonitorBox => ({
  baseline: new LiquidityBaseline(BASELINE_SAMPLES, BASELINE_MIN),
  tick: undefined,
  lastSampleAt: 0,
  previous: [],
  pulled: [],
  held: new Set(),
});

const noteSample = (box: MonitorBox, state: DepthFeedState, windowPct: number): void => {
  if (state.status !== "live" || state.book?.bestBid === undefined) {
    box.baseline = new LiquidityBaseline(BASELINE_SAMPLES, BASELINE_MIN);
    box.lastSampleAt = 0;
    return;
  }
  const now = Date.now();
  if (now - box.lastSampleAt < 1_000) return;
  if (box.tick === undefined) box.tick = fallbackTickSize(state.book.bestBid);
  box.baseline.add(windowNotionals(state.book, box.tick, windowPct));
  box.lastSampleAt = now;
};

const rememberPulls = (box: MonitorBox, frame: WallFrame, proximityPct: number): void => {
  const current = [...frame.bids, ...frame.asks].map((wall) => ({
    side: wall.side, price: wall.price, notional: wall.notional,
  }));
  const tick = box.tick ?? fallbackTickSize(frame.mid);
  const events = pulledEvents(box.previous, current, { at: Date.now(), mid: frame.mid, proximityPct, bucketWidth: tick });
  box.pulled.push(...events);
  if (box.pulled.length > PULLED_CAP) box.pulled.splice(0, box.pulled.length - PULLED_CAP);
  const live = new Set(current.map((wall) => `${wall.side}:${wall.price}`));
  for (const key of box.held) if (!live.has(key)) box.held.delete(key);
  for (const wall of current) {
    const span = frame.mid > 0 ? (Math.abs(frame.mid - wall.price) / frame.mid) * 100 : 0;
    if (span <= proximityPct) box.held.add(`${wall.side}:${wall.price}`);
  }
  box.previous = current;
};

const noteWalls = (box: MonitorBox, update: DepthWallsUpdate, proximityPct: number): void => {
  if (update.status !== "live" || update.frame === undefined) {
    box.previous = [];
    box.held.clear();
    return;
  }
  rememberPulls(box, update.frame, proximityPct);
};

const levelsFrom = (frame: WallFrame, box: MonitorBox): BigLevelInput[] =>
  [...frame.bids, ...frame.asks].map((wall) => ({
    side: wall.side,
    price: wall.price,
    quantity: wall.quantity,
    strength: box.baseline.relativeStrength(wall.notional),
    observedSince: wall.observedSince,
    held: box.held.has(`${wall.side}:${wall.price}`),
  }));

const snapshotFrom = (update: DepthWallsUpdate, box: MonitorBox, quote: string): MonitorSnapshot => {
  const frame = update.frame;
  const ctx = { mid: frame?.mid ?? 0, now: Date.now(), quote };
  if (update.status !== "live" || frame === undefined) {
    return { status: update.status, model: bigLevelsModel([], ctx, box.pulled) };
  }
  return { status: update.status, model: bigLevelsModel(levelsFrom(frame, box), ctx, box.pulled) };
};

interface MonitorRefs {
  readonly pending: { current: DepthWallsUpdate | null };
  readonly box: { current: MonitorBox };
}

const paintLoop = (
  refs: MonitorRefs,
  symbol: BinanceSymbol,
  setView: (view: MonitorSnapshot) => void,
): (() => void) => {
  const id = setInterval(() => {
    const update = refs.pending.current;
    if (update === null) return;
    setView(snapshotFrom(update, refs.box.current, quoteAssetOf(symbol)));
  }, RENDER_MS);
  return () => clearInterval(id);
};

interface MonitorOptions {
  wallWindowPct: number;
  minWallNotional: number;
  wallTopN: number;
}

const subscribeMonitor = (
  enabled: boolean,
  symbol: BinanceSymbol | undefined,
  options: MonitorOptions,
  refs: MonitorRefs,
): (() => void) | undefined => {
  if (!enabled || symbol === undefined) return undefined;
  refs.box.current = freshBox();
  const proximity = reachedProximityPct(options.wallWindowPct);
  const walls = subscribeDepthWalls(
    symbol,
    wallOptionsFor(options.wallWindowPct, options.minWallNotional, options.wallTopN),
    (update) => {
      noteWalls(refs.box.current, update, proximity);
      refs.pending.current = update;
    },
  );
  const book = subscribeBook(symbol, options.wallWindowPct, (state) => {
    noteSample(refs.box.current, state, options.wallWindowPct);
  });
  let live = true;
  void loadTickSize(symbol).then((tick) => {
    if (live && tick !== undefined) refs.box.current.tick = tick;
  });
  return () => { live = false; walls.unsubscribe(); book.unsubscribe(); refs.pending.current = null; };
};

const useWallSnapshot = (symbol: BinanceSymbol | undefined, trading: ChartSettings["trading"]): MonitorSnapshot | null => {
  const pending = useRef<DepthWallsUpdate | null>(null);
  const box = useRef<MonitorBox>(freshBox());
  const enabled = trading.showOrderBookWalls;
  const [view, setView] = useState<MonitorSnapshot | null>(null);
  const { wallWindowPct, minWallNotional, wallTopN } = trading;
  useEffect(() => {
    setView(null);
  }, [symbol]);
  useEffect(() => {
    if (symbol === undefined || !enabled) return undefined;
    return paintLoop({ pending, box }, symbol, setView);
  }, [box, enabled, pending, symbol]);
  useEffect(
    () => subscribeMonitor(enabled, symbol, { wallWindowPct, minWallNotional, wallTopN }, { pending, box }),
    [box, enabled, minWallNotional, pending, symbol, wallTopN, wallWindowPct],
  );
  return view;
};

const storageKeyForCell = (cellId?: string): string => `pine:wall-monitor:expanded:${cellId ?? "default"}`;

export const readExpandedState = (cellId?: string): boolean => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    return window.localStorage.getItem(storageKeyForCell(cellId)) === "true";
  } catch (error) {
    console.warn("Failed to read wall monitor expanded state from localStorage", error);
    return false;
  }
};

export const writeExpandedState = (cellId: string | undefined, expanded: boolean): void => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(storageKeyForCell(cellId), String(expanded));
  } catch (error) {
    console.warn("Failed to write wall monitor expanded state to localStorage", error);
  }
};

const useExpandedState = (cellId?: string): [boolean, () => void] => {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setExpanded(readExpandedState(cellId));
  }, [cellId]);
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    writeExpandedState(cellId, next);
  };
  return [expanded, toggle];
};

export interface WallMonitorPanelProps {
  readonly cellId?: string;
  readonly symbol: BinanceSymbol | undefined;
  readonly trading: ChartSettings["trading"];
}

/** Depth is ~10 Hz. The list paints at 4 Hz so the chart shell is not rendered per book event. */
export function WallMonitorPanel({ cellId, symbol, trading }: WallMonitorPanelProps) {
  const view = useWallSnapshot(symbol, trading);
  const [expanded, toggleExpanded] = useExpandedState(cellId);
  if (!trading.showOrderBookWalls || symbol === undefined) return null;
  const snapshot = view ?? {
    status: "syncing",
    model: bigLevelsModel([], { mid: 0, now: Date.now(), quote: quoteAssetOf(symbol) }, []),
  };
  return (
    <aside className="pointer-events-auto absolute bottom-8 left-2 z-20 max-h-80 w-80 overflow-auto rounded border border-border bg-popover/90 p-1.5 font-mono text-[10px] text-muted-foreground shadow">
      <BigLevelsBody snapshot={snapshot} isExpanded={expanded} onToggle={toggleExpanded} />
    </aside>
  );
}
