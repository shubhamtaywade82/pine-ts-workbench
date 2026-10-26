import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";

/** A script drawing in chart time (ms), as `ScriptDrawings` resolved against the bars it ran on. */
export type ChartDrawing =
  | { readonly kind: "line"; readonly from: number; readonly to: number; readonly price: number; readonly text: string; readonly isBullish: boolean; readonly isDashed: boolean }
  | { readonly kind: "box"; readonly from: number; readonly to: number; readonly top: number; readonly bottom: number; readonly isBullish: boolean };

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
    draw: (target: CanvasRenderingTarget2D) => target.useMediaCoordinateSpace(({ context }) => this.paint(context)),
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

  public setDrawings(drawings: readonly ChartDrawing[]): void {
    this.drawings = drawings;
    this.attachedTo?.requestUpdate();
  }

  private paint(context: CanvasRenderingContext2D): void {
    const attached = this.attachedTo;
    if (attached === null) return;
    const x = (ms: number) => attached.chart.timeScale().timeToCoordinate(Math.floor(ms / 1000) as Time);
    const y = (price: number) => attached.series.priceToCoordinate(price);
    context.font = LABEL_FONT;
    for (const drawing of this.drawings) {
      const [x1, x2] = [x(drawing.from), x(drawing.to)];
      if (x1 === null || x2 === null) continue;
      const color = drawing.isBullish ? BULL : BEAR;
      if (drawing.kind === "box") paintBox(context, { x1, x2, top: y(drawing.top), bottom: y(drawing.bottom), color });
      else paintLine(context, { x1, x2, y: y(drawing.price), color, text: drawing.text, isBullish: drawing.isBullish, isDashed: drawing.isDashed });
    }
  }
}

const paintBox = (
  context: CanvasRenderingContext2D,
  { x1, x2, top, bottom, color }: { x1: number; x2: number; top: number | null; bottom: number | null; color: string },
): void => {
  if (top === null || bottom === null) return;
  context.fillStyle = `${color}${BOX_FILL_ALPHA}`;
  context.fillRect(x1, top, x2 - x1, bottom - top);
  context.strokeStyle = color;
  context.lineWidth = 1;
  context.setLineDash([]);
  context.strokeRect(x1, top, x2 - x1, bottom - top);
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
