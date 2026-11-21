/**
 * Microstructure detectors for institutional order flow:
 * Absorption (wall holding against aggression), wall depletion velocity,
 * hidden iceberg inference, and liquidity vacuums.
 */

export interface AbsorptionInput {
  readonly levelPrice: number;
  readonly barOpen: number;
  readonly barHigh: number;
  readonly barLow: number;
  readonly barClose: number;
  readonly buyVolume: number;
  readonly sellVolume: number;
  readonly averageBarVolume: number;
  readonly tickSize: number;
}

export type AbsorptionSide = "bullish" | "bearish";

export interface AbsorptionResult {
  readonly side: AbsorptionSide;
  readonly price: number;
  readonly volume: number;
  readonly delta: number;
  readonly absorptionRatio: number;
}

const DEFAULT_VOLUME_MULTIPLIER = 2.5;

/**
 * Calculates ratio of aggressor volume to price displacement.
 * High ratios indicate heavy trading with minimal price movement (absorption).
 */
export function calculateAbsorptionRatio(
  aggressorVolume: number,
  priceDisplacement: number,
  tickSize: number
): number {
  const safeTicks = (Math.abs(priceDisplacement) + Math.max(0.000001, tickSize)) / tickSize;
  return aggressorVolume / safeTicks;
}

/**
 * Detects whether aggressive market orders were absorbed by passive limit orders at a level.
 */
export function detectAbsorption(input: AbsorptionInput): AbsorptionResult | undefined {
  const totalVolume = input.buyVolume + input.sellVolume;
  if (totalVolume < input.averageBarVolume * DEFAULT_VOLUME_MULTIPLIER) {
    return undefined;
  }

  const delta = input.buyVolume - input.sellVolume;
  const barSpread = input.barClose - input.barOpen;

  // Bullish: heavy aggressive selling absorbed by passive buy wall; bar holds and closes above low
  if (input.sellVolume > input.buyVolume * 1.5 && barSpread >= -input.tickSize && input.barClose > input.barLow) {
    const ratio = calculateAbsorptionRatio(input.sellVolume, barSpread, input.tickSize);
    return {
      side: "bullish",
      price: input.levelPrice,
      volume: totalVolume,
      delta,
      absorptionRatio: ratio,
    };
  }

  // Bearish: heavy aggressive buying absorbed by passive sell wall; bar stalls and closes below high
  if (input.buyVolume > input.sellVolume * 1.5 && barSpread <= input.tickSize && input.barClose < input.barHigh) {
    const ratio = calculateAbsorptionRatio(input.buyVolume, barSpread, input.tickSize);
    return {
      side: "bearish",
      price: input.levelPrice,
      volume: totalVolume,
      delta,
      absorptionRatio: ratio,
    };
  }

  return undefined;
}

/**
 * Computes the consumption speed of resting liquidity by market orders.
 * Ratio > 0.8 within short duration signifies rapid wall depletion.
 */
export function calculateDepletionVelocity(
  takerVolume: number,
  initialQuantity: number,
  durationSeconds: number
): number {
  if (initialQuantity <= 0 || durationSeconds <= 0) return 0;
  return (takerVolume / initialQuantity) / durationSeconds;
}

/**
 * Infers presence of an institutional iceberg order.
 * Occurs when executed volume vastly exceeds visible peak depth while level holds.
 */
export function detectIceberg(
  executedVolume: number,
  visiblePeakQuantity: number,
  touchCount: number
): boolean {
  if (visiblePeakQuantity <= 0 || touchCount < 2) return false;
  // Multiple touches with executed volume >= 2.5x visible depth indicates persistent hidden replenishment.
  return executedVolume / visiblePeakQuantity >= 2.5;
}

/**
 * Identifies a liquidity vacuum ahead of price.
 * When resting depth falls below 25% of baseline depth, market is prone to sudden slippage.
 */
export function detectLiquidityVacuum(
  immediateDepth: number,
  baselineMedianDepth: number
): boolean {
  if (baselineMedianDepth <= 0) return false;
  return immediateDepth / baselineMedianDepth <= 0.25;
}
