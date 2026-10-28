"use client";

import type { BinanceSymbol } from "./public-binance-feed";
import { quoteAssetOf } from "./public-binance-feed";
import { WallTracker, type WallFrame, type WallOptions, type BookView } from "./depth-walls";
import { LocalOrderBook, type DepthSnapshot, type DepthUpdate } from "./order-book";

/**
 * Live liquidity walls for a Binance Spot symbol, the same market as the
 * chart's candles. One `<symbol>@depth@100ms` socket per symbol serves every
 * chart showing it. Each chart observes the book with its own wall options.
 * Stream and snapshot both come from Binance's market-data mirrors.
 */

const DEPTH_STREAM_URL = "wss://data-stream.binance.vision/stream";
const DEPTH_SNAPSHOT_URL = "https://data-api.binance.vision/api/v3/depth";

export type DepthStatus = "syncing" | "live" | "stale";

/** Feed-level state, shared by every subscriber. Walls are derived per subscriber from its own options. */
export interface DepthFeedState {
  readonly status: DepthStatus;
  /** The synced book. Subscribers read it synchronously, and only while `live`. */
  readonly book: BookView | undefined;
  readonly error?: string;
}

export interface DepthWallsUpdate {
  readonly status: DepthStatus;
  /** Last walls computed while live. Kept through syncing and stale so the chart can show them as not current. */
  readonly frame: WallFrame | undefined;
  /** End of the continuous observation behind `frame`: now while live, the last live moment otherwise. */
  readonly observedUntil: number;
  readonly quoteAsset: string;
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

// Binance's maximum. Even 5000 levels reach only about ±1.1% from mid on BTCUSDT.
const SNAPSHOT_LIMIT = 5_000;
const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;
const RECONNECT_DELAY_MS = 3_000;
// depth@100ms is silent only when the book does not change; this long means the feed is not current.
const STALE_AFTER_MS = 10_000;
// A snapshot costs 250 request weight, so the book is re-centred at most this often.
const COVERAGE_REFRESH_MS = 60_000;

/** Distance from mid to the nearer edge of the verified coverage, in percent. */
const coverageHeadroomPct = (book: BookView): number => {
  if (book.bestBid === undefined || book.bestAsk === undefined) return Number.POSITIVE_INFINITY;
  const mid = (book.bestBid + book.bestAsk) / 2;
  const { bidFloor, askCeiling } = book.coverage;
  return Math.min((mid - bidFloor) / mid, (askCeiling - mid) / mid) * 100;
};

/**
 * One chart's view of the feed. It derives walls from the book with its own
 * options. It breaks observation whenever the feed stops being live, so a
 * wall seen again after a gap, a resync or a stall starts a new observation
 * instead of continuing the old one.
 */
export class WallObserver {
  private readonly tracker: WallTracker;
  private lastState: DepthFeedState | undefined;
  private frame: WallFrame | undefined;
  private observing = false;
  private observedUntil = 0;

  public constructor(
    options: WallOptions,
    private readonly quoteAsset: string,
    private readonly now: () => number,
    private readonly emit: (update: DepthWallsUpdate) => void,
  ) {
    this.tracker = new WallTracker(options);
  }

  public receive(state: DepthFeedState): void {
    this.lastState = state;
    this.apply(state);
    this.publish(state);
  }

  public setOptions(options: WallOptions): void {
    this.tracker.setOptions(options);
    if (this.lastState !== undefined) this.receive(this.lastState);
  }

  private apply(state: DepthFeedState): void {
    if (state.status === "live" && state.book !== undefined) {
      const now = this.now();
      this.frame = this.tracker.update(state.book, now);
      this.observedUntil = now;
      this.observing = true;
      return;
    }
    if (this.observing) {
      this.tracker.reset();
      this.observing = false;
    }
  }

  private publish(state: DepthFeedState): void {
    this.emit({
      status: state.status,
      frame: this.frame,
      observedUntil: this.observedUntil,
      quoteAsset: this.quoteAsset,
      ...(state.error === undefined ? {} : { error: state.error }),
    });
  }
}

export class DepthFeed {
  private readonly listeners = new Set<(state: DepthFeedState) => void>();
  // Widest window each observer searches: the snapshot must cover it around mid.
  private readonly windows = new Map<object, number>();
  private readonly book = new LocalOrderBook();
  private state: DepthFeedState = { status: "syncing", book: undefined };
  private closeSocket: (() => void) | undefined;
  private cancelRetry: (() => void) | undefined;
  private cancelWatchdog: (() => void) | undefined;
  private cancelReconnect: (() => void) | undefined;
  private snapshotInFlight = false;
  private retryMs = FIRST_RETRY_MS;
  private lastCoverageRefresh = Number.NEGATIVE_INFINITY;
  // Headroom right after the last snapshot: the most this snapshot can ever cover.
  private snapshotHeadroomPct = Number.POSITIVE_INFINITY;
  // Bumped on reconnect and stop, so responses from an older connection are ignored.
  private generation = 0;
  private stopped = false;
  private started = false;

  public constructor(
    private readonly symbol: BinanceSymbol,
    private readonly deps: DepthFeedDeps,
  ) {}

  public get isStopped(): boolean {
    return this.stopped;
  }

