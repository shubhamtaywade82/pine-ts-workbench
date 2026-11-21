/**
 * Detects liquidity sweeps (stop hunts) across key structural swing levels.
 * Validates price penetration beyond the level followed by immediate reclaim.
 */

export interface SwingLevel {
  readonly price: number;
  readonly barIndex: number;
  readonly kind: "high" | "low";
}

export interface SweepInput {
  readonly currentHigh: number;
  readonly currentLow: number;
  readonly currentClose: number;
  readonly swingLevel: SwingLevel;
  readonly tickSize: number;
  readonly maxPenetrationTicks?: number;
}

export type SweepType = "bullish_sweep" | "bearish_sweep";

export interface SweepResult {
  readonly type: SweepType;
  readonly swingPrice: number;
  readonly breachPrice: number;
  readonly penetrationTicks: number;
  readonly closePrice: number;
}

const DEFAULT_MAX_PENETRATION_TICKS = 20;

/**
 * Checks whether current bar executed a stop-hunt sweep through a swing low.
 */
function checkBullishSweep(
  input: SweepInput,
  maxTicks: number
): SweepResult | undefined {
  const { currentLow, currentClose, swingLevel, tickSize } = input;
  if (swingLevel.kind !== "low" || currentLow >= swingLevel.price) {
    return undefined;
  }

  const penetrationTicks = (swingLevel.price - currentLow) / tickSize;
  // Reclaim required: wick pierced below the swing low, but candle closed back above it.
  if (penetrationTicks <= maxTicks && currentClose > swingLevel.price) {
    return {
      type: "bullish_sweep",
      swingPrice: swingLevel.price,
      breachPrice: currentLow,
      penetrationTicks,
      closePrice: currentClose,
    };
  }

  return undefined;
}

/**
 * Checks whether current bar executed a stop-hunt sweep through a swing high.
 */
function checkBearishSweep(
  input: SweepInput,
  maxTicks: number
): SweepResult | undefined {
  const { currentHigh, currentClose, swingLevel, tickSize } = input;
  if (swingLevel.kind !== "high" || currentHigh <= swingLevel.price) {
    return undefined;
  }

  const penetrationTicks = (currentHigh - swingLevel.price) / tickSize;
  // Reclaim required: wick pierced above the swing high, but candle closed back below it.
  if (penetrationTicks <= maxTicks && currentClose < swingLevel.price) {
    return {
      type: "bearish_sweep",
      swingPrice: swingLevel.price,
      breachPrice: currentHigh,
      penetrationTicks,
      closePrice: currentClose,
    };
  }

  return undefined;
}

/**
 * Evaluates whether current bar performed a liquidity sweep of a swing level.
 */
export function detectSweep(input: SweepInput): SweepResult | undefined {
  if (input.tickSize <= 0) return undefined;
  const maxTicks = input.maxPenetrationTicks ?? DEFAULT_MAX_PENETRATION_TICKS;

  if (input.swingLevel.kind === "low") {
    return checkBullishSweep(input, maxTicks);
  }
  return checkBearishSweep(input, maxTicks);
}
