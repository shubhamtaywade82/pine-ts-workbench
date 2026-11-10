"use client";

/**
 * Watchlist quotes (P0 workspace). Live last-price / 24h change / 24h volume
 * columns for the watchlist panel, straight from Binance's public endpoints:
 *
 *  - REST:   GET /api/v3/ticker/24hr?symbols=[...]   (initial fill, no key)
 *  - Stream: wss://stream.binance.com:9443/ws/btcusdt@ticker/… (live updates)
 *
 * Binance's mini-ticker pushes arrive ~1s apart per symbol; the hook keeps
 * one map { symbol → WatchQuote } and notifies the panel on every change.
 * Dhan symbols (NSE) have no public feed here and render without quotes.
 */

import { useEffect, useState } from "react";
import { BINANCE_STREAM_WS_URL } from "./binance-endpoints";

export interface WatchQuote {
  readonly symbol: string;
  readonly lastPrice: number;
  readonly priceChangePercent: number;
  readonly volume: number;
}

type RawTicker = {
  readonly symbol: string;
  readonly lastPrice: string;
  readonly priceChangePercent: string;
  readonly volume: string;
};

const STREAM_URL = `${BINANCE_STREAM_WS_URL}/stream?streams=`;

/** Fetches one snapshot of quotes for `symbols` (empty array → empty map). */
export const fetchQuotes = async (symbols: readonly string[]): Promise<Map<string, WatchQuote>> => {
  const map = new Map<string, WatchQuote>();
  const binance = symbols.filter((s) => !s.includes(":"));
  if (binance.length === 0) return map;
  const params = encodeURIComponent(JSON.stringify(binance));
  const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${params}`);
  if (!res.ok) throw new Error(`Quotes request failed: ${res.status}`);
  const raw = (await res.json()) as readonly RawTicker[];
  for (const t of raw) {
    map.set(t.symbol, {
      symbol: t.symbol,
      lastPrice: Number(t.lastPrice),
      priceChangePercent: Number(t.priceChangePercent),
      volume: Number(t.volume),
    });
  }
  return map;
};

/** Subscribes to mini-ticker streams; `onQuote` fires per tick, returns cleanup. */
export const openQuoteStream = (
  symbols: readonly string[],
  onQuote: (quote: WatchQuote) => void,
): (() => void) => {
  const streams = symbols
    .filter((s) => !s.includes(":"))
    .map((s) => `${s.toLowerCase()}@ticker`);
  if (streams.length === 0) return () => undefined;
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(`${STREAM_URL}${streams.join("/")}`);
    ws.onmessage = (msg) => {
      try {
        const payload = JSON.parse(msg.data as string) as { data?: RawTicker };
        const t = payload.data;
        if (t === undefined) return;
        onQuote({
          symbol: t.symbol,
          lastPrice: Number(t.lastPrice),
          priceChangePercent: Number(t.priceChangePercent),
          volume: Number(t.volume),
        });
      } catch { /* malformed frame — ignore */ }
    };
    ws.onclose = () => {
      if (closed) return;
      retry += 1;
      // Backoff: 1s, 2s, 4s… capped at 30s.
      setTimeout(connect, Math.min(1_000 * 2 ** (retry - 1), 30_000));
    };
    ws.onerror = () => ws?.close();
  };
  connect();

  return () => {
    closed = true;
    ws?.close();
  };
};

/** Live quote map for `symbols`, refreshed on stream ticks (and a 30s REST re-sync). */
export function useWatchQuotes(symbols: readonly string[]): {
  readonly quotes: ReadonlyMap<string, WatchQuote>;
  readonly error: string | null;
} {
  const [quotes, setQuotes] = useState<ReadonlyMap<string, WatchQuote>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const key = symbols.join(",");

  useEffect(() => {
    if (key === "") return;
    const list = key.split(",").filter((s) => s !== "");
    let alive = true;
    const apply = (quote: WatchQuote) => {
      setQuotes((prev) => {
        const next = new Map(prev);
        next.set(quote.symbol, quote);
        return next;
      });
    };

    void fetchQuotes(list)
      .then((snapshot) => { if (alive) setQuotes(snapshot); })
      .catch((err: unknown) => { if (alive) setError(err instanceof Error ? err.message : String(err)); });

    const stop = openQuoteStream(list, apply);
    const resync = setInterval(() => {
      void fetchQuotes(list)
        .then((snapshot) => { if (alive) setQuotes((prev) => new Map([...prev, ...snapshot])); })
        .catch(() => undefined);
    }, 30_000);

    return () => {
      alive = false;
      stop();
      clearInterval(resync);
    };
  }, [key]);

  return { quotes, error };
}

/** Compact volume for the watchlist column: 1.2K / 34.5M / 2.1B. */
export const compactVolume = (value: number): string => {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
};
