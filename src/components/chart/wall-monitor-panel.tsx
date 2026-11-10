"use client";

import { useEffect, useRef, useState } from "react";
import type { BinanceSymbol } from "@/lib/public-binance-feed";
import { quoteAssetOf } from "@/lib/public-binance-feed";
import { subscribeBook, subscribeDepthWalls } from "@/lib/depth-feed-browser";
import type { DepthFeedState, DepthWallsUpdate } from "@/lib/depth-feed";
import type { BookView } from "@/lib/depth-walls";
import { wallOptionsFor, type Wall, type WallFrame } from "@/lib/depth-walls";
import { bucketize } from "@/lib/price-buckets";
import { fetchInstrumentFilters } from "@/lib/symbol-catalog";
import { LiquidityBaseline } from "@/lib/liquidity-baseline";
import type { ChartSettings } from "@/lib/chart-settings";
import { formatAge, formatNotional, formatPct } from "@/components/chart/depth-walls-primitive";

const BASELINE_SAMPLES = 60;
const BASELINE_MIN = 10;
const RENDER_MS = 250;
const ticks = new Map<string, Promise<number | undefined>>();

const loadTick = (symbol: string): Promise<number | undefined> => {
  const cached = ticks.get(symbol);
  if (cached !== undefined) return cached;
  const pending = fetchInstrumentFilters(symbol).then((filters) => filters?.tickSize).catch(() => undefined);
  ticks.set(symbol, pending);
  return pending;
};

const fallbackTickSize = (bestBid: number): number => {
  const ratio = bestBid / 1e5;
  if (!(ratio > 0) || !Number.isFinite(ratio)) return 1;
  return 10 ** Math.round(Math.log10(ratio));
};

interface MonitorRow {
  readonly key: string;
  readonly side: Wall["side"];
  readonly price: string;
  readonly notional: string;
  readonly strength: string;
  readonly distance: string;
  readonly age: string;
  readonly status: string;
}

interface MonitorView {
  readonly caption: string;
  readonly status: string;
  readonly rows: readonly MonitorRow[];
}

const formatStrength = (ratio: number | null): string =>
  ratio === null ? "—" : `${ratio.toFixed(1)}×`;

const distancePct = (price: number, mid: number): string =>
  mid > 0 ? `${((Math.abs(price - mid) / mid) * 100).toFixed(2)}%` : "—";

interface RowContext {
  readonly frame: WallFrame;
  readonly baseline: LiquidityBaseline;
  readonly quote: string;
  readonly now: number;
}

const rowFor = (wall: Wall, ctx: RowContext): MonitorRow => ({
  key: `${wall.side}:${wall.price}`,
  side: wall.side,
  price: wall.price.toLocaleString("en-US", { maximumFractionDigits: 8 }),
  notional: `${formatNotional(wall.notional)} ${ctx.quote}`,
  strength: formatStrength(ctx.baseline.relativeStrength(wall.notional)),
  distance: distancePct(wall.price, ctx.frame.mid),
  age: formatAge(Math.max(0, ctx.now - wall.observedSince)),
  status: wall.status ?? "holding",
});

const rowsFrom = (frame: WallFrame, baseline: LiquidityBaseline, quote: string): MonitorRow[] => {
  const ctx: RowContext = { frame, baseline, quote, now: Date.now() };
  return [...frame.bids, ...frame.asks]
    .sort((left, right) => right.notional - left.notional)
    .map((wall) => rowFor(wall, ctx));
};

const viewFrom = (update: DepthWallsUpdate, baseline: LiquidityBaseline, windowPct: number, quote: string): MonitorView => {
  const searched = update.frame?.searchedPct ?? windowPct;
  const caption = `max within ±${formatPct(searched)}% window`;
  if (update.status !== "live" || update.frame === undefined) return { caption, status: update.status, rows: [] };
  return { caption, status: update.status, rows: rowsFrom(update.frame, baseline, quote) };
};

const windowNotionals = (book: BookView, tick: number, windowPct: number): number[] => {
  if (book.bestBid === undefined || book.bestAsk === undefined) return [];
  const mid = (book.bestBid + book.bestAsk) / 2;
  const span = mid * (windowPct / 100);
  const shared = { tickSize: tick, bucketTicks: 1 };
  const bids = bucketize(book.levels("bid"), { ...shared, low: Math.max(mid - span, book.coverage.bidFloor), high: mid });
  const asks = bucketize(book.levels("ask"), { ...shared, low: mid, high: Math.min(mid + span, book.coverage.askCeiling) });
  return [...bids, ...asks].map((bucket) => bucket.notional);
};

