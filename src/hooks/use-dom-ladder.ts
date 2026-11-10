import { useEffect, useRef, type RefObject } from "react";
import type { ISeriesApi, SeriesType } from "lightweight-charts";
import type { BinanceSymbol, LiveTrade } from "@/lib/public-binance-feed";
import { subscribeBook, subscribeDepthWalls, type BookSubscription } from "@/lib/depth-feed-browser";
import type { DepthFeedState, DepthWallsUpdate } from "@/lib/depth-feed";
import { wallOptionsFor, type WallOptions } from "@/lib/depth-walls";
import { bucketBounds, bucketize, priceBucketKey, type PriceBucket } from "@/lib/price-buckets";
import { fallbackTickSize, loadTickSize } from "@/lib/symbol-catalog";
import type { ChartSettings } from "@/lib/chart-settings";
import { LevelActivity } from "@/lib/level-activity";
import { formatBucketWidth } from "@/components/chart/dom-ladder-layout";
import { DomLadderPrimitive, type DomLadderBuckets, type LadderWall } from "@/components/chart/dom-ladder-primitive";

/** Ignore mid noise smaller than this fraction of the registered window. */
const WINDOW_DRIFT = 0.01;

const lastClose = (series: ISeriesApi<SeriesType>): number | undefined => {
  const bar = series.data().at(-1) as { close?: number; value?: number } | undefined;
  const price = bar?.close ?? bar?.value;
  return typeof price === "number" && price > 0 ? price : undefined;
};
const windowPctFor = (price: number, tickSize: number, bucketTicks: number, visibleBuckets: number): number =>
  ((visibleBuckets / 2) * bucketTicks * tickSize / price) * 100;
