"use client";

import type { Bar } from "@nemesis-oss/pine-ts";

/**
 * Public Binance market data — no API key required.
 *
 * - Historical candles (REST): GET https://data-api.binance.vision/api/v3/klines
 *   Binance's market-data-only mirror, so heavy charting can't trip the
 *   trading API's IP rate limits.
 * - Real-time kline stream (WebSocket):
 *   wss://stream.binance.com:9443/ws/<symbol>@kline_<interval>
 *   Emits a kline event per tick; the last event for a bar has `k.x === true` (closed).
 *
 * History and stream share one exchange, so the first live candle continues
 * the history seamlessly (Coinbase history + Binance ticks used to jump ~$100).
 */

// ---------- types ----------

export interface BinanceKline {
  readonly t: number;
  readonly T: number;
  readonly o: string;
  readonly h: string;
  readonly l: string;
  readonly c: string;
  readonly v: string;
  readonly x: boolean;
}

export interface BinanceKlineEvent {
  readonly e: "kline";
  readonly E: number;
  readonly s: string;
  readonly k: BinanceKline;
}

// ---------- supported symbols + intervals ----------

/** Binance spot symbol (REST + WebSocket). */
export type BinanceSymbol = "BTCUSDT" | "ETHUSDT" | "SOLUSDT" | "BNBUSDT";

/** Workbench intervals — the strings are valid Binance kline intervals as-is. */
export type ChartInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export interface SymbolOption {
  readonly binanceSymbol: BinanceSymbol;
  readonly displayName: string;
}

export const SUPPORTED_SYMBOLS: readonly SymbolOption[] = [
  { binanceSymbol: "BTCUSDT", displayName: "BTC / USDT" },
  { binanceSymbol: "ETHUSDT", displayName: "ETH / USDT" },
  { binanceSymbol: "SOLUSDT", displayName: "SOL / USDT" },
  { binanceSymbol: "BNBUSDT", displayName: "BNB / USDT" },
];

export const SUPPORTED_INTERVALS: readonly ChartInterval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

// ---------- REST: historical candles ----------

const KLINES_URL = "https://data-api.binance.vision/api/v3/klines";
/** Binance's per-request cap for /klines. */
const MAX_KLINES_LIMIT = 1000;

/** Binance kline row: [openTime, open, high, low, close, volume, closeTime, ...], numbers as strings. */
type KlineRow = [number, string, string, string, string, string, number, ...unknown[]];

/**
 * Fetches the latest `limit` candles, oldest first. The last candle is
 * usually still forming, so `isClosed` reflects its close time.
 * Throws on network failure or a non-2xx response.
 */
export const fetchHistoricalBars = async (
  symbol: BinanceSymbol,
  interval: ChartInterval,
  limit: number = 200,
): Promise<Bar[]> => {
  const params = new URLSearchParams({ symbol, interval, limit: String(Math.min(limit, MAX_KLINES_LIMIT)) });
  const res = await fetch(`${KLINES_URL}?${params}`);
  if (!res.ok) {
    throw new Error(`Binance klines ${symbol} ${interval} failed with ${res.status}: ${await res.text()}`);
  }
  const rows = (await res.json()) as KlineRow[];
  const now = Date.now();
  return rows.map((row) => ({
    time: row[0],
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    isClosed: row[6] < now,
  }));
};

// ---------- WebSocket: real-time kline stream (Binance) ----------

export type StreamStatus = "disconnected" | "connecting" | "live" | "error";

export interface StreamCallbacks {
  /** Called on every kline update (the bar's `isClosed` flag tells confirmed vs unconfirmed). */
  readonly onBar: (bar: Bar) => void;
  /** Called when the stream status changes (e.g. connecting → live → error). */
  readonly onStatus: (status: StreamStatus) => void;
}

const WS_URL = "wss://stream.binance.com:9443/ws";

/**
 * Opens a WebSocket kline stream for `(symbol, interval)` and routes the
 * kline events to `onBar`. Returns a `disconnect()` function that closes
 * the socket.
 *
 * The stream emits one event per tick; the last event for a given bar
 * interval has `k.x === true` (closed). Real-time chart renderers should
 * update the bar on every event and switch to a new bar when `isClosed`
 * flips true.
 */
export const openKlineStream = (
  binanceSymbol: BinanceSymbol,
  interval: ChartInterval,
  callbacks: StreamCallbacks,
): (() => void) => {
  const stream = `${binanceSymbol.toLowerCase()}@kline_${interval}`;
  const url = `${WS_URL}/${stream}`;
  callbacks.onStatus("connecting");
  let socket: WebSocket;
  try {
    socket = new WebSocket(url);
  } catch (err) {
    callbacks.onStatus("error");
    throw err;
  }
  socket.onopen = () => callbacks.onStatus("live");
  socket.onerror = () => callbacks.onStatus("error");
  socket.onclose = () => callbacks.onStatus("disconnected");
  socket.onmessage = (event) => {
    let parsed: BinanceKlineEvent;
    try {
      parsed = JSON.parse(event.data) as BinanceKlineEvent;
    } catch {
      return;
    }
    if (parsed.e !== "kline") return;
    const k = parsed.k;
    const bar: Bar = {
      time: k.t,
      open: Number(k.o),
      high: Number(k.h),
      low: Number(k.l),
      close: Number(k.c),
      volume: Number(k.v),
      isClosed: k.x,
    };
    callbacks.onBar(bar);
  };
  return () => {
    socket.onopen = null;
    socket.onerror = null;
    socket.onclose = null;
    socket.onmessage = null;
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
    callbacks.onStatus("disconnected");
  };
};
