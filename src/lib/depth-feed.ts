"use client";

import type { BinanceSymbol } from "./public-binance-feed";
import { LocalOrderBook, type DepthSnapshot, type DepthUpdate } from "./order-book";
import { WallTracker, type WallFrame, type WallOptions } from "./depth-walls";

/**
 * Live liquidity walls for a Binance Spot symbol — the same market as the
 * chart's candles (a futures book over spot candles would show other prices).
 *
 * One `<symbol>@depth@100ms` socket per symbol, shared by every chart cell
 * showing it. Stream and snapshot both come from Binance's market-data-only
 * mirrors (`data-stream.binance.vision`, `data-api.binance.vision` — the
 * latter already serves the candle history), so the two halves of the sync
 * share one source and stay reachable where `api.binance.com` is
 * geo-restricted.
 */

const DEPTH_STREAM_URL = "wss://data-stream.binance.vision/stream";

export type DepthStatus = "syncing" | "live" | "stale";

export interface DepthWallsUpdate {
  /** `live`: synced and updating. `syncing`: (re)building the book. `stale`: socket down or silent. */
  readonly status: DepthStatus;
  /** Latest walls; kept through `syncing`/`stale` so the chart can show them as not current. */
  readonly frame: WallFrame | undefined;
  /** Last sync failure, cleared once live. */
  readonly error?: string;
}

/** I/O seams, injected so sync, resync and failure paths are testable without a network. */
export interface DepthFeedDeps {
  readonly now: () => number;
  /** Runs `run` after `delayMs`; returns a cancel function. */
  readonly schedule: (run: () => void, delayMs: number) => () => void;
  readonly openSocket: (
    url: string,
    handlers: { readonly onOpen: () => void; readonly onMessage: (event: DepthUpdate) => void; readonly onClose: () => void },
  ) => () => void;
  readonly fetchSnapshot: (symbol: BinanceSymbol, limit: number) => Promise<DepthSnapshot>;
}

export const DEFAULT_WALL_OPTIONS: WallOptions = { maxDistancePct: 0.5, minNotional: 0, switchMarginPct: 15 };

// Binance's maximum. Even 5000 levels reach only ~±1% from mid on BTCUSDT.
const SNAPSHOT_LIMIT = 5_000;
const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;
const RECONNECT_DELAY_MS = 3_000;
// depth@100ms is silent only when the book does not change; this long means the feed is not current.
const STALE_AFTER_MS = 10_000;
// A snapshot costs 250 request weight; widen the known range at most this often.
const COVERAGE_REFRESH_MS = 60_000;

export class DepthFeed {
  private readonly listeners = new Set<(update: DepthWallsUpdate) => void>();
  private readonly book = new LocalOrderBook();
  private readonly tracker: WallTracker;
  private latest: DepthWallsUpdate | undefined;
  private closeSocket: (() => void) | undefined;
  private cancelRetry: (() => void) | undefined;
  private cancelWatchdog: (() => void) | undefined;
  private cancelReconnect: (() => void) | undefined;
  private snapshotInFlight = false;
  private retryMs = FIRST_RETRY_MS;
  private lastCoverageRefresh = Number.NEGATIVE_INFINITY;
  // Bumped on reconnect/stop so a response from an older connection is ignored.
  private generation = 0;
  private stopped = false;
  private started = false;

  public constructor(
    private readonly symbol: BinanceSymbol,
    options: WallOptions,
    private readonly deps: DepthFeedDeps,
  ) {
    this.tracker = new WallTracker(options);
  }

  public get isStopped(): boolean {
    return this.stopped;
  }

