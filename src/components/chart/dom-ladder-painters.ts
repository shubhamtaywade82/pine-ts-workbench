import type { BookCoverage } from "@/lib/order-book";
import {
  activityLabel,
  compactQuantity,
  formatLadderPrice,
  LADDER,
  rowShowsText,
  type ActivityText,
} from "./dom-ladder-layout";

const BID_COLOR = "#089981";
const ASK_COLOR = "#f23645";
const SOLD_COLOR = "#f0a202";
const PULLED_COLOR = "#e6c200";
const PRICE_COLOR = "#d1d4dc";
const MUTED = "#b2b5be";
// Below the cell's live/replay badge row, which is HTML drawn over the top of the pane.
const HEADING_TOP_PX = 30;
const HATCH_GAP_PX = 6;
const HATCH_COLOR = "rgba(178, 181, 190, 0.35)";
const FONT = "10px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif";
const HEADING_FONT = "11px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif";
const TONE = { bought: BID_COLOR, sold: SOLD_COLOR, pulled: PULLED_COLOR } as const;

export interface PaintedRow {
  readonly y: number;
  readonly rowPx: number;
  readonly price: number;
  readonly bidWidth: number;
  readonly askWidth: number;
  readonly bidQty: number;
  readonly askQty: number;
  readonly activityAlpha: number;
  readonly activity?: ActivityText;
  readonly badge?: "Big Buyers" | "Big Sellers";
  readonly current: boolean;
}

interface BucketSpan {
  readonly key: number;
  readonly priceFrom: number;
  readonly priceTo: number;
  readonly quantity: number;
}

interface PlaceInput {
  readonly bids: readonly BucketSpan[];
  readonly asks: readonly BucketSpan[];
  readonly motion: ReadonlyMap<number, { bidWidth: number; askWidth: number; alpha: number; bought: number; sold: number; pulled: number }>;
  readonly walls: readonly { price: number; side: "bid" | "ask" }[];
  readonly lastPrice: number | undefined;
  readonly paneHeight: number;
  readonly toY: (price: number) => number | null;
}

const rowPixels = (
  from: number,
  to: number,
  paneHeight: number,
  toY: (price: number) => number | null,
): { y: number; rowPx: number } | undefined => {
  const yFrom = toY(from);
  const yTo = toY(to);
  const mid = toY((from + to) / 2);
  if (yFrom === null || yTo === null || mid === null) return undefined;
  if (mid < -40 || mid > paneHeight + 40) return undefined;
  return { y: mid, rowPx: Math.max(1, Math.abs(yTo - yFrom)) };
};

const badgeFor = (
  from: number,
  to: number,
  walls: readonly { price: number; side: "bid" | "ask" }[],
): PaintedRow["badge"] => {
  for (const wall of walls) {
    if (wall.price < from || wall.price >= to) continue;
    return wall.side === "bid" ? "Big Buyers" : "Big Sellers";
  }
  return undefined;
};

const spansOf = (bids: readonly BucketSpan[], asks: readonly BucketSpan[]): Map<number, { from: number; to: number; bid: number; ask: number }> => {
  const keys = new Map<number, { from: number; to: number; bid: number; ask: number }>();
  for (const bucket of bids) keys.set(bucket.key, { from: bucket.priceFrom, to: bucket.priceTo, bid: bucket.quantity, ask: 0 });
  for (const bucket of asks) {
    const row = keys.get(bucket.key) ?? { from: bucket.priceFrom, to: bucket.priceTo, bid: 0, ask: 0 };
    row.ask = bucket.quantity;
    keys.set(bucket.key, row);
  }
  return keys;
};

