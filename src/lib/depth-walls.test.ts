import { describe, expect, test } from "bun:test";
import { bubbleRadius, decayedReference, WallTracker, type BookView } from "./depth-walls";

const book = (
  bids: Array<[number, number]>,
  asks: Array<[number, number]>,
  coverage = { bidFloor: 0, askCeiling: Number.POSITIVE_INFINITY },
): BookView => ({
  bestBid: bids[0]?.[0],
  bestAsk: asks[0]?.[0],
  coverage,
  levels: (side) => (side === "bid" ? bids : asks),
});

const tracker = (options: Partial<ConstructorParameters<typeof WallTracker>[0]> = {}) =>
  new WallTracker({ maxDistancePct: 5, minNotional: 0, switchMarginPct: 15, ...options });

describe("WallTracker", () => {
  test("picks the largest notional level, which need not be the best bid/ask", () => {
    const frame = tracker().update(book([[100, 1], [99, 3], [98, 2.5]], [[101, 1], [102, 4]]), 0);
    expect(frame?.mid).toBe(100.5);
    expect(frame?.bid).toMatchObject({ side: "bid", price: 99, quantity: 3, notional: 297 });
    expect(frame?.ask).toMatchObject({ side: "ask", price: 102, quantity: 4, notional: 408 });
  });

  test("compares quote notional, not base quantity", () => {
    // 2 @ 101 = 202 < 1.99 @ 102 = 202.98.
    const frame = tracker().update(book([[100, 1]], [[101, 2], [102, 1.99]]), 0);
    expect(frame?.ask?.price).toBe(102);
  });

  test("ignores levels outside the distance window around mid", () => {
    // mid 100.5, ±1% → bids >= 99.495.
    const frame = tracker({ maxDistancePct: 1 }).update(book([[100, 1], [99, 50]], [[101, 1]]), 0);
    expect(frame?.bid?.price).toBe(100);
  });

  test("ignores levels beyond the snapshot coverage and flags the clipped window", () => {
    const frame = tracker().update(
      book([[100, 1], [96, 50]], [[101, 1], [104, 50]], { bidFloor: 97, askCeiling: 103 }),
      0,
    );
    expect(frame?.bid?.price).toBe(100);
    expect(frame?.ask?.price).toBe(101);
    expect(frame?.windowExceedsCoverage).toBe(true);
  });

  test("reports no wall below the minimum notional", () => {
    const frame = tracker({ minNotional: 1_000 }).update(book([[100, 1]], [[101, 1]]), 0);
    expect(frame?.bid).toBeUndefined();
    expect(frame?.ask).toBeUndefined();
  });

  test("returns nothing without both sides of the book", () => {
    expect(tracker().update(book([[100, 1]], []), 0)).toBeUndefined();
  });

  test("keeps the current wall until a challenger beats it by the switch margin", () => {
    const walls = tracker();
    walls.update(book([[100, 1], [99, 10]], [[101, 1]]), 1_000); // wall 99: 990
    // 98 × 11 = 1078: only ~9% bigger.
    expect(walls.update(book([[100, 1], [99, 10], [98, 11]], [[101, 1]]), 2_000)?.bid?.price).toBe(99);
    // 98 × 12 = 1176: ~19% bigger.
    const switched = walls.update(book([[100, 1], [99, 10], [98, 12]], [[101, 1]]), 3_000);
    expect(switched?.bid?.price).toBe(98);
    expect(switched?.bid?.since).toBe(3_000);
  });

  test("switches at once when the current wall is pulled", () => {
    const walls = tracker();
    walls.update(book([[100, 1], [99, 10]], [[101, 1]]), 1_000);
    expect(walls.update(book([[100, 1], [98, 2]], [[101, 1]]), 2_000)?.bid?.price).toBe(98);
  });

  test("keeps `since` while the wall stays at its price and its size changes", () => {
    const walls = tracker();
    walls.update(book([[100, 1], [99, 10]], [[101, 1]]), 1_000);
    const later = walls.update(book([[100, 1], [99, 6]], [[101, 1]]), 9_000);
    expect(later?.bid).toMatchObject({ price: 99, quantity: 6, since: 1_000 });
  });

  test("reset forgets the current walls", () => {
    const walls = tracker();
    walls.update(book([[100, 1], [99, 10]], [[101, 1]]), 1_000);
    walls.reset();
    expect(walls.update(book([[100, 1], [99, 10]], [[101, 1]]), 5_000)?.bid?.since).toBe(5_000);
  });
});

describe("bubbleRadius", () => {
  const range = { min: 5, max: 25 };

  test("maps notional onto a bounded square-root scale", () => {
    expect(bubbleRadius(0, 1_000, range)).toBe(5);
    expect(bubbleRadius(250, 1_000, range)).toBe(15);
    expect(bubbleRadius(1_000, 1_000, range)).toBe(25);
  });

  test("never exceeds the maximum, even above the reference", () => {
    expect(bubbleRadius(5_000, 1_000, range)).toBe(25);
  });

  test("uses the minimum without a positive reference", () => {
    expect(bubbleRadius(100, 0, range)).toBe(5);
  });
});

describe("decayedReference", () => {
  test("follows a new peak immediately", () => {
    expect(decayedReference(100, 300, 1_000, 60_000)).toBe(300);
  });

  test("halves an old peak per half-life", () => {
    expect(decayedReference(400, 100, 60_000, 60_000)).toBe(200);
  });
});
