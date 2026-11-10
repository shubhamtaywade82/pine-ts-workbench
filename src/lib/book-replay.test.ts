import { describe, expect, test } from "bun:test";
import { replayBook, type BookReplaySnapshot } from "./book-replay";
import { LocalOrderBook, type DepthUpdate } from "./order-book";

const snapshot: BookReplaySnapshot = {
  lastUpdateId: 100,
  bids: [["99", "2"], ["98", "1"]],
  asks: [["101", "3"]],
  limit: 1_000,
};

const update = (U: number, u: number, b: [string, string][] = [], a: [string, string][] = []): DepthUpdate =>
  ({ U, u, b, a });

const levels = (book: LocalOrderBook, side: "bid" | "ask") => [...book.levels(side)];

describe("replayBook", () => {
  test("a snapshot plus the same events matches a book fed live", () => {
    const first = update(101, 101, [["99", "0"], ["98.5", "4"]]);
    const second = update(102, 103, [], [["102", "7"]]);
    const live = new LocalOrderBook();
    live.applySnapshot(snapshot, snapshot.limit ?? 1_000);
    live.push(first);
    live.push(second);

    const replayed = replayBook(snapshot, [
      { kind: "depth", update: first },
      { kind: "trade" },
      { kind: "depth", update: second },
    ]);

    expect(replayed.gaps).toEqual([]);
    expect(levels(replayed.book, "bid")).toEqual(levels(live, "bid"));
    expect(levels(replayed.book, "ask")).toEqual(levels(live, "ask"));
    expect(replayed.book.updateId).toBe(live.updateId);
  });

  test("an explicit gap stops replay and is reported", () => {
    const first = update(101, 101, [["99", "5"]]);
    const after = update(102, 102, [["97", "1"]]);
    const replayed = replayBook(snapshot, [
      { kind: "depth", update: first },
      { kind: "gap" },
      { kind: "depth", update: after },
    ]);

    expect(replayed.gaps).toEqual([{ kind: "gap" }]);
    expect(replayed.book.updateId).toBe(101);
    expect(levels(replayed.book, "bid")).toEqual([[99, 5], [98, 1]]);
  });

  test("a depth event that does not continue the sequence stops replay without discarding the book", () => {
    const hole = update(105, 106, [["97", "1"]]);
    const replayed = replayBook(snapshot, [{ kind: "depth", update: hole }]);
    expect(replayed.gaps).toEqual([{ kind: "depth", update: hole }]);
    expect(replayed.book.updateId).toBe(snapshot.lastUpdateId);
    expect(levels(replayed.book, "bid")).toEqual([[99, 2], [98, 1]]);
  });
});
