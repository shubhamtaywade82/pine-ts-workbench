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
}

type EventInput = Omit<MarketEventRow, "exchangeTime" | "schemaVersion"> & {
  readonly exchangeTime?: number | null;
  readonly schemaVersion?: number;
};

const DEFAULT_MAX_PENDING = 10_000;
const SCHEMA_VERSION = 1;

const eventKey = (row: Pick<MarketEventRow, "symbol" | "kind" | "seq">): string =>
  `${row.symbol}\0${row.kind}\0${row.seq}`;

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
  private cancelTimer: (() => void) | undefined;
  private tail: Promise<void> = Promise.resolve();
  private failure: unknown;
  private dropped = 0;

  public constructor(
    private readonly store: MarketStore,
    options: MarketRecorderOptions,
  ) {
    this.maxBatch = options.maxBatch;
    this.maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;
    const schedule = options.schedule ?? defaultSchedule;
    this.cancelTimer = schedule(() => { void this.flush(); }, options.batchIntervalMs);
  }

  public get droppedCount(): number {
    return this.dropped;
  }

  public get lastError(): unknown {
    return this.failure;
  }

  public recordEvent(input: EventInput): void {
    const row = normalizeEvent(input);
    if (this.events.some((existing) => eventKey(existing) === eventKey(row))) return;
    this.events.push(row);
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

  public flush(): Promise<void> {
    const run = this.tail.then(() => this.writeAll());
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  public stop(): Promise<void> {
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
    while (this.pending() > this.maxPending) {
      this.dropOldest();
      this.dropped += 1;
    }
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

  private async writeAll(): Promise<void> {
    const eventError = await this.writeRows(this.events, (rows) => this.store.insertEvents(rows));
    const snapshotError = await this.writeRows(this.snapshots, (rows) => this.store.insertSnapshots(rows));
    const transitionError = await this.writeRows(this.transitions, (rows) => this.store.insertTransitions(rows));
    this.failure = eventError ?? snapshotError ?? transitionError;
  }

  private async writeRows<T>(queue: T[], insert: (rows: readonly T[]) => Promise<void>): Promise<unknown> {
    const rows = queue.splice(0, this.maxBatch);
    if (rows.length === 0) return undefined;
    try {
      await insert(rows);
      return undefined;
    } catch (error) {
      queue.unshift(...rows);
      this.trim();
      return error;
    }
  }
}
