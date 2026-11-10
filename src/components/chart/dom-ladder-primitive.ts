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
import { drawLadderStatus, paintLadder, placedRows } from "./dom-ladder-painters";
import { ANIMATION_TAU_MS, easeToward, LADDER, ladderPriceColumnX } from "./dom-ladder-layout";

const DIM_ALPHA = 0.35;
const SETTLE = 0.01;
const REST_ALPHA = 0.72;

export interface LadderFlow {
  readonly key: number;
  readonly bought: number;
  readonly sold: number;
  readonly pulled: number;
}

export interface LadderWall {
  readonly price: number;
  readonly side: "bid" | "ask";
}

export interface DomLadderBuckets {
  readonly status: DepthStatus;
  readonly bids: readonly PriceBucket[];
  readonly asks: readonly PriceBucket[];
  readonly coverage?: BookCoverage;
  readonly activity?: readonly LadderFlow[];
  readonly walls?: readonly LadderWall[];
  readonly lastPrice?: number;
  readonly bucketLabel?: string;
}

interface RowMotion {
  bidWidth: number;
  askWidth: number;
  targetBid: number;
  targetAsk: number;
  alpha: number;
  targetAlpha: number;
  bought: number;
  sold: number;
  pulled: number;
}

const largestQuantity = (buckets: DomLadderBuckets): number =>
  Math.max(0, ...buckets.bids.map((bucket) => bucket.quantity), ...buckets.asks.map((bucket) => bucket.quantity));

const qtyByKey = (buckets: readonly PriceBucket[]): Map<number, number> =>
  new Map(buckets.map((bucket) => [bucket.key, bucket.quantity]));

const close = (current: number, target: number): boolean => Math.abs(current - target) <= SETTLE;

const motionOf = (flow: LadderFlow | undefined): { bought: number; sold: number; pulled: number } => ({
  bought: flow?.bought ?? 0,
  sold: flow?.sold ?? 0,
  pulled: flow?.pulled ?? 0,
});

const anyActivity = (motion: { bought: number; sold: number; pulled: number }): boolean =>
  motion.bought > 0 || motion.sold > 0 || motion.pulled > 0;

const freshRow = (bid: number, ask: number, flow: LadderFlow | undefined): RowMotion => {
  const motion = motionOf(flow);
  const visible = anyActivity(motion);
  return {
    bidWidth: 0, askWidth: 0, targetBid: bid, targetAsk: ask,
    alpha: visible ? 1 : 0, targetAlpha: visible ? REST_ALPHA : 0,
    ...motion,
  };
};

