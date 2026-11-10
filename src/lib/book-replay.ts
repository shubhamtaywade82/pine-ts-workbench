import { LocalOrderBook, type DepthSnapshot, type DepthUpdate } from "./order-book";

export interface BookReplaySnapshot {
  readonly lastUpdateId: number;
  readonly bids: readonly (readonly [string, string])[];
  readonly asks: readonly (readonly [string, string])[];
  /** Same limit the live book used, so coverage is computed the same way. */
  readonly limit?: number;
}

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
  book.applySnapshot(toSnapshot(snapshot), limit);
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
