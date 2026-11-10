import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { DepthStatus } from "@/lib/depth-feed";
import type { BookCoverage } from "@/lib/order-book";
import type { PriceBucket } from "@/lib/price-buckets";

const BID_COLOR = "#089981";
const ASK_COLOR = "#f23645";
const BAR_MAX_PX = 112;
const BAR_HEIGHT_PX = 3;
const DIM_ALPHA = 0.35;
const HATCH_GAP_PX = 6;
const HATCH_COLOR = "rgba(178, 181, 190, 0.35)";
const LABEL_FONT = "10px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif";

export interface DomLadderBuckets {
  readonly status: DepthStatus;
  readonly bids: readonly PriceBucket[];
  readonly asks: readonly PriceBucket[];
  readonly coverage?: BookCoverage;
}

interface BarPaint {
  readonly context: CanvasRenderingContext2D;
  readonly color: string;
  readonly maxQuantity: number;
  readonly paneWidth: number;
  readonly toY: (price: number) => number | null;
}

interface HatchPaint {
  readonly context: CanvasRenderingContext2D;
  readonly toY: (price: number) => number | null;
  readonly paneWidth: number;
  readonly paneHeight: number;
}

/** Shared rows split ask above bid; a one-sided row keeps the full height. */
export const rowSlice = (side: "bid" | "ask", sharesRow: boolean): { top: number; height: number } => {
  if (!sharesRow) return { top: 0, height: 1 };
  return side === "ask" ? { top: 0, height: 0.5 } : { top: 0.5, height: 0.5 };
};

const largestQuantity = (buckets: DomLadderBuckets): number =>
  Math.max(0, ...buckets.bids.map((bucket) => bucket.quantity), ...buckets.asks.map((bucket) => bucket.quantity));

const rowKeys = (buckets: readonly PriceBucket[]): Set<number> =>
  new Set(buckets.map((bucket) => bucket.priceFrom));

const drawBars = (
  buckets: readonly PriceBucket[],
  otherRows: ReadonlySet<number>,
  side: "bid" | "ask",
  paint: BarPaint,
): void => {
  const { context, color, maxQuantity, paneWidth, toY } = paint;
  if (!(maxQuantity > 0)) return;
  const limit = Math.min(BAR_MAX_PX, paneWidth);
  context.fillStyle = color;
  for (const bucket of buckets) {
    const y = toY((bucket.priceFrom + bucket.priceTo) / 2);
    if (y === null) continue;
    const slice = rowSlice(side, otherRows.has(bucket.priceFrom));
    const width = (bucket.quantity / maxQuantity) * limit;
    const top = y - BAR_HEIGHT_PX / 2 + BAR_HEIGHT_PX * slice.top;
    context.fillRect(paneWidth - width, top, width, BAR_HEIGHT_PX * slice.height);
  }
};

const drawStatus = (context: CanvasRenderingContext2D, status: DepthStatus, paneWidth: number): void => {
  context.font = LABEL_FONT;
  context.fillStyle = "#b2b5be";
  context.textAlign = "right";
  context.textBaseline = "top";
  context.fillText(status, paneWidth - 6, 6);
};

const positiveFinite = (value: number): boolean => Number.isFinite(value) && value > 0;

const hatchBand = (
  context: CanvasRenderingContext2D,
  strip: { left: number; width: number },
  top: number,
  height: number,
): void => {
  if (!(height > 0) || !(strip.width > 0)) return;
  context.save();
  context.beginPath();
  context.rect(strip.left, top, strip.width, height);
  context.clip();
  context.strokeStyle = HATCH_COLOR;
  context.lineWidth = 1;
  context.beginPath();
  const reach = strip.width + height;
  for (let step = -height; step < reach; step += HATCH_GAP_PX) {
    context.moveTo(strip.left + step, top);
    context.lineTo(strip.left + step - height, top + height);
  }
  context.stroke();
  context.restore();
};

const drawCoverage = (coverage: BookCoverage | undefined, paint: HatchPaint): void => {
  if (coverage === undefined) return;
  const { context, toY, paneWidth, paneHeight } = paint;
  const strip = { left: Math.max(0, paneWidth - BAR_MAX_PX), width: Math.min(BAR_MAX_PX, paneWidth) };
  if (positiveFinite(coverage.bidFloor)) {
    const y = toY(coverage.bidFloor);
    if (y !== null) {
      const top = Math.min(Math.max(y, 0), paneHeight);
      hatchBand(context, strip, top, paneHeight - top);
    }
  }
  if (positiveFinite(coverage.askCeiling)) {
    const y = toY(coverage.askCeiling);
    if (y !== null) hatchBand(context, strip, 0, Math.min(Math.max(y, 0), paneHeight));
  }
};

/** Bid and ask depth as horizontal bars on the right edge of the pane. */
export class DomLadderPrimitive implements ISeriesPrimitive<Time> {
  private attachedTo: SeriesAttachedParameter<Time> | null = null;
  private buckets: DomLadderBuckets | undefined;
  private readonly view: IPrimitivePaneView = { renderer: () => this.renderer };
  private readonly renderer: IPrimitivePaneRenderer = {
    draw: (target: CanvasRenderingTarget2D) =>
      target.useMediaCoordinateSpace(({ context, mediaSize }) =>
        this.paint(context, mediaSize.width, mediaSize.height)),
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

  public setBuckets(next: DomLadderBuckets | undefined): void {
    this.buckets = next;
    this.attachedTo?.requestUpdate();
  }

  private paint(context: CanvasRenderingContext2D, paneWidth: number, paneHeight: number): void {
    const attached = this.attachedTo;
    const buckets = this.buckets;
    if (attached === null || buckets === undefined) return;
    const toY = (price: number) => attached.series.priceToCoordinate(price);
    context.save();
    drawCoverage(buckets.coverage, { context, toY, paneWidth, paneHeight });
    if (buckets.status !== "live") context.globalAlpha = DIM_ALPHA;
    const paint: BarPaint = {
      context,
      color: BID_COLOR,
      maxQuantity: largestQuantity(buckets),
      paneWidth,
      toY,
    };
    drawBars(buckets.bids, rowKeys(buckets.asks), "bid", paint);
    drawBars(buckets.asks, rowKeys(buckets.bids), "ask", { ...paint, color: ASK_COLOR });
    if (buckets.status !== "live") drawStatus(context, buckets.status, paneWidth);
    context.restore();
  }
}
