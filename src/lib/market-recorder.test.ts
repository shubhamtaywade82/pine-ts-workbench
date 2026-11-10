import { describe, expect, test } from "bun:test";
import {
  MarketRecorder,
  parseEventQuery,
  parseInteractionQuery,
  parseSnapshotQuery,
  syntheticGapSeq,
  type BookSnapshotRow,
  type MarketEventRow,
  type MarketStore,
  type WallTransitionRow,
} from "./market-recorder";

interface FakeStore extends MarketStore {
  readonly events: MarketEventRow[];
  readonly snapshots: BookSnapshotRow[];
  readonly transitions: WallTransitionRow[];
  failEvents: boolean;
}

const fakeStore = (): FakeStore => {
  const events: MarketEventRow[] = [];
  const snapshots: BookSnapshotRow[] = [];
  const transitions: WallTransitionRow[] = [];
  const keys = new Set<string>();
  const store: FakeStore = {
    events,
    snapshots,
    transitions,
    failEvents: false,
    insertEvents: async (rows) => {
      if (store.failEvents) throw new Error("store down");
      for (const row of rows) {
        const key = `${row.symbol}:${row.kind}:${row.seq}`;
        if (keys.has(key)) continue;
        keys.add(key);
        events.push(row);
      }
    },
    insertSnapshots: async (rows) => { snapshots.push(...rows); },
    insertTransitions: async (rows) => { transitions.push(...rows); },
  };
  return store;
};

const event = (seq: number, kind: MarketEventRow["kind"] = "depth"): MarketEventRow => ({
  symbol: "BTCUSDT",
  kind,
  seq,
  exchangeTime: null,
  receivedAt: seq,
  payload: String(seq),
  schemaVersion: 1,
});

const recorderWith = (store: FakeStore, maxBatch: number, maxPending = 100) => {
  const timers: Array<() => void> = [];
  const recorder = new MarketRecorder(store, {
    batchIntervalMs: 1_000,
    maxBatch,
    maxPending,
    schedule: (run) => {
      timers.push(run);
      return () => undefined;
    },
  });
  return { recorder, timers };
};

