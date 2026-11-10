import { describe, expect, test } from "bun:test";
import {
  BACK_MS,
  easeProgress,
  FlowScale,
  IN_MS,
  nextParticles,
  particleFrame,
  TOTAL_FLOW_MS,
  TradeFlowBatcher,
  type FlowParticle,
  type TradeBatch,
} from "./trade-flow";

describe("TradeFlowBatcher", () => {
  test("merges same key and aggressor within the window", () => {
    const batcher = new TradeFlowBatcher(150);
    batcher.add({ key: 10, aggressor: "buy", quantity: 2.5, at: 100 });
    batcher.add({ key: 10, aggressor: "buy", quantity: 3.5, at: 200 });

    expect(batcher.drain(200)).toEqual([]);
    expect(batcher.drain(250)).toEqual([
      { key: 10, aggressor: "buy", quantity: 6.0, at: 100 },
    ]);
    expect(batcher.drain(300)).toEqual([]);
  });

  test("splits across keys and sides within the same time window", () => {
    const batcher = new TradeFlowBatcher(150);
    batcher.add({ key: 10, aggressor: "buy", quantity: 1, at: 100 });
    batcher.add({ key: 10, aggressor: "sell", quantity: 2, at: 110 });
    batcher.add({ key: 11, aggressor: "buy", quantity: 3, at: 120 });

    const drained = batcher.drain(270);
    expect(drained).toHaveLength(3);
    expect(drained).toContainEqual({ key: 10, aggressor: "buy", quantity: 1, at: 100 });
    expect(drained).toContainEqual({ key: 10, aggressor: "sell", quantity: 2, at: 110 });
    expect(drained).toContainEqual({ key: 11, aggressor: "buy", quantity: 3, at: 120 });
  });

  test("splits across time windows for the same key and side", () => {
    const batcher = new TradeFlowBatcher(150);
    batcher.add({ key: 20, aggressor: "buy", quantity: 4, at: 100 });
    batcher.add({ key: 20, aggressor: "buy", quantity: 5, at: 300 });

    const firstDrain = batcher.drain(260);
    expect(firstDrain).toEqual([
      { key: 20, aggressor: "buy", quantity: 4, at: 100 },
    ]);

    expect(batcher.drain(350)).toEqual([]);
    expect(batcher.drain(460)).toEqual([
      { key: 20, aggressor: "buy", quantity: 5, at: 300 },
    ]);
  });

  test("ignores non-positive and non-finite quantities", () => {
    const batcher = new TradeFlowBatcher(150);
    batcher.add({ key: 5, aggressor: "buy", quantity: 0, at: 100 });
    batcher.add({ key: 5, aggressor: "buy", quantity: -10, at: 100 });
    batcher.add({ key: 5, aggressor: "buy", quantity: Number.NaN, at: 100 });
    expect(batcher.drain(300)).toEqual([]);
  });
});

describe("nextParticles", () => {
  test("skips tiny batches below minQuantity", () => {
    const batches: TradeBatch[] = [
      { key: 1, aggressor: "buy", quantity: 0.1, at: 100 },
      { key: 2, aggressor: "sell", quantity: 5.0, at: 100 },
    ];
    const particles = nextParticles([], batches, { now: 1000, minQuantity: 1.0 });
    expect(particles).toHaveLength(1);
    expect(particles[0]?.key).toBe(2);
    expect(particles[0]?.quantity).toBe(5.0);
  });

  test("drops oldest particles when exceeding maxParticles cap", () => {
    const existing: FlowParticle[] = Array.from({ length: 38 }, (_, i) => ({
      id: i,
      key: i,
      aggressor: "buy" as const,
      quantity: 10,
      startedAt: 1000,
    }));
    const newBatches: TradeBatch[] = [
      { key: 100, aggressor: "sell", quantity: 2, at: 1000 },
      { key: 101, aggressor: "sell", quantity: 3, at: 1000 },
      { key: 102, aggressor: "sell", quantity: 4, at: 1000 },
      { key: 103, aggressor: "sell", quantity: 5, at: 1000 },
    ];
    const result = nextParticles(existing, newBatches, { now: 1000, maxParticles: 40 });
    expect(result).toHaveLength(40);
    // Oldest 2 existing dropped (ids 0 and 1)
    expect(result[0]?.id).toBe(2);
    expect(result[result.length - 1]?.key).toBe(103);
  });

  test("removes finished particles based on elapsed total flow duration", () => {
    const now = 1_000 + TOTAL_FLOW_MS;
    const existing: FlowParticle[] = [
      { id: 1, key: 1, aggressor: "buy", quantity: 10, startedAt: now - TOTAL_FLOW_MS - 50 },
      { id: 2, key: 2, aggressor: "sell", quantity: 15, startedAt: now - TOTAL_FLOW_MS / 2 },
    ];
    const result = nextParticles(existing, [], { now });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(2);
  });
});