  /** Starts on the first subscriber; replays the latest update; stops when the last one leaves. */
  public subscribe(listener: (update: DepthWallsUpdate) => void): () => void {
    this.listeners.add(listener);
    if (this.latest !== undefined) listener(this.latest);
    if (!this.started) {
      this.started = true;
      this.connect();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  public stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.generation += 1;
    this.closeSocket?.();
    this.cancelRetry?.();
    this.cancelWatchdog?.();
    this.cancelReconnect?.();
  }

  private connect(): void {
    this.generation += 1;
    const generation = this.generation;
    this.book.reset();
    this.tracker.reset();
    this.snapshotInFlight = false;
    this.cancelRetry?.();
    this.cancelRetry = undefined;
    this.closeSocket = this.deps.openSocket(
      `${DEPTH_STREAM_URL}?streams=${this.symbol.toLowerCase()}@depth@100ms`,
      {
        // Events buffer from here, so the snapshot taken now can be continued by them.
        onOpen: () => { if (generation === this.generation) this.fetchSnapshot(); },
        onMessage: (event) => { if (generation === this.generation) this.onEvent(event); },
        onClose: () => { if (generation === this.generation) this.onSocketClosed(); },
      },
    );
  }

  private onEvent(event: DepthUpdate): void {
    const result = this.book.push(event);
    if (result === "gap") {
      // Missed events: the book was discarded and this event starts the new buffer.
      this.emit({ status: "syncing", frame: this.latest?.frame });
      this.scheduleSnapshot();
      return;
    }
    if (result !== "applied") return;
    this.armWatchdog();
    this.publishFrame();
  }

  private publishFrame(): void {
    const frame = this.tracker.update(this.book, this.deps.now());
    this.emit({ status: "live", frame });
    if (frame?.windowExceedsCoverage && this.deps.now() - this.lastCoverageRefresh >= COVERAGE_REFRESH_MS) {
      // Price drifted toward the edge of the snapshot's known range: re-snapshot around the new mid.
      this.lastCoverageRefresh = this.deps.now();
      this.book.reset();
      this.emit({ status: "syncing", frame });
      this.fetchSnapshot();
    }
  }

  private fetchSnapshot(): void {
    if (this.snapshotInFlight || this.stopped) return;
    this.snapshotInFlight = true;
    const generation = this.generation;
    this.deps.fetchSnapshot(this.symbol, SNAPSHOT_LIMIT).then(
      (snapshot) => {
        if (generation !== this.generation) return;
        this.snapshotInFlight = false;
        const result = this.book.applySnapshot(snapshot, SNAPSHOT_LIMIT);
        if (result !== "synced") {
          this.emit({ status: "syncing", frame: this.latest?.frame });
          this.scheduleSnapshot();
          return;
        }
        this.retryMs = FIRST_RETRY_MS;
        this.lastCoverageRefresh = this.deps.now();
        this.armWatchdog();
        this.publishFrame();
      },
      (error: unknown) => {
        if (generation !== this.generation) return;
        this.snapshotInFlight = false;
        const message = error instanceof Error ? error.message : String(error);
        this.emit({ status: "syncing", frame: this.latest?.frame, error: `Order book snapshot failed: ${message}` });
        this.scheduleSnapshot();
      },
    );
  }

  /** Exponential backoff from 1 s to 30 s; reset by a successful sync. */
  private scheduleSnapshot(): void {
    if (this.cancelRetry !== undefined || this.stopped) return;
    const delay = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
    this.cancelRetry = this.deps.schedule(() => {
      this.cancelRetry = undefined;
      this.fetchSnapshot();
    }, delay);
  }

  private onSocketClosed(): void {
    this.closeSocket = undefined;
    this.cancelWatchdog?.();
    this.emit({ status: "stale", frame: this.latest?.frame });
    this.cancelReconnect = this.deps.schedule(() => {
      this.cancelReconnect = undefined;
      if (this.stopped) return;
      this.connect();
      this.emit({ status: "syncing", frame: this.latest?.frame });
    }, RECONNECT_DELAY_MS);
  }

  private armWatchdog(): void {
    this.cancelWatchdog?.();
    this.cancelWatchdog = this.deps.schedule(() => {
      this.cancelWatchdog = undefined;
      if (this.latest?.status === "live") this.emit({ status: "stale", frame: this.latest.frame });
    }, STALE_AFTER_MS);
  }

  private emit(update: DepthWallsUpdate): void {
    this.latest = update;
    for (const listener of this.listeners) listener(update);
  }
}

// ---------- browser wiring ----------

const DEPTH_URL = "https://data-api.binance.vision/api/v3/depth";

const browserDeps: DepthFeedDeps = {
  now: () => Date.now(),
  schedule: (run, delayMs) => {
    const timer = setTimeout(run, delayMs);
    return () => clearTimeout(timer);
  },
  openSocket: (url, handlers) => {
    const socket = new WebSocket(url);
    socket.onopen = handlers.onOpen;
    socket.onclose = handlers.onClose;
    socket.onerror = () => socket.close();
    socket.onmessage = (message) => {
      const { data } = JSON.parse(message.data as string) as { data: DepthUpdate & { e?: string } };
      if (data.e === "depthUpdate") handlers.onMessage(data);
    };
    return () => {
      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
    };
  },
  fetchSnapshot: async (symbol, limit) => {
    const res = await fetch(`${DEPTH_URL}?symbol=${symbol}&limit=${limit}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return (await res.json()) as DepthSnapshot;
  },
};

const sharedFeeds = new Map<BinanceSymbol, DepthFeed>();

/** Live walls for `symbol`, one shared connection per symbol across chart cells. Returns unsubscribe. */
export const subscribeDepthWalls = (
  symbol: BinanceSymbol,
  listener: (update: DepthWallsUpdate) => void,
): (() => void) => {
  let feed = sharedFeeds.get(symbol);
  if (feed === undefined || feed.isStopped) {
    feed = new DepthFeed(symbol, DEFAULT_WALL_OPTIONS, browserDeps);
    sharedFeeds.set(symbol, feed);
  }
  return feed.subscribe(listener);
};
