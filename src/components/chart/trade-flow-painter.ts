import type { FlowParticle } from "@/lib/trade-flow";
import { particleFrame } from "@/lib/trade-flow";
import { LADDER } from "./dom-ladder-layout";

export const FLOW_BUY_COLOR = "#089981";
export const FLOW_SELL_COLOR = "#f23645";
const BASE_PARTICLE_RADIUS = 6;
const MIN_PARTICLE_RADIUS = 3;
const PULSE_LINE_WIDTH = 1.5;
// A soft glow and a fading comet tail make a ~100 px trip readable at a glance.
const GLOW_BLUR_PX = 8;
const TRAIL_FRACTION = 0.45;
const TRAIL_SEGMENTS = 8;
const START_ALPHA = 0.6;
const PULSE_FRACTION = 0.3;

export interface FlowPoint { readonly x: number; readonly y: number }

export interface FlowGeometry {
  readonly rowY: (key: number) => number | null;
  readonly askX: number;
  readonly bidX: number;
  /** The forming candle's close (the last-price dot); y is null when it is off-scale. */
  readonly candle: { readonly x: number; readonly y: number | null };
}

export interface PaintFlowOptions {
  readonly context: CanvasRenderingContext2D;
  readonly particles: readonly FlowParticle[];
  readonly geometry: FlowGeometry;
  readonly now: number;
}

interface FlowPath { readonly start: FlowPoint; readonly end: FlowPoint }

interface StrokeStyle { readonly color: string; readonly width: number; readonly alpha: number }

export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Point at t (0..1) on a quadratic curve from the ladder row to the candle's close. The control
 * point sits on the row's level halfway across, so flow leaves the row flat and bends into the
 * close instead of running along the row's price.
 */
export const flowPoint = (path: FlowPath, t: number): FlowPoint => {
  const control = { x: (path.start.x + path.end.x) / 2, y: path.start.y };
  const u = 1 - t;
  return {
    x: u * u * path.start.x + 2 * u * t * control.x + t * t * path.end.x,
    y: u * u * path.start.y + 2 * u * t * control.y + t * t * path.end.y,
  };
};

const strokeAlong = (context: CanvasRenderingContext2D, path: FlowPath, span: { from: number; to: number }, style: StrokeStyle): void => {
  const step = (span.to - span.from) / TRAIL_SEGMENTS;
  if (!(Math.abs(step) > 0)) return;
  context.strokeStyle = style.color;
  context.lineCap = "round";
  for (let i = 0; i < TRAIL_SEGMENTS; i += 1) {
    const a = flowPoint(path, span.from + step * i);
    const b = flowPoint(path, span.from + step * (i + 1));
    // Segments brighten toward the head so the tail fades out behind it.
    context.globalAlpha = style.alpha * ((i + 1) / TRAIL_SEGMENTS);
    context.lineWidth = style.width;
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
  }
};

const drawInParticle = (context: CanvasRenderingContext2D, path: FlowPath, color: string, frame: { progress: number; radiusScale: number }): void => {
  const radius = Math.max(MIN_PARTICLE_RADIUS, BASE_PARTICLE_RADIUS * frame.radiusScale);
  const alpha = START_ALPHA + (1 - START_ALPHA) * frame.progress;
  const head = flowPoint(path, frame.progress);
  context.save();
  strokeAlong(context, path, { from: Math.max(0, frame.progress - TRAIL_FRACTION), to: frame.progress }, { color, width: radius, alpha });
  context.globalAlpha = alpha;
  context.shadowColor = color;
  context.shadowBlur = GLOW_BLUR_PX;
  context.fillStyle = color;
  context.beginPath();
  context.arc(head.x, head.y, radius, 0, Math.PI * 2);
  context.fill();
  context.restore();
};

const drawBackPulse = (context: CanvasRenderingContext2D, path: FlowPath, color: string, progress: number): void => {
  // Same curve, travelled from the close back to the row the trade came from.
  const reversed = { start: path.end, end: path.start };
  context.save();
  strokeAlong(context, reversed, { from: Math.max(0, progress - PULSE_FRACTION), to: progress }, {
    color, width: PULSE_LINE_WIDTH, alpha: Math.max(0, 1 - progress),
  });
  context.restore();
};

const pathFor = (particle: FlowParticle, geometry: FlowGeometry): FlowPath | null => {
  const rowY = geometry.rowY(particle.key);
  if (rowY === null) return null;
  const ladderX = particle.aggressor === "buy" ? geometry.askX : geometry.bidX;
  return { start: { x: ladderX, y: rowY }, end: { x: geometry.candle.x, y: geometry.candle.y ?? rowY } };
};

export const paintTradeFlow = (options: PaintFlowOptions): void => {
  if (prefersReducedMotion() || options.particles.length === 0) return;
  const { context, particles, geometry, now } = options;
  for (const particle of particles) {
    const path = pathFor(particle, geometry);
    if (path === null) continue;
    const frame = particleFrame(particle, now);
    if (frame.phase === "done") continue;
    const color = particle.aggressor === "buy" ? FLOW_BUY_COLOR : FLOW_SELL_COLOR;
    if (frame.phase === "in") drawInParticle(context, path, color, frame);
    else drawBackPulse(context, path, color, frame.progress);
  }
};

/** y of the forming candle's close — where the last-price dot sits — or null when unknown or off-scale. */
export const formingCloseY = (
  series: { data(): readonly unknown[] },
  toY: (price: number) => number | null,
): number | null => {
  const bar = series.data().at(-1) as { close?: unknown; value?: unknown } | undefined;
  const close = typeof bar?.close === "number" ? bar.close : typeof bar?.value === "number" ? bar.value : undefined;
  return close === undefined ? null : toY(close);
};

export const createFlowGeometry = (
  sampleSpan: { from: number; to: number } | undefined,
  originX: number,
  candle: { x: number; y: number | null },
  toY: (price: number) => number | null,
): FlowGeometry => ({
  candle,
  askX: originX + LADDER.priceWidth + LADDER.barMax / 2,
  bidX: originX - LADDER.barMax / 2,
  rowY: (key: number) => {
    if (sampleSpan === undefined) return null;
    const step = sampleSpan.to - sampleSpan.from;
    return toY((key + 0.5) * step);
  },
});
