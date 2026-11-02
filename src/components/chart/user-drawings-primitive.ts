import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import {
  calculateFibPrice,
  computeMeasureStats,
  computePositionStats,
  FIB_LEVELS,
  type DrawingPoint,
  type UserDrawing,
} from "@/lib/user-drawings";

interface Projection {
  readonly x: (ms: number) => number | null;
  readonly y: (price: number) => number | null;
}

const TV_BLUE = "#2962ff";
const BADGE_FONT = "10px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif";

function drawHandle(context: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  context.save();
  context.beginPath();
  context.arc(x, y, 3.5, 0, Math.PI * 2);
  context.fillStyle = "#ffffff";
  context.fill();
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  context.stroke();
  context.restore();
}

function paintTrendline(
  context: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  color: string, isDraft: boolean,
): void {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 2;
  if (isDraft) context.setLineDash([4, 4]);
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
  context.restore();
  drawHandle(context, x1, y1, color);
  drawHandle(context, x2, y2, color);
}

function paintRay(
  context: CanvasRenderingContext2D,
  x1: number, y1: number, width: number,
  color: string, isDraft: boolean,
): void {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  if (isDraft) context.setLineDash([4, 4]);
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(width, y1);
  context.stroke();
  context.restore();
  drawHandle(context, x1, y1, color);
}

/** Horizontal line: spans the whole pane at p1's price. */
function paintHline(
  context: CanvasRenderingContext2D,
  y1: number, width: number,
  color: string, isDraft: boolean,
): void {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  if (isDraft) context.setLineDash([4, 4]);
  context.beginPath();
  context.moveTo(0, y1);
  context.lineTo(width, y1);
  context.stroke();
  context.restore();
}

/** Vertical line: spans the whole pane at p1's time. */
function paintVline(
  context: CanvasRenderingContext2D,
  x1: number, height: number,
  color: string, isDraft: boolean,
): void {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  if (isDraft) context.setLineDash([4, 4]);
  context.beginPath();
  context.moveTo(x1, 0);
  context.lineTo(x1, height);
  context.stroke();
  context.restore();
}

/** Trendline extended through both endpoints to the pane edges. */
function paintExtended(
  context: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number, width: number,
  color: string, isDraft: boolean,
): void {
  if (x2 === x1) return paintVline(context, x1, Number.MAX_SAFE_INTEGER, color, isDraft);
  const slope = (y2 - y1) / (x2 - x1);
  const yLeft = y1 - slope * x1;
  const yRight = y1 + slope * (width - x1);
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  if (isDraft) context.setLineDash([4, 4]);
  context.beginPath();
  context.moveTo(0, yLeft);
  context.lineTo(width, yRight);
  context.stroke();
  context.restore();
  drawHandle(context, x1, y1, color);
  drawHandle(context, x2, y2, color);
}

/** Parallel channel: two parallel trendlines offset by p2's distance. */
function paintChannel(
  context: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  color: string, isDraft: boolean,
): void {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  if (isDraft) context.setLineDash([4, 4]);
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
  // The second rail: same slope, offset vertically by the |dy| between rails.
  const offset = y2 - y1;
  context.beginPath();
  context.moveTo(x1, y1 + offset * 0.5);
  context.lineTo(x2, y2 + offset * 0.5);
  context.stroke();
  context.restore();
  drawHandle(context, x1, y1, color);
  drawHandle(context, x2, y2, color);
}

/** TradingView's long/short position tool: entry / target / stop box with R:R. */
function paintPosition(
  context: CanvasRenderingContext2D,
  drawing: UserDrawing,
  x1: number, x2: number,
  proj: Projection,
  isLong: boolean,
  isDraft: boolean,
): void {
  const stats = computePositionStats(drawing.p1, drawing.p2, isLong);
  const yEntry = proj.y(stats.entry);
  const yTarget = proj.y(stats.target);
  const yStop = proj.y(stats.stop);
  if (yEntry === null || yTarget === null || yStop === null) return;
  const left = Math.min(x1, x2);
  const width = Math.max(20, Math.abs(x2 - x1));
  const top = Math.min(yTarget, yEntry);
  const bottom = Math.max(yStop, yEntry);
  const green = "rgba(8, 153, 129, 0.12)";
  const red = "rgba(242, 54, 69, 0.12)";

  context.save();
  // Target zone (above entry for long, below for short).
  context.fillStyle = green;
  context.fillRect(left, Math.min(yTarget, yEntry), width, Math.abs(yTarget - yEntry));
  // Stop zone.
  context.fillStyle = red;
  context.fillRect(left, Math.min(yStop, yEntry), width, Math.abs(yStop - yEntry));
  // Entry line.
  context.strokeStyle = "#2962ff";
  context.lineWidth = 1.5;
  if (isDraft) context.setLineDash([4, 4]);
  context.beginPath();
  context.moveTo(left, yEntry);
  context.lineTo(left + width, yEntry);
  context.stroke();
  // Labels.
  context.font = BADGE_FONT;
  context.fillStyle = "#089981";
  context.fillText(`Target ${stats.target.toFixed(2)}`, left + 4, Math.min(yTarget, yEntry) + 11);
  context.fillStyle = "#f23645";
  context.fillText(`Stop ${stats.stop.toFixed(2)}`, left + 4, Math.max(yStop, yEntry) - 4);
  context.fillStyle = "#2962ff";
  context.fillText(`${isLong ? "Long" : "Short"} ${stats.entry.toFixed(2)} · R:R ${stats.riskReward.toFixed(1)}`, left + 4, yEntry - 4);
  context.restore();
  drawHandle(context, x1, yEntry, "#2962ff");
  drawHandle(context, x2, proj.y(drawing.p2.price) ?? yEntry, "#2962ff");
}

