import { describe, expect, it } from "bun:test";
import { evaluateConfluence, type ConfluenceFactors } from "./order-flow-confluence";

describe("order-flow-confluence", () => {
  it("scores 0 and SUB_THRESHOLD for neutral bias", () => {
    const factors: ConfluenceFactors = {
      bias: "neutral",
      structure: { inFvg: true, atPivot: true, hasChoch: true },
      liquidity: { relativeStrength: 3.5, persistenceScore: 0.9 },
      tape: { absorptionDetected: true, absorptionRatio: 4.0, cvdDivergence: true },
      imbalance: { obi: 0.6, ofiAligned: true },
      sweep: { sweepDetected: true },
    };

    const evalRes = evaluateConfluence(factors);
    expect(evalRes.score).toBe(0);
    expect(evalRes.grade).toBe("SUB_THRESHOLD");
  });

  it("calculates PRIME grade (score >= 80) when institutional confluence factors align", () => {
    const factors: ConfluenceFactors = {
      bias: "bullish",
      structure: { inFvg: true, atPivot: false, hasChoch: true }, // 20 + 5 = 25
      liquidity: { relativeStrength: 3.5, persistenceScore: 0.85 }, // 20
      tape: { absorptionDetected: true, absorptionRatio: 3.8, cvdDivergence: true }, // 15 + 10 = 25
      imbalance: { obi: 0.55, ofiAligned: true }, // 10 + 5 = 15
      sweep: { sweepDetected: true }, // 15
    };

    const evalRes = evaluateConfluence(factors);
    // Total: 25 + 20 + 25 + 15 + 15 = 100
    expect(evalRes.score).toBe(100);
    expect(evalRes.grade).toBe("PRIME");
    expect(evalRes.breakdown.structurePoints).toBe(25);
    expect(evalRes.breakdown.liquidityPoints).toBe(20);
    expect(evalRes.breakdown.tapePoints).toBe(25);
    expect(evalRes.breakdown.imbalancePoints).toBe(15);
    expect(evalRes.breakdown.sweepPoints).toBe(15);
  });

  it("calculates QUALITY grade (65 <= score < 80) for partial confluence", () => {
    const factors: ConfluenceFactors = {
      bias: "bearish",
      structure: { inFvg: true, atPivot: false, hasChoch: false }, // 20
      liquidity: { relativeStrength: 2.2, persistenceScore: 0.5 }, // 10
      tape: { absorptionDetected: true, absorptionRatio: 3.2, cvdDivergence: false }, // 15
      imbalance: { obi: -0.45, ofiAligned: true }, // 10 + 5 = 15
      sweep: { sweepDetected: true }, // 15
    };

    const evalRes = evaluateConfluence(factors);
    // 20 + 10 + 15 + 15 + 15 = 75
    expect(evalRes.score).toBe(75);
    expect(evalRes.grade).toBe("QUALITY");
  });

  it("calculates SUB_THRESHOLD when signals are weak or opposing", () => {
    const factors: ConfluenceFactors = {
      bias: "bullish",
      structure: { inFvg: false, atPivot: false, hasChoch: false }, // 0
      liquidity: { relativeStrength: 1.2, persistenceScore: 0.1 }, // 0
      tape: { absorptionDetected: false, absorptionRatio: 0, cvdDivergence: false }, // 0
      imbalance: { obi: -0.5, ofiAligned: false }, // opposing OBI => 0
      sweep: { sweepDetected: true }, // 15
    };

    const evalRes = evaluateConfluence(factors);
    expect(evalRes.score).toBe(15);
    expect(evalRes.grade).toBe("SUB_THRESHOLD");
  });
});
