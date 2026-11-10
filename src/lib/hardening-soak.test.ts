import { describe, expect, test } from "bun:test";
import { DepthFeed, type DepthFeedDeps, type DepthFeedState } from "./depth-feed";
import type { DepthSnapshot, DepthUpdate } from "./order-book";

// ---------- shared fake feed plumbing (no real sockets, timers or HTTP) ----------

interface FakeTimer { at: number; run: () => void; cancelled: boolean }
interface FakeSocket {
  readonly url: string;
  onOpen: () => void;
  onMessage: (event: DepthUpdate) => void;
  onClose: () => void;
  closed: boolean;
}

const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

interface FeedHarness {
  readonly deps: DepthFeedDeps;
  readonly sockets: FakeSocket[];
  readonly settle: () => Promise<void>;
  readonly advance: (ms: number) => Promise<void>;
  /** Timers scheduled but neither fired nor cancelled: leaks would grow this. */
  readonly outstanding: () => number;
  readonly snapshotCount: () => number;
  readonly resolveLatest: (snapshot: DepthSnapshot) => void;
}

const createSoakTimeline = () => {
  let now = 0;
  let outstanding = 0;
  const timers: FakeTimer[] = [];
  return {
    now: () => now,
    outstanding: () => outstanding,
    schedule: (run: () => void, delayMs: number) => {
      outstanding += 1;
      const timer: FakeTimer = { at: now + delayMs, run, cancelled: false };
      timers.push(timer);
      return () => {
        if (!timer.cancelled) outstanding -= 1;
        timer.cancelled = true;
      };
    },
    advance: async (ms: number) => {
      now += ms;
      for (const timer of timers.filter((t) => !t.cancelled && t.at <= now)) {
        timer.cancelled = true;
        outstanding -= 1;
        timer.run();
      }
      await settle();
    },
  };
};

/** Isolated clock, timers, sockets and snapshot endpoint, one per DepthFeed. */
const feedHarness = (): FeedHarness => {
  const time = createSoakTimeline();
  const sockets: FakeSocket[] = [];
  const snapshots: Array<{ resolve: (s: DepthSnapshot) => void; reject: (e: Error) => void }> = [];
  const deps: DepthFeedDeps = {
    now: time.now,
    schedule: time.schedule,
    openSocket: (url, handlers) => {
      const socket: FakeSocket = { url, ...handlers, closed: false };
      sockets.push(socket);
      return () => { socket.closed = true; };
    },
    fetchSnapshot: () => new Promise<DepthSnapshot>((resolve, reject) => { snapshots.push({ resolve, reject }); }),
  };
  return {
    deps, sockets, settle,
    outstanding: time.outstanding,
    snapshotCount: () => snapshots.length,
    resolveLatest: (snapshot: DepthSnapshot) => { snapshots.at(-1)?.resolve(snapshot); },
    advance: time.advance,
  };
};

const snapFor = (lastUpdateId: number): DepthSnapshot => ({
  lastUpdateId,
  bids: [["99", "1"]],
  asks: [["101", "1"]],
});

const depthEvent = (id: number, bids: ReadonlyArray<[string, string]>): DepthUpdate => ({ U: id, u: id, b: bids, a: [] });

const collector = (states: DepthFeedState[]) => (state: DepthFeedState): void => { states.push(state); };

// ---------- 1. multi-symbol isolation ----------

