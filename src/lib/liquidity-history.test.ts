import { describe, expect, test } from "bun:test";
import { LiquidityHistory, type LiquiditySample } from "./liquidity-history";

const sample = (at: number): LiquiditySample => ({ at, bids: [], asks: [] });

describe("LiquidityHistory", () => {
  test("keeps at most one sample per second", () => {
    const history = new LiquidityHistory(10);
    history.push(sample(1_000));
    history.push(sample(1_500));
    history.push(sample(2_000));
    expect(history.samples().map((row) => row.at)).toEqual([1_000, 2_000]);
  });

  test("drops the oldest sample past capacity", () => {
    const history = new LiquidityHistory(2);
    history.push(sample(0));
    history.push(sample(1_000));
    history.push(sample(2_000));
    expect(history.samples().map((row) => row.at)).toEqual([1_000, 2_000]);
  });

  test("defaults to 600 samples", () => {
    const history = new LiquidityHistory();
    for (let index = 0; index < 601; index += 1) history.push(sample(index * 1_000));
    expect(history.samples()).toHaveLength(600);
    expect(history.samples()[0]?.at).toBe(1_000);
  });

  test("clear drops samples and the rate limit", () => {
    const history = new LiquidityHistory();
    history.push(sample(5_000));
    history.clear();
    history.push(sample(5_100));
    expect(history.samples().map((row) => row.at)).toEqual([5_100]);
  });
});
