import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { BookSide } from "@/lib/order-book";
import { compactQuantity } from "./dom-ladder-layout";

export interface LiquidityBubble {
  readonly price: number;
  readonly notional: number;
  readonly side: BookSide;
  readonly persistence: number;
  readonly isAttacked?: boolean;
  readonly isPulled?: boolean;
}

export interface BubblePaintConfig {
  readonly originX: number;
  readonly minRadius?: number;
  readonly maxRadius?: number;
}

const DEFAULT_MIN_RADIUS = 3;
const DEFAULT_MAX_RADIUS = 22;
const BUBBLE_FONT = "9px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif";

/**
 * Computes circle radius scaled logarithmically to prevent large walls from overwhelming the pane.
 */
export function calculateBubbleRadius(
  notional: number,
  minRadius = DEFAULT_MIN_RADIUS,
  maxRadius = DEFAULT_MAX_RADIUS
): number {
  if (notional <= 0) return minRadius;
  const scaled = Math.log10(Math.max(1, notional)) * 3.5;
  return Math.max(minRadius, Math.min(maxRadius, scaled));
}

/**
 * Resolves color coding based on state: attacked (amber), committed (emerald/crimson), or pulled (grey).
 */
export function resolveBubbleColor(bubble: LiquidityBubble): { fill: string; stroke: string } {
  if (bubble.isPulled) {
    return { fill: "rgba(150, 150, 150, 0.25)", stroke: "rgba(180, 180, 180, 0.4)" };
  }
  if (bubble.isAttacked) {
    return { fill: "rgba(255, 179, 0, 0.8)", stroke: "#FFD54F" };
  }
  if (bubble.side === "bid") {
    return bubble.persistence >= 0.7
      ? { fill: "rgba(0, 230, 118, 0.75)", stroke: "#69F0AE" }
      : { fill: "rgba(8, 153, 129, 0.55)", stroke: "#00E676" };
  }
  return bubble.persistence >= 0.7
    ? { fill: "rgba(255, 23, 68, 0.75)", stroke: "#FF5252" }
    : { fill: "rgba(242, 54, 69, 0.55)", stroke: "#FF1744" };
}

function drawSingleBubble(
  context: CanvasRenderingContext2D,
  bubble: LiquidityBubble,
  x: number,
  y: number
): void {
  const radius = calculateBubbleRadius(bubble.notional);
  const { fill, stroke } = resolveBubbleColor(bubble);

  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = fill;
  context.fill();
  context.lineWidth = 1;
  context.strokeStyle = stroke;
  context.stroke();

  if (radius >= 9) {
    context.font = BUBBLE_FONT;
    context.fillStyle = "#FFFFFF";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(compactQuantity(bubble.notional), x, y);
  }
}

/**
 * Custom series primitive rendering dynamic order book liquidity bubbles anchored to price levels.
 */
export class DomBubblesPrimitive implements ISeriesPrimitive<Time> {
  private attachedTo: SeriesAttachedParameter<Time> | null = null;
  private bubbles: readonly LiquidityBubble[] = [];
  private originX = 100;
  private readonly view: IPrimitivePaneView = { renderer: () => this.renderer };
  private readonly renderer: IPrimitivePaneRenderer = {
    draw: (target: CanvasRenderingTarget2D) =>
      target.useMediaCoordinateSpace(({ context }) => this.paint(context)),
  };

  public attached(param: SeriesAttachedParameter<Time>): void {
    this.attachedTo = param;
  }

  public detached(): void {
    this.attachedTo = null;
  }

  public paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  public update(bubbles: readonly LiquidityBubble[], originX: number): void {
    this.bubbles = bubbles;
    this.originX = originX;
    this.attachedTo?.requestUpdate();
  }

  private paint(context: CanvasRenderingContext2D): void {
    const attached = this.attachedTo;
    if (attached === null || this.bubbles.length === 0) return;

    context.save();
    for (const bubble of this.bubbles) {
      const y = attached.series.priceToCoordinate(bubble.price);
      if (y === null) continue;
      const xOffset = bubble.side === "bid" ? -28 : 28;
      drawSingleBubble(context, bubble, this.originX + xOffset, y);
    }
    context.restore();
  }
}
