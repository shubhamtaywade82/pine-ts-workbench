import { NORMAL, type PlotLayout, type RayHit, type TerminalParams, type ThemeColors, type ViewportState } from "./terminal-types";
import { type SimulationState, clamp } from "./terminal-simulation";
import { fmtP, fmtT, rgba, tickDecimals } from "./terminal-formatters";

interface SceneContext {
  c: CanvasRenderingContext2D;
  layout: PlotLayout;
  viewport: ViewportState;
  bw: number;
}

const X = (i: number, v: ViewportState, l: PlotLayout): number =>
  l.x + (i - (v.center - v.visible / 2)) * (l.w / v.visible);

const Y = (p: number, v: ViewportState, l: PlotLayout): number =>
  l.y + ((v.maxP - p) / (v.maxP - v.minP)) * l.h;

const TARGET_AXIS_LINES = 10;

/** Round 1/2/5 x 10^n step giving ~TARGET_AXIS_LINES lines, never finer than one tick. */
function niceAxisStep(range: number, tick: number): number {
  const raw = Math.max(range / TARGET_AXIS_LINES, tick);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const mantissa = raw / pow;
  const nice = mantissa <= 1 ? 1 : mantissa <= 2 ? 2 : mantissa <= 5 ? 5 : 10;
  return nice * pow;
}

function drawGrid(ctx: SceneContext, pstep: number, i0: number, i1: number): void {
  const { c, layout, viewport: v, bw } = ctx;
  c.lineWidth = 1;
  c.strokeStyle = "#131F36";
  const startIdx = Math.ceil(v.minP / pstep);
  const endIdx = Math.floor(v.maxP / pstep);
  for (let k = startIdx; k <= endIdx; k++) {
    const p = k * pstep;
    const y = Math.round(Y(p, v, layout)) + 0.5;
    c.beginPath();
    c.moveTo(layout.x, y);
    c.lineTo(layout.r, y);
    c.stroke();
  }
  const k = Math.max(1, Math.ceil(84 / bw));
  for (let i = Math.ceil(i0 / k) * k; i <= i1; i++) {
    const x = Math.round(X(i, v, layout) + bw / 2) + 0.5;
    c.beginPath();
    c.moveTo(x, layout.y);
    c.lineTo(x, layout.b);
    c.stroke();
  }
}

function drawFvgZones(ctx: SceneContext, state: SimulationState, floor: number, params: TerminalParams, theme: ThemeColors): void {
  if (!params.fvg) return;
  const { c, layout, viewport: v, bw } = ctx;
  for (const z of state.zones) {
    if (z.start > floor) continue;
    const isFilled = z.filled !== null && z.filled <= floor;
    if (isFilled && !params.filled) continue;
    const x0 = X(z.start, v, layout);
    const x1 = isFilled ? X(z.filled!, v, layout) + bw : layout.r;
    if (x1 < layout.x || x0 > layout.r) continue;
    const y0 = Y(z.hi, v, layout);
    const y1 = Y(z.lo, v, layout);
    if (y1 < layout.y || y0 > layout.b) continue;
    const col = z.side === "bull" ? theme.bid : theme.ask;
    const cx0 = Math.max(layout.x, x0);
    const cx1 = Math.min(layout.r, x1);
    c.fillStyle = rgba(col, isFilled ? 0.035 : 0.085);
    c.fillRect(cx0, y0, cx1 - cx0, y1 - y0);
    if (!isFilled) {
      c.strokeStyle = col;
      c.globalAlpha = 0.3;
      c.setLineDash([3, 4]);
      c.strokeRect(cx0 + 0.5, y0 + 0.5, cx1 - cx0 - 1, y1 - y0 - 1);
      c.setLineDash([]);
      c.globalAlpha = 1;
      if (params.density >= 1 && y1 - y0 >= 11 && x0 > layout.x - 20) {
        c.fillStyle = col;
        c.font = '600 8px "IBM Plex Mono", monospace';
        c.textAlign = "left";
        c.fillText("FVG", cx0 + 4, (y0 + y1) / 2);
      }
    }
  }
}

