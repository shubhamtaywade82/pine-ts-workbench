import type { PlotLayout, ThemeColors, ViewportState } from "./terminal-types";
import type { SimulationState } from "./terminal-simulation";
import { rgba } from "./terminal-formatters";
import { analyzeStructure } from "./terminal-smc";
import { analyzeFlow, type FlowAnalysis, type FlowMark } from "./terminal-flow";

interface FlowContext {
  c: CanvasRenderingContext2D;
  layout: PlotLayout;
  viewport: ViewportState;
  bw: number;
}

const FONT = '600 9px "IBM Plex Mono", monospace';
const CVD_COLOR = "#D7F75A";
const EXHAUST_COLOR = "rgba(200,212,235,0.7)";
const PRICE_DIVERGENCE_COLOR = "#FF5A52";
const CVD_DIVERGENCE_COLOR = "#22D07E";
// A held level stays relevant for a short while after the absorption; longer rays turn into clutter.
const HELD_LEVEL_BARS = 12;
// CVD strip sits just above the volume bars (bottom 15% of the plot).
const CVD_TOP_FRACTION = 0.34;
const CVD_BOTTOM_FRACTION = 0.18;

const xOf = (i: number, ctx: FlowContext): number =>
  ctx.layout.x + (i - (ctx.viewport.center - ctx.viewport.visible / 2)) * ctx.bw + ctx.bw / 2;

const yOf = (p: number, ctx: FlowContext): number =>
  ctx.layout.y + ((ctx.viewport.maxP - p) / (ctx.viewport.maxP - ctx.viewport.minP)) * ctx.layout.h;

let cache: { bars: unknown; count: number; result: FlowAnalysis } | undefined;

function flowFor(state: SimulationState, count: number): FlowAnalysis {
  if (cache && cache.bars === state.bars && cache.count === count) return cache.result;
  // Raw pivots, not the display-filtered swings: the filter keeps only the latest few, which hides older divergences.
  const result = analyzeFlow(state.bars, count, analyzeStructure(state.bars.slice(0, count)).swings);
  cache = { bars: state.bars, count, result };
  return result;
}

function drawAbsorption(ctx: FlowContext, mark: FlowMark, theme: ThemeColors, density: number): void {
  const { c, layout } = ctx;
  const x = xOf(mark.idx, ctx);
  const y = yOf(mark.price, ctx);
  const col = mark.dir === "bull" ? theme.bid : theme.ask;
  const radius = Math.min(9, 3 + mark.volumeRatio * 1.2);
  const lineY = Math.round(y) + 0.5;
  c.strokeStyle = rgba(col, 0.55);
  c.beginPath();
  c.moveTo(x, lineY);
  c.lineTo(Math.min(layout.r, xOf(mark.idx + HELD_LEVEL_BARS, ctx)), lineY);
  c.stroke();
  // Overlapping bubbles read as "many prints hitting one price", like a footprint cluster.
  for (const [dx, dy, scale] of [[-0.35, 0.2, 1], [0.4, -0.15, 0.8], [0.1, 0.45, 0.65]]) {
    c.fillStyle = rgba(col, 0.16);
    c.strokeStyle = rgba(col, 0.9);
    c.beginPath();
    c.arc(x + dx * radius, y + dy * radius, radius * scale, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  }
  if (density < 1) return;
  c.fillStyle = col;
  c.textAlign = "center";
  c.fillText("ABS", x, y + (mark.dir === "bull" ? radius + 10 : -radius - 9));
}

function drawExhaustion(ctx: FlowContext, mark: FlowMark, state: SimulationState, density: number): void {
  const { c } = ctx;
  const run = state.bars.slice(mark.fromIdx, mark.idx + 1);
  const x0 = xOf(mark.fromIdx, ctx) - ctx.bw / 2;
  const x1 = xOf(mark.idx, ctx) + ctx.bw / 2;
  const y0 = yOf(Math.max(...run.map((b) => b.h)), ctx) - 3;
  const y1 = yOf(Math.min(...run.map((b) => b.l)), ctx) + 3;
  c.strokeStyle = EXHAUST_COLOR;
  c.setLineDash([3, 3]);
  c.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, x1 - x0, y1 - y0);
  c.setLineDash([]);
  if (density < 1) return;
  c.fillStyle = EXHAUST_COLOR;
  c.textAlign = "left";
  c.fillText("EXH", x0, mark.dir === "bull" ? y1 + 9 : y0 - 8);
}

