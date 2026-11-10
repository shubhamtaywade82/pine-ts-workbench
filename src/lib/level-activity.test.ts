import { describe, expect, test } from "bun:test";
import { LevelActivity } from "./level-activity";

const bid = (key: number, quantity: number) => [{ key, priceFrom: key, quantity }];

describe("LevelActivity", () => {
  test("a decrease fully matched by trades is not pulled", () => {
    const activity = new LevelActivity();
    activity.observeBook(0, bid(100, 10), []);
    activity.observeTrade({ quantity: 4, aggressor: "sell", time: 500 }, 100);
    activity.observeBook(1_000, bid(100, 6), []);
    expect(activity.levels(1_000).get(100)).toMatchObject({ pulled: 0, sold: 4, bought: 0 });
  });

  test("resting size that leaves without a matching trade is pulled", () => {
    const activity = new LevelActivity();
    activity.observeBook(0, bid(100, 10), []);
    activity.observeTrade({ quantity: 1, aggressor: "sell", time: 500 }, 100);
    activity.observeBook(1_000, bid(100, 6), []);
    expect(activity.levels(1_000).get(100)).toMatchObject({ pulled: 3, sold: 1 });
  });

  test("a buy print explains an ask decrease and does not explain a bid decrease", () => {
    const activity = new LevelActivity();
    activity.observeBook(0, bid(100, 5), [{ key: 101, priceFrom: 101, quantity: 8 }]);
    activity.observeTrade({ quantity: 8, aggressor: "buy", time: 100 }, 101);
    activity.observeTrade({ quantity: 5, aggressor: "buy", time: 100 }, 100);
    activity.observeBook(200, bid(100, 0), []);
    expect(activity.levels(200).get(101)).toMatchObject({ pulled: 0, bought: 8 });
    expect(activity.levels(200).get(100)).toMatchObject({ pulled: 5, bought: 5 });
  });

  test("size that appears after the baseline is added", () => {
    const activity = new LevelActivity();
    activity.observeBook(0, bid(100, 2), []);
    activity.observeBook(1_000, bid(100, 5), []);
    expect(activity.levels(1_000).get(100)?.added).toBe(3);
  });

  test("drops activity once it is older than the window", () => {
    const activity = new LevelActivity(60_000);
    activity.observeBook(0, bid(100, 10), []);
    activity.observeBook(1_000, bid(100, 4), []);
    expect(activity.levels(61_000).get(100)?.pulled).toBe(6);
    expect(activity.levels(61_001).has(100)).toBe(false);
  });

  test("reset drops history so the next book is a fresh baseline", () => {
    const activity = new LevelActivity();
    activity.observeBook(0, bid(100, 10), []);
    activity.observeBook(1_000, bid(100, 2), []);
    activity.reset();
    expect(activity.levels(1_000).size).toBe(0);
    activity.observeBook(2_000, bid(100, 2), []);
    activity.observeBook(3_000, bid(100, 2), []);
    expect(activity.levels(3_000).get(100)?.pulled ?? 0).toBe(0);
  });

  test("an unchanged book keeps unmatched prints for the next decrease", () => {
    const activity = new LevelActivity();
    activity.observeBook(0, bid(100, 10), []);
    activity.observeTrade({ quantity: 4, aggressor: "sell", time: 100 }, 100);
    activity.observeBook(200, bid(100, 10), []);
    activity.observeBook(300, bid(100, 6), []);
    expect(activity.levels(300).get(100)).toMatchObject({ pulled: 0, sold: 4 });
  });

  test("keeps a bounded set of buckets", () => {
    const activity = new LevelActivity(60_000);
    for (let key = 0; key < 400; key += 1) {
      activity.observeTrade({ quantity: 1, aggressor: "buy", time: key }, key);
    }
    expect(activity.levels(400).size).toBeLessThanOrEqual(240);
  });

  test("an old pending trade does not explain a later decrease", () => {
    const activity = new LevelActivity(60_000);
    activity.observeBook(0, bid(100, 10), []);
    activity.observeTrade({ quantity: 4, aggressor: "sell", time: 1_000 }, 100);
    activity.observeBook(70_500, bid(100, 6), []);
    expect(activity.levels(70_500).get(100)).toMatchObject({ pulled: 4, sold: 0 });
  });

  test("pending stays bounded at levels that never reach the book", () => {
    const activity = new LevelActivity(60_000);
    for (let i = 0; i < 400; i += 1) {
      activity.observeTrade({ quantity: 1, aggressor: "buy", time: i * 1_000 }, 100_000 + i);
    }
    const pending = (activity as unknown as { pending: Map<number, unknown[]> }).pending;
    expect(pending.size).toBeLessThanOrEqual(240);
  });
});