/** Bid and ask depth beside the forming candle, with a 60s activity column. */
export class DomLadderPrimitive implements ISeriesPrimitive<Time> {
  private attachedTo: SeriesAttachedParameter<Time> | null = null;
  private buckets: DomLadderBuckets | undefined;
  private readonly rows = new Map<number, RowMotion>();
  private frame: number | null = null;
  private lastFrameAt = 0;
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
    this.stopAnimation();
  }

  public paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  public setBuckets(next: DomLadderBuckets | undefined): void {
    this.buckets = next;
    if (next === undefined) {
      this.rows.clear();
      this.stopAnimation();
      this.attachedTo?.requestUpdate();
      return;
    }
    this.retarget(next);
    if (typeof requestAnimationFrame === "undefined") {
      this.snap();
      this.attachedTo?.requestUpdate();
      return;
    }
    if (this.moving()) this.startAnimation();
    else this.attachedTo?.requestUpdate();
  }

  private retarget(buckets: DomLadderBuckets): void {
    const maxQty = largestQuantity(buckets);
    const bids = qtyByKey(buckets.bids);
    const asks = qtyByKey(buckets.asks);
    const flows = new Map((buckets.activity ?? []).map((flow) => [flow.key, flow]));
    const seen = new Set<number>([...bids.keys(), ...asks.keys()]);
    for (const key of seen) {
      this.retargetRow(key, { bid: bids.get(key) ?? 0, ask: asks.get(key) ?? 0 }, maxQty, flows.get(key));
    }
    for (const [key, row] of this.rows) {
      if (seen.has(key)) continue;
      row.targetBid = 0;
      row.targetAsk = 0;
      row.targetAlpha = 0;
    }
  }

  private retargetRow(
    key: number,
    quantities: { bid: number; ask: number },
    maxQty: number,
    flow: LadderFlow | undefined,
  ): void {
    const bid = maxQty > 0 ? quantities.bid / maxQty : 0;
    const ask = maxQty > 0 ? quantities.ask / maxQty : 0;
    const motion = motionOf(flow);
    const row = this.rows.get(key);
    if (row === undefined) {
      this.rows.set(key, freshRow(bid, ask, flow));
      return;
    }
    if (motion.bought > row.bought || motion.sold > row.sold || motion.pulled > row.pulled) row.alpha = 1;
    row.targetBid = bid;
    row.targetAsk = ask;
    row.targetAlpha = anyActivity(motion) ? REST_ALPHA : 0;
    row.bought = motion.bought;
    row.sold = motion.sold;
    row.pulled = motion.pulled;
  }

  private moving(): boolean {
    for (const row of this.rows.values()) {
      if (!close(row.bidWidth, row.targetBid) || !close(row.askWidth, row.targetAsk)) return true;
      if (!close(row.alpha, row.targetAlpha)) return true;
    }
    return false;
  }

  private snap(): void {
    for (const row of this.rows.values()) {
      row.bidWidth = row.targetBid;
      row.askWidth = row.targetAsk;
      row.alpha = row.targetAlpha;
    }
  }

  private startAnimation(): void {
    if (this.frame !== null) return;
    this.lastFrameAt = performance.now();
    const step = (at: number) => {
      const elapsed = at - this.lastFrameAt;
      this.lastFrameAt = at;
      const settled = this.advance(elapsed);
      this.attachedTo?.requestUpdate();
      this.frame = settled ? null : requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  private stopAnimation(): void {
    if (this.frame !== null && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private advance(elapsed: number): boolean {
    let settled = true;
    for (const [key, row] of this.rows) {
      row.bidWidth = easeToward(row.bidWidth, row.targetBid, elapsed, ANIMATION_TAU_MS);
      row.askWidth = easeToward(row.askWidth, row.targetAsk, elapsed, ANIMATION_TAU_MS);
      row.alpha = easeToward(row.alpha, row.targetAlpha, elapsed, ANIMATION_TAU_MS);
      if (!close(row.bidWidth, row.targetBid) || !close(row.askWidth, row.targetAsk) || !close(row.alpha, row.targetAlpha)) {
        settled = false;
        continue;
      }
      row.bidWidth = row.targetBid;
      row.askWidth = row.targetAsk;
      row.alpha = row.targetAlpha;
      if (row.targetBid === 0 && row.targetAsk === 0 && row.targetAlpha === 0) this.rows.delete(key);
    }
    return settled;
  }

  private originX(paneWidth: number): number {
    const attached = this.attachedTo;
    if (attached === null) return ladderPriceColumnX(null, 6, paneWidth, LADDER);
    const scale = attached.chart.timeScale();
    const lastIndex = attached.series.data().length - 1;
    const lastX = lastIndex >= 0 ? scale.logicalToCoordinate(lastIndex as never) : null;
    const spacing = scale.options().barSpacing ?? 6;
    return ladderPriceColumnX(lastX, spacing, paneWidth, LADDER);
  }

  private paint(context: CanvasRenderingContext2D, paneWidth: number, paneHeight: number): void {
    const attached = this.attachedTo;
    const buckets = this.buckets;
    if (attached === null || buckets === undefined) return;
    const toY = (price: number) => attached.series.priceToCoordinate(price);
    const rows = placedRows({
      bids: buckets.bids,
      asks: buckets.asks,
      motion: this.rows,
      walls: buckets.walls ?? [],
      lastPrice: buckets.lastPrice,
      paneHeight,
      toY,
    });
    context.save();
    if (buckets.status !== "live") context.globalAlpha = DIM_ALPHA;
    paintLadder({
      context, paneWidth, paneHeight, originX: this.originX(paneWidth),
      bucketLabel: buckets.bucketLabel ?? "level", rows, coverage: buckets.coverage, toY,
    });
    context.restore();
    if (buckets.status !== "live") drawLadderStatus(context, buckets.status, paneWidth);
  }
}
