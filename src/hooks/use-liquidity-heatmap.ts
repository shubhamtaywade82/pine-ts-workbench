"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { ISeriesApi, SeriesType } from "lightweight-charts";
import type { BinanceSymbol } from "@/lib/public-binance-feed";
import { subscribeBook, type BookSubscription } from "@/lib/depth-feed-browser";
import type { DepthFeedState } from "@/lib/depth-feed";
import { bucketizeWindow } from "@/lib/price-buckets";
import { fallbackTickSize, loadTickSize } from "@/lib/symbol-catalog";
import type { ChartSettings } from "@/lib/chart-settings";
import { LiquidityHistory } from "@/lib/liquidity-history";
import { LiquidityHeatmapPrimitive } from "@/components/chart/liquidity-heatmap-primitive";

// The heatmap used to borrow the DOM ladder's bucket setting; its old default keeps rows unchanged.
const HEATMAP_BUCKET_TICKS = 10;

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

interface HeatSession {
  readonly run: HeatRun;
  readonly params: { current: HeatParams };
  readonly history: LiquidityHistory;
  readonly tickBox: { tick: number | undefined };
  lastBucketTicks: number;
  lastTick: number | undefined;
  subscription: BookSubscription | null;
  latest: DepthFeedState | undefined;
}

const paintHeat = (session: HeatSession): void => {
  const state = session.latest;
  const { subscription, history, run, params } = session;
  if (state === undefined || subscription === null) return;
  subscription.setWindow(params.current.windowPct);
  const book = state.book;
  if (book?.bestBid !== undefined && session.tickBox.tick === undefined) {
    session.tickBox.tick = fallbackTickSize(book.bestBid);
  }
  const tick = session.tickBox.tick;
  if (session.lastBucketTicks !== params.current.bucketTicks || (tick !== undefined && session.lastTick !== undefined && session.lastTick !== tick)) {
    history.clear();
    session.lastBucketTicks = params.current.bucketTicks;
    session.lastTick = tick;
  } else if (session.lastTick === undefined && tick !== undefined) {
    session.lastTick = tick;
  }
  if (state.status === "live" && tick !== undefined && book !== undefined) {
    const next = bucketizeWindow(book, { tickSize: tick, bucketTicks: params.current.bucketTicks, windowPct: params.current.windowPct });
    if (next !== undefined) history.push({ at: Date.now(), bids: next.bids, asks: next.asks });
  }
  run.primitive.setView(history.samples(), params.current.opacity);
};

const startHeat = (run: HeatRun, params: { current: HeatParams }, refresh: { current: () => void }): (() => void) => {
  const session: HeatSession = {
    run,
    params,
    history: new LiquidityHistory(Math.max(1, run.minutes) * 60),
    tickBox: { tick: run.knownTick },
    lastBucketTicks: params.current.bucketTicks,
    lastTick: run.knownTick,
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
  void loadTickSize(depthSymbol).then((knownTick) => {
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
  const bucketTicks = HEATMAP_BUCKET_TICKS;
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
