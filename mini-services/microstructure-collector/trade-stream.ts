import { toLiveTrade, type BinanceSymbol } from "../../src/lib/public-binance-feed";
import { COLLECTOR_DATA_WS_URL } from "./endpoints";
import { parseTradeMessage } from "./parse";

const STREAM_URL = `${COLLECTOR_DATA_WS_URL}/stream`;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export type RawTrade = Parameters<typeof toLiveTrade>[0];

interface TradeConnection {
  readonly symbol: BinanceSymbol;
  readonly onTrade: (raw: RawTrade) => void;
  readonly onGap: (phase: "start" | "end") => void;
  readonly onMalformed?: () => void;
  stopped: boolean;
  backoffMs: number;
  connectedBefore: boolean;
  socket: WebSocket | undefined;
  cancelReconnect: (() => void) | undefined;
}

export const closeQuietly = (socket: WebSocket): void => {
  try { socket.close(1000, "Normal closure"); } catch { /* already closing */ }
};

const tradeUrl = (symbol: BinanceSymbol): string =>
  `${STREAM_URL}?streams=${symbol.toLowerCase()}@trade`;

const noteOpen = (conn: TradeConnection): void => {
  if (conn.connectedBefore) conn.onGap("end");
  conn.connectedBefore = true;
};

const takeMessage = (conn: TradeConnection, data: unknown): void => {
  conn.backoffMs = INITIAL_BACKOFF_MS;
  const trade = parseTradeMessage(data);
  if (trade !== undefined) conn.onTrade(trade);
  else conn.onMalformed?.();
};

const scheduleReconnect = (conn: TradeConnection): void => {
  if (conn.stopped) return;
  const delay = conn.backoffMs;
  conn.backoffMs = Math.min(conn.backoffMs * 2, MAX_BACKOFF_MS);
  const timer = setTimeout(() => connect(conn), delay);
  conn.cancelReconnect = () => clearTimeout(timer);
};

const connect = (conn: TradeConnection): void => {
  if (conn.stopped) return;
  const socket = new WebSocket(tradeUrl(conn.symbol));
  conn.socket = socket;
  socket.onopen = () => { if (conn.socket === socket) noteOpen(conn); };
  socket.onmessage = (message) => { if (conn.socket === socket) takeMessage(conn, message.data); };
  socket.onclose = () => {
    if (conn.socket === socket) {
      if (conn.connectedBefore && !conn.stopped) conn.onGap("start");
      scheduleReconnect(conn);
    }
  };
  // error is followed by close; reconnecting here as well would open two sockets
  socket.onerror = () => { if (conn.socket === socket) closeQuietly(socket); };
};

const stopTrades = (conn: TradeConnection): void => {
  conn.stopped = true;
  conn.cancelReconnect?.();
  if (conn.socket !== undefined) closeQuietly(conn.socket);
};

/** Keeps `<symbol>@trade` up across the disconnect Binance forces every 24h. */
export const openTradeStream = (
  symbol: BinanceSymbol,
  onTrade: (raw: RawTrade) => void,
  onGap: (phase: "start" | "end") => void,
  onMalformed?: () => void,
): (() => void) => {
  const conn: TradeConnection = {
    symbol,
    onTrade,
    onGap,
    onMalformed,
    stopped: false,
    backoffMs: INITIAL_BACKOFF_MS,
    connectedBefore: false,
    socket: undefined,
    cancelReconnect: undefined,
  };
  connect(conn);
  return () => stopTrades(conn);
};
