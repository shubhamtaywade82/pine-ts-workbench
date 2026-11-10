import { describe, expect, test } from "bun:test";
import { bigLevelsModel, pulledEvents, type BigLevelInput } from "./wall-monitor-rows";
import { readExpandedState, writeExpandedState } from "./wall-monitor-panel";

const level = (
  side: BigLevelInput["side"],
  price: number,
  quantity: number,
  strength: number | null,
  held = false,
): BigLevelInput => ({ side, price, quantity, strength, observedSince: 0, held });

describe("big levels model", () => {
  test("ranks the nearest zones and collapses the rest", () => {
    const model = bigLevelsModel([
      level("bid", 90, 1500, 2.5),
      level("bid", 80, 10, 1),
      level("bid", 70, 10, 1),
      level("bid", 60, 10, 1),
      level("bid", 50, 10, 1),
      level("ask", 110, 800, 4),
    ], { mid: 100, now: 45_000, quote: "USDT" }, []);
    expect(model.buyerDistance).toBe("10 below spot");
    expect(model.sellerDistance).toBe("10 above spot");
    expect(model.shown).toHaveLength(4);
    expect(model.hidden).toHaveLength(2);
    expect(model.shown[0]?.line).toBe("Big Buyers 90–90 · 1.5k · 2.5× normal · waiting 45s");
    expect(model.shown[0]?.held).toBe(false);
  });

  test("marks a held level and lists walls that left before price reached them", () => {
    const model = bigLevelsModel(
      [level("bid", 99, 3, null, true)],
      { mid: 100, now: 10_000, quote: "USDT" },
      [{ side: "ask", price: 130, notional: 2500, at: 0 }],
    );
    expect(model.shown[0]?.held).toBe(true);
    expect(model.shown[0]?.line).toContain("—× normal");
    expect(model.shown[0]?.line).toContain("waiting 10s");
    expect(model.pulled[0]?.line).toBe("Big Sellers 130 · 2.5K USDT · 10s");
  });

  test("keeps only diffWalls pulled events", () => {
    const previous = [
      { side: "bid" as const, price: 90, notional: 100 },
      { side: "bid" as const, price: 99.96, notional: 50 },
    ];
    const events = pulledEvents(previous, [], { at: 1_000, mid: 100, proximityPct: 0.05, bucketWidth: 0.01 });
    expect(events.map((event) => event.price)).toEqual([90]);
  });
});

describe("expanded state persistence", () => {
  test("defaults to collapsed when storage is empty or undefined", () => {
    expect(readExpandedState("cell-test-empty")).toBe(false);
  });

  test("persists expanded state per cellId", () => {
    const store = new Map<string, string>();
    const fakeWindow = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
      },
    };
    (globalThis as unknown as { window?: unknown }).window = fakeWindow;
    try {
      writeExpandedState("cell-a", true);
      writeExpandedState("cell-b", false);
      expect(readExpandedState("cell-a")).toBe(true);
      expect(readExpandedState("cell-b")).toBe(false);
    } finally {
      delete (globalThis as unknown as { window?: unknown }).window;
    }
  });

  test("catches errors and warns on localStorage read/write failures", () => {
    const warnings: unknown[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args); };
    const fakeWindow = {
      localStorage: {
        getItem: () => { throw new Error("SecurityError: blocked"); },
        setItem: () => { throw new Error("QuotaExceededError: full"); },
      },
    };
    (globalThis as unknown as { window?: unknown }).window = fakeWindow;
    try {
      expect(readExpandedState("cell-error")).toBe(false);
      expect(warnings.length).toBeGreaterThan(0);
      writeExpandedState("cell-error", true);
      expect(warnings.length).toBeGreaterThan(1);
    } finally {
      delete (globalThis as unknown as { window?: unknown }).window;
      console.warn = originalWarn;
    }
  });
});
