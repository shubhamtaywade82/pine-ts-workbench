import { NORMAL, type MarketEvent, type PlotLayout, type TerminalParams, type ThemeColors, type ViewportState } from "./terminal-types";
import { type SimulationState, binTicks, clamp, lerp, wallThreshold } from "./terminal-simulation";
import { drawRoundRect, fmtP, fmtS, fmtT, rgba, tickDecimals } from "./terminal-formatters";

interface FormingBar {
  i: number;
  b: SimulationState["bars"][0];
  cur: number;
  h: number;
  l: number;
}

export interface FlashEvent extends MarketEvent {
  t0: number;
}

export function getFormingValues(state: SimulationState): FormingBar {
  const i = Math.min(Math.floor(state.playhead), state.bars.length - 1);
  const b = state.bars[i] || { t: 0, o: 74, h: 74, l: 74, c: 74, v: 0, buyR: 0.5, path: [74] };
  if (state.shown !== undefined) {
    return { i, b, cur: state.shown, h: Math.max(b.h, state.shown), l: Math.min(b.l, state.shown) };
  }
  const f = clamp(state.playhead - i, 0, 1);
  const path = b.path && b.path.length > 0 ? b.path : [b.o, b.c];
  const maxIdx = Math.max(1, path.length - 1);
  const k = f * maxIdx;
  const i0 = Math.floor(k);
  const i1 = Math.min(maxIdx, i0 + 1);
  const p0 = path[i0] ?? b.o;
  const p1 = path[i1] ?? p0;
  const cur = lerp(p0, p1, k - i0);
  let h = b.o;
  let l = b.o;
  for (let j = 0; j <= i0; j++) {
    h = Math.max(h, path[j] ?? b.o);
    l = Math.min(l, path[j] ?? b.o);
  }
  return { i, b, cur, h: Math.max(h, cur), l: Math.min(l, cur) };
}

const X = (i: number, v: ViewportState, l: PlotLayout): number =>
  l.x + (i - (v.center - v.visible / 2)) * (l.w / v.visible);

const Y = (p: number, v: ViewportState, l: PlotLayout): number =>
  l.y + ((v.maxP - p) / (v.maxP - v.minP)) * l.h;

const MIN_LABEL_ROW_PX = 11;

function drawLadderLabel(c: CanvasRenderingContext2D, size: number, isWall: boolean, isBid: boolean, barX: number, midY: number, barW: number, t: ThemeColors): void {
  c.save();
  c.font = '600 9px "IBM Plex Mono", monospace';
  c.textBaseline = "middle";
  c.textAlign = "left";
  if (barW > 30) {
    c.fillStyle = "#E9EFFA";
    c.fillText(fmtS(size), barX + 4, midY + 0.5);
  }
  if (isWall) {
    const tag = isBid ? "BIG BUYERS" : "BIG SELLERS";
    c.textAlign = "right";
    c.fillStyle = isBid ? t.bid : t.ask;
    c.fillText(tag, barX - 6, midY + 0.5);
  }
  c.restore();
}

function drawDepthLadder(c: CanvasRenderingContext2D, map: Map<number, number> | undefined, maxS: number, l: PlotLayout, v: ViewportState, p: TerminalParams, t: ThemeColors, last: number, tick: number): void {
  if (!p.ladder || !map) return;
  const lw = p.ladderW;
  const binSize = binTicks(p.bin, tick) * tick;
  const binPx = Math.max(1.5, (binSize / (v.maxP - v.minP)) * l.h - 1);
  const wallMin = wallThreshold([...map.values()]);
  const hasRoomForText = binPx >= MIN_LABEL_ROW_PX;
  const g = c.createLinearGradient(l.r - lw - 24, 0, l.r, 0);
  g.addColorStop(0, "rgba(7,13,26,0)");
  g.addColorStop(1, "rgba(7,13,26,0.62)");
  c.fillStyle = g;
  c.fillRect(l.r - lw - 24, l.y, lw + 24, l.h);
  for (const [ai, s] of map) {
    const price = ai * binSize;
    if (price < v.minP || price > v.maxP) continue;
    const ratio = Math.pow(s / maxS, 0.7);
    const w = Math.max(1, ratio * lw);
    const y = Y(price + binSize / 2, v, l);
    const col = price < last ? t.bid : t.ask;
    c.fillStyle = rgba(col, 0.22 + 0.55 * ratio);
    c.fillRect(l.r - w, y, w, binPx);
    if (hasRoomForText) drawLadderLabel(c, s, s >= wallMin, price < last, l.r - w, y + binPx / 2, w, t);
    if (s >= NORMAL * 4) {
      c.save();
      if (p.glow > 0) { c.shadowBlur = p.glow * 12; c.shadowColor = col; }
      c.strokeStyle = rgba(col, 0.9);
      c.lineWidth = 1;
      c.strokeRect(l.r - w + 0.5, y + 0.5, w - 1, Math.max(1, binPx - 1));
      c.restore();
    }
  }
}

