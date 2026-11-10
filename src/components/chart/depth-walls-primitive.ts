import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { DepthStatus, DepthWallsUpdate } from "@/lib/depth-feed";
import { bubbleRadius, decayedReference, type Wall } from "@/lib/depth-walls";
import type { BookSide } from "@/lib/order-book";
import type { DepthWallStyle, WallLabel } from "@/lib/chart-settings";
import { paintWallByStyle } from "./depth-wall-painters";
import { formatCompact } from "./footprint-primitive";

const RADIUS = { min: 5, max: 24 };
// Bubble size is relative to a recent peak that halves every minute without a new one.
const REFERENCE_HALF_LIFE_MS = 60_000;
// Same feel as the forming candle's smoothing (~95% of a move in ~450ms).
const ANIMATION_TAU_MS = 150;
const SETTLE_EPSILON = 0.01;
const GAP_PX = 3;
// Pill height (20px) plus breathing room so stacked pills never overlap.
const LABEL_LINE_PX = 22;
const LABEL_FONT = "10px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif";

interface Bubble {
  wall: Wall | undefined;
  price: number;
  radius: number;
  alpha: number;
  targetPrice: number;
  targetRadius: number;
  targetAlpha: number;
}

interface PaintParams {
  readonly paneWidth: number;
  readonly formingX: number;
  readonly barSpacing: number;
  readonly minLabelX: number;
  readonly ys: { readonly ask: number | null; readonly bid: number | null };
  readonly labelYs: { readonly ask: number | null; readonly bid: number | null };
}

/**
 * Live order-book walls as bubbles beside the forming candle: green bid, red
 * ask, centred on each wall's own price (not the candle's OHLC), sized by
 * quote notional. Size, price and fade animate between depth updates; the
 * chart repaints via `requestUpdate`, never through React.
 */
export class DepthWallsPrimitive implements ISeriesPrimitive<Time> {
  private attachedTo: SeriesAttachedParameter<Time> | null = null;
  private update: DepthWallsUpdate | undefined;
  private readonly bubbles = new Map<BookSide, Bubble>();
  private style: DepthWallStyle = "shelf";
  private labelMode: WallLabel = "compact";
  private reference = 0;
  private referenceAt = 0;
  private frame: number | null = null;
  private lastFrameAt = 0;
  private readonly view: IPrimitivePaneView = { renderer: () => this.renderer };
  private readonly renderer: IPrimitivePaneRenderer = {
    draw: (target: CanvasRenderingTarget2D) =>
      target.useMediaCoordinateSpace(({ context, mediaSize }) => this.paint(context, mediaSize.width)),
  };

  public attached(param: SeriesAttachedParameter<Time>): void { this.attachedTo = param; }
  public detached(): void { this.attachedTo = null; this.stopAnimation(); }
  public paneViews(): readonly IPrimitivePaneView[] { return [this.view]; }

  public setStyle(style: DepthWallStyle): void {
    if (this.style === style) return;
    this.style = style;
    this.attachedTo?.requestUpdate();
  }
  public setLabel(wallLabel: WallLabel): void {
    if (this.labelMode === wallLabel) return;
    this.labelMode = wallLabel;
    this.attachedTo?.requestUpdate();
  }

  /** The latest subscription update, or `undefined` to clear (overlay off / symbol switched). */
  public setUpdate(update: DepthWallsUpdate | undefined, now = Date.now()): void {
    this.update = update;
    if (update === undefined) {
      this.bubbles.clear();
      this.reference = 0;
      this.stopAnimation();
      this.attachedTo?.requestUpdate();
      return;
    }
    const walls = { bid: update.frame?.bid, ask: update.frame?.ask };
    const peak = Math.max(walls.bid?.notional ?? 0, walls.ask?.notional ?? 0);
    this.reference = decayedReference(this.reference, peak, now - this.referenceAt, REFERENCE_HALF_LIFE_MS);
    this.referenceAt = now;
    for (const side of ["bid", "ask"] as const) this.retarget(side, walls[side]);
    this.startAnimation();
  }

