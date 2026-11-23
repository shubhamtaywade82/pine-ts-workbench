import type { CoindcxPosition } from "./coindcx-client";

export const COINDCX_WS_URL = "wss://stream.coindcx.com/socket.io/?EIO=3&transport=websocket";
const AUTH_CHANNEL_NAME = "coindcx";
const RECONNECT_DELAY_MS = 3_000;

export interface ParsedWsMessage {
  readonly type: "open" | "ping" | "pong" | "connect" | "event" | "unknown";
  readonly eventName?: string;
  readonly payload?: unknown;
}

export interface CoindcxWsCallbacks {
  readonly onPositionUpdate?: (positions: unknown) => void;
  readonly onOrderUpdate?: (orders: unknown) => void;
  readonly onBalanceUpdate?: (balances: unknown) => void;
  readonly onStatusChange?: (status: "connecting" | "live" | "polling" | "disconnected" | "error") => void;
}

/** Computes HMAC-SHA256 hex signature for CoinDCX channel authentication. */
export async function signCoindcxWsAuth(secret: string): Promise<string> {
  const payload = JSON.stringify({ channel: AUTH_CHANNEL_NAME });
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
    return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const { createHmac } = await import("node:crypto");
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Formats the Socket.IO v2 join packet to authenticate on the coindcx channel. */
export function formatJoinPacket(apiKey: string, signature: string): string {
  const joinData = { channelName: AUTH_CHANNEL_NAME, authSignature: signature, apiKey };
  return `42["join",${JSON.stringify(joinData)}]`;
}

/** Parses Socket.IO / Engine.IO frame strings into structured event representations. */
export function parseEngineIoPacket(raw: string): ParsedWsMessage {
  if (raw.startsWith("0")) {
    try {
      return { type: "open", payload: JSON.parse(raw.slice(1)) };
    } catch {
      return { type: "open" };
    }
  }
  if (raw === "2") return { type: "ping" };
  if (raw === "3") return { type: "pong" };
  if (raw === "40") return { type: "connect" };
  if (raw.startsWith("42")) {
    try {
      const parsed = JSON.parse(raw.slice(2));
      if (Array.isArray(parsed) && parsed.length >= 2) {
        return { type: "event", eventName: String(parsed[0]), payload: parsed[1] };
      }
    } catch {
      return { type: "unknown" };
    }
  }
  return { type: "unknown" };
}

/** Dispatches parsed event payload to corresponding registered callbacks. */
function dispatchWsEvent(msg: ParsedWsMessage, callbacks: CoindcxWsCallbacks) {
  if (msg.type !== "event" || !msg.eventName) return;
  if (msg.eventName === "df-position-update") {
    callbacks.onPositionUpdate?.(msg.payload);
  } else if (msg.eventName === "df-order-update") {
    callbacks.onOrderUpdate?.(msg.payload);
  } else if (msg.eventName === "balance-update") {
    callbacks.onBalanceUpdate?.(msg.payload);
  }
}

function handleWsMessage(
  raw: string, ws: WebSocket, apiKey: string, sig: string, cb: CoindcxWsCallbacks, onConnect: () => void,
) {
  const p = parseEngineIoPacket(raw);
  if (p.type === "open") ws.send("40");
  else if (p.type === "connect") { onConnect(); ws.send(formatJoinPacket(apiKey, sig)); cb.onStatusChange?.("live"); }
  else if (p.type === "ping") ws.send("3");
  else if (p.type === "event") dispatchWsEvent(p, cb);
}

/** Dispatches a single parsed SSE event block into registered portfolio callbacks. */
export function parseSseChunk(chunk: string, cb: CoindcxWsCallbacks) {
  let event = "message";
  let data = "";
  for (const line of chunk.split("\n")) {
    const t = line.trim();
    if (t.startsWith("event:")) event = t.slice(6).trim();
    else if (t.startsWith("data:")) data = t.slice(5).trim();
  }
  if (!data) return;
  try {
    const payload = JSON.parse(data);
    if (event === "status") cb.onStatusChange?.(payload);
    else if (event === "positions") cb.onPositionUpdate?.(payload);
    else if (event === "orders") cb.onOrderUpdate?.(payload);
    else if (event === "balances") cb.onBalanceUpdate?.(payload);
  } catch {
    // Ignore invalid JSON payloads from stream
  }
}

/** Consumes an active SSE byte stream reader and dispatches double-newline-separated blocks. */
export async function readSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  cb: CoindcxWsCallbacks,
) {
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const chunk of parts) {
      if (chunk.trim()) parseSseChunk(chunk, cb);
    }
  }
}

