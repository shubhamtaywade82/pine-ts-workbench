import { describe, expect, test } from "bun:test";
import { LocalOrderBook, type DepthSnapshot, type DepthUpdate } from "./order-book";

const snapshot = (lastUpdateId: number, bids: [string, string][], asks: [string, string][]): DepthSnapshot =>
  ({ lastUpdateId, bids, asks });

const update = (U: number, u: number, b: [string, string][] = [], a: [string, string][] = []): DepthUpdate =>
  ({ U, u, b, a });

const levels = (book: LocalOrderBook, side: "bid" | "ask") => [...book.levels(side)];

describe("LocalOrderBook sync (Binance 'manage a local order book')", () => {
  test("buffers stream events until a snapshot arrives", () => {
    const book = new LocalOrderBook();
    expect(book.push(update(101, 102, [["99", "1"]]))).toBe("buffered");
    expect(book.isSynced).toBe(false);
    expect(levels(book, "bid")).toEqual([]);
  });

  test("drops buffered events already in the snapshot and applies the rest in order", () => {
    const book = new LocalOrderBook();
    book.push(update(95, 100, [["98", "9"]])); // u <= lastUpdateId: already in the snapshot
    book.push(update(101, 103, [["99", "5"]], [["101", "0"]]));
    book.push(update(104, 104, [], [["102", "7"]]));

    expect(book.applySnapshot(snapshot(100, [["99", "2"], ["98", "1"]], [["101", "3"], ["102", "4"]]), 1000)).toBe("synced");

    expect(book.isSynced).toBe(true);
    expect(book.updateId).toBe(104);
    expect(levels(book, "bid")).toEqual([[99, 5], [98, 1]]);
    expect(levels(book, "ask")).toEqual([[102, 7]]);
  });

  test("accepts a first event whose [U, u] range contains lastUpdateId + 1", () => {
    const book = new LocalOrderBook();
    book.push(update(98, 105, [["99", "6"]]));
    expect(book.applySnapshot(snapshot(100, [["99", "2"]], [["101", "3"]]), 1000)).toBe("synced");
    expect(levels(book, "bid")).toEqual([[99, 6]]);
  });

  test("asks for a newer snapshot when it is older than the first buffered event", () => {
    const book = new LocalOrderBook();
    book.push(update(150, 151));
    expect(book.applySnapshot(snapshot(100, [], []), 1000)).toBe("snapshot-too-old");
    expect(book.isSynced).toBe(false);
  });

  test("reports a gap between the snapshot and the first buffered event", () => {
    const book = new LocalOrderBook();
    book.push(update(90, 95)); // dropped as stale
    book.push(update(103, 104)); // 101..102 missing
    expect(book.applySnapshot(snapshot(100, [["99", "1"]], [["101", "1"]]), 1000)).toBe("gap");
    expect(book.isSynced).toBe(false);
  });

  test("applies live events in sequence and removes zero-quantity levels", () => {
    const book = new LocalOrderBook();
    book.applySnapshot(snapshot(100, [["99", "2"]], [["101", "3"]]), 1000);
    expect(book.push(update(101, 101, [["99", "0"], ["98.5", "4"]]))).toBe("applied");
    expect(levels(book, "bid")).toEqual([[98.5, 4]]);
    expect(book.push(update(100, 101))).toBe("stale");
  });

  test("discards the book on a sequence gap and starts buffering from the gap event", () => {
    const book = new LocalOrderBook();
    book.applySnapshot(snapshot(100, [["99", "2"]], [["101", "3"]]), 1000);
    expect(book.push(update(105, 106, [["97", "1"]]))).toBe("gap");
    expect(book.isSynced).toBe(false);
    expect(levels(book, "bid")).toEqual([]);

    // The gap event is the first buffered event of the resync.
    expect(book.applySnapshot(snapshot(104, [["99", "2"]], []), 1000)).toBe("synced");
    expect(levels(book, "bid")).toEqual([[99, 2], [97, 1]]);
  });

  test("orders bids high→low and asks low→high, with best prices", () => {
    const book = new LocalOrderBook();
    book.applySnapshot(snapshot(1, [["98", "1"], ["99", "1"]], [["102", "1"], ["101", "1"]]), 1000);
    expect(levels(book, "bid").map(([p]) => p)).toEqual([99, 98]);
    expect(levels(book, "ask").map(([p]) => p)).toEqual([101, 102]);
    expect(book.bestBid).toBe(99);
    expect(book.bestAsk).toBe(101);
  });

  test("records the price range the snapshot fully covers", () => {
    const full = new LocalOrderBook();
    full.applySnapshot(snapshot(1, [["99", "1"], ["98", "1"]], [["101", "1"], ["102", "1"]]), 2);
    // A side returned at the request limit may continue beyond it: only its range is known.
    expect(full.coverage).toEqual({ bidFloor: 98, askCeiling: 102 });

    const partial = new LocalOrderBook();
    partial.applySnapshot(snapshot(1, [["99", "1"]], [["101", "1"]]), 2);
    // Fewer levels than requested: the whole side is in the snapshot.
    expect(partial.coverage).toEqual({ bidFloor: 0, askCeiling: Number.POSITIVE_INFINITY });
  });

  test("bounds the pre-snapshot buffer so a stalled snapshot cannot grow memory forever", () => {
    const book = new LocalOrderBook({ maxBufferedEvents: 3 });
    for (let id = 1; id <= 10; id += 1) book.push(update(id, id));
    // Events 1..7 were dropped, so a snapshot at 5 can't be continued; a newer one can.
    expect(book.applySnapshot(snapshot(5, [], []), 1000)).toBe("snapshot-too-old");
    expect(book.applySnapshot(snapshot(8, [], []), 1000)).toBe("synced");
    expect(book.updateId).toBe(10);
  });

  test("continues from a snapshot whose next id is exactly the first buffered event", () => {
    const book = new LocalOrderBook();
    book.push(update(8, 9, [["99", "1"]]));
    expect(book.applySnapshot(snapshot(7, [], []), 1000)).toBe("synced");
    expect(book.updateId).toBe(9);
  });
});