function drawRails(ctx: SceneContext, state: SimulationState, floor: number, params: TerminalParams, theme: ThemeColors): RayHit[] {
  const hits: RayHit[] = [];
  if (!params.rays) return hits;
  const { c, layout, viewport: v } = ctx;
  const bigs = state.bigsSnap[Math.min(floor, state.bigsSnap.length - 1)] || [];
  for (const b of bigs) {
    const p = b.idx * state.tick;
    if (p < v.minP || p > v.maxP) continue;
    const y = Y(p, v, layout);
    const x0Birth = params.raySpan === "full" ? layout.x : params.raySpan === "window" ? X(floor - 40, v, layout) : X(b.born, v, layout);
    const x0 = Math.max(layout.x, x0Birth);
    const x1 = layout.r;
    const xn = b.size / NORMAL;
    const th = clamp((1 + clamp(xn - 4, 0, 8) * 0.5) * params.rayScale, 0.5, 8);
    const ageF = clamp(1 - (floor - b.born) / 140, 0.55, 1);
    const al = (0.3 + clamp(xn / 12, 0, 1) * 0.5) * ageF;
    const col = b.side === "bid" ? theme.bid : theme.ask;
    c.save();
    if (xn >= 6 && params.glow > 0) {
      c.shadowBlur = params.glow * 14;
      c.shadowColor = col;
    }
    c.strokeStyle = rgba(col, al);
    c.lineWidth = th;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(x0, y);
    c.lineTo(x1, y);
    c.stroke();
    c.restore();
    c.fillStyle = rgba(col, 0.9);
    c.beginPath();
    c.arc(x0, y, Math.min(3, th), 0, 7);
    c.fill();
    hits.push({ price: p, y, x0, x1, size: b.size, side: b.side, born: b.born });
  }
  return hits;
}

function drawVolume(ctx: SceneContext, state: SimulationState, i0: number, i1: number, theme: ThemeColors): void {
  const { c, layout, viewport: v, bw } = ctx;
  let vmax = 1;
  for (let i = i0; i <= i1; i++) {
    if (state.bars[i]) vmax = Math.max(vmax, state.bars[i].v);
  }
  const vh = layout.h * 0.15;
  for (let i = i0; i <= i1; i++) {
    const b = state.bars[i];
    if (!b) continue;
    const up = b.c >= b.o;
    const h = (b.v / vmax) * vh;
    const x = X(i, v, layout);
    const col = up ? theme.bid : theme.ask;
    c.fillStyle = rgba(col, 0.3);
    c.fillRect(x, layout.b - h, Math.max(1, bw * 0.66), h);
    c.fillStyle = rgba(col, 0.5);
    c.fillRect(x, layout.b - h * b.buyR, Math.max(1, bw * 0.66), h * b.buyR);
  }
}

function drawCandles(ctx: SceneContext, state: SimulationState, i0: number, i1: number, params: TerminalParams, theme: ThemeColors): void {
  const { c, layout, viewport: v, bw } = ctx;
  const bodyW = clamp(bw * 0.62, 2, 15);
  for (let i = i0; i <= i1; i++) {
    const b = state.bars[i];
    if (!b) continue;
    const up = b.c >= b.o;
    const col = up ? theme.bid : theme.ask;
    const x = X(i, v, layout) + bw / 2;
    const yo = Y(b.o, v, layout);
    const yc = Y(b.c, v, layout);
    const top = Math.min(yo, yc);
    const hgt = Math.max(1.2, Math.abs(yo - yc));
    c.strokeStyle = col;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(x, Y(b.h, v, layout));
    c.lineTo(x, Y(b.l, v, layout));
    c.stroke();
    if (params.candle === "hollow" && up) {
      c.fillStyle = "rgba(7,13,26,0.85)";
      c.fillRect(x - bodyW / 2, top, bodyW, hgt);
      c.lineWidth = 1.3;
      c.strokeRect(x - bodyW / 2 + 0.5, top + 0.5, bodyW - 1, Math.max(1, hgt - 1));
    } else {
      c.fillStyle = col;
      c.fillRect(x - bodyW / 2, top, bodyW, hgt);
    }
  }
}

