import { describe, expect, it } from "bun:test";
import {
  detectFvg,
  detectPivot,
  isPriceInFvg,
  updateFvgMitigation,
  type MarketBar,
} from "./market-structure";

describe("market-structure", () => {
  const makeBar = (high: number, low: number, index: number): MarketBar => ({
    time: 1_000_000 + index * 60_000,
    open: (high + low) / 2,
    high,
    low,
    close: (high + low) / 2,
    volume: 1_000,
  });

  describe("detectFvg", () => {
    it("detects bullish FVG when bar 2 low is higher than bar 0 high", () => {
      const bars = [
        makeBar(100, 95, 0),  // High: 100
        makeBar(105, 99, 1),  // Middle impulse
        makeBar(110, 103, 2), // Low: 103 > 100
      ];

      const fvg = detectFvg(bars, 2);
      expect(fvg).toBeDefined();
      expect(fvg?.kind).toBe("bullish");
      expect(fvg?.bottom).toBe(100);
      expect(fvg?.top).toBe(103);
      expect(fvg?.isMitigated).toBe(false);
    });

    it("detects bearish FVG when bar 2 high is lower than bar 0 low", () => {
      const bars = [
        makeBar(110, 105, 0), // Low: 105
        makeBar(106, 98, 1),  // Middle impulse
        makeBar(102, 95, 2),  // High: 102 < 105
      ];

      const fvg = detectFvg(bars, 2);
      expect(fvg).toBeDefined();
      expect(fvg?.kind).toBe("bearish");
      expect(fvg?.top).toBe(105);
      expect(fvg?.bottom).toBe(102);
    });

    it("returns undefined when no gap exists", () => {
      const bars = [
        makeBar(100, 95, 0),
        makeBar(102, 98, 1),
        makeBar(105, 99, 2), // Low 99 <= High 100 -> overlap
      ];

      expect(detectFvg(bars, 2)).toBeUndefined();
    });
  });

  describe("updateFvgMitigation", () => {
    it("marks bullish FVG as mitigated when price penetrates bottom", () => {
      const fvg = {
        id: "bull-1",
        kind: "bullish" as const,
        top: 105,
        bottom: 100,
        createdBarIndex: 2,
        isMitigated: false,
      };

      expect(updateFvgMitigation(fvg, 108, 102)).toBe(false); // partially penetrated, not fully through
      expect(fvg.isMitigated).toBe(false);

      expect(updateFvgMitigation(fvg, 104, 99)).toBe(true); // breached bottom 100
      expect(fvg.isMitigated).toBe(true);
    });
  });

  describe("isPriceInFvg", () => {
    it("identifies if price is inside active gap", () => {
      const fvg = {
        id: "bull-1",
        kind: "bullish" as const,
        top: 105,
        bottom: 100,
        createdBarIndex: 2,
        isMitigated: false,
      };

      expect(isPriceInFvg(fvg, 102.5)).toBe(true);
      expect(isPriceInFvg(fvg, 106.0)).toBe(false);
      expect(isPriceInFvg(fvg, 99.0)).toBe(false);

      fvg.isMitigated = true;
      expect(isPriceInFvg(fvg, 102.5)).toBe(false);
    });
  });

  describe("detectPivot", () => {
    it("detects swing high when center bar is strictly higher than neighbors", () => {
      const bars = [
        makeBar(100, 95, 0),
        makeBar(102, 96, 1),
        makeBar(108, 100, 2), // Pivot high
        makeBar(105, 98, 3),
        makeBar(101, 95, 4),
      ];

      const pivot = detectPivot(bars, 2, 2);
      expect(pivot).toBeDefined();
      expect(pivot?.kind).toBe("high");
      expect(pivot?.price).toBe(108);
    });

    it("detects swing low when center bar is strictly lower than neighbors", () => {
      const bars = [
        makeBar(105, 98, 0),
        makeBar(103, 94, 1),
        makeBar(99, 90, 2), // Pivot low
        makeBar(102, 93, 3),
        makeBar(104, 95, 4),
      ];

      const pivot = detectPivot(bars, 2, 2);
      expect(pivot).toBeDefined();
      expect(pivot?.kind).toBe("low");
      expect(pivot?.price).toBe(90);
    });
  });
});