describe("particleFrame and easeProgress", () => {
  const sampleParticle: FlowParticle = {
    id: 99,
    key: 42,
    aggressor: "buy",
    quantity: 16,
    startedAt: 1000,
  };

  test("advances phases in -> back -> done at correct times", () => {
    const frameStart = particleFrame(sampleParticle, 1000);
    expect(frameStart.phase).toBe("in");
    expect(frameStart.progress).toBe(0);

    const frameMidIn = particleFrame(sampleParticle, 1000 + IN_MS / 2);
    expect(frameMidIn.phase).toBe("in");
    expect(frameMidIn.progress).toBeGreaterThan(0);
    expect(frameMidIn.progress).toBeLessThan(1);

    const frameBackStart = particleFrame(sampleParticle, 1000 + IN_MS);
    expect(frameBackStart.phase).toBe("back");
    expect(frameBackStart.progress).toBe(0);

    const frameMidBack = particleFrame(sampleParticle, 1000 + IN_MS + BACK_MS / 2);
    expect(frameBackStart.phase).toBe("back");
    expect(frameMidBack.progress).toBeGreaterThan(0);
    expect(frameMidBack.progress).toBeLessThan(1);

    const frameDone = particleFrame(sampleParticle, 1000 + TOTAL_FLOW_MS);
    expect(frameDone.phase).toBe("done");
    expect(frameDone.progress).toBe(1);
  });

  test("scales radius with sqrt(quantity / referenceQuantity) and clamps", () => {
    // 16 / 16 = 1 -> sqrt(1) = 1
    const unitScale = particleFrame(sampleParticle, 1000, 16).radiusScale;
    expect(unitScale).toBe(1);

    // 16 / 4 = 4 -> sqrt(4) = 2
    const doubleScale = particleFrame(sampleParticle, 1000, 4).radiusScale;
    expect(doubleScale).toBe(2);

    // Clamps to max 2.5
    const largeScale = particleFrame(sampleParticle, 1000, 0.01).radiusScale;
    expect(largeScale).toBe(2.5);

    // Clamps to min 0.25
    const smallScale = particleFrame(sampleParticle, 1000, 10_000).radiusScale;
    expect(smallScale).toBe(0.25);
  });

  test("easing is strictly monotonic on [0, 1]", () => {
    expect(easeProgress(0)).toBe(0);
    expect(easeProgress(1)).toBe(1);

    let previous = -1;
    for (let step = 0; step <= 100; step++) {
      const t = step / 100;
      const current = easeProgress(t);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });
});

describe("FlowScale", () => {
  const batch = (quantity: number) => ({ key: 1, aggressor: "buy" as const, quantity, at: 0 });

  test("should have no thresholds before any batch is seen", () => {
    expect(new FlowScale().thresholds()).toBeUndefined();
  });

  test("should derive the noise cutoff and size reference from recent batches", () => {
    const scale = new FlowScale();
    scale.observe([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(batch));
    expect(scale.thresholds()).toEqual({ minQuantity: 1.5, referenceQuantity: 10 });
  });

  test("should keep only the most recent samples", () => {
    const scale = new FlowScale();
    scale.observe(Array.from({ length: 300 }, () => batch(1000)));
    scale.observe(Array.from({ length: 200 }, () => batch(1)));
    expect(scale.thresholds()?.referenceQuantity).toBe(1);
  });
});
