"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { ISeriesApi, SeriesType } from "lightweight-charts";
import { INTERVAL_MS, type BinanceSymbol, type ChartInterval, type LiveTrade } from "@/lib/public-binance-feed";
import { fallbackTickSize, loadTickSize } from "@/lib/symbol-catalog";
import type { ChartSettings } from "@/lib/chart-settings";
import type { FootprintMode } from "@/lib/trading-settings";
import { addTrade, footprintSupported, mergeHistoryAndLive, type FootprintBar } from "@/lib/footprint";
import { FootprintPrimitive } from "@/components/chart/footprint-primitive";

export interface FootprintInput {
  readonly seriesRef: RefObject<ISeriesApi<SeriesType> | null>;
  readonly symbol: BinanceSymbol | undefined;
  readonly interval: ChartInterval;
  readonly trading: ChartSettings["trading"];
  readonly subscribeTrades?: (listener: (trade: LiveTrade) => void) => () => void;
  readonly seriesType?: string;
}

interface FootprintSlot {
  series: ISeriesApi<SeriesType>;
  primitive: FootprintPrimitive;
}

interface TradeOptions {
  intervalMs: number;
  bucketTicks: number;
  mode: FootprintMode;
  enabled: boolean;
}

const detach = (series: ISeriesApi<SeriesType>, primitive: FootprintPrimitive): void => {
  try {
    series.detachPrimitive(primitive);
  } catch {
    // The chart may already have removed this series.
  }
};

const attach = (series: ISeriesApi<SeriesType>, slot: { current: FootprintSlot | null }): FootprintPrimitive => {
  const current = slot.current;
  if (current?.series === series) return current.primitive;
  if (current !== null) detach(current.series, current.primitive);
  const primitive = new FootprintPrimitive();
  series.attachPrimitive(primitive);
  slot.current = { series, primitive };
  return primitive;
};

interface TradeSession {
  readonly bars: FootprintBar[];
  readonly primitive: FootprintPrimitive;
  readonly options: { current: TradeOptions };
  readonly tickBox: { tick: number | undefined };
  raf: number;
}

const publish = (session: TradeSession): void => {
  if (session.raf !== 0) return;
  session.raf = requestAnimationFrame(() => {
    session.raf = 0;
    session.primitive.setView(session.bars, session.options.current.mode);
  });
};

const onPrint = (session: TradeSession, trade: LiveTrade): void => {
  const { intervalMs, bucketTicks, enabled } = session.options.current;
  if (!enabled) return;
  if (session.tickBox.tick === undefined) session.tickBox.tick = fallbackTickSize(trade.price);
  addTrade(session.bars, trade, { intervalMs, tickSize: session.tickBox.tick, bucketTicks });
  publish(session);
};

interface TradeWatch {
  readonly primitive: FootprintPrimitive;
  readonly symbol: BinanceSymbol;
  readonly subscribeTrades: NonNullable<FootprintInput["subscribeTrades"]>;
  readonly bars: FootprintBar[];
  readonly options: { current: TradeOptions };
}

interface StoredEvent {
  readonly receivedAt: number;
  readonly payload: string;
}

interface EventPageResponse {
  readonly ok: boolean;
  readonly hasMore?: boolean;
  readonly events?: readonly StoredEvent[];
}

const MAX_PAGES_PER_CHUNK = 20;

const isStoredTrade = (val: unknown): val is LiveTrade => {
  if (typeof val !== "object" || val === null) return false;
  const t = val as Record<string, unknown>;
  return (
    Number.isFinite(t.id) &&
    Number.isFinite(t.price) &&
    Number.isFinite(t.quantity) &&
    Number.isFinite(t.time) &&
    (t.aggressor === "buy" || t.aggressor === "sell")
  );
};

const parseStoredEvents = (events: readonly StoredEvent[]): LiveTrade[] => {
  let badCount = 0;
  const trades: LiveTrade[] = [];
  for (const event of events) {
    try {
      const parsed: unknown = JSON.parse(event.payload);
      if (isStoredTrade(parsed)) trades.push(parsed);
      else badCount += 1;
    } catch {
      // Malformed JSON is counted and skipped to keep the valid history rows intact.
      badCount += 1;
    }
  }
  if (badCount > 0) {
    console.warn(`[useFootprint] Skipped ${badCount} invalid stored trade payloads`);
  }
  return trades;
};