function drawPulledGhosts(c: CanvasRenderingContext2D, events: MarketEvent[], floor: number, playhead: number, ladderMax: number, l: PlotLayout, v: ViewportState, bw: number, lw: number): void {
  for (let e = events.length - 1; e >= 0; e--) {
    const ev = events[e];
    if (ev.bar > floor) continue;
    const d = playhead - ev.bar;
    if (d > 6) break;
    if (ev.type !== "pull") continue;
    const a = clamp(1 - d / 6, 0, 1);
    const y = Y(ev.price, v, l);
    if (y < l.y || y > l.b) continue;
    const w = Math.pow(ev.size / ladderMax, 0.7) * lw;
    c.globalAlpha = a * 0.7;
    c.strokeStyle = "#FFB224";
    c.setLineDash([3, 3]);
    c.strokeRect(l.r - w + 0.5, y - 3, w - 1, 6);
    c.setLineDash([]);
    const mx = X(ev.bar, v, l) + bw / 2;
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(mx - 4, y - 4); c.lineTo(mx + 4, y + 4);
    c.moveTo(mx + 4, y - 4); c.lineTo(mx - 4, y + 4);
    c.stroke();
    c.globalAlpha = 1;
  }
}

function drawFlashes(c: CanvasRenderingContext2D, flashes: FlashEvent[], now: number, l: PlotLayout, v: ViewportState, bw: number, t: ThemeColors): void {
  for (const f of flashes) {
    const progress = (now - f.t0) / 900;
    const y = Y(f.price, v, l);
    if (y < l.y - 30 || y > l.b + 30) continue;
    const x = clamp(X(f.bar, v, l) + bw / 2, l.x, l.r);
    const col = f.type === "held" ? "#9BE84C" : f.type === "wall" ? "#8F7BFF" : t.ask;
    c.globalAlpha = (1 - progress) * 0.9;
    c.strokeStyle = col;
    c.lineWidth = 2;
    c.beginPath();
    c.arc(x, y, 4 + progress * 26, 0, 7);
    c.stroke();
    if (f.type === "held") {
      c.beginPath();
      c.arc(x, y, 2.5, 0, 7);
      c.fillStyle = col;
      c.fill();
    }
    c.globalAlpha = 1;
  }
}

function drawFormingCandle(c: CanvasRenderingContext2D, fv: FormingBar, l: PlotLayout, v: ViewportState, bw: number, p: TerminalParams, t: ThemeColors): void {
  const x = X(fv.i, v, l) + bw / 2;
  const bodyW = clamp(bw * 0.62, 2, 15);
  const up = fv.cur >= fv.b.o;
  const col = up ? t.bid : t.ask;
  const yo = Y(fv.b.o, v, l);
  const yc = Y(fv.cur, v, l);
  const top = Math.min(yo, yc);
  const hgt = Math.max(1.2, Math.abs(yo - yc));
  c.strokeStyle = col;
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(x, Y(fv.h, v, l)); c.lineTo(x, Y(fv.l, v, l));
  c.stroke();
  if (p.candle === "hollow" && up) {
    c.fillStyle = "rgba(7,13,26,0.85)";
    c.fillRect(x - bodyW / 2, top, bodyW, hgt);
    c.lineWidth = 1.3;
    c.strokeRect(x - bodyW / 2 + 0.5, top + 0.5, bodyW - 1, Math.max(1, hgt - 1));
  } else {
    c.fillStyle = col;
    c.fillRect(x - bodyW / 2, top, bodyW, hgt);
  }
}