/** Text note anchored at p1, with the label box sized to its content. */
function paintText(
  context: CanvasRenderingContext2D,
  x1: number, y1: number,
  text: string | undefined,
  color: string, isDraft: boolean,
): void {
  const label = (text ?? "Text").slice(0, 60);
  context.save();
  context.font = BADGE_FONT;
  const w = context.measureText(label).width + 10;
  const h = 16;
  context.fillStyle = "rgba(30, 34, 45, 0.85)";
  context.fillRect(x1, y1 - h, w, h);
  context.strokeStyle = color;
  context.lineWidth = 1;
  if (isDraft) context.setLineDash([3, 3]);
  context.strokeRect(x1, y1 - h, w, h);
  context.fillStyle = "#d1d4dc";
  context.fillText(label, x1 + 5, y1 - 5);
  context.restore();
  drawHandle(context, x1, y1, color);
}

/** Arrow from p1 to p2 (annotation). */
function paintArrow(
  context: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  color: string, isDraft: boolean,
): void {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = 10;
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 2;
  if (isDraft) context.setLineDash([4, 4]);
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2 - Math.cos(angle) * headLen * 0.6, y2 - Math.sin(angle) * headLen * 0.6);
  context.stroke();
  context.beginPath();
  context.moveTo(x2, y2);
  context.lineTo(x2 - Math.cos(angle - 0.45) * headLen, y2 - Math.sin(angle - 0.45) * headLen);
  context.lineTo(x2 - Math.cos(angle + 0.45) * headLen, y2 - Math.sin(angle + 0.45) * headLen);
  context.closePath();
  context.fill();
  context.restore();
  drawHandle(context, x1, y1, color);
  drawHandle(context, x2, y2, color);
}

function paintFibonacci(
  context: CanvasRenderingContext2D,
  p1: DrawingPoint, p2: DrawingPoint,
  x1: number, x2: number, width: number,
  proj: Projection, isDraft: boolean,
): void {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(Math.max(x1, x2), width);
  context.save();
  context.font = BADGE_FONT;

  for (let i = 0; i < FIB_LEVELS.length; i++) {
    const lvl = FIB_LEVELS[i]!;
    const price = calculateFibPrice(p1.price, p2.price, lvl.ratio);
    const y = proj.y(price);
    if (y === null) continue;

    if (i > 0 && lvl.fillColor !== "transparent") {
      const prevPrice = calculateFibPrice(p1.price, p2.price, FIB_LEVELS[i - 1]!.ratio);
      const prevY = proj.y(prevPrice);
      if (prevY !== null) {
        context.fillStyle = lvl.fillColor;
        context.fillRect(minX, Math.min(y, prevY), maxX - minX, Math.abs(y - prevY));
      }
    }

    context.strokeStyle = lvl.color;
    context.lineWidth = 1;
    if (isDraft) context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(minX, y);
    context.lineTo(maxX, y);
    context.stroke();

    context.fillStyle = lvl.color;
    context.fillText(`${lvl.ratio} (${price.toFixed(2)})`, minX + 4, y - 3);
  }
  context.restore();
}

function paintRectangle(
  context: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  color: string, isDraft: boolean,
): void {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  context.save();
  context.fillStyle = "rgba(41, 98, 255, 0.12)";
  context.fillRect(left, top, width, height);
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  if (isDraft) context.setLineDash([4, 4]);
  context.strokeRect(left, top, width, height);
  context.restore();
  drawHandle(context, x1, y1, color);
  drawHandle(context, x2, y2, color);
}

function paintMeasure(
  context: CanvasRenderingContext2D,
  p1: DrawingPoint, p2: DrawingPoint,
  x1: number, y1: number, x2: number, y2: number,
  intervalMs: number,
): void {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  const stats = computeMeasureStats(p1, p2, intervalMs);
  const isUp = stats.priceDelta >= 0;

  context.save();
  context.fillStyle = isUp ? "rgba(8, 153, 129, 0.15)" : "rgba(242, 54, 69, 0.15)";
  context.fillRect(left, top, width, height);
  context.strokeStyle = isUp ? "rgba(8, 153, 129, 0.8)" : "rgba(242, 54, 69, 0.8)";
  context.lineWidth = 1;
  context.strokeRect(left, top, width, height);

  const cx = left + width / 2;
  const cy = top + height / 2;
  const sign = isUp ? "+" : "";
  const line1 = `${sign}${stats.priceDelta.toFixed(2)} (${sign}${stats.pctDelta.toFixed(2)}%)`;
  const line2 = `${stats.barCount} bars · ${stats.durationText}`;

  context.font = BADGE_FONT;
  const bw = 120;
  const bh = 34;
  context.fillStyle = "rgba(30, 34, 45, 0.9)";
  context.fillRect(cx - bw / 2, cy - bh / 2, bw, bh);
  context.strokeStyle = "#1f1f1f";
  context.strokeRect(cx - bw / 2, cy - bh / 2, bw, bh);

  context.fillStyle = isUp ? "#089981" : "#f23645";
  context.textAlign = "center";
  context.fillText(line1, cx, cy - 3);
  context.fillStyle = "#b2b5be";
  context.fillText(line2, cx, cy + 10);
  context.restore();
}