function cvdScale(flow: FlowAnalysis, i0: number, i1: number, ctx: FlowContext): ((i: number) => number) | undefined {
  const visible = flow.cvd.slice(Math.max(0, i0), i1 + 1);
  if (visible.length < 2) return undefined;
  const lo = Math.min(...visible);
  const span = Math.max(...visible) - lo || 1;
  const top = ctx.layout.b - ctx.layout.h * CVD_TOP_FRACTION;
  const height = ctx.layout.h * (CVD_TOP_FRACTION - CVD_BOTTOM_FRACTION);
  return (i) => top + (1 - (flow.cvd[i] - lo) / span) * height;
}

function drawSegment(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string): void {
  c.strokeStyle = color;
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x1, y1);
  c.stroke();
  c.lineWidth = 1;
}

function drawCvd(ctx: FlowContext, flow: FlowAnalysis, state: SimulationState, i0: number, i1: number): void {
  const { c, layout } = ctx;
  const yCvd = cvdScale(flow, i0, i1, ctx);
  if (!yCvd) return;
  const last = Math.min(i1, flow.cvd.length - 1);
  c.strokeStyle = rgba(CVD_COLOR, 0.75);
  c.beginPath();
  for (let i = Math.max(0, i0); i <= last; i++) {
    if (i === Math.max(0, i0)) c.moveTo(xOf(i, ctx), yCvd(i));
    else c.lineTo(xOf(i, ctx), yCvd(i));
  }
  c.stroke();
  c.fillStyle = rgba(CVD_COLOR, 0.7);
  c.textAlign = "left";
  c.fillText("CVD", layout.x + 4, layout.b - layout.h * CVD_TOP_FRACTION - 6);
  for (const div of flow.divergences) {
    if (div.fromIdx < i0 || div.toIdx > last) continue;
    const [xa, xb] = [xOf(div.fromIdx, ctx), xOf(div.toIdx, ctx)];
    const key = div.dir === "bull" ? "l" : "h";
    drawSegment(c, xa, yOf(state.bars[div.fromIdx][key], ctx), xb, yOf(state.bars[div.toIdx][key], ctx), PRICE_DIVERGENCE_COLOR);
    drawSegment(c, xa, yCvd(div.fromIdx), xb, yCvd(div.toIdx), CVD_DIVERGENCE_COLOR);
    c.fillStyle = CVD_DIVERGENCE_COLOR;
    c.fillText(div.dir === "bull" ? "CVD DIV ▲" : "CVD DIV ▼", xb + 4, yCvd(div.toIdx));
  }
}

/** Draws absorption/exhaustion marks, the CVD strip and CVD divergences for visible confirmed bars. */
export function drawFlowLayers(
  ctx: FlowContext, state: SimulationState, floor: number, range: { i0: number; i1: number }, theme: ThemeColors, density: number,
): void {
  const flow = flowFor(state, Math.min(floor, state.bars.length));
  const { c } = ctx;
  c.save();
  c.font = FONT;
  c.textBaseline = "middle";
  for (const mark of flow.marks) {
    if (mark.idx < range.i0 || mark.fromIdx > range.i1) continue;
    if (mark.kind === "absorb") drawAbsorption(ctx, mark, theme, density);
    else drawExhaustion(ctx, mark, state, density);
  }
  drawCvd(ctx, flow, state, range.i0, range.i1);
  c.restore();
}
