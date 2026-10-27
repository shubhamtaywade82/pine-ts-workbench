/**
 * Local Binance Spot order book, kept in sync per Binance's "How to manage a
 * local order book correctly" (web-socket-streams.md):
 *
 * 1. Buffer `<symbol>@depth` events; 2. fetch a REST `/api/v3/depth` snapshot;
 * 3. drop buffered events with `u <= lastUpdateId`; 4. apply the rest in
 * order, each continuing the previous (`U <= updateId + 1`); a hole in the
 * sequence means events were missed: discard the book and resync. A level
 * with quantity 0 is removed.
 *
 * Pure state, no I/O: the feed owns the socket and the snapshot request.
 */

/** REST `GET /api/v3/depth` response (prices and quantities are decimal strings). */
export interface DepthSnapshot {
  readonly lastUpdateId: number;
  readonly bids: readonly (readonly [string, string])[];
  readonly asks: readonly (readonly [string, string])[];
}

/** `depthUpdate` stream event, Binance field names: first/final update id, bid/ask changes. */
export interface DepthUpdate {
  readonly U: number;
  readonly u: number;
  readonly b: readonly (readonly [string, string])[];
  readonly a: readonly (readonly [string, string])[];
}

export type BookSide = "bid" | "ask";

export type PushResult = "buffered" | "applied" | "stale" | "gap";
export type SnapshotResult = "synced" | "snapshot-too-old" | "gap";

/**
 * Prices between which the book is complete. A snapshot side returned at the
 * request limit may continue past its last level; levels beyond it are unknown
 * until they change, so nothing outside this range can be trusted.
 */
export interface BookCoverage {
  readonly bidFloor: number;
  readonly askCeiling: number;
}

const FULL_COVERAGE: BookCoverage = { bidFloor: 0, askCeiling: Number.POSITIVE_INFINITY };
// ~100s of 100ms events; a snapshot slower than that is retried anyway.
const DEFAULT_MAX_BUFFERED_EVENTS = 1_000;

export class LocalOrderBook {
  private readonly bids = new Map<number, number>();
  private readonly asks = new Map<number, number>();
  private buffer: DepthUpdate[] = [];
  private synced = false;
  private lastId = -1;
  private covered: BookCoverage = FULL_COVERAGE;
  private readonly maxBufferedEvents: number;

  public constructor(options: { readonly maxBufferedEvents?: number } = {}) {
    this.maxBufferedEvents = options.maxBufferedEvents ?? DEFAULT_MAX_BUFFERED_EVENTS;
  }

  public get isSynced(): boolean {
    return this.synced;
  }

  /** Update id of the last applied event (or of the snapshot). */
  public get updateId(): number {
    return this.lastId;
  }

  public get coverage(): BookCoverage {
    return this.covered;
  }

  public get bestBid(): number | undefined {
    return this.best("bid");
  }

  public get bestAsk(): number | undefined {
    return this.best("ask");
  }

  /** A stream event: buffered until synced, then applied in sequence. On a gap the book resets and buffers it. */
  public push(event: DepthUpdate): PushResult {
    if (!this.synced) {
      this.buffer.push(event);
      // Dropping the oldest keeps the buffer contiguous; the next snapshot just has to be newer.
      if (this.buffer.length > this.maxBufferedEvents) this.buffer.shift();
      return "buffered";
    }
    const result = this.apply(event);
    if (result === "gap") {
      this.reset();
      this.buffer.push(event);
    }
    return result;
  }

  /**
   * Initializes from a REST snapshot of up to `requestedLimit` levels per side
   * and replays the buffered events. `snapshot-too-old`: the buffer starts
   * after it, fetch another. `gap`: the buffer itself is missing events.
   */
  public applySnapshot(snapshot: DepthSnapshot, requestedLimit: number): SnapshotResult {
    const first = this.buffer[0];
    if (first !== undefined && snapshot.lastUpdateId + 1 < first.U) return "snapshot-too-old";

    this.bids.clear();
    this.asks.clear();
    setLevels(this.bids, snapshot.bids);
    setLevels(this.asks, snapshot.asks);
    this.covered = {
      bidFloor: snapshot.bids.length >= requestedLimit ? Math.min(...this.bids.keys()) : 0,
      askCeiling: snapshot.asks.length >= requestedLimit ? Math.max(...this.asks.keys()) : Number.POSITIVE_INFINITY,
    };
    this.lastId = snapshot.lastUpdateId;
    this.synced = true;

    const buffered = this.buffer;
    this.buffer = [];
    for (const event of buffered) {
      if (this.apply(event) === "gap") {
        this.reset();
        return "gap";
      }
    }
    return "synced";
  }

  /** Discards the book; events are buffered until the next snapshot. */
  public reset(): void {
    this.bids.clear();
    this.asks.clear();
    this.buffer = [];
    this.synced = false;
    this.lastId = -1;
    this.covered = FULL_COVERAGE;
  }

  /** Levels as `[price, quantity]`, best first: bids high→low, asks low→high. */
  public levels(side: BookSide): Array<[number, number]> {
    const entries = [...(side === "bid" ? this.bids : this.asks)];
    return entries.sort(side === "bid" ? (x, y) => y[0] - x[0] : (x, y) => x[0] - y[0]);
  }

  private apply(event: DepthUpdate): Exclude<PushResult, "buffered"> {
    if (event.u <= this.lastId) return "stale";
    if (event.U > this.lastId + 1) return "gap";
    setLevels(this.bids, event.b);
    setLevels(this.asks, event.a);
    this.lastId = event.u;
    return "applied";
  }

  private best(side: BookSide): number | undefined {
    const prices = [...(side === "bid" ? this.bids : this.asks).keys()];
    if (prices.length === 0) return undefined;
    return side === "bid" ? Math.max(...prices) : Math.min(...prices);
  }
}

const setLevels = (book: Map<number, number>, changes: readonly (readonly [string, string])[]): void => {
  for (const [priceText, quantityText] of changes) {
    const price = Number(priceText);
    const quantity = Number(quantityText);
    if (quantity === 0) book.delete(price);
    else book.set(price, quantity);
  }
};
