import { describe, expect, it } from "bun:test";
import { volumeDotRadius } from "./last-price-primitive";

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
