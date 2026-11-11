export const LADDER = { priceWidth: 64, barMax: 72, activityWidth: 96 } as const;
export const ANIMATION_TAU_MS = 150;

export interface LadderMetrics {
  readonly priceWidth: number;
  readonly barMax: number;
  readonly activityWidth: number;
}

/** Exponential approach. τ is the time to cover about 63% of the remaining gap. */
export const easeToward = (current: number, target: number, elapsedMs: number, tauMs: number): number => {
  if (!(tauMs > 0) || !(elapsedMs > 0) || !Number.isFinite(current) || !Number.isFinite(target)) return current;
  const step = 1 - Math.exp(-elapsedMs / tauMs);
  return current + (target - current) * step;
};

const trimFixed = (value: number, digits: number): string =>
  value.toFixed(digits).replace(/\.?0+$/, "");

/** 999 → "999", 1_200 → "1.2k", 2_000_000 → "2m". */
export const compactQuantity = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${trimFixed(value / 1_000_000, 1)}m`;
  if (abs >= 1_000) return `${trimFixed(value / 1_000, 1)}k`;
  if (abs >= 100) return String(Math.round(value));
  if (abs >= 10) return trimFixed(value, 1);
  return trimFixed(value, abs >= 1 ? 2 : 3);
};

export const formatLadderPrice = (price: number): string =>
  price.toLocaleString("en-US", { maximumFractionDigits: price >= 1000 ? 2 : 4 });

export const formatBucketWidth = (width: number): string => {
  if (!(width > 0) || !Number.isFinite(width)) return "level";
  const text = width >= 1 ? width.toFixed(2) : width.toPrecision(2);
  return text.replace(/\.?0+$/, "");
};

/**
 * Left edge of the price column, pinned to the pane's right edge so the ladder stays put while
 * the chart scrolls or zooms. The chart's pixel right offset keeps candles clear of it.
 */
export const ladderPriceColumnX = (paneWidth: number, metrics: LadderMetrics): number => {
  const rightSpan = metrics.priceWidth + metrics.barMax + metrics.activityWidth;
  return Math.max(metrics.barMax, paneWidth - rightSpan);
};

export const rowShowsText = (rowPx: number): boolean => rowPx >= 11;
export interface ActivityText { readonly text: string; readonly tone: "bought" | "sold" | "pulled" }

export const activityLabel = (flow: { bought: number; sold: number; pulled: number }): ActivityText | undefined => {
  const options = [
    { tone: "bought" as const, qty: flow.bought },
    { tone: "sold" as const, qty: flow.sold },
    { tone: "pulled" as const, qty: flow.pulled },
  ];
  let best: (typeof options)[number] | undefined;
  for (const option of options) {
    if (option.qty > 0 && (best === undefined || option.qty > best.qty)) best = option;
  }
  if (best === undefined) return undefined;
  return { tone: best.tone, text: `${compactQuantity(best.qty)} ${best.tone}` };
};
