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
  context.strokeStyle = "#2a2e39";
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
      case "fibonacci":
        if (x2 !== null) paintFibonacci(context, drawing.p1, drawing.p2, x1, x2, width, proj, isDraft);
        break;
      case "rectangle":
        if (x2 !== null && y2 !== null) paintRectangle(context, x1, y1, x2, y2, color, isDraft);
        break;
      case "measure":
        if (x2 !== null && y2 !== null) paintMeasure(context, drawing.p1, drawing.p2, x1, y1, x2, y2, this.intervalMs);
        break;
    }
  }

  private paint(context: CanvasRenderingContext2D, size: { width: number; height: number }): void {
    const proj = this.projection();
    if (proj === null) return;
    for (const drawing of this.drawings) {
      this.paintDrawing(context, drawing, proj, size.width, false);
    }
    if (this.draft !== null) {
      this.paintDrawing(context, this.draft, proj, size.width, true);
    }
  }
}
