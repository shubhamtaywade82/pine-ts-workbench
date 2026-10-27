import { describe, expect, test } from "bun:test";
import { bubbleRadius, decayedReference, DEFAULT_WALL_OPTIONS, wallOptionsFor, WallTracker, type BookView } from "./depth-walls";

const FULL = { bidFloor: 0, askCeiling: Number.POSITIVE_INFINITY };

const book = (
  bids: Array<[number, number]>,
  asks: Array<[number, number]>,
  coverage = FULL,
): BookView => ({
  bestBid: bids[0]?.[0],
  bestAsk: asks[0]?.[0],
  coverage,
  levels: (side) => (side === "bid" ? bids : asks),
});

const tracker = (windowPct = 5, minNotional = 0) => new WallTracker(wallOptionsFor(windowPct, minNotional));

describe("WallTracker: which level is the wall", () => {
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

  test("returns nothing without both sides of the book", () => {
    expect(tracker().update(book([[100, 1]], []), 0)).toBeUndefined();
  });
});

describe("WallTracker: detection window", () => {
  test("ignores levels outside the configured window around mid", () => {
    // mid 100.5, ±1% → bids >= 99.495.
    const frame = tracker(1).update(book([[100, 1], [99, 50]], [[101, 1]]), 0);
    expect(frame?.bid?.price).toBe(100);
    expect(frame?.searchedPct).toBeCloseTo(1, 9);
    expect(frame?.clippedByCoverage).toBe(false);
  });

  test("a level just inside the window counts and one just outside does not", () => {
    // mid 100.5, ±1% → bids >= 99.495.
    const inside = tracker(1).update(book([[100, 1], [99.6, 50]], [[101, 1]]), 0);
    expect(inside?.bid?.price).toBe(99.6);
    const outside = tracker(1).update(book([[100, 1], [99.4, 50]], [[101, 1]]), 0);
    expect(outside?.bid?.price).toBe(100);
  });
});

describe("WallTracker: verified snapshot coverage", () => {
  // Snapshot covers 99.2..100.8 around mid 100.5 (≈1.3% below, 0.3% above).
  const covered = { bidFloor: 99.2, askCeiling: 100.8 };

  test("never reads a level outside coverage, even when the window is wider", () => {
    // Window ±2% would reach 98.49, but only 99.2 is known.
    const frame = tracker(2).update(book([[100, 1], [99.1, 1000]], [[101, 1]], covered), 0);
    expect(frame?.bid?.price).toBe(100);
  });

  test("includes a level exactly at the coverage floor", () => {
    const frame = tracker(2).update(book([[100, 1], [99.2, 50]], [[101, 1]], covered), 0);
    expect(frame?.bid?.price).toBe(99.2);
  });

  test("reports the window actually searched and that coverage clipped it", () => {
    const frame = tracker(2).update(book([[100, 1]], [[101, 1]], covered), 0);
    // Ask side is the tighter edge: (100.8 - 100.5) / 100.5.
    expect(frame?.searchedPct).toBeCloseTo((0.3 / 100.5) * 100, 9);
    expect(frame?.clippedByCoverage).toBe(true);
  });

  test("a window inside coverage is not clipped", () => {
    const frame = tracker(0.2).update(book([[100, 1]], [[101, 1]], covered), 0);
    expect(frame?.searchedPct).toBeCloseTo(0.2, 9);
    expect(frame?.clippedByCoverage).toBe(false);
  });

  test("widening the window never reaches outside coverage", () => {
    const walls = tracker(0.2);
    walls.update(book([[100, 1], [99.1, 1000]], [[101, 1]], covered), 0);
    walls.setOptions(wallOptionsFor(5, 0));
    const frame = walls.update(book([[100, 1], [99.1, 1000]], [[101, 1]], covered), 1);
    expect(frame?.bid?.price).toBe(100);
    expect(frame?.clippedByCoverage).toBe(true);
  });
});

describe("WallTracker: minimum notional", () => {
  test("compares notional in quote currency, not base quantity", () => {
    // 0.5 BTC at 80,000 = 40,000 USDT. The threshold is in USDT, so 1,000 passes
    // and 100,000 does not, although 0.5 base units would be below both.
    const passes = tracker(5, 1_000).update(book([[80_000, 0.5]], [[80_100, 1]]), 0);
    expect(passes?.bid?.price).toBe(80_000);
    const fails = tracker(5, 100_000).update(book([[80_000, 0.5]], [[80_100, 1]]), 0);
    expect(fails?.bid).toBeUndefined();
  });

  test("a wall that drops below the minimum is no longer reported", () => {
    const walls = tracker(5, 500);
    walls.update(book([[100, 10]], [[101, 1]]), 0);
    expect(walls.update(book([[100, 4]], [[101, 1]]), 1)?.bid).toBeUndefined();
  });
});

