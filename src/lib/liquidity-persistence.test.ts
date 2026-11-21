import { describe, expect, it } from "bun:test";
import {
  calculatePersistenceScore,
  calculateVelocity,
  isSpoofing,
  PersistenceTracker,
} from "./liquidity-persistence";

describe("liquidity-persistence", () => {
  describe("calculatePersistenceScore", () => {
    it("returns 0 for negative or zero duration/window", () => {
      expect(calculatePersistenceScore(0, 60_000)).toBe(0);
      expect(calculatePersistenceScore(10_000, 0)).toBe(0);
      expect(calculatePersistenceScore(-100, 60_000)).toBe(0);
    });

    it("calculates ratio and caps at 1.0", () => {
      expect(calculatePersistenceScore(30_000, 60_000)).toBe(0.5);
      expect(calculatePersistenceScore(60_000, 60_000)).toBe(1.0);
      expect(calculatePersistenceScore(90_000, 60_000)).toBe(1.0);
    });
  });

  describe("calculateVelocity", () => {
    it("computes quantity per second", () => {
      expect(calculateVelocity(100, 10)).toBe(10);
      expect(calculateVelocity(500, 2)).toBe(250);
      expect(calculateVelocity(0, 10)).toBe(0);
      expect(calculateVelocity(100, 0)).toBe(0);
    });
  });

  describe("isSpoofing", () => {
    it("flags true for short-lived orders pulled within 3 ticks", () => {
      expect(isSpoofing(0.1, 0.9, 2)).toBe(true);
    });

    it("flags false if order had high persistence (committed)", () => {
      expect(isSpoofing(0.8, 0.9, 1)).toBe(false);
    });

    it("flags false if pulled far away from active price", () => {
      expect(isSpoofing(0.1, 0.9, 10)).toBe(false);
    });

    it("flags false if only a small fraction was pulled", () => {
      expect(isSpoofing(0.1, 0.3, 1)).toBe(false);
    });
  });

  describe("PersistenceTracker", () => {
    it("tracks presence duration and marks level as committed after sufficient time", () => {
      const tracker = new PersistenceTracker({ windowMs: 10_000, committedThreshold: 0.7 });
      const t0 = 1_000_000;

      tracker.record(100, 50_000, t0);
      const initial = tracker.get(100, t0);
      expect(initial?.isCommitted).toBe(false);
      expect(initial?.persistenceScore).toBe(0);

      // Advance by 8 seconds (8,000ms out of 10,000ms window = 80%)
      tracker.record(100, 55_000, t0 + 8_000);
      const sustained = tracker.get(100, t0 + 8_000);
      expect(sustained?.persistenceScore).toBeCloseTo(0.8);
      expect(sustained?.isCommitted).toBe(true);
      expect(sustained?.peakNotional).toBe(55_000);
    });

    it("detects spoof candidate on rapid removal near price", () => {
      const tracker = new PersistenceTracker({ windowMs: 60_000 });
      const t0 = 1_000_000;

      // Wall flashed for only 2 seconds (score: 2,000 / 60,000 = 0.033 < 0.25)
      tracker.record(100, 100_000, t0);
      tracker.record(100, 100_000, t0 + 2_000);

      // Removed when last price is 100.2 (2 ticks away with tickSize 0.1)
      tracker.recordRemoval(100, 95_000, t0 + 2_100, 100.2, 0.1);

      const status = tracker.get(100, t0 + 2_100);
      expect(status?.isSpoofCandidate).toBe(true);
      expect(status?.currentNotional).toBe(0);
    });

    it("prunes expired levels older than the window", () => {
      const tracker = new PersistenceTracker({ windowMs: 5_000 });
      const t0 = 1_000_000;

      tracker.record(100, 10_000, t0);
      tracker.prune(t0 + 6_000);

      expect(tracker.get(100, t0 + 6_000)).toBeUndefined();
    });

    it("returns all active levels via getAll", () => {
      const tracker = new PersistenceTracker({ windowMs: 10_000 });
      const t0 = 1_000_000;

      tracker.record(100, 10_000, t0);
      tracker.record(200, 20_000, t0);

      const all = tracker.getAll(t0);
      expect(all.length).toBe(2);
      expect(all.map((x) => x.price).sort()).toEqual([100, 200]);
    });
  });
});
