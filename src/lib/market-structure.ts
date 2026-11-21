/**
 * Smart Money Market Structure (SMC) tracking:
 * Swing pivots (fractal highs/lows), Fair Value Gaps (FVG) and mitigation tracking.
 */

export interface MarketBar {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export interface FairValueGap {
  readonly id: string;
  readonly kind: "bullish" | "bearish";
  readonly top: number;
  readonly bottom: number;
  readonly createdBarIndex: number;
  isMitigated: boolean;
}

export interface SwingPivot {
  readonly index: number;
  readonly price: number;
  readonly kind: "high" | "low";
}

/**
 * Checks for a 3-bar Fair Value Gap formed at the current bar index.
 */
export function detectFvg(
  bars: readonly MarketBar[],
  currentIndex: number
): FairValueGap | undefined {
  if (currentIndex < 2 || currentIndex >= bars.length) return undefined;

  const bar0 = bars[currentIndex - 2];
  const bar2 = bars[currentIndex];

  // Bullish FVG: gap between bar 0 high and bar 2 low
  if (bar2.low > bar0.high) {
    return {
      id: `fvg-bull-${currentIndex}`,
      kind: "bullish",
      top: bar2.low,
      bottom: bar0.high,
      createdBarIndex: currentIndex,
      isMitigated: false,
    };
  }

  // Bearish FVG: gap between bar 2 high and bar 0 low
  if (bar2.high < bar0.low) {
    return {
      id: `fvg-bear-${currentIndex}`,
      kind: "bearish",
      top: bar0.low,
      bottom: bar2.high,
      createdBarIndex: currentIndex,
      isMitigated: false,
    };
  }

  return undefined;
}

/**
 * Updates mitigation status of an FVG against current price extremes.
 * Returns true if the gap has been fully penetrated/mitigated.
 */
export function updateFvgMitigation(
  fvg: FairValueGap,
  currentHigh: number,
  currentLow: number
): boolean {
  if (fvg.isMitigated) return true;

  if (fvg.kind === "bullish" && currentLow <= fvg.bottom) {
    fvg.isMitigated = true;
    return true;
  }

  if (fvg.kind === "bearish" && currentHigh >= fvg.top) {
    fvg.isMitigated = true;
    return true;
  }

  return false;
}

/**
 * Checks whether price is currently trading inside an unmitigated FVG zone.
 */
export function isPriceInFvg(fvg: FairValueGap, price: number): boolean {
  if (fvg.isMitigated) return false;
  return price >= fvg.bottom && price <= fvg.top;
}

/**
 * Detects swing high or swing low pivot with left and right lookback bars.
 */
export function detectPivot(
  bars: readonly MarketBar[],
  centerIndex: number,
  lookback = 3
): SwingPivot | undefined {
  if (centerIndex < lookback || centerIndex + lookback >= bars.length) {
    return undefined;
  }

  const center = bars[centerIndex];
  let isHigh = true;
  let isLow = true;

  for (let i = centerIndex - lookback; i <= centerIndex + lookback; i++) {
    if (i === centerIndex) continue;
    if (bars[i].high >= center.high) isHigh = false;
    if (bars[i].low <= center.low) isLow = false;
  }

  if (isHigh) {
    return { index: centerIndex, price: center.high, kind: "high" };
  }
  if (isLow) {
    return { index: centerIndex, price: center.low, kind: "low" };
  }

  return undefined;
}
