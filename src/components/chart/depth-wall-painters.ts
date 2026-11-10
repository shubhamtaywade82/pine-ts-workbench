import type { Wall } from "@/lib/depth-walls";
import type { DepthStatus } from "@/lib/depth-feed";
import type { BookSide } from "@/lib/order-book";
import type { DepthWallStyle } from "@/lib/chart-settings";

const BID_COLOR = "#089981";
const ASK_COLOR = "#f23645";
const STALE_COLOR = "#787b86";
const AMBER_COLOR = "#f59e0b";
const CYAN_COLOR = "#38bdf8";
const BG_DARK = "rgba(19, 23, 34, 0.92)";

export interface WallPaintContext {
  readonly context: CanvasRenderingContext2D;
  readonly side: BookSide;
  readonly wall: Wall;
  readonly x: number;
  readonly y: number;
  readonly labelY: number;
  readonly alpha: number;
  readonly radius: number;
  readonly paneWidth: number;
  readonly status: DepthStatus;
  readonly quoteAsset: string;
  readonly searchedPct: number;
  readonly clippedByCoverage: boolean;
  readonly observedMs: number;
  readonly fullLabel: string;
  readonly compactLabel?: string;
  readonly notionalOnly?: string;
  readonly label?: string;
  readonly minLabelX?: number;
}

interface PillRect {
  readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly r: number;
}

interface ClipBox {
  readonly x: number; readonly y: number; readonly w: number; readonly h: number;
}

interface BadgeStyle {
  readonly h: number;
  readonly r: number;
  readonly pad: number;
  readonly stroke: string;
  readonly lineWidth?: number;
}

interface BracketCardParams {
  readonly cardX: number;
  readonly y: number;
  readonly actualW: number;
  readonly cardW: number;
  readonly cardH: number;
  readonly color: string;
  readonly wall: Wall;
  readonly label: string;
}

const resolveColor = (side: BookSide, status: DepthStatus, wallStatus?: string): string => {
  if (status !== "live") return STALE_COLOR;
  if (wallStatus === "reduced") return AMBER_COLOR;
  if (wallStatus === "stacking") return CYAN_COLOR;
  return side === "bid" ? BID_COLOR : ASK_COLOR;
};

const drawPill = (ctx: CanvasRenderingContext2D, rect: PillRect): void => {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, rect.r);
  } else {
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
  }
};

const clipAndFillText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  pos: { readonly x: number; readonly y: number },
  clip?: ClipBox
): void => {
  if (clip !== undefined) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(clip.x, clip.y, clip.w, clip.h);
    ctx.clip();
    ctx.fillText(text, pos.x, pos.y);
    ctx.restore();
    return;
  }
  ctx.fillText(text, pos.x, pos.y);
};

/**
 * Chooses the compact label if it fits the space between the forming candle
 * and the pane edge; otherwise falls back to the notional-only text.
 */
export function fitWallLabel(
  labels: { readonly compact: string; readonly notionalOnly: string },
  availablePx: number,
  measure: (text: string) => number,
): string {
  return measure(labels.compact) <= availablePx ? labels.compact : labels.notionalOnly;
}

const resolveBadgeLabel = (
  ctx: CanvasRenderingContext2D,
  p: WallPaintContext,
  pad: number,
  availablePx: number,
): string => {
  if (p.notionalOnly === undefined) return p.label ?? p.fullLabel;
  const compact = p.compactLabel ?? p.label ?? p.fullLabel;
  return fitWallLabel(
    { compact, notionalOnly: p.notionalOnly },
    availablePx,
    (text) => ctx.measureText(text).width + pad * 2,
  );
};

// Pill sits flush to the right margin, never shifting left over the newest candles.
const paintPillBadge = (
  ctx: CanvasRenderingContext2D,
  p: WallPaintContext,
  color: string,
  style: BadgeStyle
): void => {
  const minX = p.minLabelX ?? Math.max(10, p.x - p.radius);
  const availableSpace = Math.max(0, p.paneWidth - minX - 4);
  const label = resolveBadgeLabel(ctx, p, style.pad, availableSpace);
  const textW = ctx.measureText(label).width;
  const pillW = textW + style.pad * 2;
  const pillX = Math.max(minX, p.paneWidth - pillW - 4);
  const availableW = Math.max(0, p.paneWidth - pillX - 4);
  const actualW = Math.min(pillW, availableW);
  if (actualW <= 0) return;

  const y = p.labelY;
  const top = y - style.h / 2;
  ctx.fillStyle = BG_DARK;
  drawPill(ctx, { x: pillX, y: top, w: actualW, h: style.h, r: style.r });
  ctx.fill();
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = style.lineWidth ?? 1;
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const clip = pillW > availableW ? { x: pillX, y: top, w: actualW, h: style.h } : undefined;
  clipAndFillText(ctx, label, { x: pillX + style.pad, y }, clip);
};

