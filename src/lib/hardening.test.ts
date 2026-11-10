import { expect, test } from "bun:test";
import { LocalOrderBook, type DepthSnapshot, type DepthUpdate } from "./order-book";
import { addTrade, MAX_BARS, type FootprintBar } from "./footprint";
import { LiquidityHistory, type LiquiditySample } from "./liquidity-history";
import { LiquidityBaseline } from "./liquidity-baseline";
import { LevelActivity, type ActivityTrade } from "./level-activity";
import { MarketRecorder, type MarketStore } from "./market-recorder";
import type { LiveTrade } from "./public-binance-feed";

// ---------- boundedness ----------

const snapFor = (lastUpdateId: number): DepthSnapshot => ({
  lastUpdateId,
  bids: [["99", "1"]],
  asks: [["101", "1"]],
});

const ROLLING_LEVELS = 2_000;
const SNAPSHOT_LEVELS = 1;

const fetchLevels = (u: number): DepthUpdate =>
  u <= ROLLING_LEVELS
    ? { U: u, u, b: [[String(1000 + u), "1"]], a: [] }
    : { U: u, u, b: [[String(1000 + u), "1"], [String(1000 + u - ROLLING_LEVELS), "0"]], a: [] };

const pushOrderBook = (book: LocalOrderBook, until: number): void => {
  for (let u = 1; u <= until; u += 1) book.push(fetchLevels(u));
};

test("LocalOrderBook level count stays bounded over 100k rolling updates", () => {
  const book = new LocalOrderBook();
  book.applySnapshot(snapFor(0), 5_000);
  pushOrderBook(book, 50_000);
  expect(book.levels("bid").length).toBeLessThanOrEqual(ROLLING_LEVELS + SNAPSHOT_LEVELS);
  pushOrderBook(book, 100_000);
  expect(book.levels("bid").length).toBeLessThanOrEqual(ROLLING_LEVELS + SNAPSHOT_LEVELS);
  expect(book.isSynced).toBe(true);
  expect(book.updateId).toBe(100_000);
});

const footprintOptions = { intervalMs: 1_000, tickSize: 0.01, bucketTicks: 1 };

const footprintTrade = (i: number): LiveTrade => ({
  id: i,
  price: 100 + (i % 5) * 0.01,
  quantity: 1,
  time: Math.floor(i / 100) * 1_000,
  aggressor: i % 2 === 0 ? "buy" : "sell",
});

test("addTrade keeps bars.length <= MAX_BARS over 100k trades across 1000 intervals", () => {
  const bars: FootprintBar[] = [];
  for (let i = 0; i < 100_000; i += 1) {
    addTrade(bars, footprintTrade(i), footprintOptions);
    expect(bars.length).toBeLessThanOrEqual(MAX_BARS);
  }
  expect(bars.length).toBe(MAX_BARS);
});

const sampleBucket = (at: number): LiquiditySample => ({
  at,
  bids: [{ key: 99, priceFrom: 99, priceTo: 100, quantity: 1, notional: 99 }],
  asks: [{ key: 101, priceFrom: 101, priceTo: 102, quantity: 1, notional: 101 }],
});

test("LiquidityHistory caps samples at capacity over 10k one-second-apart pushes", () => {
  const capacity = 300;
  const history = new LiquidityHistory(capacity);
  for (let i = 0; i < 10_000; i += 1) {
    history.push(sampleBucket(i * 1_000));
    expect(history.samples().length).toBeLessThanOrEqual(capacity);
  }
  expect(history.samples()).toHaveLength(capacity);
  expect(history.samples()[0]!.at).toBe(9_700_000);
});

test("LiquidityBaseline stays capped and finite over 10k adds", () => {
  const baseline = new LiquidityBaseline(10, 2);
  for (let i = 0; i < 10_000; i += 1) {
    baseline.add([i + 1]);
    if (i >= 1) expect(baseline.relativeStrength(i + 2)).toBeGreaterThan(0);
  }
  // Median of the last ten kept samples (9991..10000) is 9995.5, so this ratio
  // is 2 only if rolling capping works; an unbounded median would give ~4.
  expect(baseline.relativeStrength(19991)).toBe(2);
  expect(Number.isFinite(baseline.relativeStrength(19991) ?? NaN)).toBe(true);
});

const activityTrade = (time: number, aggressor: ActivityTrade["aggressor"]): ActivityTrade => ({
  quantity: 1,
  aggressor,
  time,
});

test("LevelActivity state stays bounded over 50k trades at 5k unseen levels", () => {
  const activity = new LevelActivity(1_000);
  activity.observeBook(0, [], []);
  for (let i = 0; i < 50_000; i += 1) {
    activity.observeTrade(activityTrade(i * 20, i % 2 === 0 ? "buy" : "sell"), i % 5_000);
  }
  expect(activity.levels(50_000 * 20).size).toBeLessThanOrEqual(240);

  // A rapid burst over 1200 fresh levels forces the MAX_BUCKETS cap to drop
  // old buckets, so the exposed map must still stay at 240 entries.
  const base = 50_000 * 20;
  for (let i = 0; i < 1_200; i += 1) {
    activity.observeTrade(activityTrade(base + i, "buy"), (i + 1) * 10_000);
  }
  expect(activity.levels(base + 1_199).size).toBe(240);
});

const failingStore = (): MarketStore => ({
  insertEvents: async () => { throw new Error("store down"); },
  insertSnapshots: async () => { throw new Error("store down"); },
  insertTransitions: async () => { throw new Error("store down"); },
});

test("MarketRecorder caps pending under a throwing store and counts drops", async () => {
  const drops: Array<[number, number]> = [];
  const writeErrors: unknown[] = [];
  const recorder = new MarketRecorder(failingStore(), {
    batchIntervalMs: 3_600_000,
    maxBatch: Number.MAX_SAFE_INTEGER,
    maxPending: 100,
    schedule: (run) => () => { void run; },
    onDrop: (total, pending) => { drops.push([total, pending]); },
    onWriteError: (error) => { writeErrors.push(error); },
  });
  for (let i = 0; i < 250; i += 1) {
    recorder.recordEvent({ symbol: "BTCUSDT", kind: "depth", seq: i, receivedAt: i, payload: "x" });
  }
  expect(recorder.droppedCount).toBe(150);
  expect(drops).toHaveLength(150);
  expect(drops.at(-1)).toEqual([150, 100]);

  // flush() returns the pending count, so it doubles as the public bound check.
  expect(await recorder.flush()).toBe(100);
  expect(recorder.droppedCount).toBe(150);
  expect(writeErrors).toHaveLength(1);
  expect(recorder.lastError).toBeInstanceOf(Error);
  await recorder.stop();
});
