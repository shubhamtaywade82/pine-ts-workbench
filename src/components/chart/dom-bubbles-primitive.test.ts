import { describe, expect, it } from "bun:test";
import {
  calculateBubbleRadius,
  DomBubblesPrimitive,
  resolveBubbleColor,
  type LiquidityBubble,
} from "./dom-bubbles-primitive";

describe("dom-bubbles-primitive", () => {
  describe("calculateBubbleRadius", () => {
    it("returns minRadius for non-positive or tiny notional", () => {
      expect(calculateBubbleRadius(0)).toBe(3);
      expect(calculateBubbleRadius(-500)).toBe(3);
    });

    it("scales logarithmically with notional and caps at maxRadius", () => {
      const r1 = calculateBubbleRadius(1_000);
      const r2 = calculateBubbleRadius(100_000);
      const rMax = calculateBubbleRadius(10_000_000_000);

      expect(r1).toBeGreaterThan(3);
      expect(r2).toBeGreaterThan(r1);
      expect(rMax).toBe(22);
    });
  });

  describe("resolveBubbleColor", () => {
    it("returns muted grey tones when level was pulled", () => {
      const bubble: LiquidityBubble = {
        price: 100,
        notional: 50_000,
        side: "bid",
        persistence: 0.8,
        isPulled: true,
      };
      const colors = resolveBubbleColor(bubble);
      expect(colors.fill).toContain("150, 150, 150");
    });

    it("returns amber pulse tones when level is under active attack", () => {
      const bubble: LiquidityBubble = {
        price: 100,
        notional: 50_000,
        side: "bid",
        persistence: 0.8,
        isAttacked: true,
      };
      const colors = resolveBubbleColor(bubble);
      expect(colors.fill).toContain("255, 179, 0");
    });

    it("returns emerald green for committed bid liquidity", () => {
      const bubble: LiquidityBubble = {
        price: 100,
        notional: 50_000,
        side: "bid",
        persistence: 0.85,
      };
      const colors = resolveBubbleColor(bubble);
      expect(colors.fill).toContain("0, 230, 118");
    });

    it("returns crimson red for committed ask liquidity", () => {
      const bubble: LiquidityBubble = {
        price: 105,
        notional: 50_000,
        side: "ask",
        persistence: 0.9,
      };
      const colors = resolveBubbleColor(bubble);
      expect(colors.fill).toContain("255, 23, 68");
    });
  });

  describe("DomBubblesPrimitive", () => {
    it("initializes cleanly and exposes paneViews", () => {
      const primitive = new DomBubblesPrimitive();
      const views = primitive.paneViews();
      expect(views).toHaveLength(1);
      expect(views[0].renderer()).toBeDefined();
    });
  });
});
