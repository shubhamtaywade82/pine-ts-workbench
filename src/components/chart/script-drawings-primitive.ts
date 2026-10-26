import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { BoxShape, LabelShape, LineShape, ScriptTable } from "@nemesis-oss/pine-ts";
import { paintBgcolor, paintLabel, paintShapeBox, paintShapeLine, paintTable, type Projection } from "./script-shape-painters";

/** A script drawing in chart time (ms), as `ScriptDrawings` resolved against the bars it ran on. */
export type ChartDrawing =
  | { readonly kind: "line"; readonly from: number; readonly to: number; readonly price: number; readonly text: string; readonly isBullish: boolean; readonly isDashed: boolean }
  | { readonly kind: "box"; readonly from: number; readonly to: number; readonly top: number; readonly bottom: number; readonly isBullish: boolean; readonly text?: string }
  | (Omit<LineShape, "kind"> & { readonly kind: "shape-line"; readonly from: number; readonly to: number })
  | (Omit<BoxShape, "kind"> & { readonly kind: "shape-box"; readonly from: number; readonly to: number })
  | (LabelShape & { readonly time: number })
  | { readonly kind: "bgcolor"; readonly time: number; readonly color: string }
  | { readonly kind: "table"; readonly table: ScriptTable };

// TradingView's up/down colours; boxes use them translucent, as SMC scripts do.
const BULL = "#089981";
const BEAR = "#f23645";
const BOX_FILL_ALPHA = "26"; // ~15%
const LABEL_FONT = "11px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif";
const LABEL_GAP_PX = 3;

/**
 * Draws editor-script lines (with labels) and boxes on the price pane. One
 * canvas primitive instead of a line series per drawing keeps hundreds of
 * BOS/CHoCH levels cheap and lets boxes exist at all (LWC has no rectangle series).
 */
export class ScriptDrawingsPrimitive implements ISeriesPrimitive<Time> {
  private drawings: readonly ChartDrawing[] = [];
  private attachedTo: SeriesAttachedParameter<Time> | null = null;
  private readonly view: IPrimitivePaneView = { renderer: () => this.renderer };
  private readonly renderer: IPrimitivePaneRenderer = {
    draw: (target: CanvasRenderingTarget2D) => target.useMediaCoordinateSpace(({ context, mediaSize }) => this.paint(context, mediaSize)),
  };
  // Pine bgcolor sits behind the candles.
  private readonly backgroundView: IPrimitivePaneView = { zOrder: () => "bottom", renderer: () => this.backgroundRenderer };
  private readonly backgroundRenderer: IPrimitivePaneRenderer = {
    draw: (target: CanvasRenderingTarget2D) => target.useMediaCoordinateSpace(({ context, mediaSize }) => this.paintBackground(context, mediaSize.height)),
  };

  public attached(param: SeriesAttachedParameter<Time>): void {
    this.attachedTo = param;
  }

  public detached(): void {
    this.attachedTo = null;
  }

  public paneViews(): readonly IPrimitivePaneView[] {
    return [this.backgroundView, this.view];
  }

  public setDrawings(drawings: readonly ChartDrawing[]): void {
    this.drawings = drawings;
    this.attachedTo?.requestUpdate();
  }

  /** Chart time (ms) → x; times past the last bar (future-bar shapes) are extrapolated by logical index. */
  private projection(): Projection | null {
    const attached = this.attachedTo;
    if (attached === null) return null;
    const timeScale = attached.chart.timeScale();
    const data = attached.series.data();
    const lastTime = Number(data.at(-1)?.time ?? 0) * 1000;
    const step = data.length > 1 ? lastTime - Number(data.at(-2)!.time) * 1000 : 60_000;
    const x = (ms: number) => {
      if (ms <= lastTime || data.length === 0) return timeScale.timeToCoordinate(Math.floor(ms / 1000) as Time);
      return timeScale.logicalToCoordinate((data.length - 1 + (ms - lastTime) / step) as never);
    };
    const barWidth = Math.max(1, (timeScale.options().barSpacing ?? 6));
    return { x, y: (price: number) => attached.series.priceToCoordinate(price), barWidth };
  }

  private paintBackground(context: CanvasRenderingContext2D, height: number): void {
    const projection = this.projection();
    if (projection === null) return;
    for (const drawing of this.drawings) {
      if (drawing.kind === "bgcolor") paintBgcolor(context, projection, drawing, height);
    }
  }

  private paint(context: CanvasRenderingContext2D, size: { width: number; height: number }): void {
    const projection = this.projection();
    if (projection === null) return;
    context.font = LABEL_FONT;
    for (const drawing of this.drawings) {
      if (drawing.kind === "line" || drawing.kind === "box") this.paintSmc(context, projection, drawing);
      else if (drawing.kind === "shape-line") paintShapeLine(context, projection, drawing);
      else if (drawing.kind === "shape-box") paintShapeBox(context, projection, drawing);
    }
    // Labels over lines and boxes, the dashboard over everything.
    for (const drawing of this.drawings) if (drawing.kind === "label") paintLabel(context, projection, drawing);
    for (const drawing of this.drawings) if (drawing.kind === "table") paintTable(context, drawing.table, size);
  }

  private paintSmc(context: CanvasRenderingContext2D, { x, y }: Projection, drawing: Extract<ChartDrawing, { kind: "line" | "box" }>): void {
    const [x1, x2] = [x(drawing.from), x(drawing.to)];
    if (x1 === null || x2 === null) return;
    const color = drawing.isBullish ? BULL : BEAR;
    context.font = LABEL_FONT;
    if (drawing.kind === "box") paintBox(context, { x1, x2, top: y(drawing.top), bottom: y(drawing.bottom), color, text: drawing.text });
    else paintLine(context, { x1, x2, y: y(drawing.price), color, text: drawing.text, isBullish: drawing.isBullish, isDashed: drawing.isDashed });
  }
}

const paintBox = (
  context: CanvasRenderingContext2D,
  { x1, x2, top, bottom, color, text }: { x1: number; x2: number; top: number | null; bottom: number | null; color: string; text?: string },
): void => {
  if (top === null || bottom === null) return;
  const y = Math.min(top, bottom);
  const height = Math.max(Math.abs(bottom - top), 2);
  const width = Math.max(x2 - x1, 14);
  context.fillStyle = `${color}${BOX_FILL_ALPHA}`;
  context.fillRect(x1, y, width, height);
  context.strokeStyle = color;
  context.lineWidth = 1;
  context.setLineDash([]);
  context.strokeRect(x1, y, width, height);
  if (text) {
    context.fillStyle = color;
    context.textAlign = "left";
    context.textBaseline = "top";
    context.fillText(text, x1 + 4, y + 2);
  }
};

const paintLine = (
  context: CanvasRenderingContext2D,
  line: { x1: number; x2: number; y: number | null; color: string; text: string; isBullish: boolean; isDashed: boolean },
): void => {
  if (line.y === null) return;
  context.strokeStyle = line.color;
  context.lineWidth = 1;
  context.setLineDash(line.isDashed ? [4, 3] : []);
  context.beginPath();
  context.moveTo(line.x1, line.y);
  context.lineTo(line.x2, line.y);
  context.stroke();
  // Centred on the line, above a broken high and below a broken low, like TradingView SMC scripts.
  context.fillStyle = line.color;
  context.textAlign = "center";
  context.textBaseline = line.isBullish ? "bottom" : "top";
  context.fillText(line.text, (line.x1 + line.x2) / 2, line.y + (line.isBullish ? -LABEL_GAP_PX : LABEL_GAP_PX));
};
