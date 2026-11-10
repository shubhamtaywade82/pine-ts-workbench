import { PrismaClient } from "@prisma/client";
import { DEFAULT_WALL_OPTIONS, WallTracker } from "../../src/lib/depth-walls";
import { DepthFeed, type DepthFeedDeps, type DepthFeedState } from "../../src/lib/depth-feed";
import {
  isBinanceSymbol,
  MarketRecorder,
  type BookSnapshotRow,
  type MarketEventKind,
  type MarketEventRow,
  type MarketStore,
  type WallTransitionRow,
} from "../../src/lib/market-recorder";
import type { DepthSnapshot, DepthUpdate } from "../../src/lib/order-book";
import { toLiveTrade, type BinanceSymbol } from "../../src/lib/public-binance-feed";
import { diffWalls, type LifecycleWall, type WallEvent } from "../../src/lib/wall-lifecycle";

const DEPTH_STREAM_URL = "wss://data-stream.binance.vision/stream";
const DEPTH_SNAPSHOT_URL = "https://data-api.binance.vision/api/v3/depth";
const SNAPSHOT_MS = 60_000;
const RETENTION_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DETECTOR_VERSION = "1";

const db = new PrismaClient();

const eventData = (row: MarketEventRow) => ({
  symbol: row.symbol,
  kind: row.kind,
  seq: BigInt(row.seq),
  exchangeTime: row.exchangeTime,
  receivedAt: row.receivedAt,
  payload: row.payload,
  schemaVersion: row.schemaVersion,
});

const insertEvents = async (rows: readonly MarketEventRow[]): Promise<void> => {
  for (const row of rows) {
    const data = eventData(row);
    await db.marketEvent.upsert({
      where: { symbol_kind_seq: { symbol: data.symbol, kind: data.kind, seq: data.seq } },
      update: {},
      create: data,
    });
  }
};

const insertSnapshots = async (rows: readonly BookSnapshotRow[]): Promise<void> => {
  await db.bookSnapshot.createMany({
    data: rows.map((row) => ({
      symbol: row.symbol,
      capturedAt: row.capturedAt,
      lastUpdateId: BigInt(row.lastUpdateId),
      bids: row.bids,
      asks: row.asks,
      coverage: row.coverage,
    })),
  });
};

const insertTransitions = async (rows: readonly WallTransitionRow[]): Promise<void> => {
  await db.wallTransition.createMany({ data: [...rows] });
};

const store: MarketStore = { insertEvents, insertSnapshots, insertTransitions };

const retentionDays = (): number => {
  const days = Number(process.env.RETENTION_DAYS ?? "3");
  return Number.isFinite(days) && days > 0 ? days : 3;
};

const purgeOldEvents = async (): Promise<void> => {
  const cutoff = Date.now() - retentionDays() * DAY_MS;
  await db.marketEvent.deleteMany({ where: { receivedAt: { lt: cutoff } } });
};

const closeQuietly = (socket: WebSocket): void => {
  try { socket.close(1000, "Normal closure"); } catch { /* already closing */ }
};

const openDepthSocket: DepthFeedDeps["openSocket"] = (url, handlers) => {
  const socket = new WebSocket(url);
  socket.onopen = handlers.onOpen;
  socket.onclose = handlers.onClose;
  socket.onerror = () => { if (socket.readyState === WebSocket.OPEN) closeQuietly(socket); };
  socket.onmessage = (message) => {
    const body = JSON.parse(String(message.data)) as { data: DepthUpdate & { e?: string } };
    if (body.data.e === "depthUpdate") handlers.onMessage(body.data);
  };
  return () => closeQuietly(socket);
};

