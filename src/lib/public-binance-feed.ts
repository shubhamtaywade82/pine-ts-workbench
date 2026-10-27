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
export type ChartInterval = "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "1d" | "1w" | "1M";

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

/**
 * Quote asset of each supported market. The table is typed over every
 * `BinanceSymbol`, so a new market cannot be added without declaring its quote
 * asset. Nothing assumes USDT.
 */
export const QUOTE_ASSET: Record<BinanceSymbol, string> = {
  BTCUSDT: "USDT",
  ETHUSDT: "USDT",
  SOLUSDT: "USDT",
  BNBUSDT: "USDT",
};

export const quoteAssetOf = (symbol: BinanceSymbol): string => QUOTE_ASSET[symbol];

export const SUPPORTED_INTERVALS: readonly ChartInterval[] = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w", "1M"];

/** TradingView's toolbar labels. */
export const INTERVAL_LABELS: Record<ChartInterval, string> = {
  "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m",
  "1h": "1h", "2h": "2h", "4h": "4h", "1d": "D", "1w": "W", "1M": "M",
};

// ---------- REST: historical candles ----------

const KLINES_URL = "https://data-api.binance.vision/api/v3/klines";
/** Binance's per-request cap for /klines. */
const MAX_KLINES_LIMIT = 1000;

/** Binance kline row: [openTime, open, high, low, close, volume, closeTime, ...], numbers as strings. */
type KlineRow = [number, string, string, string, string, string, number, ...unknown[]];

/**
 * Fetches up to `limit` candles, oldest first: the latest ones, or with
 * `endTime` (ms) the ones opening at or before it (for loading older history).
 * The last candle is usually still forming, so `isClosed` reflects its close time.
 * Throws on network failure or a non-2xx response.
 */
export const fetchHistoricalBars = async (
  symbol: BinanceSymbol,
  interval: ChartInterval,
  limit: number = 200,
  endTime?: number,
): Promise<Bar[]> => {
  const params = new URLSearchParams({ symbol, interval, limit: String(Math.min(limit, MAX_KLINES_LIMIT)) });
  if (endTime !== undefined) params.set("endTime", String(endTime));
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

// ---------- WebSocket: live klines + trades ----------

/** Bar duration per interval, to know when a trade starts a new candle. */
export const INTERVAL_MS: Record<ChartInterval, number> = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
  "1w": 604_800_000,
  // ponytail: months vary in length; 31 days keeps trades in the forming bar
  // until the kline stream opens the next month's bar (within ~2 s).
  "1M": 2_678_400_000,
};

export interface LiveTrade {
  readonly price: number;
  readonly quantity: number;
  /** Trade time, ms. */
  readonly time: number;
}

export interface MarketStreamCallbacks {
  /** Authoritative candle (~every 1–2s); `isClosed` is true on the bar's final event. */
  readonly onKline: (bar: Bar) => void;
  /** Every trade — exact tick-by-tick OHLC and volume between kline snapshots. */
  readonly onTrade: (trade: LiveTrade) => void;
  readonly onOpen: () => void;
  /** Socket closed or errored; the caller decides whether to reconnect. */
  readonly onClose: () => void;
}

interface BinanceTrade { readonly e: "trade"; readonly p: string; readonly q: string; readonly T: number }

/** Binance mainnet combined-stream endpoint (public, no key). */
const COMBINED_STREAM_URL = "wss://stream.binance.com:9443/stream";

const toBar = (k: BinanceKline): Bar => ({
  time: k.t,
  open: Number(k.o),
  high: Number(k.h),
  low: Number(k.l),
  close: Number(k.c),
  volume: Number(k.v),
  isClosed: k.x,
});

/**
 * Opens one socket carrying `<symbol>@kline_<interval>` and `<symbol>@trade`.
 * Raw trades (not aggTrades) carry every price, so the forming candle's
 * high/low/close match Binance's own chart between kline snapshots.
 * Returns `close()`, which detaches callbacks first so it never reports onClose.
 */
export const openMarketStream = (
  symbol: BinanceSymbol,
  interval: ChartInterval,
  callbacks: MarketStreamCallbacks,
): (() => void) => {
  const lower = symbol.toLowerCase();
  const socket = new WebSocket(`${COMBINED_STREAM_URL}?streams=${lower}@kline_${interval}/${lower}@trade`);
  socket.onopen = callbacks.onOpen;
  socket.onclose = callbacks.onClose;
  socket.onerror = () => socket.close();
  socket.onmessage = (event) => {
    const { data } = JSON.parse(event.data as string) as { data: BinanceKlineEvent | BinanceTrade };
    if (data.e === "kline") callbacks.onKline(toBar(data.k));
    else callbacks.onTrade({ price: Number(data.p), quantity: Number(data.q), time: data.T });
  };
  return () => {
    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
  };
};