/** Streams live CoinDCX account updates through the server-side SSE bridge. */
export function connectCoindcxServerStream(
  apiKey: string,
  apiSecret: string,
  callbacks: CoindcxWsCallbacks,
  fetchFn: typeof fetch = fetch,
): () => void {
  let isClosed = false;
  let abortController: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const init = async () => {
    if (isClosed) return;
    callbacks.onStatusChange?.("connecting");
    abortController = new AbortController();
    try {
      const res = await fetchFn("/api/coindcx/stream", {
        headers: { "x-coindcx-apikey": apiKey, "x-coindcx-secret": apiSecret },
        signal: abortController.signal,
      });
      if (!res.ok || !res.body) {
        callbacks.onStatusChange?.("polling");
        return;
      }
      callbacks.onStatusChange?.("live");
      await readSseStream(res.body.getReader(), callbacks);
    } catch {
      // Stream aborted or connection interrupted
    } finally {
      if (!isClosed) {
        callbacks.onStatusChange?.("polling");
        reconnectTimer = setTimeout(() => void init(), 5000);
      }
    }
  };

  void init();
  return () => {
    isClosed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (abortController) abortController.abort();
    callbacks.onStatusChange?.("disconnected");
  };
}

/** Establishes resilient live WebSocket user stream connection with CoinDCX. */
export function connectCoindcxWs(
  apiKey: string,
  apiSecret: string,
  callbacks: CoindcxWsCallbacks,
  wsFactory?: (url: string) => WebSocket,
): () => void {
  // CoinDCX Envoy proxy blocks browser Origin: http://localhost:* with HTTP 400.
  // In the browser, bridge through the server-side stream endpoint unless testing with wsFactory.
  if (typeof window !== "undefined" && !wsFactory) {
    return connectCoindcxServerStream(apiKey, apiSecret, callbacks);
  }
  const createWs = wsFactory ?? ((url: string) => new WebSocket(url));
  let isClosed = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let hasConnectedOnce = false;
  let attempts = 0;

  const init = async () => {
    if (isClosed) return;
    attempts++;
    callbacks.onStatusChange?.("connecting");
    try {
      const signature = await signCoindcxWsAuth(apiSecret);
      ws = createWs(COINDCX_WS_URL);
      ws.onmessage = (e) => handleWsMessage(typeof e.data === "string" ? e.data : "", ws!, apiKey, signature, callbacks, () => {
        hasConnectedOnce = true;
        attempts = 0;
      });
      ws.onerror = () => {
        if (!hasConnectedOnce && attempts >= 1) callbacks.onStatusChange?.("polling");
        else callbacks.onStatusChange?.("error");
      };
      ws.onclose = () => {
        if (isClosed) return;
        if (!hasConnectedOnce && attempts >= 1) { callbacks.onStatusChange?.("polling"); return; }
        callbacks.onStatusChange?.("disconnected");
        reconnectTimer = setTimeout(() => void init(), RECONNECT_DELAY_MS);
      };
    } catch {
      callbacks.onStatusChange?.("polling");
    }
  };

  void init();

  return () => {
    isClosed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    }
    callbacks.onStatusChange?.("disconnected");
  };
}

/** Connects to public live WebSocket ticker stream for open positions' markets. */
export function connectLivePriceStream(
  pairs: readonly string[],
  onPriceTick: (pair: string, price: number) => void,
  wsFactory: (url: string) => WebSocket = (url) => new WebSocket(url),
): () => void {
  const streamMap = new Map<string, string>();
  for (const pair of pairs) {
    const sym = pair.toUpperCase().replace(/^B-/, "").replace(/[^A-Z0-9]/g, "").toLowerCase();
    if (sym) streamMap.set(`${sym}@ticker`, pair);
  }
  const streamNames = Array.from(streamMap.keys());
  if (streamNames.length === 0) return () => {};

  let isClosed = false;
  let ws: WebSocket | null = null;
  const url = `wss://data-stream.binance.vision/stream?streams=${streamNames.join("/")}`;

  const init = () => {
    if (isClosed) return;
    try {
      ws = wsFactory(url);
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(typeof event.data === "string" ? event.data : "");
          const pair = streamMap.get(String(payload?.stream ?? ""));
          const price = Number(payload?.data?.c ?? 0);
          if (pair && price > 0) onPriceTick(pair, price);
        } catch {
          // ignore parsing error
        }
      };
    } catch {
      // ignore connection error
    }
  };

  init();
  return () => {
    isClosed = true;
    if (ws) ws.close();
  };
}

