"use client";

import type { Bar } from "@nemesis-oss/pine-ts";

/**
 * Public crypto market-data feed — no API key required.
 *
 * - Historical candles (Coinbase REST):
 *   GET https://api.exchange.coinbase.com/products/<SYMBOL>/candles
 *   No API key, no rate limit (per Coinbase public docs). Returns the
 *   candles newest-first as `[time, low, high, open, close, volume]`.
 * - Real-time kline stream (Binance WebSocket):
 *   wss://stream.binance.com:9443/ws/<symbol>@kline_<interval>
 *   No API key. Emits a kline event per tick; the last event for a bar
 *   interval has `k.x === true` (closed).
 *
 * Wave 14b — used by the chart workbench to load real BTC/ETH bars and
 * stream live ticks. Both exchanges are public; the historical snapshot
 * comes from Coinbase and the live tick stream comes from Binance (the
 * live prices differ by ~$1 between exchanges — the chart shows this as
 * a small discontinuity at the live-tick boundary, which is honest).
 *
 * Future waves can swap either endpoint for the @nemesis-oss/binance-sdk
 * (real BinanceProvider) or @nemesis-oss/dhanhq-sdk (real DhanHQProvider)
 * when the host has API credentials.
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

/** Coinbase product IDs. */
export type CoinbaseProduct = "BTC-USD" | "ETH-USD" | "SOL-USD" | "BNB-USD";

/** Binance symbol (for WebSocket stream). */
export type BinanceSymbol = "BTCUSDT" | "ETHUSDT" | "SOLUSDT" | "BNBUSDT";

export type ChartInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

/** Mapping between workbench symbols + intervals + the per-exchange form. */
export interface SymbolOption {
  readonly coinbaseProduct: CoinbaseProduct;
  readonly binanceSymbol: BinanceSymbol;
  readonly displayName: string;
}

export const SUPPORTED_SYMBOLS: readonly SymbolOption[] = [
  { coinbaseProduct: "BTC-USD", binanceSymbol: "BTCUSDT", displayName: "BTC / USD" },
  { coinbaseProduct: "ETH-USD", binanceSymbol: "ETHUSDT", displayName: "ETH / USD" },
  { coinbaseProduct: "SOL-USD", binanceSymbol: "SOLUSDT", displayName: "SOL / USD" },
  { coinbaseProduct: "BNB-USD", binanceSymbol: "BNBUSDT", displayName: "BNB / USD" },
];

export const SUPPORTED_INTERVALS: readonly ChartInterval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

/** Coinbase granularity (seconds) per workbench interval. */
const COINBASE_GRANULARITY: Record<ChartInterval, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 21_600, // Coinbase's nearest granularity (no 4h support).
  "1d": 86_400,
};

/** Binance interval string per workbench interval. */
const BINANCE_INTERVAL: Record<ChartInterval, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
};

// ---------- REST: historical candles (Coinbase) ----------

/**
 * Fetches historical candles via Coinbase's public REST endpoint. Returns
 * bars OLDEST-FIRST (Coinbase returns newest-first; we reverse). Throws
 * on network failure or non-2xx response.
 *
 * @param coinbaseProduct e.g. "BTC-USD"
 * @param interval         e.g. "1m"
 * @param limit            Number of bars (Coinbase returns up to 300).
 */
export const fetchHistoricalBars = async (
  coinbaseProduct: CoinbaseProduct,
  interval: ChartInterval,
  limit: number = 200,
): Promise<Bar[]> => {
  const granularity = COINBASE_GRANULARITY[interval];
  const url = `https://api.exchange.coinbase.com/products/${encodeURIComponent(
    coinbaseProduct,
  )}/candles?granularity=${granularity}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Coinbase candles ${res.status}: ${await res.text()}`);
  }
  // Coinbase returns: [[time_seconds, low, high, open, close, volume], ...] newest-first.
  const data = (await res.json()) as number[][];
  // Reverse to oldest-first, take the last `limit`.
  const oldestFirst = data.slice().reverse();
  const bars = oldestFirst.slice(-limit).map((row) => ({
    time: Number(row[0]) * 1000, // s → ms
    open: Number(row[3]),
    high: Number(row[2]),
    low: Number(row[1]),
    close: Number(row[4]),
    volume: Number(row[5]),
    isClosed: true,
  }));
  return bars;
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
  const binanceInterval = BINANCE_INTERVAL[interval];
  const stream = `${binanceSymbol.toLowerCase()}@kline_${binanceInterval}`;
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