  /** Starts on the first subscriber and stops when the last one leaves. Replays the current state. */
  public subscribe(listener: (state: DepthFeedState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    if (!this.started) {
      this.started = true;
      this.connect();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  /** Registers (or with `undefined`, removes) an observer's window. */
  public setWindow(owner: object, windowPct: number | undefined): void {
    if (windowPct === undefined) this.windows.delete(owner);
    else this.windows.set(owner, windowPct);
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
    this.snapshotInFlight = false;
    this.cancelRetry?.();
    this.cancelRetry = undefined;
    this.closeSocket = this.deps.openSocket(
      `${DEPTH_STREAM_URL}?streams=${this.symbol.toLowerCase()}@depth@100ms`,
      {
        // Events buffer from here, so a snapshot taken now can be continued by them.
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
      this.emit("syncing");
      this.scheduleSnapshot();
      return;
    }
    if (result !== "applied") return;
    this.armWatchdog();
    this.emit("live");
    this.refreshCoverageIfNeeded();
  }

  /**
   * Re-centres the book when price nears the edge of the verified coverage, so
   * observers keep their window. The threshold is capped by what the last
   * snapshot could cover at all, so a window wider than the snapshot can't
   * trigger a refresh on every tick.
   */
  private refreshCoverageIfNeeded(): void {
    const requiredPct = Math.max(0, ...this.windows.values());
    const threshold = Math.min(requiredPct, this.snapshotHeadroomPct / 2);
    if (coverageHeadroomPct(this.book) >= threshold) return;
    const now = this.deps.now();
    if (now - this.lastCoverageRefresh < COVERAGE_REFRESH_MS) return;
    this.lastCoverageRefresh = now;
    this.book.reset();
    this.emit("syncing");
    this.fetchSnapshot();
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
          this.emit("syncing");
          this.scheduleSnapshot();
          return;
        }
        this.retryMs = FIRST_RETRY_MS;
        this.snapshotHeadroomPct = coverageHeadroomPct(this.book);
        this.armWatchdog();
        this.emit("live");
      },
      (error: unknown) => {
        if (generation !== this.generation) return;
        this.snapshotInFlight = false;
        const message = error instanceof Error ? error.message : String(error);
        this.emit("syncing", `Order book snapshot failed: ${message}`);
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
    this.emit("stale");
    this.cancelReconnect = this.deps.schedule(() => {
      this.cancelReconnect = undefined;
      if (this.stopped) return;
      this.connect();
      this.emit("syncing");
    }, RECONNECT_DELAY_MS);
  }

  private armWatchdog(): void {
    this.cancelWatchdog?.();
    this.cancelWatchdog = this.deps.schedule(() => {
      this.cancelWatchdog = undefined;
      if (this.state.status === "live") this.emit("stale");
    }, STALE_AFTER_MS);
  }

  private emit(status: DepthStatus, error?: string): void {
    this.state = {
      status,
      book: this.book.isSynced ? this.book : undefined,
      ...(error === undefined ? {} : { error }),
    };
    for (const listener of this.listeners) listener(this.state);
  }
}

// ---------- browser wiring ----------

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
    socket.onerror = () => {
      if (socket.readyState === WebSocket.OPEN) {
        try { socket.close(1000, "Normal closure"); } catch {}
      }
    };
    socket.onmessage = (message) => {
      const { data } = JSON.parse(message.data as string) as { data: DepthUpdate & { e?: string } };
      if (data.e === "depthUpdate") handlers.onMessage(data);
    };
    return () => {
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.onopen = () => {
          try { socket.close(1000, "Normal closure"); } catch {}
        };
      } else if (socket.readyState === WebSocket.OPEN) {
        socket.onopen = null;
        try { socket.close(1000, "Normal closure"); } catch {}
      } else {
        socket.onopen = null;
      }
    };
  },
  fetchSnapshot: async (symbol, limit) => {
    const res = await fetch(`${DEPTH_SNAPSHOT_URL}?symbol=${symbol}&limit=${limit}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return (await res.json()) as DepthSnapshot;
  },
};

const sharedFeeds = new Map<BinanceSymbol, DepthFeed>();

const feedFor = (symbol: BinanceSymbol): DepthFeed => {
  const existing = sharedFeeds.get(symbol);
  if (existing !== undefined && !existing.isStopped) return existing;
  const feed = new DepthFeed(symbol, browserDeps);
  sharedFeeds.set(symbol, feed);
  return feed;
};

export interface WallsSubscription {
  /** Applies new wall options immediately, without reconnecting. */
  setOptions(options: WallOptions): void;
  unsubscribe(): void;
}

/** Live walls for `symbol`, one shared connection per symbol. Options can change without reconnecting. */
export const subscribeDepthWalls = (
  symbol: BinanceSymbol,
  options: WallOptions,
  listener: (update: DepthWallsUpdate) => void,
): WallsSubscription => {
  const feed = feedFor(symbol);
  const observer = new WallObserver(options, quoteAssetOf(symbol), browserDeps.now, listener);
  feed.setWindow(observer, options.windowPct);
  const unsubscribeFeed = feed.subscribe((state) => observer.receive(state));
  return {
    setOptions: (next) => {
      feed.setWindow(observer, next.windowPct);
      observer.setOptions(next);
    },
    unsubscribe: () => {
      feed.setWindow(observer, undefined);
      unsubscribeFeed();
    },
  };
};
