/**
 * Domain types and pure calculations for user interactive chart drawings
 * (trendline, horizontal ray, fibonacci retracement, rectangle, measure tool).
 */

export type DrawingToolType =
  | "cursor"
  | "trendline"
  | "ray"
  | "fibonacci"
  | "rectangle"
  | "measure";

export interface DrawingPoint {
  readonly time: number; // UTC ms
  readonly price: number;
}

export interface UserDrawing {
  readonly id: string;
  readonly type: Exclude<DrawingToolType, "cursor">;
  readonly p1: DrawingPoint;
  readonly p2: DrawingPoint;
  readonly color?: string;
}

export interface FibLevel {
  readonly ratio: number;
  readonly color: string;
  readonly fillColor: string;
}

export const FIB_LEVELS: readonly FibLevel[] = [
  { ratio: 0.0, color: "#787b86", fillColor: "transparent" },
  { ratio: 0.236, color: "#f23645", fillColor: "rgba(242, 54, 69, 0.06)" },
  { ratio: 0.382, color: "#ff9800", fillColor: "rgba(255, 152, 0, 0.06)" },
  { ratio: 0.5, color: "#4caf50", fillColor: "rgba(76, 175, 80, 0.06)" },
  { ratio: 0.618, color: "#089981", fillColor: "rgba(8, 153, 129, 0.08)" },
  { ratio: 0.786, color: "#2962ff", fillColor: "rgba(41, 98, 255, 0.06)" },
  { ratio: 1.0, color: "#787b86", fillColor: "transparent" },
];

export interface MeasureStats {
  readonly priceDelta: number;
  readonly pctDelta: number;
  readonly barCount: number;
  readonly durationText: string;
}

export function formatMeasureDuration(durationMs: number): string {
  const totalMinutes = Math.max(1, Math.round(durationMs / 60_000));
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (hours < 24) return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

export function computeMeasureStats(
  p1: DrawingPoint,
  p2: DrawingPoint,
  intervalMs: number,
): MeasureStats {
  const priceDelta = p2.price - p1.price;
  const pctDelta = p1.price === 0 ? 0 : (priceDelta / p1.price) * 100;
  const durationMs = Math.abs(p2.time - p1.time);
  const barCount = Math.max(1, Math.round(durationMs / Math.max(1, intervalMs)));
  return {
    priceDelta,
    pctDelta,
    barCount,
    durationText: formatMeasureDuration(durationMs),
  };
}

export function calculateFibPrice(p1Price: number, p2Price: number, ratio: number): number {
  return p1Price + (p2Price - p1Price) * ratio;
}
