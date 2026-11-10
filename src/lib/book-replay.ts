import { LocalOrderBook, type BookCoverage, type DepthSnapshot, type DepthUpdate } from "./order-book";

export interface BookReplaySnapshot {
  readonly lastUpdateId: number;
  readonly bids: readonly (readonly [string, string])[];
  readonly asks: readonly (readonly [string, string])[];
  /** Used only when `coverage` was not stored with the snapshot. */
  readonly limit?: number;
  readonly coverage?: BookCoverage;
}

interface CoverageText {
  readonly bidFloor?: unknown;
  readonly askCeiling?: unknown;
}

// JSON.stringify turns Infinity into null, so an open ask side is stored as null on purpose.
export const serializeCoverage = (coverage: BookCoverage): string => JSON.stringify({
  bidFloor: coverage.bidFloor,
  askCeiling: Number.isFinite(coverage.askCeiling) ? coverage.askCeiling : null,
});

export const parseCoverage = (text: string): BookCoverage => {
  const parsed = JSON.parse(text) as CoverageText;
  const bidFloor = typeof parsed.bidFloor === "number" ? parsed.bidFloor : 0;
  const askCeiling = typeof parsed.askCeiling === "number" ? parsed.askCeiling : Number.POSITIVE_INFINITY;
  return { bidFloor, askCeiling };
};

export interface SnapshotRowInput {
  readonly id?: number;
  readonly symbol: string;
  readonly capturedAt: number;
  readonly lastUpdateId: number | bigint;
  readonly bids: string;
  readonly asks: string;
  readonly coverage: string;
}

export interface ParsedBookSnapshot extends BookReplaySnapshot {
  readonly id?: number;
  readonly symbol: string;
  readonly capturedAt: number;
  readonly lastUpdateId: number;
  readonly bids: readonly (readonly [string, string])[];
  readonly asks: readonly (readonly [string, string])[];
  readonly coverage: BookCoverage;
}

const isLevelPair = (value: unknown): value is readonly [string, string] => {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const [price, qty] = value;
  if (typeof price !== "string" || typeof qty !== "string") return false;
  const p = Number(price);
  const q = Number(qty);
  return Number.isFinite(p) && p >= 0 && Number.isFinite(q) && q >= 0;
};

const parseLevels = (raw: string, side: string): readonly (readonly [string, string])[] => {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || !parsed.every(isLevelPair)) {
    throw new Error(`Invalid ${side} levels in snapshot`);
  }
  return parsed;
};

export const snapshotFromRow = (row: SnapshotRowInput): ParsedBookSnapshot => ({
  id: row.id,
  symbol: row.symbol,
  capturedAt: row.capturedAt,
  lastUpdateId: Number(row.lastUpdateId),
  bids: parseLevels(row.bids, "bid"),
  asks: parseLevels(row.asks, "ask"),
  coverage: parseCoverage(row.coverage),
});

export type BookReplayEvent =
  | { readonly kind: "depth"; readonly update: DepthUpdate }
  | { readonly kind: "gap" }
  | { readonly kind: "trade" };

export interface BookReplayResult {
  readonly book: LocalOrderBook;
  readonly gaps: readonly BookReplayEvent[];
}

const toSnapshot = (snapshot: BookReplaySnapshot): DepthSnapshot => ({
  lastUpdateId: snapshot.lastUpdateId,
  bids: snapshot.bids,
  asks: snapshot.asks,
});

/** A stale or contiguous update can be pushed. A hole must stop the replay instead. */
const canPush = (book: LocalOrderBook, update: DepthUpdate): boolean => {
  if (!book.isSynced) return true;
  if (update.u <= book.updateId) return true;
  return update.U <= book.updateId + 1;
};

/**
 * Rebuilds a book from a snapshot and the events that followed it.
 * Stops at the first gap so later events are not applied across a hole.
 */
export const replayBook = (
  snapshot: BookReplaySnapshot,
  events: readonly BookReplayEvent[],
): BookReplayResult => {
  const book = new LocalOrderBook();
  const limit = snapshot.limit ?? Math.max(snapshot.bids.length, snapshot.asks.length, 1);
  book.applySnapshot(toSnapshot(snapshot), limit, snapshot.coverage);
  const gaps: BookReplayEvent[] = [];
  for (const event of events) {
    if (event.kind === "trade") continue;
    if (event.kind === "gap" || !canPush(book, event.update)) {
      gaps.push(event);
      break;
    }
    book.push(event.update);
  }
  return { book, gaps };
};
