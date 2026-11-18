import type { PlotLayout, TerminalParams, ThemeColors, ViewportState } from "./terminal-types";
import type { SimulationState } from "./terminal-simulation";
import { rgba } from "./terminal-formatters";
import { analyzeSmc, type SmcAnalysis } from "./terminal-smc";

interface SmcContext {
  c: CanvasRenderingContext2D;
  layout: PlotLayout;
  viewport: ViewportState;
  bw: number;
}

const FONT = '600 9px "IBM Plex Mono", monospace';

const xOf = (i: number, ctx: SmcContext): number =>
  ctx.layout.x + (i - (ctx.viewport.center - ctx.viewport.visible / 2)) * ctx.bw + ctx.bw / 2;

const yOf = (p: number, ctx: SmcContext): number =>
  ctx.layout.y + ((ctx.viewport.maxP - p) / (ctx.viewport.maxP - ctx.viewport.minP)) * ctx.layout.h;

const isVisibleX = (x: number, ctx: SmcContext): boolean => x >= ctx.layout.x - 40 && x <= ctx.layout.r + 40;

function drawStructure(ctx: SmcContext, smc: SmcAnalysis, theme: ThemeColors, density: number): void {
  const { c, layout } = ctx;
  c.font = FONT;
  c.textBaseline = "middle";
  c.textAlign = "center";
  for (const swing of smc.swings) {
    if (!swing.label || density < 1) continue;
    const x = xOf(swing.idx, ctx);
    const y = yOf(swing.price, ctx);
    if (!isVisibleX(x, ctx) || y < layout.y || y > layout.b) continue;
    c.fillStyle = rgba(swing.kind === "high" ? theme.ask : theme.bid, 0.75);
    c.fillText(swing.label, x, y + (swing.kind === "high" ? -9 : 9));
  }
  for (const brk of smc.breaks.slice(-12)) {
    const x0 = Math.max(layout.x, xOf(brk.fromIdx, ctx));
    const x1 = xOf(brk.idx, ctx);
    const y = Math.round(yOf(brk.level, ctx)) + 0.5;
    if (x1 < layout.x || x0 > layout.r || y < layout.y || y > layout.b) continue;
    const col = brk.dir === "bull" ? theme.bid : theme.ask;
    c.strokeStyle = rgba(col, brk.kind === "CHoCH" ? 0.9 : 0.6);
    c.lineWidth = 1;
    c.setLineDash(brk.kind === "CHoCH" ? [] : [5, 4]);
    c.beginPath();
    c.moveTo(x0, y);
    c.lineTo(x1, y);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = col;
    c.fillText(brk.kind, (x0 + x1) / 2, y + (brk.dir === "bull" ? -7 : 8));
  }
}

function drawOrderBlocks(ctx: SmcContext, smc: SmcAnalysis, theme: ThemeColors, density: number): void {
  const { c, layout } = ctx;
  c.font = FONT;
  c.textBaseline = "middle";
  c.textAlign = "left";
  for (const block of smc.blocks) {
    const x0 = Math.max(layout.x, xOf(block.start, ctx) - ctx.bw / 2);
    const x1 = block.end === undefined ? layout.r : Math.min(layout.r, xOf(block.end, ctx));
    const y0 = yOf(block.hi, ctx);
    const y1 = yOf(block.lo, ctx);
    if (x1 <= x0 || y1 < layout.y || y0 > layout.b) continue;
    const col = block.dir === "bull" ? theme.bid : theme.ask;
    const alpha = block.isMitigated ? 0.05 : 0.14;
    c.fillStyle = rgba(col, alpha);
    c.fillRect(x0, y0, x1 - x0, Math.max(1.5, y1 - y0));
    c.strokeStyle = rgba(col, alpha * 3);
    c.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, Math.max(1, y1 - y0 - 1));
    if (density >= 1 && !block.isMitigated) {
      c.fillStyle = col;
      c.fillText(block.dir === "bull" ? "OB+" : "OB-", x0 + 4, y0 + 8);
    }
  }
}

const SWEEP_COLOR = "#FFB224";