describe("DepthFeed multi-symbol isolation", () => {
  test("driving one feed never changes the other's status, book or counters", async () => {
    const hA = feedHarness();
    const hB = feedHarness();
    const feedA = new DepthFeed("BTCUSDT", hA.deps);
    const feedB = new DepthFeed("ETHUSDT", hB.deps);
    const seenA: DepthFeedState[] = [];
    const seenB: DepthFeedState[] = [];
    feedA.subscribe(collector(seenA));
    feedB.subscribe(collector(seenB));
    expect(hA.sockets[0]!.url).toContain("btcusdt@depth@100ms");
    expect(hB.sockets[0]!.url).toContain("ethusdt@depth@100ms");

    // Drive only BTCUSDT to live; ETHUSDT must keep its initial state.
    hA.sockets[0]!.onOpen();
    hA.resolveLatest(snapFor(10));
    await hA.settle();
    hA.sockets[0]!.onMessage(depthEvent(11, [["99", "4"]]));
    expect(seenA.at(-1)).toMatchObject({ status: "live", gapCount: 0, resyncCount: 0, malformedCount: 0 });
    expect(seenB).toHaveLength(1);
    expect(seenB[0]).toMatchObject({ status: "syncing", book: undefined, gapCount: 0, resyncCount: 0, malformedCount: 0 });

    // A gap and a malformed frame on BTCUSDT must not touch ETHUSDT's counters.
    feedA.noteMalformed();
    hA.sockets[0]!.onMessage(depthEvent(100, []));
    expect(seenA.at(-1)).toMatchObject({ status: "syncing", gapCount: 1, malformedCount: 1 });
    expect(seenB).toHaveLength(1);
    expect(seenB[0]).toMatchObject({ status: "syncing", gapCount: 0, malformedCount: 0 });

    // Resync BTCUSDT: its counters move, ETHUSDT's stay untouched.
    await hA.advance(1_000);
    hA.resolveLatest(snapFor(100));
    await hA.settle();
    expect(seenA.at(-1)).toMatchObject({ status: "live", gapCount: 1, resyncCount: 1, malformedCount: 1 });
    expect(seenB).toHaveLength(1);
    expect(hB.sockets).toHaveLength(1);

    // Driving ETHUSDT afterwards leaves BTCUSDT's final state unchanged.
    hB.sockets[0]!.onOpen();
    hB.resolveLatest(snapFor(10));
    await hB.settle();
    hB.sockets[0]!.onMessage(depthEvent(11, [["99", "2"]]));
    expect(seenB.at(-1)).toMatchObject({ status: "live", gapCount: 0, resyncCount: 0, malformedCount: 0 });
    expect(seenA.at(-1)?.resyncCount).toBe(1);
    feedA.stop();
    feedB.stop();
  });
});

// ---------- 2. reconnect soak ----------

test("reconnect soak: no live between close and snapshot, timers bounded, stop is quiet", async () => {
  const h = feedHarness();
  const feed = new DepthFeed("BTCUSDT", h.deps);
  const states: DepthFeedState[] = [];
  let resolvedSinceClose = 0;
  let liveWithoutSnapshot = 0;
  feed.subscribe((state) => {
    if (state.status === "live" && resolvedSinceClose === 0) liveWithoutSnapshot += 1;
    states.push(state);
  });

  for (let cycle = 0; cycle < 200; cycle += 1) {
    const socket = h.sockets[cycle]!;
    socket.onOpen();
    h.resolveLatest(snapFor(cycle * 10));
    resolvedSinceClose += 1;
    await h.settle();
    socket.onMessage(depthEvent(cycle * 10 + 1, [["99", "1"]]));
    expect(h.outstanding()).toBeLessThanOrEqual(3);
    expect(states.at(-1)).toMatchObject({ status: "live", gapCount: 0 });
    socket.onClose();
    resolvedSinceClose = 0;
    expect(states.at(-1)?.status).toBe("disconnected");
    expect(h.outstanding()).toBeLessThanOrEqual(3);
    await h.advance(3_000);
    expect(h.sockets).toHaveLength(cycle + 2);
  }

  expect(liveWithoutSnapshot).toBe(0);
  expect(states.at(-1)).toMatchObject({ resyncCount: 199, gapCount: 0, malformedCount: 0 });

  // After stop() nothing may emit: stray socket callbacks and a late snapshot hit
  // a stale generation, and every scheduled callback has been cancelled.
  const beforeStop = states.length;
  feed.stop();
  const lastSocket = h.sockets.at(-1)!;
  expect(lastSocket.closed).toBe(true);
  expect(h.outstanding()).toBe(0);
  lastSocket.onOpen();
  lastSocket.onMessage(depthEvent(999_999, [["99", "1"]]));
  lastSocket.onClose();
  await h.settle();
  expect(h.snapshotCount()).toBe(200);
  expect(states).toHaveLength(beforeStop);
});
