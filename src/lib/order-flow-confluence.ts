/**
 * Multi-factor Order Flow + Market Structure confluence scoring engine.
 * Computes a composite 0-100 score across 5 weighted dimensions.
 */

export type ConfluenceBias = "bullish" | "bearish" | "neutral";
export type ConfluenceGrade = "PRIME" | "QUALITY" | "SUB_THRESHOLD";

export interface StructureFactor {
  readonly inFvg: boolean;
  readonly atPivot: boolean;
  readonly hasChoch: boolean;
}

export interface LiquidityFactor {
  readonly relativeStrength: number;
  readonly persistenceScore: number;
}

export interface TapeFactor {
  readonly absorptionDetected: boolean;
  readonly absorptionRatio: number;
  readonly cvdDivergence: boolean;
}

export interface ImbalanceFactor {
  readonly obi: number;
  readonly ofiAligned: boolean;
}

export interface SweepFactor {
  readonly sweepDetected: boolean;
}

export interface ConfluenceFactors {
  readonly bias: ConfluenceBias;
  readonly structure: StructureFactor;
  readonly liquidity: LiquidityFactor;
  readonly tape: TapeFactor;
  readonly imbalance: ImbalanceFactor;
  readonly sweep: SweepFactor;
}

export interface ConfluenceBreakdown {
  readonly structurePoints: number;
  readonly liquidityPoints: number;
  readonly tapePoints: number;
  readonly imbalancePoints: number;
  readonly sweepPoints: number;
}

export interface ConfluenceEvaluation {
  readonly bias: ConfluenceBias;
  readonly score: number;
  readonly grade: ConfluenceGrade;
  readonly breakdown: ConfluenceBreakdown;
}

/**
 * Calculates score for market structure dimension (max 25 pts).
 */
function scoreStructure(factor: StructureFactor): number {
  let points = 0;
  if (factor.inFvg || factor.atPivot) points += 20;
  if (factor.hasChoch) points += 5;
  return points;
}

/**
 * Calculates score for resting limit liquidity dimension (max 20 pts).
 */
function scoreLiquidity(factor: LiquidityFactor): number {
  if (factor.relativeStrength >= 3.0 && factor.persistenceScore >= 0.7) {
    return 20;
  }
  if (factor.relativeStrength >= 2.0) {
    return 10;
  }
  return 0;
}

/**
 * Calculates score for tape aggression and absorption dimension (max 25 pts).
 */
function scoreTape(factor: TapeFactor): number {
  let points = 0;
  if (factor.absorptionDetected && factor.absorptionRatio >= 3.0) points += 15;
  else if (factor.absorptionDetected) points += 8;
  if (factor.cvdDivergence) points += 10;
  return points;
}

/**
 * Calculates score for order book and order flow imbalance dimension (max 15 pts).
 */
function scoreImbalance(factor: ImbalanceFactor, bias: ConfluenceBias): number {
  let points = 0;
  const isObiAligned = bias === "bullish" ? factor.obi >= 0.4 : factor.obi <= -0.4;
  if (isObiAligned) points += 10;
  if (factor.ofiAligned) points += 5;
  return points;
}

/**
 * Evaluates the full multi-factor confluence matrix.
 */
export function evaluateConfluence(factors: ConfluenceFactors): ConfluenceEvaluation {
  if (factors.bias === "neutral") {
    return {
      bias: "neutral",
      score: 0,
      grade: "SUB_THRESHOLD",
      breakdown: { structurePoints: 0, liquidityPoints: 0, tapePoints: 0, imbalancePoints: 0, sweepPoints: 0 },
    };
  }

  const structurePoints = scoreStructure(factors.structure);
  const liquidityPoints = scoreLiquidity(factors.liquidity);
  const tapePoints = scoreTape(factors.tape);
  const imbalancePoints = scoreImbalance(factors.imbalance, factors.bias);
  const sweepPoints = factors.sweep.sweepDetected ? 15 : 0;

  const score = structurePoints + liquidityPoints + tapePoints + imbalancePoints + sweepPoints;
  const grade: ConfluenceGrade = score >= 80 ? "PRIME" : score >= 65 ? "QUALITY" : "SUB_THRESHOLD";

  return {
    bias: factors.bias,
    score,
    grade,
    breakdown: { structurePoints, liquidityPoints, tapePoints, imbalancePoints, sweepPoints },
  };
}
