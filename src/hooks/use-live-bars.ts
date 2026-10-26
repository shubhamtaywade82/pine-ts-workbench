"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Bar } from "@nemesis-oss/pine-ts";
import {
  fetchHistoricalBars,
  openMarketStream,
  INTERVAL_MS,
  type BinanceSymbol,
  type ChartInterval,
  type LiveTrade,
} from "@/lib/public-binance-feed";

// TradingView-like depth; multi-timeframe scripts (4H context on 5m) need it.
const HISTORY_BARS = 1000;
// Bars fetched per scroll-back request; Binance allows up to 1000 per call.
const OLDER_PAGE_BARS = 500;
// The chart subscribes to raw updates (drawn once per animation frame), so the
// React snapshot only feeds indicators/editor/backtest. 1/s keeps that work
// off the main thread between ticks without making those panels feel stale.
const SNAPSHOT_INTERVAL_MS = 1_000;
const RECONNECT_DELAY_MS = 3_000;

export type LiveStatus = "loading" | "live" | "reconnecting";

export interface LiveBars {
  readonly bars: readonly Bar[];
  readonly status: LiveStatus;
  /** Last load failure, cleared once the stream is live again. */
  readonly error: string | null;
  /** Prepends the page of candles before the oldest one; no-op while loading or once history is exhausted. */
  readonly loadOlder: () => void;
  /**
   * Per-frame bars for the chart, so ticks are drawn as they arrive instead of
   * waiting for the next React snapshot. Returns an unsubscribe function.
   */
  readonly subscribe: (listener: (bars: readonly Bar[]) => void) => () => void;
}

/** Keeps `existing` bars older than `fresh` (scroll-back history survives a reconnect), then `fresh`. */
const withOlderHistory = (existing: readonly Bar[], fresh: readonly Bar[]): readonly Bar[] => {
  const firstFresh = fresh[0];
  if (firstFresh === undefined) return existing;
  return [...existing.filter((b) => b.time < firstFresh.time), ...fresh];
};

/**
 * Inserts `bar` by time: replaces the bar at the same time, appends a newer
 * one, drops an older one. The closed kline can arrive after the first trade
 * of the next candle already opened it, so also settle the bar before `last`.
 */
export const mergeBar = (bars: readonly Bar[], bar: Bar): readonly Bar[] => {
  const last = bars[bars.length - 1];
  if (last === undefined || bar.time > last.time) return [...bars, bar];
  if (bar.time === last.time) return [...bars.slice(0, -1), bar];
  const previous = bars[bars.length - 2];
  if (previous !== undefined && bar.time === previous.time) {
    return [...bars.slice(0, -2), bar, last];
  }
  return bars;
};

/** Applies one trade to the forming candle, or opens the next candle when the trade is past its end. */
export const applyTrade = (forming: Bar, trade: LiveTrade, intervalMs: number): Bar => {
  if (trade.time >= forming.time + intervalMs) {
    const time = forming.time + Math.floor((trade.time - forming.time) / intervalMs) * intervalMs;
    return { time, open: trade.price, high: trade.price, low: trade.price, close: trade.price, volume: trade.quantity, isClosed: false };
  }
  return {
    ...forming,
    high: Math.max(forming.high, trade.price),
    low: Math.min(forming.low, trade.price),
    close: trade.price,
    // Trades fill the bar between klines; the kline carries the exchange's exact total.
    volume: forming.volume + trade.quantity,
  };
};

/**
 * Binance mainnet candles for `(symbol, interval)`: REST history, then live
 * klines + trades over one WebSocket. On disconnect it waits, refetches the
 * history (filling any gap) and reconnects.
 */