export const placedRows = (input: PlaceInput): PaintedRow[] => {
  const painted: PaintedRow[] = [];
  for (const [key, bucket] of spansOf(input.bids, input.asks)) {
    const place = rowPixels(bucket.from, bucket.to, input.paneHeight, input.toY);
    const motion = input.motion.get(key);
    if (place === undefined || motion === undefined) continue;
    const activity = activityLabel(motion);
    painted.push({
      y: place.y,
      rowPx: place.rowPx,
      price: (bucket.from + bucket.to) / 2,
      bidWidth: motion.bidWidth,
      askWidth: motion.askWidth,
      bidQty: bucket.bid,
      askQty: bucket.ask,
      activityAlpha: motion.alpha,
      ...(activity === undefined ? {} : { activity }),
      badge: badgeFor(bucket.from, bucket.to, input.walls),
      current: input.lastPrice !== undefined && input.lastPrice >= bucket.from && input.lastPrice < bucket.to,
    });
  }
  return painted;
};

export interface LadderPaint {
  readonly context: CanvasRenderingContext2D;
  readonly paneWidth: number;
  readonly paneHeight: number;
  readonly originX: number;
  readonly bucketLabel: string;
  readonly rows: readonly PaintedRow[];
  readonly coverage?: BookCoverage;
  readonly toY: (price: number) => number | null;
}

const drawHeading = (paint: LadderPaint): void => {
  const { context, originX } = paint;
  const x = Math.max(4, originX - LADDER.barMax);
  context.font = HEADING_FONT;
  context.fillStyle = MUTED;
  context.textAlign = "left";
  context.textBaseline = "top";
  context.fillText(`Live order book (waiting, per ${paint.bucketLabel} )`, x, HEADING_TOP_PX);
  context.font = FONT;
  const parts = [
    { text: "buyers waiting · bought", color: BID_COLOR },
    { text: "sellers waiting · sold", color: SOLD_COLOR },
    { text: "pulled", color: PULLED_COLOR },
  ];
  let cursor = x;
  for (const part of parts) {
    context.fillStyle = part.color;
    context.fillText(part.text, cursor, HEADING_TOP_PX + 16);
    cursor += context.measureText(part.text).width + 10;
  }
};

const positiveFinite = (value: number): boolean => Number.isFinite(value) && value > 0;

