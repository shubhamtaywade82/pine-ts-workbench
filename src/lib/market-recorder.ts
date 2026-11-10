import { SYMBOL_CATALOG } from "./symbol-catalog";
import type { BinanceSymbol } from "./public-binance-feed";

export type MarketEventKind = "depth" | "trade" | "gap";

export interface MarketEventRow {
  readonly symbol: string;
  readonly kind: MarketEventKind;
  readonly seq: number;
  readonly exchangeTime: number | null;
  readonly receivedAt: number;
  readonly payload: string;
  readonly schemaVersion: number;
}

export interface BookSnapshotRow {
  readonly symbol: string;
  readonly capturedAt: number;
  readonly lastUpdateId: number;
  readonly bids: string;
  readonly asks: string;
  readonly coverage: string;
}

export interface WallTransitionRow {
  readonly wallId: string;
  readonly symbol: string;
  readonly side: string;
  readonly price: number;
  readonly kind: string;
  readonly notional: number;
  readonly at: number;
  readonly detectorVersion: string;
}

/** Insert methods ignore duplicate events (same symbol, kind, seq) and must not throw for them. */
export interface MarketStore {
  insertEvents(rows: readonly MarketEventRow[]): Promise<void>;
  insertSnapshots(rows: readonly BookSnapshotRow[]): Promise<void>;
  insertTransitions(rows: readonly WallTransitionRow[]): Promise<void>;
}

export interface MarketRecorderOptions {
  readonly batchIntervalMs: number;
  readonly maxBatch: number;
  readonly maxPending?: number;
  readonly schedule?: (run: () => void, delayMs: number) => () => void;
  readonly onDrop?: (total: number, pending: number) => void;
  readonly onWriteError?: (error: unknown, remaining: number, dropped: number) => void;
}

type EventInput = Omit<MarketEventRow, "exchangeTime" | "schemaVersion"> & {
  readonly exchangeTime?: number | null;
  readonly schemaVersion?: number;
};

const DEFAULT_MAX_PENDING = 10_000;
const SCHEMA_VERSION = 1;

// Number(null) is 0, so a missing query param must be rejected before coercion.
const milliseconds = (value: string | null): number | undefined => {
  if (value === null || value.trim() === "") return undefined;
  const time = Number(value);
  return Number.isFinite(time) ? time : undefined;
};

const normalizeEvent = (input: EventInput): MarketEventRow => ({
  symbol: input.symbol,
  kind: input.kind,
  seq: input.seq,
  exchangeTime: input.exchangeTime ?? null,
  receivedAt: input.receivedAt,
  payload: input.payload,
  schemaVersion: input.schemaVersion ?? SCHEMA_VERSION,
});

const defaultSchedule = (run: () => void, delayMs: number): (() => void) => {
  const timer = setInterval(run, delayMs);
  return () => clearInterval(timer);
};

// A per-process counter repeats after restart and the unique (symbol, kind, seq) key drops the new gap.
export const syntheticGapSeq = (nowMs: number, counter: number): number =>
  -(nowMs * 1000 + (counter % 1000));

export const isBinanceSymbol = (value: string): value is BinanceSymbol =>
  SYMBOL_CATALOG.some((row) => row.provider === "binance" && row.ticker === value);

export interface EventQuery {
  readonly symbol: BinanceSymbol;
  readonly from: number;
  readonly to: number;
}

export const parseEventQuery = (
  symbol: string | null,
  from: string | null,
  to: string | null,
): EventQuery | undefined => {
  if (symbol === null || !isBinanceSymbol(symbol)) return undefined;
  const start = milliseconds(from);
  const end = milliseconds(to);
  if (start === undefined || end === undefined || start > end) return undefined;
  return { symbol, from: start, to: end };
};

export type InteractionSide = "all" | "bid" | "ask";

export interface InteractionQuery extends EventQuery {
  readonly side: InteractionSide;
}

const interactionSide = (value: string | null): InteractionSide | undefined => {
  if (value === null || value.trim() === "" || value === "all") return "all";
  if (value === "bid" || value === "ask") return value;
  return undefined;
};

export const parseInteractionQuery = (
  symbol: string | null,
  from: string | null,
  to: string | null,
  side: string | null,
): InteractionQuery | undefined => {
  const range = parseEventQuery(symbol, from, to);
  const picked = interactionSide(side);
  if (range === undefined || picked === undefined) return undefined;
  return { ...range, side: picked };
};

