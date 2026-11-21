import { describe, expect, it } from "bun:test";
import {
  calculateAbsorptionRatio,
  calculateDepletionVelocity,
  detectAbsorption,
  detectIceberg,
  detectLiquidityVacuum,
  type AbsorptionInput,
} from "./absorption-detector";

describe("absorption-detector", () => {
  describe("calculateAbsorptionRatio", () => {
    it("returns high ratio when volume is large and price displacement is zero", () => {
      const ratio = calculateAbsorptionRatio(10_000, 0, 1.0);
      expect(ratio).toBe(10_000);
    });

    it("returns lower ratio when price moves significantly", () => {
      const ratio = calculateAbsorptionRatio(10_000, 10.0, 1.0);
      // 10 displacement / 1 tick = 10 + 1 = 11 ticks => 10,000 / 11 ~ 909
      expect(ratio).toBeCloseTo(909.09, 1);
    });
  });

  describe("detectAbsorption", () => {
    it("detects bullish absorption when aggressive sellers fail to push price down", () => {
      const input: AbsorptionInput = {
        levelPrice: 100,
        barOpen: 100,
        barHigh: 101,
        barLow: 99.5,
        barClose: 100.5,
        buyVolume: 1_000,
        sellVolume: 5_000,
        averageBarVolume: 1_500, // Total 6000 >= 1500 * 2.5
        tickSize: 0.5,
      };

      const result = detectAbsorption(input);
      expect(result).toBeDefined();
      expect(result?.side).toBe("bullish");
      expect(result?.price).toBe(100);
      expect(result?.delta).toBe(-4_000);
    });

    it("detects bearish absorption when aggressive buyers fail to push price up", () => {
      const input: AbsorptionInput = {
        levelPrice: 110,
        barOpen: 110,
        barHigh: 111,
        barLow: 109.5,
        barClose: 109.5,
        buyVolume: 6_000,
        sellVolume: 1_200,
        averageBarVolume: 1_500,
        tickSize: 0.5,
      };

      const result = detectAbsorption(input);
      expect(result).toBeDefined();
      expect(result?.side).toBe("bearish");
      expect(result?.price).toBe(110);
      expect(result?.delta).toBe(4_800);
    });

    it("returns undefined when volume is below minimum threshold", () => {
      const input: AbsorptionInput = {
        levelPrice: 100,
        barOpen: 100,
        barHigh: 101,
        barLow: 99,
        barClose: 100,
        buyVolume: 200,
        sellVolume: 800,
        averageBarVolume: 2_000, // 1000 < 5000
        tickSize: 1.0,
      };

      expect(detectAbsorption(input)).toBeUndefined();
    });
  });

  describe("calculateDepletionVelocity", () => {
    it("computes wall depletion rate per second", () => {
      // 80 contracts out of 100 taken in 2 seconds = (80 / 100) / 2 = 0.40/sec
      expect(calculateDepletionVelocity(80, 100, 2)).toBe(0.4);
      expect(calculateDepletionVelocity(0, 100, 2)).toBe(0);
      expect(calculateDepletionVelocity(50, 0, 2)).toBe(0);
    });
  });

  describe("detectIceberg", () => {
    it("identifies iceberg when executed volume is 2.5x or more of visible peak", () => {
      expect(detectIceberg(250, 100, 3)).toBe(true);
      expect(detectIceberg(300, 100, 4)).toBe(true);
    });

    it("returns false if touch count is insufficient or ratio is low", () => {
      expect(detectIceberg(250, 100, 1)).toBe(false); // only 1 touch
      expect(detectIceberg(150, 100, 3)).toBe(false); // ratio 1.5 < 2.5
    });
  });

  describe("detectLiquidityVacuum", () => {
    it("flags true when immediate depth is <= 25% of baseline", () => {
      expect(detectLiquidityVacuum(20, 100)).toBe(true);
      expect(detectLiquidityVacuum(25, 100)).toBe(true);
    });

    it("flags false when depth is normal", () => {
      expect(detectLiquidityVacuum(60, 100)).toBe(false);
      expect(detectLiquidityVacuum(10, 0)).toBe(false);
    });
  });
});
