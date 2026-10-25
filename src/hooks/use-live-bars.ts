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

const HISTORY_BARS = 200;
// Bars fetched per scroll-back request; Binance allows up to 1000 per call.
const OLDER_PAGE_BARS = 500;
// Trades can arrive hundreds of times a second; React state updates at 10/s
// are smooth for the eye (the candle lerp fills the gaps) and cheap to render.
const FLUSH_INTERVAL_MS = 100;
const RECONNECT_DELAY_MS = 3_000;

export type LiveStatus = "loading" | "live" | "reconnecting";

export interface LiveBars {
  readonly bars: readonly Bar[];
  readonly status: LiveStatus;
  /** Last load failure, cleared once the stream is live again. */
  readonly error: string | null;
  /** Prepends the page of candles before the oldest one; no-op while loading or once history is exhausted. */
  readonly loadOlder: () => void;
}

/** Keeps `existing` bars older than `fresh` (scroll-back history survives a reconnect), then `fresh`. */
const withOlderHistory = (existing: readonly Bar[], fresh: readonly Bar[]): readonly Bar[] => {
  const firstFresh = fresh[0];
  if (firstFresh === undefined) return existing;
  return [...existing.filter((b) => b.time < firstFresh.time), ...fresh];
};

/** Inserts `bar` by time: replaces the bar at the same time, appends a newer one, drops an older one. */
export const mergeBar = (bars: readonly Bar[], bar: Bar): readonly Bar[] => {
  const last = bars[bars.length - 1];
  if (last === undefined || bar.time > last.time) return [...bars, bar];
  if (bar.time === last.time) return [...bars.slice(0, -1), bar];
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
    // Approximate until the next kline event replaces it with Binance's exact volume.
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
    const flushTimer = setInterval(() => setBars(workingRef.current), FLUSH_INTERVAL_MS);

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
      closeStream = openMarketStream(symbol, interval, {
        onOpen: () => { setStatus("live"); setError(null); },
        onClose: scheduleReconnect,
        onKline: (bar) => { workingRef.current = mergeBar(workingRef.current, bar); },
        onTrade: (trade) => {
          const forming = workingRef.current[workingRef.current.length - 1];
          if (forming === undefined || trade.time < forming.time) return;
          workingRef.current = mergeBar(workingRef.current, applyTrade(forming, trade, INTERVAL_MS[interval]));
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
      clearInterval(flushTimer);
      closeStream?.();
    };
  }, [symbol, interval, attempt]);

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
      })
      .catch((err: unknown) => {
        // Retried on the next scroll to the left edge.
        setError(`Failed to load older ${symbol} ${interval} candles: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => { isLoadingOlderRef.current = false; });
  }, [symbol, interval]);

  return { bars, status, error, loadOlder };
}