const paintRayAndGauge = (ctx: CanvasRenderingContext2D, p: WallPaintContext, startX: number, color: string): void => {
  const { wall, y, radius, paneWidth } = p;
  const gaugeW = Math.min(140, Math.max(40, radius * 5));
  ctx.setLineDash(wall.status === "pulled" || p.status !== "live" ? [4, 3] : [2, 2]);
  ctx.strokeStyle = `${color}88`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(startX, y);
  ctx.lineTo(paneWidth, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = `${color}33`;
  ctx.fillRect(startX, y - 9, gaugeW, 18);
};

/** Horizontal Liquidity Shelf & Ray: exact 1px price ray with volume gauge and pill badge. */
export const paintShelf = (p: WallPaintContext): void => {
  const { context: ctx, side, wall, alpha, radius } = p;
  const color = resolveColor(side, p.status, wall.status);
  const startX = Math.max(10, p.x - radius);

  ctx.save();
  ctx.globalAlpha = alpha;
  paintRayAndGauge(ctx, p, startX, color);
  const lineWidth = wall.status === "tested" || wall.status === "reduced" ? 1.5 : 1;
  paintPillBadge(ctx, p, color, { h: 20, r: 4, pad: 8, stroke: color, lineWidth });
  ctx.restore();
};

/** Right-Margin DOM Shelf: pinned depth ladder against the price axis, keeping candles clear. */
export const paintDomShelf = (p: WallPaintContext): void => {
  const { context: ctx, side, wall, y, alpha, radius, paneWidth } = p;
  const color = resolveColor(side, p.status, wall.status);
  const barW = Math.min(130, Math.max(35, radius * 4.5));
  const rightX = paneWidth - 2;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = `${color}40`;
  ctx.fillRect(rightX - barW, y - 8, barW, 16);
  ctx.strokeStyle = `${color}aa`;
  ctx.lineWidth = 1;
  ctx.strokeRect(rightX - barW, y - 8, barW, 16);

  paintPillBadge(ctx, p, color, { h: 18, r: 3, pad: 6, stroke: `${color}88` });
  ctx.restore();
};

const paintBracketCard = (ctx: CanvasRenderingContext2D, p: BracketCardParams): void => {
  const { cardX, y, actualW, cardW, cardH, color, wall, label } = p;
  const top = y - cardH / 2;
  ctx.fillStyle = BG_DARK;
  drawPill(ctx, { x: cardX, y: top, w: actualW, h: cardH, r: 4 });
  ctx.fill();
  ctx.strokeStyle = wall.status === "reduced" ? AMBER_COLOR : color;
  ctx.lineWidth = wall.status === "reduced" ? 1.5 : 1;
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const clip = cardW > actualW ? { x: cardX, y: top, w: actualW, h: cardH } : undefined;
  clipAndFillText(ctx, label, { x: cardX + 8, y: top + 4 }, clip);

  // Absorption meter reflects resting size decrease rather than verified fills.
  const fillRatio = wall.status === "reduced" ? Math.max(0.08, Math.min(1, 1 + (wall.changePct ?? 0) / 100)) : 1;
  const meterW = Math.max(0, actualW - 16);
  ctx.fillStyle = `${color}22`;
  ctx.fillRect(cardX + 8, y + 4, meterW, 3);
  ctx.fillStyle = color;
  ctx.fillRect(cardX + 8, y + 4, meterW * fillRatio, 3);
};

/** Micro-DOM Bracket: card HUD with dynamic absorption / volume gauge bar. */
export const paintBracket = (p: WallPaintContext): void => {
  const { context: ctx, side, wall, y, alpha, radius, paneWidth } = p;
  const color = resolveColor(side, p.status, wall.status);
  const minX = p.minLabelX ?? Math.max(10, p.x - radius);
  const availableSpace = Math.max(0, paneWidth - minX - 4);
  const label = resolveBadgeLabel(ctx, p, 8, availableSpace);
  const startX = Math.max(10, p.x - radius);
  const cardW = Math.max(80, ctx.measureText(label).width + 16);
  const cardH = 26;
  const cardX = Math.max(minX, paneWidth - cardW - 4);
  const availableW = Math.max(0, paneWidth - cardX - 4);
  const actualW = Math.min(cardW, availableW);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = `${color}aa`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(startX, y);
  ctx.lineTo(startX + 8, y);
  ctx.stroke();

  if (actualW > 0) {
    paintBracketCard(ctx, { cardX, y: p.labelY, actualW, cardW, cardH, color, wall, label });
  }
  ctx.restore();
};

/** Floating bubble beside the forming candle (legacy representation). */
export const paintBubble = (p: WallPaintContext): void => {
  const { context: ctx, side, wall, x, y, alpha, radius } = p;
  const color = resolveColor(side, p.status, wall.status);
  const isReduced = wall.status === "reduced";
  const isDashed = p.status !== "live" || isReduced || wall.status === "pulled";

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = `${color}4d`;
  ctx.fill();
  ctx.setLineDash(isDashed ? [3, 2] : []);
  ctx.lineWidth = wall.status === "tested" || isReduced ? 2 : 1.5;
  ctx.strokeStyle = isReduced ? AMBER_COLOR : color;
  ctx.stroke();
  ctx.setLineDash([]);

  paintPillBadge(ctx, p, color, { h: 18, r: 3, pad: 6, stroke: `${color}88` });
  ctx.restore();
};

export const paintWallByStyle = (style: DepthWallStyle, p: WallPaintContext): void => {
  switch (style) {
    case "shelf": paintShelf(p); break;
    case "dom": paintDomShelf(p); break;
    case "bracket": paintBracket(p); break;
    case "bubbles": paintBubble(p); break;
  }
};