interface BaselineBox {
  baseline: LiquidityBaseline;
  tick: number | undefined;
  lastSampleAt: number;
}

const noteSample = (box: BaselineBox, state: DepthFeedState, windowPct: number): void => {
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

const RowLine = ({ row }: { row: MonitorRow }) => (
  <li className="grid grid-cols-[2.2rem_1fr] gap-1">
    <span className={row.side === "bid" ? "text-[#089981]" : "text-[#f23645]"}>{row.side}</span>
    <span>{row.price} · {row.notional} · {row.strength} · {row.distance} · {row.age} · {row.status}</span>
  </li>
);

const freshBox = (): BaselineBox => ({
  baseline: new LiquidityBaseline(BASELINE_SAMPLES, BASELINE_MIN),
  tick: undefined,
  lastSampleAt: 0,
});

interface MonitorRefs {
  readonly pending: { current: DepthWallsUpdate | null };
  readonly box: { current: BaselineBox };
}

const paintLoop = (
  refs: MonitorRefs,
  symbol: BinanceSymbol,
  windowPct: number,
  setView: (view: MonitorView) => void,
): (() => void) => {
  const id = setInterval(() => {
    const update = refs.pending.current;
    if (update === null) return;
    setView(viewFrom(update, refs.box.current.baseline, windowPct, quoteAssetOf(symbol)));
  }, RENDER_MS);
  return () => clearInterval(id);
};

const subscribeMonitor = (
  enabled: boolean,
  symbol: BinanceSymbol | undefined,
  options: { wallWindowPct: number; minWallNotional: number; wallTopN: number },
  refs: MonitorRefs,
): (() => void) | undefined => {
  if (!enabled || symbol === undefined) return undefined;
  refs.box.current = freshBox();
  const walls = subscribeDepthWalls(
    symbol,
    wallOptionsFor(options.wallWindowPct, options.minWallNotional, options.wallTopN),
    (update) => { refs.pending.current = update; },
  );
  const book = subscribeBook(symbol, options.wallWindowPct, (state) => {
    noteSample(refs.box.current, state, options.wallWindowPct);
  });
  let live = true;
  void loadTick(symbol).then((tick) => {
    if (live && tick !== undefined) refs.box.current.tick = tick;
  });
  return () => {
    live = false;
    walls.unsubscribe();
    book.unsubscribe();
    refs.pending.current = null;
  };
};

const useWallSnapshot = (symbol: BinanceSymbol | undefined, trading: ChartSettings["trading"]): MonitorView | null => {
  const pending = useRef<DepthWallsUpdate | null>(null);
  const box = useRef<BaselineBox>(freshBox());
  const enabled = trading.showOrderBookWalls;
  const [view, setView] = useState<MonitorView | null>(null);
  const { wallWindowPct, minWallNotional, wallTopN } = trading;
  useEffect(() => {
    // Clears on symbol change so the old symbol's walls never paint for the new symbol.
    setView(null);
  }, [symbol, setView]);
  useEffect(() => {
    if (symbol === undefined || !enabled) return undefined;
    return paintLoop({ pending, box }, symbol, wallWindowPct, setView);
  }, [box, enabled, pending, symbol, wallWindowPct]);
  useEffect(
    () => subscribeMonitor(enabled, symbol, { wallWindowPct, minWallNotional, wallTopN }, { pending, box }),
    [box, enabled, minWallNotional, pending, symbol, wallTopN, wallWindowPct],
  );
  return view;
};

/** Depth is ~10 Hz. The list paints at 4 Hz so the chart shell is not rendered per book event. */
export function WallMonitorPanel({ symbol, trading }: {
  symbol: BinanceSymbol | undefined;
  trading: ChartSettings["trading"];
}) {
  const view = useWallSnapshot(symbol, trading);
  if (!trading.showOrderBookWalls || symbol === undefined) return null;
  const caption = view?.caption ?? `max within ±${formatPct(trading.wallWindowPct)}% window`;
  return (
    <aside className="pointer-events-auto absolute bottom-8 left-2 z-20 max-h-48 w-72 overflow-auto rounded border border-border bg-popover/90 p-1.5 font-mono text-[10px] text-muted-foreground shadow">
      <p>{caption}</p>
      {view !== null && view.status !== "live" && <p>{view.status}</p>}
      <ul className="mt-1 flex flex-col gap-0.5">
        {view?.rows.map((row) => <RowLine key={row.key} row={row} />)}
      </ul>
    </aside>
  );
}
