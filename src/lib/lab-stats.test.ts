import { describe, expect, it } from "bun:test";
import { bestShare, bootstrapMeanInterval, breakevenWinRate, verdictOf, wilsonPct } from "./lab-stats";

describe("wilsonPct", () => {
  it("matches the textbook interval for 5 of 10", () => {
    const { low, high } = wilsonPct(5, 10);
    expect(low).toBeCloseTo(23.66, 1);
    expect(high).toBeCloseTo(76.34, 1);
  });

  it("stays inside 0 to 100 at the extremes and is wide open with no data", () => {
    expect(wilsonPct(0, 5).low).toBe(0);
    expect(wilsonPct(5, 5).high).toBe(100);
    expect(wilsonPct(0, 0)).toEqual({ low: 0, high: 100 });
  });
});

describe("bootstrapMeanInterval", () => {
  it("brackets the mean and is the same every time", () => {
    const values = [10, -5, 20, 0, 15, -10, 5, 8];
    const a = bootstrapMeanInterval(values)!;
    expect(a.low).toBeLessThan(5.375);
    expect(a.high).toBeGreaterThan(5.375);
    expect(bootstrapMeanInterval(values)).toEqual(a);
  });

  it("collapses to the value when every return is the same, and needs two values", () => {
    expect(bootstrapMeanInterval([3, 3, 3, 3])).toEqual({ low: 3, high: 3 });
    expect(bootstrapMeanInterval([3])).toBeUndefined();
  });
});

describe("bestShare and breakevenWinRate", () => {
  it("finds how much of the gain one trade carried", () => {
    expect(bestShare([60, 20, 20, -50])).toBeCloseTo(0.6);
    expect(bestShare([-1, -2])).toBeUndefined();
  });

  it("gives the win rate at which wins and losses cancel", () => {
    // Wins average 30, losses 10: break even at 10 / (30 + 10) = 25%.
    expect(breakevenWinRate([30, 30, -10, -10])).toBeCloseTo(25);
    expect(breakevenWinRate([5, 6])).toBeUndefined();
  });
});

describe("verdictOf", () => {
  it("calls a result only when the interval clears zero with enough trades", () => {
    expect(verdictOf(10, { low: 2, high: 9 })).toBe("Positive");
    expect(verdictOf(10, { low: -9, high: -1 })).toBe("Negative");
    expect(verdictOf(10, { low: -3, high: 4 })).toBe("Unclear");
    expect(verdictOf(5, { low: 2, high: 9 })).toBe("Too few trades");
  });
});