export class UserDrawingsPrimitive implements ISeriesPrimitive<Time> {
  private drawings: readonly UserDrawing[] = [];
  private draft: UserDrawing | null = null;
  private intervalMs = 60_000;
  private attachedTo: SeriesAttachedParameter<Time> | null = null;

  private readonly view: IPrimitivePaneView = { renderer: () => this.renderer };
  private readonly renderer: IPrimitivePaneRenderer = {
    draw: (target: CanvasRenderingTarget2D) =>
      target.useMediaCoordinateSpace(({ context, mediaSize }) => this.paint(context, mediaSize)),
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

  public setDrawings(drawings: readonly UserDrawing[]): void {
    this.drawings = drawings;
    this.attachedTo?.requestUpdate();
  }

  public setDraft(draft: UserDrawing | null): void {
    this.draft = draft;
    this.attachedTo?.requestUpdate();
  }

  public setIntervalMs(intervalMs: number): void {
    this.intervalMs = intervalMs;
  }

  private projection(): Projection | null {
    const attached = this.attachedTo;
    if (attached === null) return null;
    const timeScale = attached.chart.timeScale();
    const data = attached.series.data();
    const lastTime = Number(data.at(-1)?.time ?? 0) * 1000;
    const step = data.length > 1 ? lastTime - Number(data.at(-2)!.time) * 1000 : 60_000;

    const x = (ms: number) => {
      if (ms <= lastTime || data.length === 0) {
        return timeScale.timeToCoordinate(Math.floor(ms / 1000) as Time);
      }
      return timeScale.logicalToCoordinate((data.length - 1 + (ms - lastTime) / step) as never);
    };
    return { x, y: (price: number) => attached.series.priceToCoordinate(price) };
  }

  private paintDrawing(
    context: CanvasRenderingContext2D,
    drawing: UserDrawing,
    proj: Projection,
    width: number,
    height: number,
    isDraft: boolean,
  ): void {
    const x1 = proj.x(drawing.p1.time);
    const y1 = proj.y(drawing.p1.price);
    const x2 = proj.x(drawing.p2.time);
    const y2 = proj.y(drawing.p2.price);
    if (x1 === null || y1 === null) return;
    const color = drawing.color ?? TV_BLUE;

    switch (drawing.type) {
      case "trendline":
        if (x2 !== null && y2 !== null) paintTrendline(context, x1, y1, x2, y2, color, isDraft);
        break;
      case "ray":
        paintRay(context, x1, y1, width, color, isDraft);
        break;
      case "hline":
        paintHline(context, y1, width, color, isDraft);
        break;
      case "vline":
        paintVline(context, x1, height, color, isDraft);
        break;
      case "extended":
        if (x2 !== null && y2 !== null) paintExtended(context, x1, y1, x2, y2, width, color, isDraft);
        break;
      case "channel":
        if (x2 !== null && y2 !== null) paintChannel(context, x1, y1, x2, y2, color, isDraft);
        break;
      case "fibonacci":
        if (x2 !== null) paintFibonacci(context, drawing.p1, drawing.p2, x1, x2, width, proj, isDraft);
        break;
      case "rectangle":
        if (x2 !== null && y2 !== null) paintRectangle(context, x1, y1, x2, y2, color, isDraft);
        break;
      case "measure":
        if (x2 !== null && y2 !== null) paintMeasure(context, drawing.p1, drawing.p2, x1, y1, x2, y2, this.intervalMs);
        break;
      case "position-long":
      case "position-short":
        if (x2 !== null) paintPosition(context, drawing, x1, x2, proj, drawing.type === "position-long", isDraft);
        break;
      case "text":
        paintText(context, x1, y1, drawing.text, color, isDraft);
        break;
      case "arrow":
        if (x2 !== null && y2 !== null) paintArrow(context, x1, y1, x2, y2, color, isDraft);
        break;
    }
  }

  private paint(context: CanvasRenderingContext2D, size: { width: number; height: number }): void {
    const proj = this.projection();
    if (proj === null) return;
    for (const drawing of this.drawings) {
      this.paintDrawing(context, drawing, proj, size.width, size.height, false);
    }
    if (this.draft !== null) {
      this.paintDrawing(context, this.draft, proj, size.width, size.height, true);
    }
  }
}
