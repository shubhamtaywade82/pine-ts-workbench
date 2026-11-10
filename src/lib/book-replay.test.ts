import { describe, expect, test } from "bun:test";
import {
  parseCoverage,
  replayBook,
  serializeCoverage,
  snapshotFromRow,
  type BookReplaySnapshot,
} from "./book-replay";
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

  test("restores stored coverage instead of the range implied by level counts", () => {
    const full = replayBook({
      ...snapshot,
      limit: 1,
      coverage: { bidFloor: 0, askCeiling: Number.POSITIVE_INFINITY },
    }, []);
    expect(full.book.coverage).toEqual({ bidFloor: 0, askCeiling: Number.POSITIVE_INFINITY });

    const clipped = replayBook({
      ...snapshot,
      limit: 1,
      coverage: { bidFloor: 97, askCeiling: 103 },
    }, []);
    expect(clipped.book.coverage).toEqual({ bidFloor: 97, askCeiling: 103 });
  });
});

describe("coverage text", () => {
  test("round-trips a finite window and an infinite ask ceiling", () => {
    const full = { bidFloor: 0, askCeiling: Number.POSITIVE_INFINITY };
    const clipped = { bidFloor: 90.5, askCeiling: 110 };
    expect(serializeCoverage(full)).toBe('{"bidFloor":0,"askCeiling":null}');
    expect(serializeCoverage(full)).not.toContain("Infinity");
    expect(parseCoverage(serializeCoverage(full))).toEqual(full);
    expect(parseCoverage(serializeCoverage(clipped))).toEqual(clipped);
  });

  test("reads a missing bid floor as 0 and a null ask ceiling as infinity", () => {
    expect(parseCoverage('{"askCeiling":null}')).toEqual({
      bidFloor: 0,
      askCeiling: Number.POSITIVE_INFINITY,
    });
    expect(parseCoverage("{}")).toEqual({ bidFloor: 0, askCeiling: Number.POSITIVE_INFINITY });
  });
});

describe("snapshotFromRow", () => {
  test("parses stored JSON strings and feeds replayBook correctly", () => {
    const row = {
      id: 1,
      symbol: "BTCUSDT",
      capturedAt: 10_000,
      lastUpdateId: BigInt(100),
      bids: JSON.stringify([["99", "2"], ["98", "1"]]),
      asks: JSON.stringify([["101", "3"]]),
      coverage: '{"bidFloor":0,"askCeiling":null}',
    };
    const parsed = snapshotFromRow(row);
    expect(parsed.id).toBe(1);
    expect(parsed.lastUpdateId).toBe(100);
    expect(parsed.bids).toEqual([["99", "2"], ["98", "1"]]);
    expect(parsed.asks).toEqual([["101", "3"]]);
    expect(parsed.coverage).toEqual({ bidFloor: 0, askCeiling: Number.POSITIVE_INFINITY });

    const updateEvent: DepthUpdate = { U: 101, u: 101, b: [["99", "5"]], a: [] };
    const replayed = replayBook(parsed, [{ kind: "depth", update: updateEvent }]);
    expect(replayed.gaps).toEqual([]);
    expect(replayed.book.updateId).toBe(101);
    expect(levels(replayed.book, "bid")).toEqual([[99, 5], [98, 1]]);
    expect(levels(replayed.book, "ask")).toEqual([[101, 3]]);
  });

  test("rejects malformed level strings", () => {
    const row = {
      symbol: "BTCUSDT",
      capturedAt: 10_000,
      lastUpdateId: 100,
      bids: JSON.stringify([["bad", "1"]]),
      asks: "[]",
      coverage: "{}",
    };
    expect(() => snapshotFromRow(row)).toThrow();
  });
});
