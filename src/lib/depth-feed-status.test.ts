import { describe, expect, test } from "bun:test";
import { DepthFeed, WallObserver, type DepthFeedDeps, type DepthFeedState, type DepthWallsUpdate } from "./depth-feed";
import { wallOptionsFor } from "./depth-walls";
import type { DepthSnapshot, DepthUpdate } from "./order-book";

interface Socket {
  readonly url: string;
  onOpen: () => void;
  onMessage: (event: DepthUpdate) => void;
  onClose: () => void;
  closed: boolean;
}

const createTimeline = () => {
  let now = 0;
  const timers: Array<{ at: number; run: () => void; cancelled: boolean }> = [];
  return {
    now: () => now,
    schedule: (run: () => void, delayMs: number) => {
      const timer = { at: now + delayMs, run, cancelled: false };
      timers.push(timer);
      return () => { timer.cancelled = true; };
    },
    advance: async (ms: number) => {
      now += ms;
      for (const t of timers.filter((item) => !item.cancelled && item.at <= now)) {
        t.cancelled = true;
        t.run();
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
};

/** Hand-driven clock, timers, socket and snapshot endpoint. */
const harness = () => {
  const time = createTimeline();
  const sockets: Socket[] = [];
  const snapshotRequests: Array<{ resolve: (s: DepthSnapshot) => void; reject: (e: Error) => void }> = [];
  const updates: DepthWallsUpdate[] = [];
  const deps: DepthFeedDeps = {
    now: time.now,
    schedule: time.schedule,
    openSocket: (url, handlers) => {
      const socket: Socket = { url, ...handlers, closed: false };
      sockets.push(socket);
      return () => { socket.closed = true; };
    },
    fetchSnapshot: () => new Promise<DepthSnapshot>((resolve, reject) => snapshotRequests.push({ resolve, reject })),
  };
  const observe = (feed: DepthFeed, windowPct = 5) => {
    const observer = new WallObserver(wallOptionsFor(windowPct, 0), "USDT", time.now, (u) => updates.push(u));
    feed.setWindow(observer, windowPct);
    feed.subscribe((state) => observer.receive(state));
    return observer;
  };
  return {
    deps, sockets, snapshotRequests, updates,
    advance: time.advance, settle: () => new Promise((resolve) => setTimeout(resolve, 0)),
    observe, now: time.now,
  };
};

const snap = (lastUpdateId: number): DepthSnapshot => ({
  lastUpdateId,
  bids: [["100", "1"], ["99", "10"]],
  asks: [["101", "1"], ["102", "8"]],
});
const event = (U: number, u: number, b: [string, string][] = [], a: [string, string][] = []): DepthUpdate => ({ U, u, b, a });
const lastUpdate = (h: ReturnType<typeof harness>): DepthWallsUpdate => h.updates[h.updates.length - 1]!;
const statesOf = (feed: DepthFeed): DepthFeedState[] => {
  const states: DepthFeedState[] = [];
  feed.subscribe((state) => states.push(state));
  return states;
};

describe("DepthFeed: observation is not continued across a break", () => {
  test("after a sequence gap, a wall is observed from the resync, not from before the gap", async () => {
    const h = harness();
    const feed = new DepthFeed("BTCUSDT", h.deps);
    h.observe(feed);
    h.sockets[0]!.onOpen();
    h.snapshotRequests[0]!.resolve(snap(10));
    await h.settle();
    expect(lastUpdate(h).frame?.bid?.observedSince).toBe(0);

    await h.advance(60_000);
    h.sockets[0]!.onMessage(event(11, 11));
    h.sockets[0]!.onMessage(event(20, 21)); // 12..19 missed
    expect(lastUpdate(h).status).toBe("syncing");

    await h.advance(1_000);
    h.snapshotRequests[1]!.resolve(snap(20));
    await h.settle();
    expect(lastUpdate(h)).toMatchObject({ status: "live" });
    expect(lastUpdate(h).frame?.bid).toMatchObject({ price: 99, observedSince: 61_000 });
    feed.stop();
  });

  test("a stall (no updates for 10 s) freezes observedUntil, and observation restarts on the next update", async () => {
    const h = harness();
    const feed = new DepthFeed("BTCUSDT", h.deps);
    h.observe(feed);
    h.sockets[0]!.onOpen();
    h.snapshotRequests[0]!.resolve(snap(10));
    await h.settle();

    await h.advance(5_000);
    h.sockets[0]!.onMessage(event(11, 11));
    expect(lastUpdate(h)).toMatchObject({ status: "live", observedUntil: 5_000 });

    await h.advance(10_000);
    expect(lastUpdate(h)).toMatchObject({ status: "stale", observedUntil: 5_000 });
    expect(lastUpdate(h).frame?.bid?.price).toBe(99);

    h.sockets[0]!.onMessage(event(12, 12));
    expect(lastUpdate(h).status).toBe("live");
    expect(lastUpdate(h).frame?.bid?.observedSince).toBe(15_000);
    feed.stop();
  });

  test("a dropped socket is disconnected, and after reconnecting the walls are observed from the reconnect", async () => {
    const h = harness();
    const feed = new DepthFeed("BTCUSDT", h.deps);
    h.observe(feed);
    h.sockets[0]!.onOpen();
    h.snapshotRequests[0]!.resolve(snap(10));
    await h.settle();
    await h.advance(2_000);

    h.sockets[0]!.onClose();
    expect(lastUpdate(h)).toMatchObject({ status: "disconnected", observedUntil: 0 });
    expect(lastUpdate(h).frame?.bid?.price).toBe(99);

    await h.advance(8_000);
    expect(h.sockets).toHaveLength(2);
    h.sockets[1]!.onOpen();
    h.snapshotRequests[1]!.resolve(snap(10));
    await h.settle();
    expect(lastUpdate(h)).toMatchObject({ status: "live" });
    expect(lastUpdate(h).frame?.bid?.observedSince).toBe(10_000);
    feed.stop();
  });

  test("forces reconnect when feed stays stale for 3 x STALE_AFTER_MS with no message", async () => {
    const h = harness();
    const feed = new DepthFeed("BTCUSDT", h.deps);
    h.observe(feed);
    h.sockets[0]!.onOpen();
    h.snapshotRequests[0]!.resolve(snap(10));
    await h.settle();

    await h.advance(5_000);
    h.sockets[0]!.onMessage(event(11, 11));
    expect(lastUpdate(h).status).toBe("live");

    await h.advance(10_000);
    expect(lastUpdate(h).status).toBe("stale");
    expect(h.sockets).toHaveLength(1);
    expect(h.sockets[0]!.closed).toBe(false);

    await h.advance(30_000);
    expect(h.sockets[0]!.closed).toBe(true);
    expect(h.sockets).toHaveLength(2);
    expect(lastUpdate(h).status).toBe("syncing");

    h.sockets[0]!.onMessage(event(12, 12));
    expect(lastUpdate(h).status).toBe("syncing");

    h.sockets[1]!.onOpen();
    expect(h.snapshotRequests).toHaveLength(2);
    h.snapshotRequests[1]!.resolve(snap(20));
    await h.settle();
    h.sockets[1]!.onMessage(event(21, 21));
    expect(lastUpdate(h).status).toBe("live");
    feed.stop();
  });
});

describe("DepthFeed: diagnostics", () => {
  test("a sequence gap increments gapCount and the next snapshot fetch increments resyncCount", async () => {
    const h = harness();
    const feed = new DepthFeed("BTCUSDT", h.deps);
    const states = statesOf(feed);
    h.sockets[0]!.onOpen();
    h.snapshotRequests[0]!.resolve(snap(10));
    await h.settle();
    expect(states.at(-1)).toMatchObject({ status: "live", resyncCount: 0, gapCount: 0 });

    h.sockets[0]!.onMessage(event(20, 21));
    expect(states.at(-1)).toMatchObject({ status: "syncing", gapCount: 1, resyncCount: 0 });

    const beforeRetry = states.length;
    await h.advance(1_000);
    expect(states).toHaveLength(beforeRetry);
    h.snapshotRequests[1]!.resolve(snap(20));
    await h.settle();
    expect(states.at(-1)).toMatchObject({ status: "live", gapCount: 1, resyncCount: 1 });
    feed.stop();
  });

  test("a snapshot that cannot continue the buffer increments gapCount", async () => {
    const h = harness();
    const feed = new DepthFeed("BTCUSDT", h.deps);
    const states = statesOf(feed);
    h.sockets[0]!.onOpen();
    h.sockets[0]!.onMessage(event(90, 95));
    h.sockets[0]!.onMessage(event(103, 104));
    h.snapshotRequests[0]!.resolve(snap(100));
    await h.settle();
    expect(states.at(-1)).toMatchObject({ status: "syncing", gapCount: 1 });
    feed.stop();
  });

  test("a snapshot resolving after the socket closes stays disconnected until reconnect", async () => {
    const h = harness();
    const feed = new DepthFeed("BTCUSDT", h.deps);
    const states = statesOf(feed);
    h.sockets[0]!.onOpen();
    h.sockets[0]!.onClose();
    expect(states.at(-1)?.status).toBe("disconnected");

    const afterClose = states.length;
    h.snapshotRequests[0]!.resolve(snap(10));
    await h.settle();
    const later = states.slice(afterClose).map((state) => state.status);
    expect(later.every((status) => status !== "live" && status !== "syncing")).toBe(true);
    expect(states.at(-1)?.status).toBe("disconnected");
    feed.stop();
  });

  test("lastMessageAt is the injected clock time of each received depth event", async () => {
    const h = harness();
    const feed = new DepthFeed("BTCUSDT", h.deps);
    const states = statesOf(feed);
    h.sockets[0]!.onOpen();
    h.snapshotRequests[0]!.resolve(snap(10));
    await h.settle();

    await h.advance(4_000);
    h.sockets[0]!.onMessage(event(11, 11));
    expect(states.at(-1)?.lastMessageAt).toBe(4_000);
    feed.stop();
  });

  test("noteMalformed increments malformedCount, and each later emit carries the total", async () => {
    const h = harness();
    const feed = new DepthFeed("BTCUSDT", h.deps);
    const states = statesOf(feed);
    h.sockets[0]!.onOpen();
    h.snapshotRequests[0]!.resolve(snap(10));
    await h.settle();
    expect(states.at(-1)?.malformedCount).toBe(0);

    feed.noteMalformed();
    feed.noteMalformed();
    h.sockets[0]!.onMessage(event(11, 11));
    expect(states.at(-1)).toMatchObject({ status: "live", malformedCount: 2 });
    feed.stop();
  });

  test("a rejected snapshot fetch increments snapshotFailureCount, carried on later emits", async () => {
    const h = harness();
    const feed = new DepthFeed("BTCUSDT", h.deps);
    const states = statesOf(feed);
    expect(states[0]?.snapshotFailureCount).toBe(0);

    h.sockets[0]!.onOpen();
    h.snapshotRequests[0]!.reject(new Error("HTTP 500"));
    await h.settle();
    expect(states.at(-1)?.snapshotFailureCount).toBe(1);

    await h.advance(1_000);
    h.snapshotRequests[1]!.reject(new Error("HTTP 503"));
    await h.settle();
    expect(states.at(-1)?.snapshotFailureCount).toBe(2);

    await h.advance(2_000);
    h.snapshotRequests[2]!.resolve(snap(10));
    await h.settle();
    expect(states.at(-1)).toMatchObject({ status: "live", snapshotFailureCount: 2 });
    feed.stop();
  });
});
