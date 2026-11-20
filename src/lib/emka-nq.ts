export type GammaRegime = "positive" | "negative";

export interface GexLevels {
  readonly putWall: number;
  readonly callWall: number;
  readonly gammaFlip: number;
  readonly maxPain?: number;
}

export interface PositionSizeResult {
  readonly contracts: number;
  readonly dollarRisk: number;
  readonly stopDistancePoints: number;
  readonly valid: boolean;
}

export interface PositionSizeParams {
  readonly equity: number;
  readonly riskPercent: number;
  readonly entryPrice: number;
  readonly stopLossPrice: number;
  readonly pointValue?: number;
}

export interface AbsorptionParams {
  readonly candleClose: number;
  readonly putWall: number;
  readonly delta: number;
  readonly volume: number;
  readonly avgVolume: number;
  readonly tolerancePct?: number;
}

export interface SweepParams {
  readonly candleLow: number;
  readonly candleVolume: number;
  readonly candleDelta: number;
  readonly putWall: number;
  readonly absorptionVolume: number;
}

// In positive gamma, dealer hedging dampens moves and stabilizes support levels.
export const evaluateGammaRegime = (spot: number, gammaFlip: number): GammaRegime =>
  spot >= gammaFlip ? "positive" : "negative";

// Absorption is identified when aggressive selling stalls at resting limit support.
export const checkAbsorption = (params: AbsorptionParams): boolean => {
  const tolerance = params.tolerancePct ?? 0.002;
  const nearPutWall = Math.abs(params.candleClose - params.putWall) / params.putWall <= tolerance;
  const highAggression = params.volume >= params.avgVolume * 1.5 && params.delta < 0;
  return nearPutWall && highAggression;
};

// Exhaustion sweep requires a probe below support with depleted volume and weak delta.
export const checkExhaustionSweep = (params: SweepParams): boolean => {
  const probedBelow = params.candleLow < params.putWall;
  const volumeDrying = params.candleVolume < params.absorptionVolume * 0.7;
  const deltaWeakened = params.candleDelta > -Math.abs(params.absorptionVolume * 0.4);
  return probedBelow && volumeDrying && deltaWeakened;
};

// Bullish divergence confirms aggressive selling collapsed despite lower price print.
export const isBullishCvdDivergence = (
  priorPriceLow: number,
  currentPriceLow: number,
  priorCvd: number,
  currentCvd: number,
): boolean => currentPriceLow < priorPriceLow && currentCvd > priorCvd;

// Multiplier is $20 for NQ and $2 for MNQ per point of price movement.
export const calculateNqPositionSize = (params: PositionSizeParams): PositionSizeResult => {
  const pointValue = params.pointValue ?? 20;
  const stopDistancePoints = Math.abs(params.entryPrice - params.stopLossPrice);
  if (stopDistancePoints <= 0 || params.equity <= 0 || params.riskPercent <= 0) {
    return { contracts: 0, dollarRisk: 0, stopDistancePoints: 0, valid: false };
  }
  const dollarRisk = params.equity * (params.riskPercent / 100);
  const riskPerContract = stopDistancePoints * pointValue;
  const contracts = Math.floor(dollarRisk / riskPerContract);
  return { contracts, dollarRisk, stopDistancePoints, valid: contracts >= 1 };
};