interface TickBox { tick: number | undefined }
interface DomParams {
  bucketTicks: number;
  visibleBuckets: number;
  wallWindowPct: number;
  minWallNotional: number;
  wallTopN: number;
}
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
  readonly subscribeTrades?: (listener: (trade: LiveTrade) => void) => () => void;
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
  readonly activity: LevelActivity;
  subscription: BookSubscription | null;
  wallsSub: { setOptions: (options: WallOptions) => void; unsubscribe: () => void } | null;
  wallOptions: WallOptions;
  shown: DomLadderBuckets;
  latest: DepthFeedState | undefined;
  walls: LadderWall[];
  lastPrice: number | undefined;
  bucketTicks: number;
}
const trackBook = (session: LadderSession, state: DepthFeedState): void => {
  session.latest = state;
  const { bucketTicks, visibleBuckets } = session.params.current;
  if (session.bucketTicks !== bucketTicks || state.status !== "live") {
    // Diffing the order book across a resync would invent fake pulls.
    session.activity.reset();
    session.bucketTicks = bucketTicks;
  }
  if (state.status !== "live") return;
  const next = bucketsFrom(state, session.tickBox, bucketTicks, visibleBuckets);
  if (next !== undefined) session.activity.observeBook(Date.now(), next.bids, next.asks);
};
const publishLadder = (session: LadderSession, shown: DomLadderBuckets, bucketTicks: number): void => {
  const activity = [...session.activity.levels(Date.now())].map(([key, flow]) => ({
    key, bought: flow.bought, sold: flow.sold, pulled: flow.pulled,
  }));
  session.run.primitive.setBuckets({
    ...shown,
    activity,
    walls: session.walls,
    lastPrice: session.lastPrice,
    bucketLabel: formatBucketWidth((session.tickBox.tick ?? 0) * bucketTicks),
  });
};
const syncWallOptions = (session: LadderSession): void => {
  const { wallWindowPct, minWallNotional, wallTopN } = session.params.current;
  const next = wallOptionsFor(wallWindowPct, minWallNotional, wallTopN);
  const prev = session.wallOptions;
  if (prev.windowPct === next.windowPct && prev.minNotional === next.minNotional && prev.topN === next.topN) return;
  session.wallOptions = next;
  session.wallsSub?.setOptions(next);
};
const paintSession = (session: LadderSession): void => {
  const { latest, subscription } = session;
  if (latest === undefined || subscription === null) return;
  const { bucketTicks, visibleBuckets } = session.params.current;
  syncWindow(latest, session.tickBox, subscription, { params: session.params.current, applied: session.applied });
  const next = bucketsFrom(latest, session.tickBox, bucketTicks, visibleBuckets);
  session.shown = shownBuckets(latest, next, session.shown);
  syncWallOptions(session);
  publishLadder(session, session.shown, bucketTicks);
};
const noteTrade = (session: LadderSession, trade: LiveTrade): void => {
  if (session.latest?.status !== "live") return;
  const tick = session.tickBox.tick;
  if (tick === undefined) return;
  const bucketTicks = session.params.current.bucketTicks;
  const key = priceBucketKey(trade.price, tick, bucketTicks);
  // Stamp trades with local receive time so they share the book's clock.
  session.activity.observeTrade({ ...trade, time: Date.now() }, key);
  session.lastPrice = trade.price;
};
const noteWalls = (session: LadderSession, update: DepthWallsUpdate): void => {
  const frame = update.frame;
  session.walls = update.status === "live" && frame !== undefined
    ? [...frame.bids, ...frame.asks].map((wall) => ({ price: wall.price, side: wall.side }))
    : [];
};
const bindFeeds = (session: LadderSession, refresh: { current: () => void }): (() => void) => {
  let raf = 0;
  const schedule = () => {
    if (raf !== 0) return;
    raf = requestAnimationFrame(() => { raf = 0; paintSession(session); });
  };
  const { run } = session;
  session.subscription = subscribeBook(run.symbol, session.applied.pct, (state) => {
    trackBook(session, state);
    schedule();
  });
  session.wallsSub = subscribeDepthWalls(run.symbol, session.wallOptions, (update) => {
    noteWalls(session, update);
    schedule();
  });
  const stopTrades = run.subscribeTrades?.((trade) => { noteTrade(session, trade); schedule(); }) ?? (() => undefined);
  refresh.current = schedule;
  return () => {
    if (raf !== 0) cancelAnimationFrame(raf);
    refresh.current = () => undefined;
    session.subscription?.unsubscribe();
    session.wallsSub?.unsubscribe();
    stopTrades();
    session.activity.reset();
  };
};
const startDom = (run: DomRun, params: { current: DomParams }, refresh: { current: () => void }): (() => void) => {
  const wallOptions = wallOptionsFor(params.current.wallWindowPct, params.current.minWallNotional, params.current.wallTopN);
  const session: LadderSession = {
    run, params, tickBox: { tick: run.knownTick },
    applied: { pct: openingWindow(run.series, run.knownTick, params.current) },
    activity: new LevelActivity(), subscription: null, wallsSub: null, wallOptions,
    shown: { status: "syncing", bids: [], asks: [] }, latest: undefined, walls: [],
    lastPrice: undefined, bucketTicks: params.current.bucketTicks,
  };
  return bindFeeds(session, refresh);
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
  readonly subscribeTrades?: (listener: (trade: LiveTrade) => void) => () => void;
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
  void loadTickSize(depthSymbol).then((knownTick) => {
    if (stopped) return;
    const run = { series, symbol: depthSymbol, primitive, knownTick, subscribeTrades: holders.subscribeTrades };
    cancel = startDom(run, holders.params, holders.refresh);
  });
  return () => {
    stopped = true;
    cancel();
    holders.refresh.current = () => undefined;
    primitive.setBuckets(undefined);
  };
};
interface DomExtras {
  readonly seriesType?: string;
  readonly subscribeTrades?: (listener: (trade: LiveTrade) => void) => () => void;
}

/** Draws a throttled DOM ladder on the candle series while `trading.dom` is enabled. */
export function useDomLadder(
  candlestickRef: RefObject<ISeriesApi<SeriesType> | null>,
  depthSymbol: BinanceSymbol | undefined,
  tradingSettings: ChartSettings["trading"],
  extras?: DomExtras,
): void {
  const { enabled, bucketTicks, visibleBuckets } = tradingSettings.dom;
  const { wallWindowPct, minWallNotional, wallTopN } = tradingSettings;
  const slot = useRef<DomHolders["slot"]["current"]>(null);
  const params = useRef<DomParams>({ bucketTicks, visibleBuckets, wallWindowPct, minWallNotional, wallTopN });
  const refresh = useRef<() => void>(() => undefined);
  useEffect(() => {
    params.current = { bucketTicks, visibleBuckets, wallWindowPct, minWallNotional, wallTopN };
    refresh.current();
  }, [bucketTicks, visibleBuckets, wallWindowPct, minWallNotional, wallTopN]);
  useEffect(() => {
    const candle = candlestickRef.current;
    if (candle === null) return;
    return watchDom(candle, depthSymbol, enabled, {
      slot, params, refresh, subscribeTrades: extras?.subscribeTrades,
    });
  }, [candlestickRef, depthSymbol, enabled, extras?.seriesType, extras?.subscribeTrades]);
}