const requestPage = async (symbol: string, from: number, to: number): Promise<EventPageResponse> => {
  const res = await fetch(`/api/microstructure/events?symbol=${symbol}&kind=trade&from=${from}&to=${to}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as EventPageResponse;
};

const fetchChunkEvents = async (symbol: string, from: number, to: number): Promise<StoredEvent[]> => {
  const events: StoredEvent[] = [];
  let cursor = from;
  let page = 0;
  while (page < MAX_PAGES_PER_CHUNK) {
    const data = await requestPage(symbol, cursor, to);
    if (!data.ok || !data.events || data.events.length === 0) return events;
    events.push(...data.events);
    if (!data.hasMore) return events;
    cursor = data.events[data.events.length - 1]!.receivedAt;
    page += 1;
  }
  console.warn(`[useFootprint] Page cap (${MAX_PAGES_PER_CHUNK}) hit for chunk ${from}-${to}`);
  return events;
};

const fetchHistoricalTrades = async (symbol: string): Promise<LiveTrade[]> => {
  const now = Date.now();
  const chunkMs = 10 * 60 * 1000;
  const chunks: Array<Promise<StoredEvent[]>> = [];
  // 10-minute chunks covering up to the last 60 minutes of visible bars
  for (let i = 6; i > 0; i -= 1) {
    const from = now - i * chunkMs;
    chunks.push(fetchChunkEvents(symbol, from, from + chunkMs));
  }
  const results = await Promise.all(chunks);
  return parseStoredEvents(results.flat());
};

const applyTrades = (session: TradeSession, trades: readonly LiveTrade[]): void => {
  const { intervalMs, bucketTicks } = session.options.current;
  for (const trade of trades) {
    if (session.tickBox.tick === undefined) session.tickBox.tick = fallbackTickSize(trade.price);
    addTrade(session.bars, trade, { intervalMs, tickSize: session.tickBox.tick, bucketTicks });
  }
  publish(session);
};

interface LiveBufferState {
  isHistoryDone: boolean;
  buffered: LiveTrade[];
}

const loadAndApplyHistory = async (
  session: TradeSession,
  symbol: BinanceSymbol,
  bufferState: LiveBufferState,
  isStopped: () => boolean,
): Promise<void> => {
  let history: LiveTrade[] = [];
  try {
    history = await fetchHistoricalTrades(symbol);
  } catch (err: unknown) {
    // History fetch failure is warned once; live stream continues regardless.
    console.warn(`[useFootprint] Could not load historical trades (collector may not be running): ${err instanceof Error ? err.message : String(err)}`);
  }
  if (isStopped()) return;
  const trades = mergeHistoryAndLive(history, bufferState.buffered);
  bufferState.buffered = [];
  bufferState.isHistoryDone = true;
  applyTrades(session, trades);
};

const watchTrades = (watch: TradeWatch): (() => void) => {
  const session: TradeSession = {
    bars: watch.bars, primitive: watch.primitive, options: watch.options,
    tickBox: { tick: undefined }, raf: 0,
  };
  const bufferState: LiveBufferState = { isHistoryDone: false, buffered: [] };
  let stopped = false;
  void loadTickSize(watch.symbol).then((known) => {
    if (!stopped) session.tickBox.tick = known;
  });
  const unsubscribe = watch.subscribeTrades((trade) => {
    if (stopped) return;
    if (!bufferState.isHistoryDone) bufferState.buffered.push(trade);
    else onPrint(session, trade);
  });
  void loadAndApplyHistory(session, watch.symbol, bufferState, () => stopped);
  return () => {
    stopped = true;
    unsubscribe();
    if (session.raf !== 0) cancelAnimationFrame(session.raf);
    watch.primitive.clear();
  };
};

/** Live footprint for one Binance symbol. History is not rebuilt from candles. */
export function useFootprint(input: FootprintInput): void {
  const { seriesRef, symbol, interval, trading, subscribeTrades, seriesType } = input;
  const { enabled, mode, bucketTicks } = trading.footprint;
  const slot = useRef<FootprintSlot | null>(null);
  const barsRef = useRef<FootprintBar[]>([]);
  const options = useRef<TradeOptions>({ intervalMs: INTERVAL_MS[interval], bucketTicks, mode, enabled });

  useEffect(() => {
    options.current = { intervalMs: INTERVAL_MS[interval], bucketTicks, mode, enabled };
  }, [interval, bucketTicks, mode, enabled]);

  useEffect(() => {
    slot.current?.primitive.setView(barsRef.current, mode);
  }, [mode]);

  useEffect(() => {
    const series = seriesRef.current;
    if (series === null) return;
    const primitive = attach(series, slot);
    const bars: FootprintBar[] = [];
    barsRef.current = bars;
    primitive.setView(bars, options.current.mode);
    if (!enabled || !footprintSupported(interval) || symbol === undefined || subscribeTrades === undefined) {
      return () => { primitive.clear(); };
    }
    return watchTrades({ primitive, symbol, subscribeTrades, bars, options });
  }, [seriesRef, symbol, interval, bucketTicks, enabled, subscribeTrades, seriesType]);
}