interface PriceChip { y0: number; y: number; h: number; bg: string; fg: string; txt: string; border?: string }

function resolveChips(chips: PriceChip[], l: PlotLayout): void {
  chips.sort((a, b) => a.y0 - b.y0);
  for (const ch of chips) ch.y = clamp(ch.y0, l.y + 8, l.b - 8);
  for (let i = 1; i < chips.length; i++) {
    if (chips[i].y < chips[i - 1].y + chips[i - 1].h + 2) {
      chips[i].y = chips[i - 1].y + chips[i - 1].h + 2;
    }
  }
  const overB = chips.length ? chips[chips.length - 1].y + chips[chips.length - 1].h - (l.b - 2) : 0;
  if (overB > 0) {
    for (const ch of chips) ch.y = Math.max(l.y + 2, ch.y - overB);
  }
}

function drawPriceChips(c: CanvasRenderingContext2D, last: number, bigs: SimulationState["bigsSnap"][0], l: PlotLayout, v: ViewportState, density: number, t: ThemeColors, axisW: number, tick: number): void {
  const dec = tickDecimals(tick);
  const lastCol = last >= (bigs && bigs[0] ? bigs[0].size : last) ? t.bid : t.ask;
  const bestBid = Math.floor(last / tick) * tick;
  const bestAsk = bestBid + tick;
  const chips: PriceChip[] = [
    { y0: Y(last, v, l), y: 0, h: 17, bg: lastCol, fg: "#04070F", txt: fmtP(last, dec) },
    { y0: Y(bestAsk, v, l), y: 0, h: 15, bg: t.ask, fg: "#2B040C", txt: "A " + fmtP(bestAsk, dec) },
    { y0: Y(bestBid, v, l), y: 0, h: 15, bg: t.bid, fg: "#03231A", txt: "B " + fmtP(bestBid, dec) },
  ];
  const cap = density === 0 ? 0 : density === 1 ? 3 : 6;
  const sortedBigs = (bigs || []).slice().sort((a, b) => b.size - a.size).slice(0, cap);
  for (const b of sortedBigs) {
    const p = b.idx * tick;
    if (p < v.minP || p > v.maxP) continue;
    chips.push({
      y0: Y(p, v, l), y: 0, h: 14, bg: "#101C30", fg: b.side === "bid" ? t.bid : t.ask,
      border: b.side === "bid" ? t.bid : t.ask, txt: fmtP(p, dec) + " " + fmtS(b.size),
    });
  }
  resolveChips(chips, l);
  c.font = '600 9px "IBM Plex Mono", monospace';
  c.textBaseline = "middle";
  for (const ch of chips) {
    const tw = c.measureText(ch.txt).width + 10;
    const x = l.r + 2;
    drawRoundRect(c, x, ch.y, Math.min(axisW - 4, tw), ch.h, 4);
    c.fillStyle = ch.bg;
    c.fill();
    if (ch.border) { c.strokeStyle = ch.border; c.lineWidth = 1; c.stroke(); }
    c.fillStyle = ch.fg;
    c.textAlign = "left";
    c.fillText(ch.txt, x + 5, ch.y + ch.h / 2 + 0.5);
  }
}