describe("WallTracker: observation time", () => {
  test("tracks liquidity dynamics as size evolves at the same price", () => {
    const walls = tracker();
    // Initial wall: 10 units at 99 (notional = 990)
    const initial = walls.update(book([[100, 1], [99, 10]], [[101, 1]]), 1_000);
    expect(initial?.bid?.status).toBe("holding");

    // Partial absorption: size shrinks to 6 units (-40%)
    const absorbed = walls.update(book([[100, 1], [99, 6]], [[101, 1]]), 2_000);
    expect(absorbed?.bid?.status).toBe("absorbing");
    expect(absorbed?.bid?.changePct).toBeCloseTo(-40, 1);

    // Stacking: size expands to 15 units (+50% from initial)
    const stacked = walls.update(book([[100, 1], [99, 15]], [[101, 1]]), 3_000);
    expect(stacked?.bid?.status).toBe("stacking");
    expect(stacked?.bid?.changePct).toBeCloseTo(50, 1);
  });

  test("hysteresis keeps the incumbent unless a challenger beats it by the margin", () => {
    const walls = tracker();
    walls.update(book([[100, 1], [99, 10]], [[101, 1]]), 1_000);
    // 98 × 11 = 1078: ~9% bigger, under the 15% margin.
    expect(walls.update(book([[100, 1], [99, 10], [98, 11]], [[101, 1]]), 2_000)?.bid?.price).toBe(99);
    // 98 × 12 = 1176: ~19% bigger.
    const switched = walls.update(book([[100, 1], [99, 10], [98, 12]], [[101, 1]]), 3_000);
    expect(switched?.bid).toMatchObject({ price: 98, observedSince: 3_000 });
  });

  test("switches at once when the incumbent is pulled, and the new level starts observed now", () => {
    const walls = tracker();
    walls.update(book([[100, 1], [99, 10]], [[101, 1]]), 1_000);
    expect(walls.update(book([[100, 1], [98, 2]], [[101, 1]]), 2_000)?.bid).toMatchObject({ price: 98, observedSince: 2_000 });
  });

  test("a wall that disappears and returns is observed from its return, not from before", () => {
    const walls = tracker();
    walls.update(book([[100, 1], [99, 10]], [[101, 1]]), 1_000);
    walls.update(book([[100, 1]], [[101, 1]]), 2_000); // pulled
    const back = walls.update(book([[100, 1], [99, 10]], [[101, 1]]), 9_000);
    expect(back?.bid).toMatchObject({ price: 99, observedSince: 9_000 });
  });

  test("reset breaks continuity: the same level seen again starts a new observation", () => {
    const walls = tracker();
    walls.update(book([[100, 1], [99, 10]], [[101, 1]]), 1_000);
    walls.reset();
    expect(walls.update(book([[100, 1], [99, 10]], [[101, 1]]), 5_000)?.bid?.observedSince).toBe(5_000);
  });

  test("setOptions applies a narrower window to the next update", () => {
    const walls = tracker(5);
    expect(walls.update(book([[100, 1], [99, 10]], [[101, 1]]), 1_000)?.bid?.price).toBe(99);
    walls.setOptions(wallOptionsFor(0.1, 0));
    // 99 is 1.5% from mid, outside ±0.1%.
    expect(walls.update(book([[100, 1], [99, 10]], [[101, 1]]), 2_000)?.bid).toBeUndefined();
  });

  test("the default options are a 0.5% window with no minimum", () => {
    expect(DEFAULT_WALL_OPTIONS).toMatchObject({ windowPct: 0.5, minNotional: 0 });
  });
});

describe("bubbleRadius and decayedReference", () => {
  const range = { min: 5, max: 25 };

  test("maps notional onto a bounded square-root scale", () => {
    expect(bubbleRadius(0, 1_000, range)).toBe(5);
    expect(bubbleRadius(250, 1_000, range)).toBe(15);
    expect(bubbleRadius(1_000, 1_000, range)).toBe(25);
  });

  test("never exceeds the maximum, and uses the minimum without a reference", () => {
    expect(bubbleRadius(5_000, 1_000, range)).toBe(25);
    expect(bubbleRadius(100, 0, range)).toBe(5);
  });

  test("follows a new peak at once, and halves an old one per half-life", () => {
    expect(decayedReference(100, 300, 1_000, 60_000)).toBe(300);
    expect(decayedReference(400, 100, 60_000, 60_000)).toBe(200);
  });
});
