import type { BinanceSymbol } from "./public-binance-feed";
import { WallTracker, type WallFrame, type WallOptions, type BookView } from "./depth-walls";
import { LocalOrderBook, type DepthSnapshot, type DepthUpdate } from "./order-book";


const DEPTH_STREAM_URL = "wss://data-stream.binance.vision/stream";

export type DepthStatus = "syncing" | "live" | "stale" | "disconnected";

export interface DepthFeedState {
  readonly status: DepthStatus;
  readonly book: BookView | undefined;
  readonly error?: string;
  readonly resyncCount: number;
  readonly gapCount: number;
  readonly lastMessageAt?: number;
  /** Present while the book is synced. The collector stores this on each snapshot. */
  readonly updateId?: number;
}

export interface DepthWallsUpdate {
  readonly status: DepthStatus;
  readonly frame: WallFrame | undefined;
  readonly observedUntil: number;
  readonly quoteAsset: string;
  readonly error?: string;
}

export interface DepthFeedDeps {
  readonly now: () => number;
  readonly schedule: (run: () => void, delayMs: number) => () => void;
  readonly openSocket: (
    url: string,
    handlers: { readonly onOpen: () => void; readonly onMessage: (event: DepthUpdate) => void; readonly onClose: () => void },
  ) => () => void;
  readonly fetchSnapshot: (symbol: BinanceSymbol, limit: number) => Promise<DepthSnapshot>;
  readonly onApplied?: (event: DepthUpdate) => void;
  // Omitted when the hole is inside a snapshot apply: the book has already discarded the buffer.
  readonly onGap?: (event?: DepthUpdate) => void;
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

const coverageHeadroomPct = (book: BookView): number => {
  if (book.bestBid === undefined || book.bestAsk === undefined) return Number.POSITIVE_INFINITY;
  const mid = (book.bestBid + book.bestAsk) / 2;
  const { bidFloor, askCeiling } = book.coverage;
  return Math.min((mid - bidFloor) / mid, (askCeiling - mid) / mid) * 100;
};

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
  private readonly windows = new Map<object, number>();
  private readonly book = new LocalOrderBook();
  private state: DepthFeedState = { status: "syncing", book: undefined, resyncCount: 0, gapCount: 0 };
  private resyncCount = 0;
  private gapCount = 0;
  private lastMessageAt: number | undefined;
  private hasSynced = false;
  private closeSocket: (() => void) | undefined;
  private cancelRetry: (() => void) | undefined;
  private cancelWatchdog: (() => void) | undefined;
  private cancelReconnect: (() => void) | undefined;
  private snapshotInFlight = false;
  private retryMs = FIRST_RETRY_MS;
  private lastCoverageRefresh = Number.NEGATIVE_INFINITY;
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
    this.lastMessageAt = this.deps.now();
    const result = this.book.push(event);
    if (result === "gap") {
      // Missed events: the book was discarded and this event starts the new buffer.
      this.gapCount += 1;
      this.deps.onGap?.(event);
      this.emit("syncing");
      this.scheduleSnapshot();
      return;
    }
    if (result !== "applied") return;
    this.deps.onApplied?.(event);
    this.armWatchdog();
    this.emit("live");
    this.refreshCoverageIfNeeded();
  }
  // Cap the refresh at half the last snapshot: a wider window would resync every tick.
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
    this.noteResyncFetch();
    this.snapshotInFlight = true;
    const generation = this.generation;
    this.deps.fetchSnapshot(this.symbol, SNAPSHOT_LIMIT).then(
      (snapshot) => this.onSnapshot(generation, snapshot),
      (error: unknown) => this.onSnapshotError(generation, error),
    );
  }
  private noteResyncFetch(): void {
    if (!this.hasSynced) return;
    this.resyncCount += 1;
  }
  private onSnapshot(generation: number, snapshot: DepthSnapshot): void {
    if (generation !== this.generation) return;
    this.snapshotInFlight = false;
    const result = this.book.applySnapshot(snapshot, SNAPSHOT_LIMIT);
    if (result === "gap") {
      this.gapCount += 1;
      this.deps.onGap?.();
    }
    if (result !== "synced") {
      this.emit("syncing");
      this.scheduleSnapshot();
      return;
    }
    this.hasSynced = true;
    this.retryMs = FIRST_RETRY_MS;
    this.snapshotHeadroomPct = coverageHeadroomPct(this.book);
    this.armWatchdog();
    this.emit("live");
  }
  private onSnapshotError(generation: number, error: unknown): void {
    if (generation !== this.generation) return;
    this.snapshotInFlight = false;
    const message = error instanceof Error ? error.message : String(error);
    this.emit("syncing", `Order book snapshot failed: ${message}`);
    this.scheduleSnapshot();
  }
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
    this.generation += 1;
    this.cancelRetry?.();
    this.cancelRetry = undefined;
    this.snapshotInFlight = false;
    this.emit("disconnected");
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
      resyncCount: this.resyncCount,
      gapCount: this.gapCount,
      ...(this.lastMessageAt === undefined ? {} : { lastMessageAt: this.lastMessageAt }),
      ...(error === undefined ? {} : { error }),
      ...(this.book.isSynced ? { updateId: this.book.updateId } : {}),
    };
    for (const listener of this.listeners) listener(this.state);
  }
}

