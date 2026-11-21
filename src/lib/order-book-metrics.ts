/**
 * Pure mathematical metrics derived from Level 2 order books:
 * Multi-Tier Order Book Imbalance (OBI), Cont-Kukanov-Stoikov Order Flow Imbalance (OFI),
 * Microprice (queue-weighted midpoint), and depth density.
 */

export interface TopOfBook {
  readonly bidPrice: number;
  readonly bidQty: number;
  readonly askPrice: number;
  readonly askQty: number;
}

export interface ObiTierResult {
  readonly tier: number;
  readonly bidQty: number;
  readonly askQty: number;
  readonly obi: number;
}

export interface MultiTierObi {
  readonly tiers: readonly ObiTierResult[];
  readonly weightedObi: number;
}

const DEFAULT_OBI_TIERS = [5, 10, 20, 50] as const;

/**
 * Calculates Order Book Imbalance (OBI) across a specific depth tier.
 * Returns value in [-1.0, 1.0], where +1.0 is pure bid liquidity, -1.0 is pure ask liquidity.
 */
export function calculateObi(
  bids: readonly (readonly [number, number])[],
  asks: readonly (readonly [number, number])[],
  tierCount: number
): ObiTierResult {
  const boundedTier = Math.max(1, Math.floor(tierCount));
  let bidQty = 0;
  let askQty = 0;

  const maxBids = Math.min(boundedTier, bids.length);
  for (let i = 0; i < maxBids; i++) {
    bidQty += bids[i][1];
  }

  const maxAsks = Math.min(boundedTier, asks.length);
  for (let i = 0; i < maxAsks; i++) {
    askQty += asks[i][1];
  }

  const total = bidQty + askQty;
  // Guard against zero liquidity to avoid NaN/division by zero.
  const obi = total > 0 ? (bidQty - askQty) / total : 0;

  return { tier: boundedTier, bidQty, askQty, obi };
}

/**
 * Calculates multi-tier OBI and a geometrically weighted aggregate score.
 * Nearer tiers carry higher predictive weight for immediate execution.
 */
export function calculateMultiTierObi(
  bids: readonly (readonly [number, number])[],
  asks: readonly (readonly [number, number])[],
  tiers: readonly number[] = DEFAULT_OBI_TIERS
): MultiTierObi {
  const results: ObiTierResult[] = [];
  let weightedSum = 0;
  let totalWeight = 0;

  for (let i = 0; i < tiers.length; i++) {
    const res = calculateObi(bids, asks, tiers[i]);
    results.push(res);
    // Weight decays inversely with tier index: tier 0 weight 1.0, tier 1 weight 0.5, etc.
    const weight = 1 / (i + 1);
    weightedSum += res.obi * weight;
    totalWeight += weight;
  }

  const weightedObi = totalWeight > 0 ? weightedSum / totalWeight : 0;
  return { tiers: results, weightedObi };
}

/**
 * Calculates Order Flow Imbalance (OFI) based on Cont, Kukanov, and Stoikov (2014).
 * Measures net changes in bid and ask queues at the best price boundaries.
 */
export function calculateOfi(current: TopOfBook, previous: TopOfBook): number {
  let bidDelta = 0;
  if (current.bidPrice > previous.bidPrice) {
    bidDelta = current.bidQty;
  } else if (current.bidPrice === previous.bidPrice) {
    bidDelta = current.bidQty - previous.bidQty;
  } else {
    bidDelta = -previous.bidQty;
  }

  let askDelta = 0;
  if (current.askPrice < previous.askPrice) {
    askDelta = current.askQty;
  } else if (current.askPrice === previous.askPrice) {
    askDelta = current.askQty - previous.askQty;
  } else {
    askDelta = -previous.askQty;
  }

  return bidDelta - askDelta;
}

/**
 * Calculates Microprice (Queue-weighted Midpoint).
 * Returns undefined if both sides have zero quantity or if prices are non-positive.
 */
export function calculateMicroprice(top: TopOfBook): number | undefined {
  if (top.bidPrice <= 0 || top.askPrice <= 0 || top.bidPrice > top.askPrice) {
    return undefined;
  }

  const totalQty = top.bidQty + top.askQty;
  if (totalQty <= 0) {
    return (top.bidPrice + top.askPrice) / 2;
  }

  // Opposite weighting: larger bid volume pulls microprice closer to ask price.
  return (top.bidQty * top.askPrice + top.askQty * top.bidPrice) / totalQty;
}

/**
 * Calculates cumulative depth quantity within a specific tick distance from the best level.
 */
export function calculateDepthDensity(
  levels: readonly (readonly [number, number])[],
  maxLevels: number
): number {
  const count = Math.min(levels.length, Math.max(1, maxLevels));
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += levels[i][1];
  }
  return total;
}