export function useLiveBars(symbol: BinanceSymbol, interval: ChartInterval): LiveBars {
  const [bars, setBars] = useState<readonly Bar[]>([]);
  const [status, setStatus] = useState<LiveStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Working copy updated on every message; React state is synced from it on a timer.
  const workingRef = useRef<readonly Bar[]>([]);
  const isLoadingOlderRef = useRef(false);
  const hasOlderRef = useRef(true);
  // Chart listeners are notified at most once per animation frame, so a burst of
  // trades becomes one series update and the chart never waits for React.
  const listenersRef = useRef(new Set<(bars: readonly Bar[]) => void>());
  const frameRef = useRef<number | null>(null);

  const scheduleNotify = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const snapshot = workingRef.current;
      for (const listener of listenersRef.current) listener(snapshot);
    });
  }, []);

  const subscribe = useCallback((listener: (bars: readonly Bar[]) => void) => {
    listenersRef.current.add(listener);
    // Draw immediately so a freshly mounted chart doesn't wait for the next tick.
    if (workingRef.current.length > 0) listener(workingRef.current);
    return () => { listenersRef.current.delete(listener); };
  }, []);

  useEffect(() => {
    // New symbol/interval: show the loader instead of the previous market's candles.
    workingRef.current = [];
    hasOlderRef.current = true;
    setBars([]);
    setStatus("loading");
  }, [symbol, interval]);

  useEffect(() => {
    let isCancelled = false;
    let closeStream: (() => void) | null = null;
    // Same array reference → React skips the render, so idle ticks cost nothing.
    const snapshotTimer = setInterval(() => setBars(workingRef.current), SNAPSHOT_INTERVAL_MS);

    const scheduleReconnect = () => {
      if (isCancelled) return;
      setStatus("reconnecting");
      setTimeout(() => { if (!isCancelled) setAttempt((n) => n + 1); }, RECONNECT_DELAY_MS);
    };

    const start = async () => {
      const history = await fetchHistoricalBars(symbol, interval, HISTORY_BARS);
      if (isCancelled) return;
      workingRef.current = withOlderHistory(workingRef.current, history);
      setBars(workingRef.current);
      scheduleNotify();
      closeStream = openMarketStream(symbol, interval, {
        onOpen: () => { setStatus("live"); setError(null); },
        onClose: scheduleReconnect,
        onKline: (bar) => {
          workingRef.current = mergeBar(workingRef.current, bar);
          scheduleNotify();
        },
        onTrade: (trade) => {
          const forming = workingRef.current[workingRef.current.length - 1];
          if (forming === undefined || trade.time < forming.time) return;
          workingRef.current = mergeBar(workingRef.current, applyTrade(forming, trade, INTERVAL_MS[interval]));
          scheduleNotify();
        },
      });
    };

    start().catch((err: unknown) => {
      if (isCancelled) return;
      setError(`Failed to load ${symbol} ${interval} from Binance: ${err instanceof Error ? err.message : String(err)}`);
      scheduleReconnect();
    });

    return () => {
      isCancelled = true;
      clearInterval(snapshotTimer);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      closeStream?.();
    };
  }, [symbol, interval, attempt, scheduleNotify]);

  const loadOlder = useCallback(() => {
    const first = workingRef.current[0];
    if (first === undefined || isLoadingOlderRef.current || !hasOlderRef.current) return;
    isLoadingOlderRef.current = true;
    fetchHistoricalBars(symbol, interval, OLDER_PAGE_BARS, first.time - 1)
      .then((older) => {
        // A short page means Binance has no data before it (the pair's listing date).
        if (older.length < OLDER_PAGE_BARS) hasOlderRef.current = false;
        // Symbol/interval switched while fetching: these bars belong to the old market.
        if (workingRef.current[0]?.time !== first.time) return;
        workingRef.current = [...older.filter((b) => b.time < first.time), ...workingRef.current];
        setBars(workingRef.current);
        scheduleNotify();
      })
      .catch((err: unknown) => {
        // Retried on the next scroll to the left edge.
        setError(`Failed to load older ${symbol} ${interval} candles: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => { isLoadingOlderRef.current = false; });
  }, [symbol, interval, scheduleNotify]);

  return { bars, status, error, loadOlder, subscribe };
}