function drawAxes(ctx: SceneContext, state: SimulationState, pstep: number, i0: number, i1: number, axisW: number, timeH: number, totalW: number, totalH: number): void {
  const { c, layout, viewport: v, bw } = ctx;
  c.fillStyle = "#0B1424";
  c.fillRect(layout.r + 1, 0, axisW, totalH);
  c.fillRect(0, layout.b + 1, totalW, timeH);
  c.strokeStyle = "#1B2B4A";
  c.beginPath();
  c.moveTo(layout.r + 0.5, 0);
  c.lineTo(layout.r + 0.5, totalH);
  c.moveTo(0, layout.b + 0.5);
  c.lineTo(totalW, layout.b + 0.5);
  c.stroke();
  c.fillStyle = "#5A6C8C";
  c.font = '10px "IBM Plex Mono", monospace';
  c.textAlign = "left";
  c.textBaseline = "middle";
  const startIdx = Math.ceil(v.minP / pstep);
  const endIdx = Math.floor(v.maxP / pstep);
  for (let k = startIdx; k <= endIdx; k++) {
    const p = k * pstep;
    const y = Y(p, v, layout);
    if (y >= layout.y && y <= layout.b) c.fillText(fmtP(p, tickDecimals(state.tick)), layout.r + 7, y);
  }
  c.textAlign = "center";
  const k = Math.max(1, Math.ceil(84 / bw));
  for (let i = Math.ceil(i0 / k) * k; i <= i1; i++) {
    if (state.bars[i]) {
      c.fillText(fmtT(state.bars[i].t), X(i, v, layout) + bw / 2, layout.b + 13);
    }
  }
}

export function drawScene(
  c: CanvasRenderingContext2D,
  state: SimulationState,
  viewport: ViewportState,
  params: TerminalParams,
  theme: ThemeColors,
  layout: PlotLayout,
  dpr: number,
  highlightPrice: number | null,
  axisW: number,
  timeH: number,
  totalW: number,
  totalH: number,
): RayHit[] {
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, totalW, totalH);
  const floor = Math.floor(state.playhead);
  const bw = layout.w / viewport.visible;
  const left = viewport.center - viewport.visible / 2;
  const i0 = Math.max(0, Math.floor(left) - 1);
  const i1 = Math.min(floor - 1, state.bars.length - 1, Math.ceil(left + viewport.visible) + 1);
  const range = viewport.maxP - viewport.minP;
  const pstep = niceAxisStep(range, state.tick);
  const ctx: SceneContext = { c, layout, viewport, bw };

  drawGrid(ctx, pstep, i0, i1);
  drawFvgZones(ctx, state, floor, params, theme);
  const hits = drawRails(ctx, state, floor, params, theme);
  if (params.vol && i1 >= i0) drawVolume(ctx, state, i0, i1, theme);
  drawCandles(ctx, state, i0, i1, params, theme);

  if (highlightPrice != null && highlightPrice >= viewport.minP && highlightPrice <= viewport.maxP) {
    const y = Math.round(Y(highlightPrice, viewport, layout)) + 0.5;
    c.strokeStyle = "#3FC1FF";
    c.lineWidth = 1.4;
    c.globalAlpha = 0.8;
    c.setLineDash([6, 4]);
    c.beginPath();
    c.moveTo(layout.x, y);
    c.lineTo(layout.r, y);
    c.stroke();
    c.setLineDash([]);
    c.globalAlpha = 1;
  }

  drawAxes(ctx, state, pstep, i0, i1, axisW, timeH, totalW, totalH);
  return hits;
}
