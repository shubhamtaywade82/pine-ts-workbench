import type { ChartDrawing } from "@/components/chart/script-drawings-primitive";
import { compactQuantity } from "@/components/chart/dom-ladder-layout";
import type { Level } from "./option-analytics";
import type { ChainSummary } from "./option-chain";

/** How far the lines run past the last bar. */
const LOOKAHEAD_BARS = 25;
/** How many bars back the lines and the expected-range box start. */
export const RANGE_BACK_BARS = 80;

/** The stretch of time the lines cover: from `startTime` to a little past `lastTime`. */
export interface LevelSpan { readonly startTime: number; readonly lastTime: number }

const CALL_WALL = "#f23645";
const PUT_WALL = "#089981";
const MAX_PAIN = "#f7b731";
const GAMMA_FLIP = "#b388ff";
const RANGE_FILL = "rgba(41, 98, 255, 0.10)";
const RANGE_BORDER = "rgba(41, 98, 255, 0.55)";

/**
 * The chain's levels as chart drawings on the underlying: OI walls (the strongest solid, the rest dashed),
 * max pain, the gamma flip, and the straddle's expected range as a box. Prices outside the visible range
 * are simply off-screen; the dashboard lists them all.
 */
export const optionLevelDrawings = (summary: ChainSummary, span: LevelSpan | undefined, intervalMs: number): ChartDrawing[] => {
  if (span === undefined) return [];
  const to = span.lastTime + LOOKAHEAD_BARS * intervalMs;
  const labelAt = span.lastTime + intervalMs;
  const drawings: ChartDrawing[] = [];

  const line = (price: number, text: string, color: string, style: "solid" | "dashed" | "dotted", width: number): void => {
    drawings.push({ kind: "shape-line", from: span.startTime, to, x1: span.startTime, x2: to, y1: price, y2: price, color, width, style });
    drawings.push({ kind: "label", time: labelAt, x: labelAt, y: price, text, color, position: "right", size: "small" });
  };
  const walls = (levels: readonly Level[], name: string, color: string): void => {
    levels.forEach((level, rank) => line(level.strike, `${name} ${level.strike} · ${compactQuantity(level.oi)}`, color, rank === 0 ? "solid" : "dashed", rank === 0 ? 2 : 1));
  };

  const { analytics, straddle } = summary;
  if (analytics.lowerBreakeven !== undefined && analytics.upperBreakeven !== undefined && straddle !== undefined) {
    drawings.push({ kind: "shape-box", from: span.startTime, to, left: span.startTime, right: to, top: analytics.upperBreakeven, bottom: analytics.lowerBreakeven, fill: RANGE_FILL, border: RANGE_BORDER });
    drawings.push({ kind: "label", time: labelAt, x: labelAt, y: analytics.upperBreakeven, text: `Expected range ${analytics.lowerBreakeven.toFixed(0)}–${analytics.upperBreakeven.toFixed(0)}`, color: RANGE_BORDER, position: "right", size: "small" });
  }
  walls(analytics.resistances, "Call wall", CALL_WALL);
  walls(analytics.supports, "Put wall", PUT_WALL);
  line(summary.maxPain, `Max pain ${summary.maxPain}`, MAX_PAIN, "dashed", 1.5);
  if (analytics.gammaFlip !== undefined) line(analytics.gammaFlip, `Gamma flip ${analytics.gammaFlip}`, GAMMA_FLIP, "dotted", 1);
  return drawings;
};
