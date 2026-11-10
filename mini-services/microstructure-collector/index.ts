import { BINANCE_DATA_WS_URL } from "../../src/lib/binance-endpoints";
import { isDepthSnapshot } from "../../src/lib/binance-payloads";
import { serializeCoverage } from "../../src/lib/book-replay";
import { DepthFeed, type DepthFeedDeps, type DepthFeedState } from "../../src/lib/depth-feed";
import { DEFAULT_WALL_OPTIONS, WallTracker } from "../../src/lib/depth-walls";
import {
  isBinanceSymbol,
  MarketRecorder,
  syntheticGapSeq,
  type BookSnapshotRow,
  type MarketEventKind,
  type MarketStore,
  type WallTransitionRow,
} from "../../src/lib/market-recorder";
import type { DepthSnapshot, DepthUpdate } from "../../src/lib/order-book";
import { toLiveTrade, type BinanceSymbol } from "../../src/lib/public-binance-feed";
import { fetchInstrumentFilters } from "../../src/lib/symbol-catalog";
import { diffWalls, wallIdentityWidth, type LifecycleWall, type WallEvent } from "../../src/lib/wall-lifecycle";
import { COLLECTOR_DATA_WS_URL, COLLECTOR_REST_URL } from "./endpoints";
import { createMalformedLogger, parseDepthMessage } from "./parse";
import { disconnectStore, purgeOldEvents, startOutcomeLoop, store } from "./store";
import { closeQuietly, openTradeStream, type RawTrade } from "./trade-stream";

const DEPTH_SNAPSHOT_URL = `${COLLECTOR_REST_URL}/api/v3/depth`;
const SNAPSHOT_MS = 60_000;
const RETENTION_MS = 60 * 60 * 1000;
const DETECTOR_VERSION = "1";

const malformedLogger = createMalformedLogger();

const openDepthSocket: DepthFeedDeps["openSocket"] = (url, handlers) => {
  const socket = new WebSocket(url.replace(BINANCE_DATA_WS_URL, COLLECTOR_DATA_WS_URL));
  socket.onopen = handlers.onOpen;
  socket.onclose = handlers.onClose;
  socket.onerror = () => { if (socket.readyState === WebSocket.OPEN) closeQuietly(socket); };
  socket.onmessage = (message) => {
    const update = parseDepthMessage(message.data);
    if (update !== undefined) handlers.onMessage(update);
    else { handlers.onMalformed(); malformedLogger.record(); }
  };
  return () => closeQuietly(socket);
};

