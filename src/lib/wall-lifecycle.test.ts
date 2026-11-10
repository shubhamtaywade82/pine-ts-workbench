import { describe, expect, test } from "bun:test";
import { diffWalls, wallIdentityWidth, type LifecycleContext, type LifecycleWall } from "./wall-lifecycle";

const wall = (side: LifecycleWall["side"], price: number, notional: number): LifecycleWall =>
  ({ side, price, notional });

const ctx = (over: Partial<LifecycleContext> = {}): LifecycleContext => ({
  at: 1_000,
  mid: 100,
  proximityPct: 0.5,
  bucketWidth: 1,
  ...over,
});

describe("diffWalls", () => {
  test("treats a price inside the same bucket as the same wall", () => {
    const events = diffWalls([wall("bid", 100, 100)], [wall("bid", 100.4, 115)], ctx());
    expect(events).toEqual([{ kind: "increased", side: "bid", price: 100.4, notional: 115, at: 1_000 }]);
  });

  test("emits increased or reduced only at a 15% change", () => {
    expect(diffWalls([wall("bid", 100, 100)], [wall("bid", 100, 114)], ctx())).toEqual([]);
    expect(diffWalls([wall("bid", 100, 100)], [wall("bid", 100, 115)], ctx())[0]?.kind).toBe("increased");
    expect(diffWalls([wall("bid", 100, 100)], [wall("bid", 100, 86)], ctx())).toEqual([]);
    expect(diffWalls([wall("bid", 100, 100)], [wall("bid", 100, 85)], ctx())[0]?.kind).toBe("reduced");
  });

  test("a wall that vanishes away from mid is pulled, and one at mid is removed", () => {
    const far = diffWalls([wall("bid", 90, 100)], [], ctx());
    expect(far[0]).toMatchObject({ kind: "pulled", side: "bid", price: 90, notional: 100 });
    const near = diffWalls([wall("bid", 99.8, 50)], [], ctx());
    expect(near[0]).toMatchObject({ kind: "removed", side: "bid", price: 99.8, notional: 50 });
  });

  test("an empty previous re-detects walls after a non-live gap", () => {
    const again = [wall("bid", 100, 200)];
    expect(diffWalls([wall("bid", 100, 100)], again, ctx()).map((event) => event.kind)).toEqual(["increased"]);
    expect(diffWalls([], again, ctx())).toEqual([
      { kind: "detected", side: "bid", price: 100, notional: 200, at: 1_000 },
    ]);
  });

  test("a jump of more than one bucket is a departure plus a detection", () => {
    const events = diffWalls([wall("bid", 90, 100)], [wall("bid", 92, 100)], ctx());
    expect(events.map((event) => event.kind)).toEqual(["detected", "pulled"]);
  });
});

describe("wallIdentityWidth", () => {
  test("uses tick when known, else mid * 0.0001", () => {
    expect(wallIdentityWidth(50_000, 0.1)).toBe(0.1);
    expect(wallIdentityWidth(50_000, undefined)).toBe(5);
    expect(wallIdentityWidth(100, 0)).toBe(0.01);
  });
});
