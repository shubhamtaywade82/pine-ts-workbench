"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { ISeriesApi, SeriesType } from "lightweight-charts";
import type { BinanceSymbol } from "@/lib/public-binance-feed";
import { subscribeBook, type BookSubscription } from "@/lib/depth-feed-browser";
import type { DepthFeedState } from "@/lib/depth-feed";
import { bucketize, type PriceBucket } from "@/lib/price-buckets";
import { fetchInstrumentFilters } from "@/lib/symbol-catalog";
import type { ChartSettings } from "@/lib/chart-settings";
import { LiquidityHistory } from "@/lib/liquidity-history";
import { LiquidityHeatmapPrimitive } from "@/components/chart/liquidity-heatmap-primitive";

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

interface HeatParams {
  readonly windowPct: number;
  readonly bucketTicks: number;
  readonly opacity: number;
  readonly minutes: number;
}

interface HeatRun {
  readonly series: ISeriesApi<SeriesType>;
  readonly symbol: BinanceSymbol;
  readonly primitive: LiquidityHeatmapPrimitive;
  readonly knownTick: number | undefined;
  readonly minutes: number;
}

const sideBuckets = (
  state: DepthFeedState,
  tick: number,
  params: HeatParams,
): { bids: PriceBucket[]; asks: PriceBucket[] } | undefined => {
  const book = state.book;
  if (book?.bestBid === undefined || book.bestAsk === undefined) return undefined;
  const mid = (book.bestBid + book.bestAsk) / 2;
  const span = mid * (params.windowPct / 100);
  const shared = { tickSize: tick, bucketTicks: params.bucketTicks };
  return {
    bids: bucketize(book.levels("bid"), {
      ...shared,
      low: Math.max(mid - span, book.coverage.bidFloor),
      high: mid,
    }),
    asks: bucketize(book.levels("ask"), {
      ...shared,
      low: mid,
      high: Math.min(mid + span, book.coverage.askCeiling),
    }),
  };
};

interface HeatSession {
  readonly run: HeatRun;
  readonly params: { current: HeatParams };
  readonly history: LiquidityHistory;
  readonly tickBox: { tick: number | undefined };
  subscription: BookSubscription | null;
  latest: DepthFeedState | undefined;
}

const paintHeat = (session: HeatSession): void => {
  const state = session.latest;
  const { subscription, history, run, params } = session;
  if (state === undefined || subscription === null) return;
  subscription.setWindow(params.current.windowPct);
  if (state.status !== "live") {
    history.clear();
    run.primitive.setView([], params.current.opacity);
    return;
  }
  const book = state.book;
  if (book?.bestBid !== undefined && session.tickBox.tick === undefined) {
    session.tickBox.tick = fallbackTickSize(book.bestBid);
  }
  const tick = session.tickBox.tick;
  const next = tick === undefined ? undefined : sideBuckets(state, tick, params.current);
  if (next !== undefined) history.push({ at: Date.now(), bids: next.bids, asks: next.asks });
  run.primitive.setView(history.samples(), params.current.opacity);
};

const startHeat = (run: HeatRun, params: { current: HeatParams }, refresh: { current: () => void }): (() => void) => {
  const session: HeatSession = {
    run,
    params,
    history: new LiquidityHistory(Math.max(1, run.minutes) * 60),
    tickBox: { tick: run.knownTick },
    subscription: null,
    latest: undefined,
  };
  let raf = 0;
  const schedule = () => {
    if (raf !== 0) return;
    raf = requestAnimationFrame(() => { raf = 0; paintHeat(session); });
  };
  session.subscription = subscribeBook(run.symbol, params.current.windowPct, (state) => {
    session.latest = state;
    schedule();
  });
  refresh.current = schedule;
  return () => {
    if (raf !== 0) cancelAnimationFrame(raf);
    refresh.current = () => undefined;
    session.history.clear();
    session.subscription?.unsubscribe();
    run.primitive.setView([], params.current.opacity);
  };
};

const detachHeat = (series: ISeriesApi<SeriesType>, primitive: LiquidityHeatmapPrimitive): void => {
  try {
    series.detachPrimitive(primitive);
  } catch {
    // The chart may already have removed this series.
  }
};

const attachHeat = (
  series: ISeriesApi<SeriesType>,
  slot: { current: { series: ISeriesApi<SeriesType>; primitive: LiquidityHeatmapPrimitive } | null },
): LiquidityHeatmapPrimitive => {
  const current = slot.current;
  if (current?.series === series) return current.primitive;
  if (current !== null) detachHeat(current.series, current.primitive);
  const primitive = new LiquidityHeatmapPrimitive();
  series.attachPrimitive(primitive);
  slot.current = { series, primitive };
  return primitive;
};

interface HeatHolders {
  readonly slot: { current: { series: ISeriesApi<SeriesType>; primitive: LiquidityHeatmapPrimitive } | null };
  readonly params: { current: HeatParams };
  readonly refresh: { current: () => void };
  readonly minutes: number;
}

const watchHeat = (
  series: ISeriesApi<SeriesType>,
  depthSymbol: BinanceSymbol | undefined,
  enabled: boolean,
  holders: HeatHolders,
): (() => void) => {
  const primitive = attachHeat(series, holders.slot);
  if (!enabled || depthSymbol === undefined) {
    primitive.setView([], holders.params.current.opacity);
    return () => undefined;
  }
  let cancel = () => {};
  let stopped = false;
  void loadTick(depthSymbol).then((knownTick) => {
    if (stopped) return;
    const run = { series, symbol: depthSymbol, primitive, knownTick, minutes: holders.minutes };
    cancel = startHeat(run, holders.params, holders.refresh);
  });
  return () => {
    stopped = true;
    cancel();
    primitive.setView([], holders.params.current.opacity);
  };
};

/** Draws the one-second book history while `trading.heatmap` is enabled. */
export function useLiquidityHeatmap(
  candlestickRef: RefObject<ISeriesApi<SeriesType> | null>,
  depthSymbol: BinanceSymbol | undefined,
  trading: ChartSettings["trading"],
  seriesType?: string,
): void {
  const { enabled, opacity, minutes } = trading.heatmap;
  const bucketTicks = trading.dom.bucketTicks;
  const windowPct = trading.wallWindowPct;
  const slot = useRef<HeatHolders["slot"]["current"]>(null);
  const params = useRef<HeatParams>({ windowPct, bucketTicks, opacity, minutes });
  const refresh = useRef<() => void>(() => undefined);
  useEffect(() => {
    params.current = { windowPct, bucketTicks, opacity, minutes };
    refresh.current();
  }, [windowPct, bucketTicks, opacity, minutes]);
  useEffect(() => {
    const candle = candlestickRef.current;
    if (candle === null) return;
    return watchHeat(candle, depthSymbol, enabled, { slot, params, refresh, minutes });
  }, [candlestickRef, depthSymbol, enabled, minutes, seriesType]);
}