function drawCrosshair(c: CanvasRenderingContext2D, hover: { px: number; py: number }, l: PlotLayout, v: ViewportState, bw: number, bars: SimulationState["bars"], axisW: number, tick: number): void {
  const { px, py } = hover;
  if (px <= l.x || px >= l.r || py <= l.y || py >= l.b) return;
  c.strokeStyle = "#8CA0BF";
  c.globalAlpha = 0.5;
  c.setLineDash([3, 4]);
  c.beginPath();
  c.moveTo(px + 0.5, l.y); c.lineTo(px + 0.5, l.b);
  c.moveTo(l.x, py + 0.5); c.lineTo(l.r, py + 0.5);
  c.stroke();
  c.setLineDash([]);
  c.globalAlpha = 1;

  const rawPrice = v.maxP - ((py - l.y) / l.h) * (v.maxP - v.minP);
  const price = Math.round(rawPrice / tick) * tick;
  drawRoundRect(c, l.r + 2, py - 9, axisW - 4, 18, 4);
  c.fillStyle = "#1B2B4A";
  c.fill();
  c.fillStyle = "#E9EFFA";
  c.textAlign = "left";
  c.font = '10px "IBM Plex Mono", monospace';
  c.fillText(fmtP(price, tickDecimals(tick)), l.r + 7, py + 0.5);

  const hi = clamp(Math.floor(v.center - v.visible / 2 + (px - l.x) / bw), 0, bars.length - 1);
  if (bars[hi]) {
    const tt = fmtT(bars[hi].t);
    const tw = c.measureText(tt).width + 12;
    drawRoundRect(c, clamp(px - tw / 2, l.x, l.r - tw), l.b + 2, tw, 17, 4);
    c.fillStyle = "#1B2B4A";
    c.fill();
    c.fillStyle = "#E9EFFA";
    c.textAlign = "center";
    c.fillText(tt, clamp(px, l.x + tw / 2, l.r - tw / 2), l.b + 11);
  }
}

export function drawOverlay(
  c: CanvasRenderingContext2D,
  state: SimulationState,
  viewport: ViewportState,
  params: TerminalParams,
  theme: ThemeColors,
  layout: PlotLayout,
  dpr: number,
  ladderMap: Map<number, number> | undefined,
  maxLadderSize: number,
  flashes: FlashEvent[],
  hover: { px: number; py: number } | null,
  isDragging: boolean,
  now: number,
  axisW: number,
  totalW: number,
  totalH: number,
): void {
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, totalW, totalH);
  const floor = Math.floor(state.playhead);
  const bw = layout.w / viewport.visible;
  const fv = getFormingValues(state);
  const up = fv.cur >= fv.b.o;
  const lastCol = up ? theme.bid : theme.ask;

  drawDepthLadder(c, ladderMap, maxLadderSize, layout, viewport, params, theme, fv.cur, state.tick);
  if (params.pulled) drawPulledGhosts(c, state.events, floor, state.playhead, maxLadderSize, layout, viewport, bw, params.ladderW);
  drawFlashes(c, flashes, now, layout, viewport, bw, theme);
  drawFormingCandle(c, fv, layout, viewport, bw, params, theme);

  const y = Y(fv.cur, viewport, layout);
  if (y > layout.y && y < layout.b) {
    c.strokeStyle = lastCol;
    c.globalAlpha = 0.55;
    c.setLineDash([2, 4]);
    c.beginPath();
    c.moveTo(layout.x, Math.round(y) + 0.5);
    c.lineTo(layout.r, Math.round(y) + 0.5);
    c.stroke();
    c.setLineDash([]);
    c.globalAlpha = 1;
    const px = clamp(X(fv.i, viewport, layout) + bw / 2, layout.x, layout.r - 4);
    const r = 3 + Math.sin(now * 0.006) * 1.1;
    c.save();
    c.shadowBlur = 10;
    c.shadowColor = lastCol;
    c.fillStyle = lastCol;
    c.beginPath();
    c.arc(px, y, r, 0, 7);
    c.fill();
    c.restore();
  }

  const bigs = state.bigsSnap[floor] || [];
  drawPriceChips(c, fv.cur, bigs, layout, viewport, params.density, theme, axisW, state.tick);
  if (hover && !isDragging) drawCrosshair(c, hover, layout, viewport, bw, state.bars, axisW, state.tick);
}