const hatchBand = (context: CanvasRenderingContext2D, strip: { left: number; width: number }, top: number, height: number): void => {
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

const drawCoverage = (paint: LadderPaint): void => {
  const coverage = paint.coverage;
  if (coverage === undefined) return;
  const left = Math.max(0, paint.originX - LADDER.barMax);
  const width = LADDER.barMax + LADDER.priceWidth + LADDER.barMax;
  const strip = { left, width: Math.min(width, paint.paneWidth - left) };
  if (positiveFinite(coverage.bidFloor)) {
    const y = paint.toY(coverage.bidFloor);
    if (y !== null) {
      const top = Math.min(Math.max(y, 0), paint.paneHeight);
      hatchBand(paint.context, strip, top, paint.paneHeight - top);
    }
  }
  if (positiveFinite(coverage.askCeiling)) {
    const y = paint.toY(coverage.askCeiling);
    if (y !== null) hatchBand(paint.context, strip, 0, Math.min(Math.max(y, 0), paint.paneHeight));
  }
};

interface BarDraw {
  readonly context: CanvasRenderingContext2D;
  readonly edge: number;
  readonly top: number;
  readonly height: number;
  readonly width: number;
  readonly quantity: number;
  readonly side: "bid" | "ask";
  readonly showText: boolean;
}

const drawSideBar = (bar: BarDraw): void => {
  if (!(bar.width > 0.5)) return;
  const left = bar.side === "bid" ? bar.edge - bar.width : bar.edge;
  bar.context.fillStyle = bar.side === "bid" ? BID_COLOR : ASK_COLOR;
  bar.context.fillRect(left, bar.top, bar.width, bar.height);
  if (!bar.showText || bar.width < 22) return;
  bar.context.fillStyle = "#ffffff";
  bar.context.textAlign = bar.side === "bid" ? "right" : "left";
  bar.context.textBaseline = "middle";
  const x = bar.side === "bid" ? bar.edge - 3 : bar.edge + 3;
  bar.context.fillText(compactQuantity(bar.quantity), x, bar.top + bar.height / 2);
};

const drawCurrentMark = (context: CanvasRenderingContext2D, originX: number, row: PaintedRow): void => {
  const height = Math.max(1, row.rowPx - 1);
  const top = row.y - height / 2;
  context.fillStyle = "rgba(120, 160, 255, 0.28)";
  context.fillRect(originX, top, LADDER.priceWidth, height);
  if (!rowShowsText(row.rowPx)) return;
  context.fillStyle = PRICE_COLOR;
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText("◀", originX + 1, row.y);
};

const drawPrice = (context: CanvasRenderingContext2D, originX: number, row: PaintedRow): void => {
  if (!rowShowsText(row.rowPx)) return;
  context.font = FONT;
  context.fillStyle = PRICE_COLOR;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const x = originX + (row.current ? LADDER.priceWidth * 0.62 : LADDER.priceWidth / 2);
  context.fillText(formatLadderPrice(row.price), x, row.y);
};

const drawBadge = (context: CanvasRenderingContext2D, x: number, y: number, badge: "Big Buyers" | "Big Sellers"): void => {
  context.font = FONT;
  context.textAlign = "left";
  context.textBaseline = "middle";
  const width = context.measureText(badge).width + 6;
  context.fillStyle = badge === "Big Buyers" ? "rgba(8, 153, 129, 0.85)" : "rgba(242, 54, 69, 0.85)";
  context.fillRect(x, y - 6, width, 12);
  context.fillStyle = "#ffffff";
  context.fillText(badge, x + 3, y);
};

const drawNotes = (paint: LadderPaint, row: PaintedRow, barPx: number): void => {
  if (!rowShowsText(row.rowPx)) return;
  const x = paint.originX + LADDER.priceWidth + barPx + 4;
  const { context } = paint;
  if (row.badge !== undefined && row.rowPx >= 18 && row.activity !== undefined) {
    drawBadge(context, x, row.y - row.rowPx / 4, row.badge);
    drawActivity(context, x, row.y + row.rowPx / 4, row);
    return;
  }
  if (row.badge !== undefined) drawBadge(context, x, row.y, row.badge);
  else drawActivity(context, x, row.y, row);
};

const drawActivity = (context: CanvasRenderingContext2D, x: number, y: number, row: PaintedRow): void => {
  if (row.activity === undefined) return;
  context.save();
  context.globalAlpha *= Math.max(0, Math.min(1, row.activityAlpha));
  context.font = FONT;
  context.fillStyle = TONE[row.activity.tone];
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(row.activity.text, x, y);
  context.restore();
};

const drawRow = (paint: LadderPaint, row: PaintedRow): void => {
  const barPx = Math.min(LADDER.barMax, paint.paneWidth);
  const height = Math.max(1, row.rowPx - 1);
  const top = row.y - height / 2;
  const showText = rowShowsText(row.rowPx);
  if (row.current) drawCurrentMark(paint.context, paint.originX, row);
  drawSideBar({ context: paint.context, edge: paint.originX, top, height, width: row.bidWidth * barPx, quantity: row.bidQty, side: "bid", showText });
  drawSideBar({ context: paint.context, edge: paint.originX + LADDER.priceWidth, top, height, width: row.askWidth * barPx, quantity: row.askQty, side: "ask", showText });
  drawPrice(paint.context, paint.originX, row);
  drawNotes(paint, row, barPx);
};

export const paintLadder = (paint: LadderPaint): void => {
  drawHeading(paint);
  drawCoverage(paint);
  paint.context.font = FONT;
  for (const row of paint.rows) drawRow(paint, row);
};

export const drawLadderStatus = (context: CanvasRenderingContext2D, status: string, paneWidth: number): void => {
  context.font = FONT;
  context.fillStyle = MUTED;
  context.textAlign = "right";
  context.textBaseline = "top";
  context.fillText(status, paneWidth - 6, 6);
};
