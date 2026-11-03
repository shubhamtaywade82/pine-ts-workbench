import { describe, expect, it } from "bun:test";
import { volumeDotRadius } from "./last-price-primitive";
import { pointAt } from "./chart-legend";

describe("volumeDotRadius", () => {
  it("grows with volume against the average and caps at 4x", () => {
    const quiet = volumeDotRadius(10, 100);
    const average = volumeDotRadius(100, 100);
    expect(quiet).toBeLessThan(average);
    expect(volumeDotRadius(400, 100)).toBe(volumeDotRadius(4000, 100));
  });

  it("falls back to the smallest dot without history", () => {
    expect(volumeDotRadius(100, 0)).toBe(volumeDotRadius(0, 100));
  });
});

describe("pointAt", () => {
  const points = [
    { time: 100, value: 10 },
    { time: 200, value: 20 },
    { time: 300, value: 30 },
  ];

  it("returns the latest point when time is null", () => {
    expect(pointAt(points, null)).toEqual({ time: 300, value: 30 });
  });

  it("finds points via binary search by exact timestamp", () => {
    expect(pointAt(points, 200)).toEqual({ time: 200, value: 20 });
    expect(pointAt(points, 100)).toEqual({ time: 100, value: 10 });
    expect(pointAt(points, 300)).toEqual({ time: 300, value: 30 });
  });

  it("returns undefined for non-matching timestamp or empty array", () => {
    expect(pointAt(points, 250)).toBeUndefined();
    expect(pointAt([], 100)).toBeUndefined();
    expect(pointAt([], null)).toBeUndefined();
  });
});