export const parseSnapshotQuery = (
  symbol: string | null,
  at: string | null,
): { readonly symbol: BinanceSymbol; readonly at: number } | undefined => {
  if (symbol === null || !isBinanceSymbol(symbol)) return undefined;
  const time = milliseconds(at);
  if (time === undefined) return undefined;
  return { symbol, at: time };
};

export class MarketRecorder {
  private readonly events: MarketEventRow[] = [];
  private readonly snapshots: BookSnapshotRow[] = [];
  private readonly transitions: WallTransitionRow[] = [];
  private readonly maxBatch: number;
  private readonly maxPending: number;
  private readonly onDrop: MarketRecorderOptions["onDrop"];
  private readonly onWriteError: MarketRecorderOptions["onWriteError"];
  private cancelTimer: (() => void) | undefined;
  private tail: Promise<void> = Promise.resolve();
  private failure: unknown;
  private dropped = 0;
  private written = 0;
  // Flushes already queued behind a failed batch must not retry it immediately.
  private skipQueued = false;

  public constructor(
    private readonly store: MarketStore,
    options: MarketRecorderOptions,
  ) {
    this.maxBatch = options.maxBatch;
    this.maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;
    this.onDrop = options.onDrop;
    this.onWriteError = options.onWriteError;
    const schedule = options.schedule ?? defaultSchedule;
    this.cancelTimer = schedule(() => { void this.flush(); }, options.batchIntervalMs);
  }

  public get droppedCount(): number {
    return this.dropped;
  }

  public get writtenCount(): number {
    return this.written;
  }

  public get lastError(): unknown {
    return this.failure;
  }

  public recordEvent(input: EventInput): void {
    this.events.push(normalizeEvent(input));
    this.afterRecord();
  }

  public recordSnapshot(row: BookSnapshotRow): void {
    this.snapshots.push(row);
    this.afterRecord();
  }

  public recordTransition(row: WallTransitionRow): void {
    this.transitions.push(row);
    this.afterRecord();
  }

  public flush(): Promise<number> {
    this.skipQueued = false;
    const run = this.tail.then(() => this.writeAll());
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  public stop(): Promise<number> {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    return this.flush();
  }

  private afterRecord(): void {
    this.trim();
    if (this.pending() >= this.maxBatch) void this.flush();
  }

  private pending(): number {
    return this.events.length + this.snapshots.length + this.transitions.length;
  }

  private trim(): void {
    let droppedNow = 0;
    while (this.pending() > this.maxPending) {
      this.dropOldest();
      droppedNow += 1;
    }
    if (droppedNow === 0) return;
    this.dropped += droppedNow;
    this.onDrop?.(this.dropped, this.pending());
  }

  private dropOldest(): void {
    if (this.events.length > 0) {
      this.events.shift();
      return;
    }
    if (this.snapshots.length > 0) {
      this.snapshots.shift();
      return;
    }
    this.transitions.shift();
  }

  private async writeAll(): Promise<number> {
    if (this.skipQueued) return this.pending();
    const error = await this.firstError();
    this.failure = error;
    this.skipQueued = error !== undefined;
    return this.pending();
  }

  private async firstError(): Promise<unknown> {
    const eventError = await this.drain(this.events, (rows) => this.store.insertEvents(rows));
    if (eventError !== undefined) return eventError;
    const snapshotError = await this.drain(this.snapshots, (rows) => this.store.insertSnapshots(rows));
    if (snapshotError !== undefined) return snapshotError;
    return this.drain(this.transitions, (rows) => this.store.insertTransitions(rows));
  }

  private async drain<T>(queue: T[], insert: (rows: readonly T[]) => Promise<void>): Promise<unknown> {
    while (queue.length > 0) {
      const error = await this.sendBatch(queue, insert);
      if (error !== undefined) return error;
    }
    return undefined;
  }

  private async sendBatch<T>(queue: T[], insert: (rows: readonly T[]) => Promise<void>): Promise<unknown> {
    const rows = queue.splice(0, this.maxBatch);
    try {
      await insert(rows);
      this.written += rows.length;
      return undefined;
    } catch (error) {
      queue.unshift(...rows);
      this.trim();
      this.onWriteError?.(error, this.pending(), this.dropped);
      return error;
    }
  }
}