const fetchSnapshot: DepthFeedDeps["fetchSnapshot"] = async (symbol, limit) => {
  const res = await fetch(`${DEPTH_SNAPSHOT_URL}?symbol=${symbol}&limit=${limit}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as unknown;
  if (!isDepthSnapshot(body)) throw new Error(`Invalid depth snapshot for ${symbol}: ${(JSON.stringify(body) ?? "").slice(0, 200)}`);
  return body;
};

const serverDeps = (): DepthFeedDeps => ({
  now: () => Date.now(),
  schedule: (run, delayMs) => { const timer = setTimeout(run, delayMs); return () => clearTimeout(timer); },
  openSocket: openDepthSocket,
  fetchSnapshot,
});

const recordMarket = (
  recorder: MarketRecorder, symbol: string, kind: MarketEventKind,
  source: { readonly event?: DepthUpdate; readonly seq: number },
): void => {
  recorder.recordEvent({ symbol, kind, seq: source.seq, receivedAt: Date.now(), payload: JSON.stringify(source.event ?? null) });
};

const recordTrade = (recorder: MarketRecorder, symbol: string, raw: RawTrade): void => {
  const trade = toLiveTrade(raw);
  recorder.recordEvent({ symbol, kind: "trade", seq: trade.id, exchangeTime: trade.time, receivedAt: Date.now(), payload: JSON.stringify(trade) });
};

const snapshotRow = (symbol: string, state: DepthFeedState): BookSnapshotRow | undefined => {
  const { book, updateId } = state;
  if (book === undefined || updateId === undefined) return undefined;
  const levels = (side: "bid" | "ask") => JSON.stringify([...book.levels(side)].map(([p, q]) => [String(p), String(q)]));
  return { symbol, capturedAt: Date.now(), lastUpdateId: updateId, bids: levels("bid"), asks: levels("ask"), coverage: serializeCoverage(book.coverage) };
};

interface ActiveWall {
  readonly wallId: string;
  readonly side: "bid" | "ask";
  readonly originalPrice: number;
  price: number;
  notional: number;
}

const matchActiveWall = (open: readonly ActiveWall[], wall: { readonly side: string; readonly price: number }, width: number, used: Set<number>): number => {
  let best = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < open.length; i += 1) {
    const prior = open[i];
    if (prior === undefined || used.has(i) || prior.side !== wall.side) continue;
    const dist = Math.abs(prior.price - wall.price);
    if (dist > width || dist >= bestDist) continue;
    best = i;
    bestDist = dist;
  }
  return best;
};

export const watchWalls = (symbol: string, recorder: MarketRecorder, tickSize?: number) => {
  const tracker = new WallTracker(DEFAULT_WALL_OPTIONS);
  let openWalls: ActiveWall[] = [];

  const dropOutage = (at: number): void => {
    for (const w of openWalls) {
      recorder.recordTransition({
        wallId: w.wallId, symbol, side: w.side, price: w.originalPrice,
        kind: "unobserved", notional: w.notional, at, detectorVersion: DETECTOR_VERSION,
      });
    }
    openWalls = [];
    tracker.reset();
  };

  const recordEvents = (events: readonly WallEvent[], currentMap: Map<string, ActiveWall>, at: number): void => {
    for (const event of events) {
      const active = event.kind === "removed" || event.kind === "pulled"
        ? openWalls.find((w) => w.side === event.side && Math.abs(w.price - event.price) <= 1e-9)
        : currentMap.get(`${event.side}:${event.price}`);
      if (active === undefined) continue;
      recorder.recordTransition({
        wallId: active.wallId, symbol, side: event.side, price: active.originalPrice,
        kind: event.kind, notional: event.notional, at, detectorVersion: DETECTOR_VERSION,
      });
    }
  };

  const updateOpen = (current: readonly LifecycleWall[], width: number, at: number) => {
    const used = new Set<number>();
    const nextOpen: ActiveWall[] = [];
    const currentMap = new Map<string, ActiveWall>();
    for (const wall of current) {
      const idx = matchActiveWall(openWalls, wall, width, used);
      const active: ActiveWall = idx >= 0 ? openWalls[idx]! : {
        wallId: `${symbol}:${wall.side}:${wall.price}:${at}`,
        side: wall.side, originalPrice: wall.price, price: wall.price, notional: wall.notional,
      };
      if (idx >= 0) used.add(idx);
      active.price = wall.price;
      active.notional = wall.notional;
      nextOpen.push(active);
      currentMap.set(`${wall.side}:${wall.price}`, active);
    }
    return { nextOpen, currentMap };
  };

  return {
    reset(): void { tracker.reset(); openWalls = []; },
    dropOutage,
    note(state: DepthFeedState): void {
      if (state.book === undefined) return;
      const at = Date.now();
      const frame = tracker.update(state.book, at);
      if (frame === undefined) return;
      const current = [...frame.bids, ...frame.asks].map((w) => ({ side: w.side, price: w.price, notional: w.notional }));
      const width = Math.max(wallIdentityWidth(frame.mid, tickSize), 1e-8);
      const previous = openWalls.map((w) => ({ side: w.side, price: w.price, notional: w.notional }));
      const events = diffWalls(previous, current, { at, mid: frame.mid, proximityPct: DEFAULT_WALL_OPTIONS.windowPct, bucketWidth: width });
      const { nextOpen, currentMap } = updateOpen(current, width, at);
      recordEvents(events, currentMap, at);
      openWalls = nextOpen;
    },
  };
};

const captureIfLive = (symbol: string, recorder: MarketRecorder, state: DepthFeedState | undefined): void => {
  if (state?.status === "live") {
    const row = snapshotRow(symbol, state);
    if (row !== undefined) recorder.recordSnapshot(row);
  }
};

const followBook = (
  symbol: string, recorder: MarketRecorder, walls: ReturnType<typeof watchWalls>,
  held: { state?: DepthFeedState }, nextGapSeq: () => number,
) => {
  let live = false;
  let wasLive = false;
  return (state: DepthFeedState): void => {
    held.state = state;
    const nowLive = state.status === "live";
    const now = Date.now();
    if (live && !nowLive) {
      wasLive = true;
      walls.dropOutage(now);
      recorder.recordEvent({ symbol, kind: "gap", seq: nextGapSeq(), receivedAt: now, payload: JSON.stringify({ stream: "depth", phase: "start" }) });
    }
    if (!live && nowLive) {
      if (wasLive) {
        recorder.recordEvent({ symbol, kind: "gap", seq: nextGapSeq(), receivedAt: now, payload: JSON.stringify({ stream: "depth", phase: "end" }) });
      }
      captureIfLive(symbol, recorder, state);
    }
    live = nowLive;
    if (nowLive) walls.note(state);
  };
};

const recordTradeGap = (recorder: MarketRecorder, symbol: string, phase: "start" | "end", seq: number): void => {
  recorder.recordEvent({
    symbol,
    kind: "gap",
    seq,
    receivedAt: Date.now(),
    payload: JSON.stringify({ stream: "trade", phase }),
  });
};

const collectSymbol = (symbol: BinanceSymbol, recorder: MarketRecorder, tickSize?: number): (() => void) => {
  let gapCounter = 0;
  const nextGapSeq = (): number => syntheticGapSeq(Date.now(), gapCounter++);
  const walls = watchWalls(symbol, recorder, tickSize);
  const held: { state?: DepthFeedState } = {};
  const feed = new DepthFeed(symbol, {
    ...serverDeps(),
    onApplied: (event) => recordMarket(recorder, symbol, "depth", { event, seq: event.u }),
    onGap: (event) => recordMarket(recorder, symbol, "gap", { event, seq: event?.u ?? nextGapSeq() }),
  });
  const unsubscribe = feed.subscribe(followBook(symbol, recorder, walls, held, nextGapSeq));
  const trades = openTradeStream(
    symbol,
    (raw) => recordTrade(recorder, symbol, raw),
    (phase) => { recordTradeGap(recorder, symbol, phase, nextGapSeq()); },
    () => { malformedLogger.record(); },
  );
  const timer = setInterval(() => captureIfLive(symbol, recorder, held.state), SNAPSHOT_MS);
  return () => { clearInterval(timer); trades(); unsubscribe(); };
};

const symbolsFrom = (raw: string | undefined): BinanceSymbol[] =>
  (raw ?? "BTCUSDT").split(",").map((part) => part.trim()).filter(isBinanceSymbol);

const logDrop = (total: number, pending: number): void => {
  console.warn(`recorder dropped rows; total ${total}; pending ${pending}`);
};

const logWriteError = (error: unknown, remaining: number, dropped: number): void => {
  const msg = error instanceof Error ? error.message : "unknown error";
  console.warn(`store write failed; remaining ${remaining}; dropped ${dropped}; ${msg}`);
};

const startRetention = (): (() => void) => {
  const timer = setInterval(() => { void purgeOldEvents().catch(console.error); }, RETENTION_MS);
  return () => clearInterval(timer);
};

const wireShutdown = (shutdown: () => Promise<void>): void => {
  const listen = process as unknown as { on(name: string, listener: () => void): void };
  listen.on("SIGINT", () => { void shutdown(); });
  listen.on("SIGTERM", () => { void shutdown(); });
};

const stopCollector = async (stops: readonly (() => void)[], recorder: MarketRecorder): Promise<void> => {
  stops.forEach((stop) => stop());
  const remaining = await recorder.stop();
  malformedLogger.logSummary();
  console.warn(`collector shutdown; written ${recorder.writtenCount}; dropped ${recorder.droppedCount}; malformed ${malformedLogger.count()}; remaining ${remaining}`);
  await disconnectStore();
  process.exit(0);
};

const main = async (): Promise<void> => {
  const symbols = symbolsFrom(process.env.COLLECTOR_SYMBOLS);
  if (symbols.length === 0) throw new Error("COLLECTOR_SYMBOLS has no supported Binance symbol");
  const bootTime = Date.now();
  const recorder = new MarketRecorder(store, {
    batchIntervalMs: 1_000, maxBatch: 200, maxPending: 20_000, onDrop: logDrop, onWriteError: logWriteError,
  });
  let gapSeq = 0;
  for (const s of symbols) {
    recorder.recordEvent({
      symbol: s, kind: "gap", seq: syntheticGapSeq(bootTime, gapSeq++),
      receivedAt: bootTime, payload: JSON.stringify({ stream: "collector", phase: "restart" }),
    });
  }
  const filters = await Promise.all(symbols.map((s) => fetchInstrumentFilters(s).catch(() => undefined)));
  const stops = symbols.map((s, i) => collectSymbol(s, recorder, filters[i]?.tickSize));
  const stopOutcomes = startOutcomeLoop(symbols, () => recorder.flush());
  const stopRetention = startRetention();
  await purgeOldEvents();
  let stopping = false;
  wireShutdown(async () => {
    if (stopping) return;
    stopping = true;
    stopOutcomes();
    stopRetention();
    await stopCollector(stops, recorder);
  });
};

if (import.meta.main) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
