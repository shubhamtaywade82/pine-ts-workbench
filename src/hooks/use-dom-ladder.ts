import { useEffect, useRef, type RefObject } from "react";
import type { ISeriesApi, SeriesType } from "lightweight-charts";
import type { BinanceSymbol } from "@/lib/public-binance-feed";
import { subscribeBook, type BookSubscription } from "@/lib/depth-feed-browser";
import type { DepthFeedState } from "@/lib/depth-feed";
import { bucketize, type PriceBucket } from "@/lib/price-buckets";
import { loadTickSize } from "@/lib/symbol-catalog";
import type { ChartSettings } from "@/lib/chart-settings";
import { DomLadderPrimitive, type DomLadderBuckets } from "@/components/chart/dom-ladder-primitive";

/** Ignore mid noise smaller than this fraction of the registered window. */
const WINDOW_DRIFT = 0.01;

/** Exchange tick is unknown: one part in 1e5 of the bid, rounded to a power of ten. */
const fallbackTickSize = (bestBid: number): number => {
  const ratio = bestBid / 1e5;
  if (!(ratio > 0) || !Number.isFinite(ratio)) return 1;
  return 10 ** Math.round(Math.log10(ratio));
};

const lastClose = (series: ISeriesApi<SeriesType>): number | undefined => {
  const bar = series.data().at(-1) as { close?: number; value?: number } | undefined;
  const price = bar?.close ?? bar?.value;
  return typeof price === "number" && price > 0 ? price : undefined;
};

const windowPctFor = (price: number, tickSize: number, bucketTicks: number, visibleBuckets: number): number =>
  ((visibleBuckets / 2) * bucketTicks * tickSize / price) * 100;

interface TickBox { tick: number | undefined }
interface DomParams { bucketTicks: number; visibleBuckets: number }
interface AppliedWindow { pct: number | undefined }

const bucketsFrom = (
  state: DepthFeedState,
  tickBox: TickBox,
  bucketTicks: number,
  visibleBuckets: number,
): { bids: PriceBucket[]; asks: PriceBucket[] } | undefined => {
  const book = state.book;
  if (state.status !== "live" || book?.bestBid === undefined || book.bestAsk === undefined) return undefined;
  if (tickBox.tick === undefined) tickBox.tick = fallbackTickSize(book.bestBid);
  const mid = (book.bestBid + book.bestAsk) / 2;
  const half = (visibleBuckets / 2) * bucketTicks * tickBox.tick;
  const options = {
    tickSize: tickBox.tick,
    bucketTicks,
    low: Math.max(mid - half, book.coverage.bidFloor),
    high: Math.min(mid + half, book.coverage.askCeiling),
  };
  return { bids: bucketize(book.levels("bid"), options), asks: bucketize(book.levels("ask"), options) };
};

interface DomRun {
  readonly series: ISeriesApi<SeriesType>;
  readonly symbol: BinanceSymbol;
  readonly primitive: DomLadderPrimitive;
  readonly knownTick: number | undefined;
}

interface WindowView {
  readonly params: DomParams;
  readonly applied: AppliedWindow;
}

const openingWindow = (series: ISeriesApi<SeriesType>, knownTick: number | undefined, params: DomParams): number | undefined => {
  const price = lastClose(series);
  if (price === undefined) return undefined;
  const tick = knownTick ?? fallbackTickSize(price);
  return windowPctFor(price, tick, params.bucketTicks, params.visibleBuckets);
};

const publishWindow = (subscription: BookSubscription, price: number, tick: number, view: WindowView): void => {
  const next = windowPctFor(price, tick, view.params.bucketTicks, view.params.visibleBuckets);
  const previous = view.applied.pct;
  if (previous !== undefined && Math.abs(next - previous) <= previous * WINDOW_DRIFT) return;
  subscription.setWindow(next);
  view.applied.pct = next;
};

const syncWindow = (
  state: DepthFeedState,
  tickBox: TickBox,
  subscription: BookSubscription,
  view: WindowView,
): void => {
  const book = state.book;
  if (state.status !== "live" || book?.bestBid === undefined || book.bestAsk === undefined) return;
  if (tickBox.tick === undefined) tickBox.tick = fallbackTickSize(book.bestBid);
  publishWindow(subscription, (book.bestBid + book.bestAsk) / 2, tickBox.tick, view);
};

const shownBuckets = (
  state: DepthFeedState,
  next: { bids: PriceBucket[]; asks: PriceBucket[] } | undefined,
  previous: DomLadderBuckets,
): DomLadderBuckets => ({
  status: state.status,
  bids: next?.bids ?? previous.bids,
  asks: next?.asks ?? previous.asks,
  coverage: state.book?.coverage,
});

