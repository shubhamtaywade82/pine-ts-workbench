import { describe, expect, it } from "bun:test";
import {
  calculateDepthDensity,
  calculateMicroprice,
  calculateMultiTierObi,
  calculateObi,
  calculateOfi,
  type TopOfBook,
} from "./order-book-metrics";

describe("order-book-metrics", () => {
  describe("calculateObi", () => {
    it("returns 0 for an empty book", () => {
      const res = calculateObi([], [], 5);
      expect(res.obi).toBe(0);
      expect(res.bidQty).toBe(0);
      expect(res.askQty).toBe(0);
    });

    it("returns 0 for perfectly balanced liquidity", () => {
      const bids = [[100, 10], [99, 10]] as const;
      const asks = [[101, 10], [102, 10]] as const;
      const res = calculateObi(bids, asks, 2);
      expect(res.obi).toBe(0);
      expect(res.bidQty).toBe(20);
      expect(res.askQty).toBe(20);
    });

    it("returns +1.0 when only bids exist", () => {
      const bids = [[100, 50]] as const;
      const asks = [] as const;
      const res = calculateObi(bids, asks, 5);
      expect(res.obi).toBe(1.0);
      expect(res.bidQty).toBe(50);
      expect(res.askQty).toBe(0);
    });

    it("returns -1.0 when only asks exist", () => {
      const bids = [] as const;
      const asks = [[101, 40]] as const;
      const res = calculateObi(bids, asks, 5);
      expect(res.obi).toBe(-1.0);
    });

    it("respects tier bounds and excludes deeper levels", () => {
      const bids = [[100, 10], [99, 10], [98, 100]] as const;
      const asks = [[101, 30], [102, 30], [103, 300]] as const;

      // Tier 2: bids sum = 20, asks sum = 60 => (20 - 60) / 80 = -0.5
      const tier2 = calculateObi(bids, asks, 2);
      expect(tier2.bidQty).toBe(20);
      expect(tier2.askQty).toBe(60);
      expect(tier2.obi).toBeCloseTo(-0.5);

      // Tier 3: bids sum = 120, asks sum = 360 => (120 - 360) / 480 = -0.5
      const tier3 = calculateObi(bids, asks, 3);
      expect(tier3.bidQty).toBe(120);
      expect(tier3.askQty).toBe(360);
    });
  });

  describe("calculateMultiTierObi", () => {
    it("evaluates custom tiers and computes decaying weighted average", () => {
      const bids = [[100, 30], [99, 10]] as const;
      const asks = [[101, 10], [102, 10]] as const;

      const multi = calculateMultiTierObi(bids, asks, [1, 2]);
      expect(multi.tiers.length).toBe(2);

      // Tier 1: (30 - 10) / 40 = +0.5 (weight = 1.0)
      expect(multi.tiers[0].obi).toBeCloseTo(0.5);
      // Tier 2: (40 - 20) / 60 = +0.3333 (weight = 0.5)
      expect(multi.tiers[1].obi).toBeCloseTo(0.3333, 3);

      // Weighted: (0.5 * 1.0 + 0.3333 * 0.5) / 1.5 = (0.5 + 0.16666) / 1.5 = 0.4444
      expect(multi.weightedObi).toBeCloseTo(0.4444, 3);
    });
  });

  describe("calculateOfi", () => {
    const prev: TopOfBook = {
      bidPrice: 100,
      bidQty: 10,
      askPrice: 101,
      askQty: 10,
    };

    it("evaluates price improvement on bid side (buyer raised bid)", () => {
      const curr: TopOfBook = {
        bidPrice: 100.5,
        bidQty: 15,
        askPrice: 101,
        askQty: 10,
      };
      // bidPrice improved: +15, ask unchanged: 0 => OFI = +15
      expect(calculateOfi(curr, prev)).toBe(15);
    });

    it("evaluates queue addition at identical prices", () => {
      const curr: TopOfBook = {
        bidPrice: 100,
        bidQty: 25, // +15
        askPrice: 101,
        askQty: 5,  // -5
      };
      // bidDelta = 25 - 10 = +15, askDelta = 5 - 10 = -5 => OFI = 15 - (-5) = 20
      expect(calculateOfi(curr, prev)).toBe(20);
    });

    it("evaluates bid drop (buyer pulled or hit)", () => {
      const curr: TopOfBook = {
        bidPrice: 99.5,
        bidQty: 20,
        askPrice: 101,
        askQty: 10,
      };
      // bidPrice fell: -10 (prev.bidQty dropped), ask unchanged: 0 => OFI = -10
      expect(calculateOfi(curr, prev)).toBe(-10);
    });

    it("evaluates aggressive seller lowering ask", () => {
      const curr: TopOfBook = {
        bidPrice: 100,
        bidQty: 10,
        askPrice: 100.5,
        askQty: 12,
      };
      // bid unchanged: 0, ask price dropped: askDelta = 12 => OFI = 0 - 12 = -12
      expect(calculateOfi(curr, prev)).toBe(-12);
    });
  });

  describe("calculateMicroprice", () => {
    it("returns exact midpoint when bid and ask quantities are equal", () => {
      const top: TopOfBook = {
        bidPrice: 100,
        bidQty: 10,
        askPrice: 102,
        askQty: 10,
      };
      expect(calculateMicroprice(top)).toBe(101);
    });

    it("shifts toward ask price when bid queue is much larger", () => {
      const top: TopOfBook = {
        bidPrice: 100,
        bidQty: 90,
        askPrice: 102,
        askQty: 10,
      };
      // (90 * 102 + 10 * 100) / 100 = (9180 + 1000) / 100 = 101.8
      expect(calculateMicroprice(top)).toBeCloseTo(101.8);
    });

    it("returns undefined for crossed or invalid books", () => {
      const crossed: TopOfBook = {
        bidPrice: 105,
        bidQty: 10,
        askPrice: 100,
        askQty: 10,
      };
      expect(calculateMicroprice(crossed)).toBeUndefined();
    });
  });

  describe("calculateDepthDensity", () => {
    it("sums cumulative volume up to requested depth levels", () => {
      const levels = [[100, 5], [99, 15], [98, 30]] as const;
      expect(calculateDepthDensity(levels, 2)).toBe(20);
      expect(calculateDepthDensity(levels, 5)).toBe(50);
    });
  });
});
