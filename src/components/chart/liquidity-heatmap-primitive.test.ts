import { describe, expect, test } from "bun:test";
import { heatIntensity } from "./liquidity-heatmap-primitive";

describe("heatIntensity", () => {
  test("is empty for no values and zero when every log is zero", () => {
    expect(heatIntensity([])).toEqual([]);
    expect(heatIntensity([0, 0])).toEqual([0, 0]);
  });

  test("clips log intensity at the 99th percentile", () => {
    const values = Array.from({ length: 100 }, (_, index) => index);
    values[99] = 1e12;
    const intensity = heatIntensity(values);
    expect(intensity).toHaveLength(100);
    expect(intensity[99]).toBe(1);
    expect(intensity[0]).toBe(0);
    expect(intensity[50]).toBeGreaterThan(0);
    expect(intensity[50]).toBeLessThan(1);
    expect(intensity[98]).toBe(1);
  });
});