const fetchSnapshot: DepthFeedDeps["fetchSnapshot"] = async (symbol, limit) => {
  const res = await fetch(`${DEPTH_SNAPSHOT_URL}?symbol=${symbol}&limit=${limit}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()) as DepthSnapshot;
};

const serverDeps = (): DepthFeedDeps => ({
  now: () => Date.now(),
  schedule: (run, delayMs) => {
    const timer = setTimeout(run, delayMs);
    return () => clearTimeout(timer);
  },
  openSocket: openDepthSocket,
  fetchSnapshot,
});

const recordMarket = (
  recorder: MarketRecorder,
  symbol: string,
  kind: MarketEventKind,
  source: { readonly event?: DepthUpdate; readonly seq: number },
): void => {
  recorder.recordEvent({
    symbol,
    kind,
    seq: source.seq,
    receivedAt: Date.now(),
    payload: JSON.stringify(source.event ?? null),
  });
};

type RawTrade = Parameters<typeof toLiveTrade>[0];

const recordTrade = (recorder: MarketRecorder, symbol: string, raw: RawTrade): void => {
  const trade = toLiveTrade(raw);
  recorder.recordEvent({
    symbol,
    kind: "trade",
    seq: trade.id,
    exchangeTime: trade.time,
    receivedAt: Date.now(),
    payload: JSON.stringify(trade),
  });
};

const isTrade = (value: unknown): value is RawTrade => {
  if (typeof value !== "object" || value === null) return false;
  return (value as { e?: string }).e === "trade";
};

const openTrades = (symbol: BinanceSymbol, onTrade: (raw: RawTrade) => void): (() => void) => {
  const socket = new WebSocket(`${DEPTH_STREAM_URL}?streams=${symbol.toLowerCase()}@trade`);
  socket.onmessage = (message) => {
    const body = JSON.parse(String(message.data)) as { data: unknown };
    if (isTrade(body.data)) onTrade(body.data);
  };
  return () => closeQuietly(socket);
};

const snapshotRow = (symbol: string, state: DepthFeedState): BookSnapshotRow | undefined => {
  const book = state.book;
  if (book === undefined || state.updateId === undefined) return undefined;
  const levels = (side: "bid" | "ask") =>
    JSON.stringify([...book.levels(side)].map(([price, quantity]) => [String(price), String(quantity)]));
  return {
    symbol,
    capturedAt: Date.now(),
    lastUpdateId: state.updateId,
    bids: levels("bid"),
    asks: levels("ask"),
    coverage: JSON.stringify(book.coverage),
  };
};

const transitionRow = (symbol: string, event: WallEvent): WallTransitionRow => ({
  wallId: `${symbol}:${event.side}:${event.price}`,
  symbol,
  side: event.side,
  price: event.price,
  kind: event.kind,
  notional: event.notional,
  at: event.at,
  detectorVersion: DETECTOR_VERSION,
});

const watchWalls = (symbol: string, recorder: MarketRecorder) => {
  const tracker = new WallTracker(DEFAULT_WALL_OPTIONS);
  let previous: LifecycleWall[] = [];
  return {
    reset(): void {
      tracker.reset();
      previous = [];
    },
    note(state: DepthFeedState): void {
      if (state.book === undefined) return;
      const frame = tracker.update(state.book, Date.now());
      if (frame === undefined) return;
      const current = [...frame.bids, ...frame.asks].map((wall) => ({
        side: wall.side, price: wall.price, notional: wall.notional,
      }));
      const events = diffWalls(previous, current, {
        at: Date.now(),
        mid: frame.mid,
        proximityPct: DEFAULT_WALL_OPTIONS.windowPct,
        bucketWidth: Math.max(frame.mid * 0.0001, 1e-8),
      });
      previous = current;
      for (const event of events) recorder.recordTransition(transitionRow(symbol, event));
    },
  };
};

const captureIfLive = (symbol: string, recorder: MarketRecorder, state: DepthFeedState | undefined): void => {
  if (state === undefined || state.status !== "live") return;
  const row = snapshotRow(symbol, state);
  if (row !== undefined) recorder.recordSnapshot(row);
};

const followBook = (
  symbol: string,
  recorder: MarketRecorder,
  walls: ReturnType<typeof watchWalls>,
  held: { state?: DepthFeedState },
) => {
  let live = false;
  return (state: DepthFeedState): void => {
    held.state = state;
    const nowLive = state.status === "live";
    if (live && !nowLive) walls.reset();
    if (!live && nowLive) captureIfLive(symbol, recorder, state);
    live = nowLive;
    if (nowLive) walls.note(state);
  };
};

const collectSymbol = (symbol: BinanceSymbol, recorder: MarketRecorder): (() => void) => {
  let syntheticGap = 0;
  const walls = watchWalls(symbol, recorder);
  const held: { state?: DepthFeedState } = {};
  const feed = new DepthFeed(symbol, {
    ...serverDeps(),
    onApplied: (event) => recordMarket(recorder, symbol, "depth", { event, seq: event.u }),
    onGap: (event) => recordMarket(recorder, symbol, "gap", { event, seq: event?.u ?? -(++syntheticGap) }),
  });
  const unsubscribe = feed.subscribe(followBook(symbol, recorder, walls, held));
  const trades = openTrades(symbol, (raw) => recordTrade(recorder, symbol, raw));
  const timer = setInterval(() => captureIfLive(symbol, recorder, held.state), SNAPSHOT_MS);
  return () => {
    clearInterval(timer);
    trades();
    unsubscribe();
  };
};

const symbolsFrom = (raw: string | undefined): BinanceSymbol[] =>
  (raw ?? "BTCUSDT").split(",").map((part) => part.trim()).filter(isBinanceSymbol);

const main = async (): Promise<void> => {
  const symbols = symbolsFrom(process.env.COLLECTOR_SYMBOLS);
  if (symbols.length === 0) throw new Error("COLLECTOR_SYMBOLS has no supported Binance symbol");
  const recorder = new MarketRecorder(store, { batchIntervalMs: 1_000, maxBatch: 200, maxPending: 20_000 });
  const stops = symbols.map((symbol) => collectSymbol(symbol, recorder));
  await purgeOldEvents();
  const retention = setInterval(() => { void purgeOldEvents().catch((error: unknown) => console.error(error)); }, RETENTION_MS);
  let stopping = false;
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    clearInterval(retention);
    for (const stop of stops) stop();
    await recorder.stop();
    await db.$disconnect();
    process.exit(0);
  };
  // bun-types declares Process.on only for "memoryPressure", which hides these signals.
  const listen = process as unknown as { on(name: string, listener: () => void): void };
  listen.on("SIGINT", () => { void shutdown(); });
  listen.on("SIGTERM", () => { void shutdown(); });
};

if (import.meta.main) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
