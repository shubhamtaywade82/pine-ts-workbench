import { describe, expect, test } from "bun:test";
import { DepthFeed, type DepthFeedDeps, type DepthWallsUpdate } from "./depth-feed";
import type { DepthSnapshot, DepthUpdate } from "./order-book";

/** Hand-driven socket, snapshot endpoint, clock and timers. */
const harness = () => {
  let now = 0;
  const timers: Array<{ at: number; run: () => void; cancelled: boolean }> = [];
  const sockets: Array<{ url: string; onMessage: (e: DepthUpdate) => void; onOpen: () => void; onClose: () => void; closed: boolean }> = [];
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
      const socket = { url, ...handlers, closed: false };
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
    await Promise.resolve();
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  return { deps, sockets, snapshotRequests, updates, advance, settle, listener: (u: DepthWallsUpdate) => updates.push(u) };
};

const snap = (lastUpdateId: number): DepthSnapshot => ({
  lastUpdateId,
  bids: [["100", "1"], ["99", "10"]],
  asks: [["101", "1"], ["102", "8"]],
});
const event = (U: number, u: number, b: [string, string][] = [], a: [string, string][] = []): DepthUpdate => ({ U, u, b, a });

const OPTIONS = { maxDistancePct: 5, minNotional: 0, switchMarginPct: 15 };

describe("DepthFeed", () => {
  test("subscribes to the 100ms diff-depth stream and syncs from a snapshot", async () => {
    const h = harness();
    const feed = new DepthFeed("BTCUSDT", OPTIONS, h.deps);
    feed.subscribe(h.listener);

    expect(h.sockets[0]?.url).toContain("btcusdt@depth@100ms");
    h.sockets[0]!.onOpen();
    h.sockets[0]!.onMessage(event(11, 12, [["99", "12"]]));
    expect(h.snapshotRequests).toHaveLength(1);

    h.snapshotRequests[0]!.resolve(snap(10));
    await h.settle();

    const last = h.updates.at(-1);
    expect(last?.status).toBe("live");
    expect(last?.frame?.bid).toMatchObject({ price: 99, quantity: 12 });
    expect(last?.frame?.ask).toMatchObject({ price: 102, quantity: 8 });

    h.sockets[0]!.onMessage(event(13, 13, [], [["102", "0"]]));
    expect(h.updates.at(-1)?.frame?.ask?.price).toBe(101);
    feed.stop();
  });

  test("retries a snapshot older than the buffered stream, with backoff", async () => {
    const h = harness();
    const feed = new DepthFeed("BTCUSDT", OPTIONS, h.deps);
    feed.subscribe(h.listener);
    h.sockets[0]!.onOpen();
    h.sockets[0]!.onMessage(event(50, 51));

    h.snapshotRequests[0]!.resolve(snap(10));
    await h.settle();
    expect(h.updates.at(-1)?.status).toBe("syncing");
    expect(h.snapshotRequests).toHaveLength(1);

    await h.advance(1_000);
    expect(h.snapshotRequests).toHaveLength(2);
    h.snapshotRequests[1]!.resolve(snap(50));
    await h.settle();
    expect(h.updates.at(-1)?.status).toBe("live");
    feed.stop();
  });

  test("resyncs from a new snapshot after a sequence gap", async () => {
    const h = harness();
    const feed = new DepthFeed("BTCUSDT", OPTIONS, h.deps);
    feed.subscribe(h.listener);
    h.sockets[0]!.onOpen();
    h.snapshotRequests[0]!.resolve(snap(10));
    await h.settle();
    h.sockets[0]!.onMessage(event(11, 11));
    expect(h.updates.at(-1)?.status).toBe("live");

    h.sockets[0]!.onMessage(event(20, 21)); // 12..19 missing
    expect(h.updates.at(-1)?.status).toBe("syncing");
    await h.advance(1_000);
    expect(h.snapshotRequests).toHaveLength(2);
    h.snapshotRequests[1]!.resolve(snap(20));
    await h.settle();
    expect(h.updates.at(-1)?.status).toBe("live");
    feed.stop();
  });

  test("marks the walls stale when the socket drops, then reconnects with a fresh book", async () => {
    const h = harness();
    const feed = new DepthFeed("BTCUSDT", OPTIONS, h.deps);
    feed.subscribe(h.listener);
    h.sockets[0]!.onOpen();
    h.snapshotRequests[0]!.resolve(snap(10));
    await h.settle();

    h.sockets[0]!.onClose();
    const stale = h.updates.at(-1);
    expect(stale?.status).toBe("stale");
    // The last known walls stay visible, marked stale rather than current.
    expect(stale?.frame?.bid?.price).toBe(99);

    await h.advance(3_000);
    expect(h.sockets).toHaveLength(2);
    expect(h.updates.at(-1)?.status).toBe("syncing");
    feed.stop();
  });

  test("marks the walls stale when no update arrives for 10 s", async () => {
    const h = harness();
    const feed = new DepthFeed("BTCUSDT", OPTIONS, h.deps);
    feed.subscribe(h.listener);
    h.sockets[0]!.onOpen();
    h.snapshotRequests[0]!.resolve(snap(10));
    await h.settle();

    await h.advance(5_000);
    expect(h.updates.at(-1)?.status).toBe("live");
    await h.advance(6_000);
    expect(h.updates.at(-1)?.status).toBe("stale");

    h.sockets[0]!.onMessage(event(11, 11));
    expect(h.updates.at(-1)?.status).toBe("live");
    feed.stop();
  });

  test("retries a failed snapshot request instead of giving up", async () => {
    const h = harness();
    const feed = new DepthFeed("BTCUSDT", OPTIONS, h.deps);
    feed.subscribe(h.listener);
    h.sockets[0]!.onOpen();
    h.snapshotRequests[0]!.reject(new Error("HTTP 503"));
    await h.settle();
    expect(h.updates.at(-1)).toMatchObject({ status: "syncing", error: expect.stringContaining("503") });

    await h.advance(1_000);
    expect(h.snapshotRequests).toHaveLength(2);
    feed.stop();
  });

  test("replays the latest update to a late subscriber and stops when the last one leaves", async () => {
    const h = harness();
    const feed = new DepthFeed("BTCUSDT", OPTIONS, h.deps);
    const unsubscribe = feed.subscribe(h.listener);
    h.sockets[0]!.onOpen();
    h.snapshotRequests[0]!.resolve(snap(10));
    await h.settle();

    const late: DepthWallsUpdate[] = [];
    const unsubscribeLate = feed.subscribe((u) => late.push(u));
    expect(late[0]?.status).toBe("live");

    unsubscribe();
    expect(h.sockets[0]!.closed).toBe(false);
    unsubscribeLate();
    expect(h.sockets[0]!.closed).toBe(true);
    expect(feed.isStopped).toBe(true);
  });
});