function drawLiquidity(ctx: SmcContext, smc: SmcAnalysis, theme: ThemeColors): void {
  const { c, layout } = ctx;
  c.font = FONT;
  c.textBaseline = "middle";
  c.textAlign = "left";
  for (const pool of smc.pools) {
    const x0 = Math.max(layout.x, xOf(pool.fromIdx, ctx));
    const x1 = pool.sweptAt === undefined ? layout.r : Math.min(layout.r, xOf(pool.sweptAt, ctx));
    const y = Math.round(yOf(pool.price, ctx)) + 0.5;
    if (x1 <= x0 || y < layout.y || y > layout.b) continue;
    const col = pool.kind === "EQH" ? theme.ask : theme.bid;
    c.strokeStyle = rgba(col, pool.sweptAt === undefined ? 0.8 : 0.3);
    c.setLineDash([2, 3]);
    c.beginPath();
    c.moveTo(x0, y);
    c.lineTo(x1, y);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = rgba(col, pool.sweptAt === undefined ? 1 : 0.5);
    c.fillText(pool.kind, x0 + 3, y + (pool.kind === "EQH" ? -7 : 8));
  }
  for (const sweep of smc.sweeps) {
    const x0 = Math.max(layout.x, xOf(sweep.fromIdx, ctx));
    const x1 = xOf(sweep.idx, ctx);
    const y = Math.round(yOf(sweep.level, ctx)) + 0.5;
    if (x1 < layout.x || x0 > layout.r || y < layout.y || y > layout.b) continue;
    c.strokeStyle = rgba(SWEEP_COLOR, 0.55);
    c.beginPath();
    c.moveTo(x0, y);
    c.lineTo(x1, y);
    c.stroke();
    c.fillStyle = SWEEP_COLOR;
    c.textAlign = "center";
    c.fillText(sweep.dir === "bear" ? "▼ SWEEP" : "▲ SWEEP", x1, y + (sweep.dir === "bear" ? -9 : 10));
    c.textAlign = "left";
  }
}

function drawDashedLevel(ctx: SmcContext, price: number, fromIdx: number, label: string, color: string): void {
  const { c, layout } = ctx;
  const x0 = Math.max(layout.x, xOf(fromIdx, ctx));
  const y = Math.round(yOf(price, ctx)) + 0.5;
  if (x0 >= layout.r || y < layout.y || y > layout.b) return;
  c.strokeStyle = color;
  c.setLineDash([6, 4]);
  c.beginPath();
  c.moveTo(x0, y);
  c.lineTo(layout.r, y);
  c.stroke();
  c.setLineDash([]);
  c.fillStyle = color;
  c.textAlign = "left";
  c.fillText(label, x0 + 3, y - 7);
}

function drawPremiumDiscount(ctx: SmcContext, smc: SmcAnalysis, theme: ThemeColors): void {
  const { c, layout } = ctx;
  c.font = FONT;
  c.textBaseline = "middle";
  const range = smc.range;
  if (range) {
    const x0 = Math.max(layout.x, xOf(range.fromIdx, ctx));
    const yHi = yOf(range.hi, ctx);
    const yMid = yOf(range.mid, ctx);
    const yLo = yOf(range.lo, ctx);
    c.fillStyle = rgba(theme.ask, 0.05);
    c.fillRect(x0, yHi, layout.r - x0, yMid - yHi);
    c.fillStyle = rgba(theme.bid, 0.05);
    c.fillRect(x0, yMid, layout.r - x0, yLo - yMid);
    drawDashedLevel(ctx, range.mid, range.fromIdx, "EQ", "rgba(140,160,191,0.7)");
  }
  if (smc.daily) {
    drawDashedLevel(ctx, smc.daily.pdh, smc.daily.fromIdx, "PDH", "rgba(63,193,255,0.8)");
    drawDashedLevel(ctx, smc.daily.pdl, smc.daily.fromIdx, "PDL", "rgba(63,193,255,0.8)");
  }
}

/** Draws the enabled SMC layers over confirmed bars (`floor` excludes the forming bar). */
export function drawSmcLayers(
  ctx: SmcContext, state: SimulationState, floor: number, params: TerminalParams, theme: ThemeColors,
): void {
  const smc = analyzeSmc(state.bars, Math.min(floor, state.bars.length));
  ctx.c.save();
  if (params.ob) drawOrderBlocks(ctx, smc, theme, params.density);
  if (params.pd) drawPremiumDiscount(ctx, smc, theme);
  if (params.liq) drawLiquidity(ctx, smc, theme);
  if (params.bos) drawStructure(ctx, smc, theme, params.density);
  ctx.c.restore();
}