  private retarget(side: BookSide, wall: Wall | undefined): void {
    const bubble = this.bubbles.get(side);
    if (wall === undefined) {
      if (bubble !== undefined && bubble.wall !== undefined) {
        // A shrinking wall that vanishes stays "removed"; anything else was pulled.
        const wasReduced = bubble.wall.status === "reduced" || bubble.wall.status === "removed";
        bubble.wall = { ...bubble.wall, status: wasReduced ? "removed" : "pulled" };
        bubble.targetAlpha = 0;
      }
      return;
    }
    const radius = bubbleRadius(wall.notional, this.reference, RADIUS);
    if (bubble === undefined || bubble.alpha < SETTLE_EPSILON) {
      // A new wall appears at its price and grows in, instead of sliding from an old one.
      this.bubbles.set(side, { wall, price: wall.price, radius: RADIUS.min, alpha: 0, targetPrice: wall.price, targetRadius: radius, targetAlpha: 1 });
      return;
    }
    Object.assign(bubble, { wall, targetPrice: wall.price, targetRadius: radius, targetAlpha: 1 });
  }

  private startAnimation(): void {
    if (this.frame !== null || typeof requestAnimationFrame === "undefined") {
      this.attachedTo?.requestUpdate();
      return;
    }
    this.lastFrameAt = performance.now();
    const step = (at: number) => {
      const t = 1 - Math.exp(-(at - this.lastFrameAt) / ANIMATION_TAU_MS);
      this.lastFrameAt = at;
      const settled = this.advance(t);
      this.attachedTo?.requestUpdate();
      this.frame = settled ? null : requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  private stopAnimation(): void {
    if (this.frame !== null && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  /** Moves every bubble a fraction `t` toward its target; true once nothing visibly moves. */
  private advance(t: number): boolean {
    let settled = true;
    for (const [side, bubble] of this.bubbles) {
      bubble.price += (bubble.targetPrice - bubble.price) * t;
      bubble.radius += (bubble.targetRadius - bubble.radius) * t;
      bubble.alpha += (bubble.targetAlpha - bubble.alpha) * t;
      const moving =
        Math.abs(bubble.targetPrice - bubble.price) > Math.abs(bubble.targetPrice) * 1e-7 ||
        Math.abs(bubble.targetRadius - bubble.radius) > SETTLE_EPSILON ||
        Math.abs(bubble.targetAlpha - bubble.alpha) > SETTLE_EPSILON;
      if (moving) settled = false;
      else Object.assign(bubble, { price: bubble.targetPrice, radius: bubble.targetRadius, alpha: bubble.targetAlpha });
      if (bubble.targetAlpha === 0 && bubble.alpha <= SETTLE_EPSILON) this.bubbles.delete(side);
    }
    return settled;
  }

  private paint(context: CanvasRenderingContext2D, paneWidth: number): void {
    const attached = this.attachedTo;
    const forming = attached?.series.data().at(-1);
    if (attached === null || forming === undefined || this.update === undefined) return;
    const formingX = attached.chart.timeScale().timeToCoordinate(forming.time);
    if (formingX === null) return; // Forming candle scrolled out of view.
    const barSpacing = attached.chart.timeScale().options().barSpacing ?? 6;
    const ys = {
      ask: this.bubbleY("ask", (price) => attached.series.priceToCoordinate(price)),
      bid: this.bubbleY("bid", (price) => attached.series.priceToCoordinate(price)),
    };
    const labelYs = separateLabels(ys.ask, ys.bid, LABEL_LINE_PX);
    context.font = LABEL_FONT;
    const minLabelX = formingX + barSpacing / 2 + 4;
    this.paintBubbles(context, { paneWidth, formingX, barSpacing, minLabelX, ys, labelYs });
    context.globalAlpha = 1;
  }

  private paintBubbles(context: CanvasRenderingContext2D, p: PaintParams): void {
    if (this.update === undefined) return;
    const { status, quoteAsset, frame, observedUntil } = this.update;
    const observationEnd = status === "live" ? Date.now() : observedUntil;
    const isCompact = this.labelMode === "compact";
    for (const [side, bubble] of this.bubbles) {
      const y = p.ys[side];
      if (y === null || bubble.wall === undefined) continue;
      const wall = bubble.wall;
      const x = bubbleCenterX(p.formingX, p.barSpacing, bubble.radius, p.paneWidth);
      const label = isCompact ? formatWallPill(wall) : wallLabel({
        wall, status, quoteAsset,
        searchedPct: frame?.searchedPct ?? 0,
        clippedByCoverage: frame?.clippedByCoverage ?? false,
        observedMs: observationEnd - wall.observedSince,
      });
      const notionalOnly = isCompact ? formatCompact(wall.notional) : undefined;
      paintWallByStyle(this.style, {
        context, side, wall, x, y,
        labelY: p.labelYs[side] ?? y,
        alpha: bubble.alpha, radius: bubble.radius,
        paneWidth: p.paneWidth, status,
        label, notionalOnly, minLabelX: p.minLabelX,
      });
    }
  }

  private bubbleY(side: BookSide, toY: (price: number) => number | null): number | null {
    const bubble = this.bubbles.get(side);
    return bubble?.wall === undefined ? null : toY(bubble.price);
  }
}

/**
 * Label heights for the two walls. On wide (higher-timeframe) scales the walls can sit
 * a pixel apart; the labels then spread around their midpoint to one line apart, ask
 * above bid, while the bubbles stay on their true prices.
 */
export const separateLabels = (askY: number | null, bidY: number | null, lineHeight: number): { ask: number | null; bid: number | null } => {
  if (askY === null || bidY === null || bidY - askY >= lineHeight) return { ask: askY, bid: bidY };
  const middle = (askY + bidY) / 2;
  return { ask: middle - lineHeight / 2, bid: middle + lineHeight / 2 };
};

/** Just right of the forming candle's body, pulled back inside the pane when there is no room. */
export const bubbleCenterX = (formingX: number, barSpacing: number, radius: number, paneWidth: number): number => {
  const preferred = formingX + barSpacing / 2 + GAP_PX + radius;
  return Math.max(radius, Math.min(preferred, paneWidth - radius));
};

/** 950 → "950", 12_300 → "12.3K", 2_048_054 → "2.05M". */
export const formatNotional = (value: number): string => {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
};

/** Compact price and notional only for on-chart pill: e.g. "2,043.5 · 269k". */
export const formatWallPill = (wall: Pick<Wall, "price" | "notional">): string => {
  const price = wall.price.toLocaleString("en-US", { maximumFractionDigits: 8 });
  return `${price} · ${formatCompact(wall.notional)}`;
};

/** Observation length: "<10s" under 10 s (never blank, so a short observation isn't hidden), then "45s", "3m", "1h 5m". */
export const formatAge = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 10) return "<10s";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

/** Detection window as shown: "0.5", "0.9" (never "0.90" or "0.5000"). */
export const formatPct = (pct: number): string => String(Number(pct.toFixed(2)));

export interface WallLabelInput {
  readonly wall: Wall;
  readonly status: DepthStatus;
  readonly quoteAsset: string;
  readonly searchedPct: number;
  readonly clippedByCoverage: boolean;
  readonly observedMs: number;
}

/** Formats resting-liquidity status: reduced (-35%), removed, stacking, tested, or holding. */
export const formatLiquidityStatus = (wall: Wall, observedMs: number): string => {
  const age = formatAge(observedMs);
  switch (wall.status) {
    case "reduced": return `reduced (${Math.round(wall.changePct ?? 0)}%) · ${age}`;
    case "removed": return `removed · ${age}`;
    case "stacking": return `stacking (+${Math.round(wall.changePct ?? 0)}%) · ${age}`;
    case "tested": return `tested (holding) · ${age}`;
    case "pulled": return "pulled";
    case "holding": return `holding · ${age}`;
    default: return `observed for ${age}`;
  }
};

/**
 * "79,500 · 2.05M USDT · holding · 3m · max in ±0.5%". The scope says this
 * is the largest level inside the searched window, not the market's maximum.
 * Real-time liquidity status (reduced, stacking, tested, holding) updates as order volume changes.
 */
export const wallLabel = (input: WallLabelInput): string => {
  const { wall, status, quoteAsset, searchedPct, clippedByCoverage, observedMs } = input;
  const scope = `max in ±${formatPct(searchedPct)}%${clippedByCoverage ? " (coverage)" : ""}`;
  const liquidity = formatLiquidityStatus(wall, observedMs);
  const parts = [
    wall.price.toLocaleString("en-US", { maximumFractionDigits: 8 }),
    `${formatNotional(wall.notional)} ${quoteAsset}`,
    liquidity,
    scope,
  ];
  if (status !== "live") parts.push(status);
  return parts.join(" · ");
};
