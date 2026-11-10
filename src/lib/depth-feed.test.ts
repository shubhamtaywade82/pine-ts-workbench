import { describe, expect, test } from "bun:test";
import { DepthFeed, WallObserver, type DepthFeedDeps, type DepthFeedState, type DepthWallsUpdate } from "./depth-feed";
import { bindDepthFeed } from "./depth-feed-browser";
import { wallOptionsFor } from "./depth-walls";
import type { DepthSnapshot, DepthUpdate } from "./order-book";

interface Socket {
  readonly url: string;
  onOpen: () => void;
  onMessage: (event: DepthUpdate) => void;
  onClose: () => void;
  closed: boolean;
}

/** Hand-driven clock, timers, socket and snapshot endpoint. */
const harness = () => {
  let now = 0;
  const timers: Array<{ at: number; run: () => void; cancelled: boolean }> = [];
  const sockets: Socket[] = [];
  const snapshotRequests: Array<{ resolve: (s: DepthSnapshot) => void; reject: (e: Error) => void }> = [];
  const updates: DepthWallsUpdate[] = [];

  const deps: DepthFeedDeps = {
    now: () => now,
    schedule: (run, delayMs) => {
      const timer = { at: now + delayMs, run, cancelled: false };
      timers.push(timer);
      return () => { timer.cancelled = true; };
    },
    openSocket: (url, handlers) => {
      const socket: Socket = { url, ...handlers, closed: false };
      sockets.push(socket);
      return () => { socket.closed = true; };
    },
    fetchSnapshot: () => new Promise<DepthSnapshot>((resolve, reject) => snapshotRequests.push({ resolve, reject })),
  };

  const advance = async (ms: number) => {
    now += ms;
    for (const timer of timers.filter((t) => !t.cancelled && t.at <= now)) {
      timer.cancelled = true;
      timer.run();
    }
    await settle();
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const observe = (feed: DepthFeed, windowPct = 5) => {
    const observer = new WallObserver(wallOptionsFor(windowPct, 0), "USDT", () => now, (u) => updates.push(u));
    feed.setWindow(observer, windowPct);
    feed.subscribe((state) => observer.receive(state));
    return observer;
  };

  return { deps, sockets, snapshotRequests, updates, advance, settle, observe, now: () => now };
};

const snap = (lastUpdateId: number): DepthSnapshot => ({
  lastUpdateId,
  bids: [["100", "1"], ["99", "10"]], asks: [["101", "1"], ["102", "8"]],
});
const event = (U: number, u: number, b: [string, string][] = [], a: [string, string][] = []): DepthUpdate => ({ U, u, b, a });
const lastUpdate = (h: ReturnType<typeof harness>): DepthWallsUpdate => h.updates[h.updates.length - 1]!;

const statesOf = (feed: DepthFeed): DepthFeedState[] => {
  const states: DepthFeedState[] = [];
  feed.subscribe((state) => states.push(state));
  return states;
};

/** A 5000-level snapshot per side, tightly spaced, so its verified coverage is about ±1% around mid 100. */
const wideSnapshot = (lastUpdateId: number): DepthSnapshot => ({
  lastUpdateId,
  bids: Array.from({ length: 5000 }, (_, i) => [(99.9999 - 0.0002 * i).toFixed(4), "1"]),
  asks: Array.from({ length: 5000 }, (_, i) => [(100.0001 + 0.0002 * i).toFixed(4), "1"]),
});

describe("DepthFeed: connection and sync", () => {
  test("subscribes to the 100ms diff-depth stream, syncs, and publishes walls", async () => {
    const h = harness();
    const feed = new DepthFeed("BTCUSDT", h.deps);
    h.observe(feed);

    expect(h.sockets[0]?.url).toContain("btcusdt@depth@100ms");
    h.sockets[0]!.onOpen();
    h.sockets[0]!.onMessage(event(11, 12, [["99", "12"]]));
    h.snapshotRequests[0]!.resolve(snap(10));
    await h.settle();

    expect(lastUpdate(h)).toMatchObject({ status: "live", quoteAsset: "USDT" });
    expect(lastUpdate(h).frame?.bid).toMatchObject({ price: 99, quantity: 12 });
    expect(lastUpdate(h).frame?.ask).toMatchObject({ price: 102, quantity: 8 });

    h.sockets[0]!.onMessage(event(13, 13, [], [["102", "0"]]));
    expect(lastUpdate(h).frame?.ask?.price).toBe(101);
    feed.stop();
  });

  test("retries a snapshot older than the buffered stream, with backoff", async () => {
    const h = harness();
    const feed = new DepthFeed("BTCUSDT", h.deps);
    h.observe(feed);
    h.sockets[0]!.onOpen();
    h.sockets[0]!.onMessage(event(50, 51));

    h.snapshotRequests[0]!.resolve(snap(10));
    await h.settle();
    expect(lastUpdate(h).status).toBe("syncing");
    expect(h.snapshotRequests).toHaveLength(1);

    await h.advance(1_000);
    expect(h.snapshotRequests).toHaveLength(2);
    h.snapshotRequests[1]!.resolve(snap(50));
    await h.settle();
    expect(lastUpdate(h).status).toBe("live");
    feed.stop();
  });

  test("retries a failed snapshot request and reports the error", async () => {
    const h = harness();
    const feed = new DepthFeed("BTCUSDT", h.deps);
    h.observe(feed);
    h.sockets[0]!.onOpen();
    h.snapshotRequests[0]!.reject(new Error("HTTP 503"));
    await h.settle();
    expect(lastUpdate(h)).toMatchObject({ status: "syncing", error: expect.stringContaining("503") });

    await h.advance(1_000);
    expect(h.snapshotRequests).toHaveLength(2);
    feed.stop();
  });
});

describe("DepthFeed: options and coverage", () => {
  test("a subscriber's window changes apply without reopening the socket", async () => {
    const h = harness();
    const feed = new DepthFeed("BTCUSDT", h.deps);
    const observer = h.observe(feed, 5);
    h.sockets[0]!.onOpen();
    h.snapshotRequests[0]!.resolve(snap(10));
    await h.settle();
    expect(lastUpdate(h).frame?.bid?.price).toBe(99);

    feed.setWindow(observer, 0.001);
    observer.setOptions(wallOptionsFor(0.001, 0));
    expect(h.sockets).toHaveLength(1);
    expect(lastUpdate(h).frame?.bid).toBeUndefined();
    feed.stop();
  });

  test("re-centres the book when price nears the edge of the verified coverage", async () => {
    const h = harness();
    const feed = new DepthFeed("BTCUSDT", h.deps);
    h.observe(feed, 0.5);
    h.sockets[0]!.onOpen();
    h.snapshotRequests[0]!.resolve(wideSnapshot(10));
    await h.settle();
    expect(lastUpdate(h).status).toBe("live");

    const asksBelow = Array.from({ length: 3000 }, (_, i) => [(100.0001 + 0.0002 * i).toFixed(4), "0"] as [string, string]);
    h.sockets[0]!.onMessage(event(11, 11, [["100.6", "1"]], asksBelow));
    await h.settle();
    expect(lastUpdate(h).status).toBe("syncing");
    expect(h.snapshotRequests).toHaveLength(2);

    h.snapshotRequests[1]!.resolve(wideSnapshot(11));
    await h.settle();
    expect(lastUpdate(h).status).toBe("live");
    feed.stop();
  });
});

describe("DepthFeed: subscribers", () => {
  test("a late subscriber gets the current state, and the feed stops when the last one leaves", async () => {
    const h = harness();
    const feed = new DepthFeed("BTCUSDT", h.deps);
    const firstSub = feed.subscribe(() => {});
    h.sockets[0]!.onOpen();
    h.snapshotRequests[0]!.resolve(snap(10));
    await h.settle();

    const seen: DepthWallsUpdate[] = [];
    const secondSub = feed.subscribe((state) => seen.push(state as never));
    expect(seen[0]).toMatchObject({ status: "live" });

    firstSub();
    expect(feed.isStopped).toBe(false);
    secondSub();
    expect(feed.isStopped).toBe(true);
    expect(h.sockets[0]?.closed).toBe(true);
  });
});

describe("DepthFeed: recorder hooks", () => {
  test("reports each applied event, and not a buffered or stale one", async () => {
    const h = harness();
    const applied: number[] = [];
    const gaps: Array<number | undefined> = [];
    const feed = new DepthFeed("BTCUSDT", {
      ...h.deps,
      onApplied: (event) => applied.push(event.u),
      onGap: (event) => gaps.push(event?.u),
    });
    const states = statesOf(feed);
    h.sockets[0]!.onOpen();
    h.sockets[0]!.onMessage(event(11, 12, [["99", "4"]]));
    expect(applied).toEqual([]);
    h.snapshotRequests[0]!.resolve(snap(10));
    await h.settle();
    expect(applied).toEqual([]);
    expect(states.at(-1)?.updateId).toBe(12);

    h.sockets[0]!.onMessage(event(13, 13));
    h.sockets[0]!.onMessage(event(13, 13));
    expect(applied).toEqual([13]);
    h.sockets[0]!.onMessage(event(20, 21));
    expect(gaps).toEqual([21]);
    feed.stop();
  });

  test("a snapshot that cannot continue the buffer reports a gap without an event", async () => {
    const h = harness();
    const gaps: Array<number | undefined> = [];
    const feed = new DepthFeed("BTCUSDT", {
      ...h.deps,
      onGap: (event) => gaps.push(event?.u),
    });
    feed.subscribe(() => {});
    h.sockets[0]!.onOpen();
    h.sockets[0]!.onMessage(event(90, 95));
    h.sockets[0]!.onMessage(event(103, 104));
    h.snapshotRequests[0]!.resolve(snap(100));
    await h.settle();
    expect(gaps).toEqual([undefined]);
    feed.stop();
  });
});

describe("bindDepthFeed", () => {
  test("forwards the synced book and stops the feed when it was the last subscriber", async () => {
    const h = harness();
    const feed = new DepthFeed("BTCUSDT", h.deps);
    const states: DepthFeedState[] = [];
    const subscription = bindDepthFeed(feed, 0.5, (state) => states.push(state));
    h.sockets[0]!.onOpen();
    h.snapshotRequests[0]!.resolve(snap(10));
    await h.settle();
    expect(states.at(-1)).toMatchObject({ status: "live" });
    expect(states.at(-1)?.book?.bestBid).toBe(100);
    expect(states.at(-1)?.book?.bestAsk).toBe(101);
    subscription.unsubscribe();
    expect(feed.isStopped).toBe(true);
  });

  test("registers a coverage window that re-centres the book", async () => {
    const h = harness();
    const feed = new DepthFeed("BTCUSDT", h.deps);
    bindDepthFeed(feed, 0.5, () => {});
    h.sockets[0]!.onOpen();
    h.snapshotRequests[0]!.resolve(wideSnapshot(10));
    await h.settle();
    const asksBelow = Array.from({ length: 3000 }, (_, i) => [(100.0001 + 0.0002 * i).toFixed(4), "0"] as [string, string]);
    h.sockets[0]!.onMessage(event(11, 11, [["100.6", "1"]], asksBelow));
    await h.settle();
    expect(h.snapshotRequests).toHaveLength(2);
    feed.stop();
  });

  test("unsubscribe drops the coverage window", async () => {
    const h = harness();
    const feed = new DepthFeed("BTCUSDT", h.deps);
    feed.subscribe(() => {});
    bindDepthFeed(feed, 0.5, () => {}).unsubscribe();
    h.sockets[0]!.onOpen();
    h.snapshotRequests[0]!.resolve(wideSnapshot(10));
    await h.settle();
    const asksBelow = Array.from({ length: 3000 }, (_, i) => [(100.0001 + 0.0002 * i).toFixed(4), "0"] as [string, string]);
    h.sockets[0]!.onMessage(event(11, 11, [["100.6", "1"]], asksBelow));
    await h.settle();
    expect(h.snapshotRequests).toHaveLength(1);
    feed.stop();
  });

  test("setWindow registers a coverage window that was omitted at subscribe time", async () => {
    const h = harness();
    const feed = new DepthFeed("BTCUSDT", h.deps);
    const subscription = bindDepthFeed(feed, undefined, () => {});
    h.sockets[0]!.onOpen();
    h.snapshotRequests[0]!.resolve(wideSnapshot(10));
    await h.settle();
    const asksBelow = Array.from({ length: 3000 }, (_, i) => [(100.0001 + 0.0002 * i).toFixed(4), "0"] as [string, string]);
    h.sockets[0]!.onMessage(event(11, 11, [["100.6", "1"]], asksBelow));
    await h.settle();
    expect(h.snapshotRequests).toHaveLength(1);
    subscription.setWindow(0.5);
    h.sockets[0]!.onMessage(event(12, 12, [["100.6", "1"]], asksBelow));
    await h.settle();
    expect(h.snapshotRequests).toHaveLength(2);
    feed.stop();
  });
});
