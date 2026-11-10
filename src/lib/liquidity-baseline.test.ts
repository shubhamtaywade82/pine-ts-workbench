import { describe, expect, test } from "bun:test";
import { LiquidityBaseline } from "./liquidity-baseline";

describe("LiquidityBaseline", () => {
  test("is null until minSamples observations exist", () => {
    const baseline = new LiquidityBaseline(10, 3);
    baseline.add([10, 20]);
    baseline.add([10, 20]);
    expect(baseline.relativeStrength(20)).toBeNull();
  });

  test("divides notional by the median of the stored bucket notionals", () => {
    const baseline = new LiquidityBaseline(10, 3);
    baseline.add([10, 20]);
    baseline.add([10, 20]);
    baseline.add([10, 30]);
    expect(baseline.relativeStrength(30)).toBe(2);
  });

  test("is null when the median is zero", () => {
    const baseline = new LiquidityBaseline(10, 1);
    baseline.add([0, 0]);
    expect(baseline.relativeStrength(5)).toBeNull();
  });

  test("is null when the notional is not finite", () => {
    const baseline = new LiquidityBaseline(10, 1);
    baseline.add([10]);
    expect(baseline.relativeStrength(Number.NaN)).toBeNull();
    expect(baseline.relativeStrength(Number.POSITIVE_INFINITY)).toBeNull();
  });

  test("forgets samples beyond maxSamples", () => {
    const baseline = new LiquidityBaseline(2, 1);
    baseline.add([100]);
    baseline.add([1]);
    baseline.add([1]);
    expect(baseline.relativeStrength(4)).toBe(4);
  });
});