describe("MarketRecorder", () => {
  test("flushes when the buffer reaches maxBatch and when the interval fires", async () => {
    const store = fakeStore();
    const { recorder, timers } = recorderWith(store, 2);
    recorder.recordEvent(event(1));
    expect(store.events).toHaveLength(0);
    expect(recorder.writtenCount).toBe(0);
    recorder.recordEvent(event(2));
    await recorder.flush();
    expect(store.events.map((row) => row.seq)).toEqual([1, 2]);
    expect(recorder.writtenCount).toBe(2);
    await recorder.stop();
  });

  test("flushes a short buffer when the interval fires", async () => {
    const store = fakeStore();
    const { recorder, timers } = recorderWith(store, 10);
    recorder.recordEvent(event(4));
    recorder.recordSnapshot({
      symbol: "BTCUSDT", capturedAt: 5, lastUpdateId: 2, bids: "[]", asks: "[]", coverage: "{}",
    });
    recorder.recordTransition({
      wallId: "bid:1", symbol: "BTCUSDT", side: "bid", price: 1, kind: "detected",
      notional: 10, at: 5, detectorVersion: "1",
    });
    expect(store.events).toHaveLength(0);
    timers[0]!();
    await recorder.flush();
    expect(store.events.map((row) => row.seq)).toEqual([4]);
    expect(store.snapshots).toHaveLength(1);
    expect(store.transitions).toHaveLength(1);
    await recorder.stop();
  });

  test("a repeated symbol/kind/seq is ignored in the buffer and by the store", async () => {
    const store = fakeStore();
    const { recorder } = recorderWith(store, 10);
    recorder.recordEvent(event(7));
    recorder.recordEvent(event(7));
    await recorder.flush();
    recorder.recordEvent(event(7));
    await recorder.flush();
    expect(store.events).toHaveLength(1);
    expect(recorder.lastError).toBeUndefined();
    await recorder.stop();
  });

  test("keeps rows when the store fails and writes them on the next flush", async () => {
    const store = fakeStore();
    store.failEvents = true;
    const { recorder } = recorderWith(store, 10);
    recorder.recordEvent(event(3));
    await recorder.flush();
    expect(store.events).toHaveLength(0);
    expect(recorder.lastError).toBeInstanceOf(Error);
    expect(recorder.droppedCount).toBe(0);

    store.failEvents = false;
    await recorder.flush();
    expect(store.events.map((row) => row.seq)).toEqual([3]);
    expect(recorder.lastError).toBeUndefined();
    await recorder.stop();
  });

  test("drops the oldest rows once the pending bound is exceeded", async () => {
    const store = fakeStore();
    store.failEvents = true;
    const { recorder } = recorderWith(store, 10, 2);
    recorder.recordEvent(event(1));
    recorder.recordEvent(event(2));
    recorder.recordEvent(event(3));
    expect(recorder.droppedCount).toBe(1);
    store.failEvents = false;
    await recorder.flush();
    expect(store.events.map((row) => row.seq)).toEqual([2, 3]);
    await recorder.stop();
  });

  test("stop writes every queued row when the batch size is smaller", async () => {
    const store = fakeStore();
    const { recorder } = recorderWith(store, 200, 1_000);
    for (let seq = 1; seq <= 1_000; seq += 1) recorder.recordEvent(event(seq));
    expect(await recorder.stop()).toBe(0);
    expect(store.events).toHaveLength(1_000);
    expect(store.events[0]?.seq).toBe(1);
    expect(store.events[999]?.seq).toBe(1_000);
  });

  test("reports the rows still queued when a batch fails", async () => {
    const store = fakeStore();
    const { recorder } = recorderWith(store, 2, 10);
    recorder.recordEvent(event(1));
    recorder.recordEvent(event(2));
    recorder.recordEvent(event(3));
    store.failEvents = true;
    expect(await recorder.flush()).toBe(3);
    expect(store.events).toHaveLength(0);
    await recorder.stop();
  });
});

describe("syntheticGapSeq", () => {
  test("stays strictly decreasing across two process starts", () => {
    const earlier = 1_700_000_000_000;
    const first = Array.from({ length: 1_000 }, (_, counter) => syntheticGapSeq(earlier, counter));
    const second = [0, 1].map((counter) => syntheticGapSeq(earlier + 1, counter));
    const seqs = [...first, ...second];
    expect(seqs).toEqual([...seqs].sort((left, right) => right - left));
    expect(new Set(seqs).size).toBe(seqs.length);
  });
});

describe("microstructure query parsing", () => {
  test("accepts a known symbol and a finite range", () => {
    expect(parseEventQuery("BTCUSDT", "10", "20")).toEqual({ symbol: "BTCUSDT", from: 10, to: 20 });
    expect(parseEventQuery("DOGEUSDT", "10", "20")).toBeUndefined();
    expect(parseEventQuery("BTCUSDT", "20", "10")).toBeUndefined();
    expect(parseEventQuery("BTCUSDT", "nope", "10")).toBeUndefined();
  });

  test("accepts a snapshot time for a known symbol", () => {
    expect(parseSnapshotQuery("ETHUSDT", "50")).toEqual({ symbol: "ETHUSDT", at: 50 });
    expect(parseSnapshotQuery("ETHUSDT", null)).toBeUndefined();
  });

  test("accepts an interaction range and a bid, ask, or all side", () => {
    expect(parseInteractionQuery("BTCUSDT", "10", "20", null)).toEqual({ symbol: "BTCUSDT", from: 10, to: 20, side: "all" });
    expect(parseInteractionQuery("BTCUSDT", "10", "20", "ask")).toEqual({ symbol: "BTCUSDT", from: 10, to: 20, side: "ask" });
    expect(parseInteractionQuery("BTCUSDT", "10", "20", "both")).toBeUndefined();
    expect(parseInteractionQuery("BTCUSDT", null, "20", "bid")).toBeUndefined();
  });
});
