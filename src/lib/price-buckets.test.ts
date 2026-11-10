import { describe, expect, test } from "bun:test";
import { bucketize } from "./price-buckets";

const options = { tickSize: 1, bucketTicks: 1, low: 90, high: 110 };

describe("bucketize", () => {
  test("aligns prices to integer tick buckets", () => {
    const buckets = bucketize(
      [[100, 1], [100.09, 2], [100.1, 4]],
      { tickSize: 0.01, bucketTicks: 10, low: 0, high: 200 },
    );
    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toMatchObject({ quantity: 3, notional: 100 * 1 + 100.09 * 2 });
    expect(buckets[0]?.priceFrom).toBeCloseTo(100);
    expect(buckets[0]?.priceTo).toBeCloseTo(100.1);
    expect(buckets[1]).toMatchObject({ quantity: 4, notional: 100.1 * 4 });
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
});
