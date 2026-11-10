export interface PriceBucket {
  readonly priceFrom: number;
  readonly priceTo: number;
  readonly quantity: number;
  readonly notional: number;
}

export interface BucketOptions {
  readonly tickSize: number;
  readonly bucketTicks: number;
  readonly low: number;
  readonly high: number;
}

/** Integer bucket index. Rounding to a tick first stops 0.1 + 0.2 from splitting. */
export const priceBucketKey = (price: number, tickSize: number, bucketTicks: number): number =>
  Math.floor(Math.round(price / tickSize) / bucketTicks);

export const bucketBounds = (
  key: number,
  tickSize: number,
  bucketTicks: number,
): { priceFrom: number; priceTo: number } => ({
  priceFrom: key * bucketTicks * tickSize,
  priceTo: (key + 1) * bucketTicks * tickSize,
});

/** Groups price levels into the tick buckets from `priceBucketKey`. */
export const bucketize = (
  levels: Iterable<readonly [number, number]>,
  options: BucketOptions,
): PriceBucket[] => {
  const { tickSize, bucketTicks, low, high } = options;
  if (!(tickSize > 0) || !(bucketTicks > 0) || !(high >= low)) return [];
  const totals = new Map<number, { quantity: number; notional: number }>();
  for (const [price, quantity] of levels) {
    if (price < low || price > high || quantity === 0) continue;
    const key = priceBucketKey(price, tickSize, bucketTicks);
    const bucket = totals.get(key) ?? { quantity: 0, notional: 0 };
    bucket.quantity += quantity;
    bucket.notional += price * quantity;
    totals.set(key, bucket);
  }
  return [...totals.keys()].sort((a, b) => a - b).map((key) => {
    const bucket = totals.get(key)!;
    return { ...bucketBounds(key, tickSize, bucketTicks), quantity: bucket.quantity, notional: bucket.notional };
  });
};
