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
}

const resolveColor = (side: BookSide, status: DepthStatus, wallStatus?: string): string => {
  if (status !== "live") return STALE_COLOR;
  if (wallStatus === "absorbing") return AMBER_COLOR;
  if (wallStatus === "stacking") return CYAN_COLOR;
  return side === "bid" ? BID_COLOR : ASK_COLOR;
};

const drawPill = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void => {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.rect(x, y, w, h);
  }
};

/** Horizontal Liquidity Shelf & Ray: exact 1px price ray with volume gauge and pill badge. */
export const paintShelf = (p: WallPaintContext): void => {
  const { context: ctx, side, wall, y, alpha, radius, paneWidth, fullLabel } = p;
  const color = resolveColor(side, p.status, wall.status);
  const startX = Math.max(10, p.x - radius);
  const gaugeW = Math.min(140, Math.max(40, radius * 5));

  ctx.save();
  ctx.globalAlpha = alpha;

  // Thin ray extends to right edge to visualize exact limit order price across time.
  ctx.setLineDash(wall.status === "pulled" || p.status !== "live" ? [4, 3] : [2, 2]);
  ctx.strokeStyle = `${color}88`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(startX, y);
  ctx.lineTo(paneWidth, y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Proportional volume shelf bar anchored at the price line.
  ctx.fillStyle = `${color}33`;
  ctx.fillRect(startX, y - 9, gaugeW, 18);

  // High-contrast pill badge with wall details.
  const textW = ctx.measureText(fullLabel).width;
  const pillW = textW + 16;
  const pillX = Math.min(startX + 4, Math.max(4, paneWidth - pillW - 4));
  ctx.fillStyle = BG_DARK;
  drawPill(ctx, pillX, y - 10, pillW, 20, 4);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = wall.status === "tested" || wall.status === "absorbing" ? 1.5 : 1;
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(fullLabel, pillX + 8, y);
  ctx.restore();
};

/** Right-Margin DOM Shelf: pinned depth ladder against the price axis, keeping candles clear. */
export const paintDomShelf = (p: WallPaintContext): void => {
  const { context: ctx, side, wall, y, alpha, radius, paneWidth, fullLabel } = p;
  const color = resolveColor(side, p.status, wall.status);
  const barW = Math.min(130, Math.max(35, radius * 4.5));
  const rightX = paneWidth - 2;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Depth volume block extending leftward from the price axis.
  ctx.fillStyle = `${color}40`;
  ctx.fillRect(rightX - barW, y - 8, barW, 16);
  ctx.strokeStyle = `${color}aa`;
  ctx.lineWidth = 1;
  ctx.strokeRect(rightX - barW, y - 8, barW, 16);

  // Label card sitting directly left of the depth bar.
  const textW = ctx.measureText(fullLabel).width;
  const pillW = textW + 12;
  const pillX = rightX - barW - pillW - 4;
  if (pillX > 0) {
    ctx.fillStyle = BG_DARK;
    drawPill(ctx, pillX, y - 9, pillW, 18, 3);
    ctx.fill();
    ctx.strokeStyle = `${color}88`;
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(fullLabel, pillX + 6, y);
  }
  ctx.restore();
};

/** Micro-DOM Bracket: card HUD with dynamic absorption / volume gauge bar. */
export const paintBracket = (p: WallPaintContext): void => {
  const { context: ctx, side, wall, y, alpha, radius, paneWidth, fullLabel } = p;
  const color = resolveColor(side, p.status, wall.status);
  const startX = Math.max(10, p.x - radius);
  const cardW = Math.min(260, Math.max(180, ctx.measureText(fullLabel).width + 16));
  const cardH = 26;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Connecting leader tick from level to card.
  ctx.strokeStyle = `${color}aa`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(startX, y);
  ctx.lineTo(startX + 8, y);
  ctx.stroke();

  // Container card with subtle glow on active market interactions.
  const cardX = Math.min(startX + 10, paneWidth - cardW - 4);
  ctx.fillStyle = BG_DARK;
  drawPill(ctx, cardX, y - cardH / 2, cardW, cardH, 4);
  ctx.fill();
  ctx.strokeStyle = wall.status === "absorbing" ? AMBER_COLOR : color;
  ctx.lineWidth = wall.status === "absorbing" ? 1.5 : 1;
  ctx.stroke();

  // Summary line.
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(fullLabel, cardX + 8, y - cardH / 2 + 4);

  // Live absorption / fill gauge: visually shrinks as volume is absorbed by trades.
  const changePct = wall.changePct ?? 0;
  const fillRatio = wall.status === "absorbing"
    ? Math.max(0.08, Math.min(1, 1 + changePct / 100))
    : 1;
  const meterW = cardW - 16;
  ctx.fillStyle = `${color}22`;
  ctx.fillRect(cardX + 8, y + 4, meterW, 3);
  ctx.fillStyle = color;
  ctx.fillRect(cardX + 8, y + 4, meterW * fillRatio, 3);
  ctx.restore();
};

/** Floating bubble beside the forming candle (legacy representation). */
export const paintBubble = (p: WallPaintContext): void => {
  const { context: ctx, side, wall, x, y, labelY, alpha, radius, paneWidth, fullLabel } = p;
  const color = resolveColor(side, p.status, wall.status);
  const isAbsorbing = wall.status === "absorbing";
  const isDashed = p.status !== "live" || isAbsorbing || wall.status === "pulled";

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = `${color}4d`;
  ctx.fill();
  ctx.setLineDash(isDashed ? [3, 2] : []);
  ctx.lineWidth = wall.status === "tested" || isAbsorbing ? 2 : 1.5;
  ctx.strokeStyle = isAbsorbing ? AMBER_COLOR : color;
  ctx.stroke();
  ctx.setLineDash([]);

  const fitsRight = x + radius + 3 + ctx.measureText(fullLabel).width <= paneWidth;
  ctx.textAlign = fitsRight ? "left" : "right";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(fullLabel, fitsRight ? x + radius + 3 : x - radius - 3, labelY);
  ctx.restore();
};

export const paintWallByStyle = (style: DepthWallStyle, p: WallPaintContext): void => {
  switch (style) {
    case "shelf":
      paintShelf(p);
      break;
    case "dom":
      paintDomShelf(p);
      break;
    case "bracket":
      paintBracket(p);
      break;
    case "bubbles":
      paintBubble(p);
      break;
  }
};
