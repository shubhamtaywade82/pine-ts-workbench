import { describe, expect, test } from "bun:test";
import { bucketize, bucketizeWindow, priceBucketKey } from "./price-buckets";
import type { BookView } from "./depth-walls";

const options = { tickSize: 1, bucketTicks: 1, low: 90, high: 110 };

describe("bucketize", () => {
  test("aligns prices to integer tick buckets", () => {
    const buckets = bucketize(
      [[100, 1], [100.09, 2], [100.1, 4]],
      { tickSize: 0.01, bucketTicks: 10, low: 0, high: 200 },
    );
    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toMatchObject({ key: 1000, quantity: 3, notional: 100 * 1 + 100.09 * 2 });
    expect(buckets[0]?.priceFrom).toBeCloseTo(100);
    expect(buckets[0]?.priceTo).toBeCloseTo(100.1);
    expect(buckets[1]).toMatchObject({ key: 1001, quantity: 4, notional: 100.1 * 4 });
    expect(buckets[1]?.priceFrom).toBeCloseTo(100.1);
    expect(buckets[1]?.priceTo).toBeCloseTo(100.2);
  });

  test("sorts buckets by price even when levels arrive high first", () => {
    const buckets = bucketize([[110, 1], [90, 3]], options);
    expect(buckets.map((bucket) => bucket.priceFrom)).toEqual([90, 110]);
  });

  test("drops levels outside coverage and never keeps them as zero", () => {
    const buckets = bucketize([[89, 5], [90, 1], [100, 2], [110, 3], [111, 7]], options);
    expect(buckets.map((bucket) => bucket.quantity)).toEqual([1, 2, 3]);
    expect(buckets.some((bucket) => bucket.quantity === 0)).toBe(false);
  });

  test("returns nothing for an empty book", () => {
    expect(bucketize([], options)).toEqual([]);
  });

  test("puts 0.1 + 0.2 in the 0.3 bucket", () => {
    const price = 0.1 + 0.2;
    const buckets = bucketize(
      [[price, 5], [0.3, 1], [0.1, 4], [0.2, 4]],
      { tickSize: 0.1, bucketTicks: 1, low: 0, high: 1 },
    );
    expect(buckets).toHaveLength(3);
    expect(buckets[0]?.priceFrom).toBeCloseTo(0.1);
    expect(buckets[0]?.quantity).toBe(4);
    expect(buckets[1]?.priceFrom).toBeCloseTo(0.2);
    expect(buckets[1]?.quantity).toBe(4);
    expect(buckets[2]?.priceFrom).toBeCloseTo(0.3);
    expect(buckets[2]?.quantity).toBe(6);
    expect(buckets[2]?.notional).toBeCloseTo(price * 5 + 0.3);
  });

  test("shares one integer key between prices differing only by float noise", () => {
    const noisyPrice = 0.1 + 0.2; // 0.30000000000000004
    const exactPrice = 0.3;
    const keyA = priceBucketKey(noisyPrice, 0.1, 1);
    const keyB = priceBucketKey(exactPrice, 0.1, 1);
    expect(keyA).toBe(keyB);

    const [bucketA] = bucketize([[noisyPrice, 1]], { tickSize: 0.1, bucketTicks: 1, low: 0, high: 1 });
    const [bucketB] = bucketize([[exactPrice, 2]], { tickSize: 0.1, bucketTicks: 1, low: 0, high: 1 });
    expect(bucketA?.key).toBe(bucketB?.key);
  });
});

describe("bucketizeWindow", () => {
  const mockBook: BookView = {
    bestBid: 100,
    bestAsk: 102,
    coverage: { bidFloor: 90, askCeiling: 110 },
    levels: (side) => (side === "bid" ? [[100, 2], [95, 3], [85, 10]] : [[102, 1], [105, 4], [115, 10]]),
  };

  test("returns undefined when book is empty or uncrossed", () => {
    const emptyBook: BookView = {
      bestBid: undefined,
      bestAsk: undefined,
      coverage: { bidFloor: 0, askCeiling: 0 },
      levels: () => [],
    };
    expect(bucketizeWindow(emptyBook, { tickSize: 1, bucketTicks: 1, windowPct: 5 })).toBeUndefined();
  });

  test("clamps window to coverage limits and produces bid/ask buckets", () => {
    // mid = 101, span = 101 * 0.1 = 10.1; range: [90.9, 111.1] clamped to coverage [90, 110]
    const result = bucketizeWindow(mockBook, { tickSize: 1, bucketTicks: 5, windowPct: 10 });
    expect(result).toBeDefined();
    expect(result?.bids).toHaveLength(2); // 95 and 100
    expect(result?.asks).toHaveLength(2); // 102 and 105
  });
});