interface LadderSession {
  readonly run: DomRun;
  readonly params: { current: DomParams };
  readonly tickBox: TickBox;
  readonly applied: AppliedWindow;
  subscription: BookSubscription | null;
  shown: DomLadderBuckets;
  latest: DepthFeedState | undefined;
}

const paintSession = (session: LadderSession): void => {
  const { latest, subscription } = session;
  if (latest === undefined || subscription === null) return;
  const { bucketTicks, visibleBuckets } = session.params.current;
  syncWindow(latest, session.tickBox, subscription, { params: session.params.current, applied: session.applied });
  const next = bucketsFrom(latest, session.tickBox, bucketTicks, visibleBuckets);
  session.shown = shownBuckets(latest, next, session.shown);
  session.run.primitive.setBuckets(session.shown);
};

const startDom = (
  run: DomRun,
  params: { current: DomParams },
  refresh: { current: () => void },
): (() => void) => {
  const session: LadderSession = {
    run,
    params,
    tickBox: { tick: run.knownTick },
    applied: { pct: openingWindow(run.series, run.knownTick, params.current) },
    subscription: null,
    shown: { status: "syncing", bids: [], asks: [] },
    latest: undefined,
  };
  let raf = 0;
  const schedule = () => {
    if (raf !== 0) return;
    raf = requestAnimationFrame(() => { raf = 0; paintSession(session); });
  };
  session.subscription = subscribeBook(run.symbol, session.applied.pct, (state) => {
    session.latest = state;
    schedule();
  });
  refresh.current = schedule;
  return () => {
    if (raf !== 0) cancelAnimationFrame(raf);
    refresh.current = () => undefined;
    session.subscription?.unsubscribe();
  };
};

const detachDom = (series: ISeriesApi<SeriesType>, primitive: DomLadderPrimitive): void => {
  try {
    series.detachPrimitive(primitive);
  } catch {
    // The chart may already have removed this series.
  }
};

const attachDom = (
  series: ISeriesApi<SeriesType>,
  slot: { current: { series: ISeriesApi<SeriesType>; primitive: DomLadderPrimitive } | null },
): DomLadderPrimitive => {
  const current = slot.current;
  if (current?.series === series) return current.primitive;
  if (current !== null) detachDom(current.series, current.primitive);
  const primitive = new DomLadderPrimitive();
  series.attachPrimitive(primitive);
  slot.current = { series, primitive };
  return primitive;
};

interface DomHolders {
  readonly slot: { current: { series: ISeriesApi<SeriesType>; primitive: DomLadderPrimitive } | null };
  readonly params: { current: DomParams };
  readonly refresh: { current: () => void };
}

const watchDom = (
  series: ISeriesApi<SeriesType>,
  depthSymbol: BinanceSymbol | undefined,
  enabled: boolean,
  holders: DomHolders,
): (() => void) => {
  const primitive = attachDom(series, holders.slot);
  if (!enabled || depthSymbol === undefined) {
    primitive.setBuckets(undefined);
    return () => undefined;
  }
  let cancel = () => {};
  let stopped = false;
  void loadTick(depthSymbol).then((knownTick) => {
    if (stopped) return;
    const run = { series, symbol: depthSymbol, primitive, knownTick };
    cancel = startDom(run, holders.params, holders.refresh);
  });
  return () => {
    stopped = true;
    cancel();
    holders.refresh.current = () => undefined;
    primitive.setBuckets(undefined);
  };
};

/** Draws a throttled DOM ladder on the candle series while `trading.dom` is enabled. */
export function useDomLadder(
  candlestickRef: RefObject<ISeriesApi<SeriesType> | null>,
  depthSymbol: BinanceSymbol | undefined,
  tradingSettings: ChartSettings["trading"],
  seriesType?: string,
): void {
  const { enabled, bucketTicks, visibleBuckets } = tradingSettings.dom;
  const slot = useRef<DomHolders["slot"]["current"]>(null);
  const params = useRef<DomParams>({ bucketTicks, visibleBuckets });
  const refresh = useRef<() => void>(() => undefined);
  useEffect(() => {
    params.current = { bucketTicks, visibleBuckets };
    refresh.current();
  }, [bucketTicks, visibleBuckets]);
  useEffect(() => {
    const candle = candlestickRef.current;
    if (candle === null) return;
    return watchDom(candle, depthSymbol, enabled, { slot, params, refresh });
  }, [candlestickRef, depthSymbol, enabled, seriesType]);
}
