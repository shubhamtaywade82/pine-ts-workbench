import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { FootprintBar, FootprintCell } from "@/lib/footprint";
import type { FootprintMode } from "@/lib/trading-settings";

export const MIN_BAR_PX = 40;
const BID_RGB = "8, 153, 129";
const ASK_RGB = "242, 54, 69";
const TEXT = "#d1d4dc";
const FONT = "9px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif";

export interface CellPaint {
  readonly rgb: string;
  readonly intensity: number;
}

/** Green when delta is non-negative, red when it is negative. Intensity is `|delta| / scale`, clipped to 1. */
export const deltaCellPaint = (delta: number, scale: number): CellPaint => ({
  rgb: delta < 0 ? ASK_RGB : BID_RGB,
  intensity: scale > 0 ? Math.min(1, Math.abs(delta) / scale) : 0,
});

/** Footprint text is unreadable inside a narrow candle, so the pane stays empty. */
export const showsFootprint = (barPx: number): boolean => barPx >= MIN_BAR_PX;

const largestAbs = (bars: readonly FootprintBar[], read: (cell: FootprintCell) => number): number => {
  let max = 0;
  for (const bar of bars) {
    for (const cell of bar.cells.values()) max = Math.max(max, Math.abs(read(cell)));
  }
  return max;
};

interface CellBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly cell: FootprintCell;
}

interface PlotSpace {
  readonly timeToX: (time: number) => number | null;
  readonly priceToY: (price: number) => number | null;
  readonly barPx: number;
}

const boxFor = (cell: FootprintCell, left: number, width: number, priceToY: PlotSpace["priceToY"]): CellBox | undefined => {
  const y1 = priceToY(cell.priceFrom);
  const y2 = priceToY(cell.priceTo);
  if (y1 === null || y2 === null) return undefined;
  return { left, top: Math.min(y1, y2), width, height: Math.max(1, Math.abs(y2 - y1)), cell };
};

const boxesForBar = (bar: FootprintBar, space: PlotSpace): CellBox[] => {
  const x = space.timeToX(bar.time);
  if (x === null) return [];
  const left = x - space.barPx / 2;
  const boxes: CellBox[] = [];
  for (const cell of bar.cells.values()) {
    const box = boxFor(cell, left, space.barPx, space.priceToY);
    if (box !== undefined) boxes.push(box);
  }
  return boxes;
};

const magnitude = (abs: number): readonly [number, string] => {
  if (abs >= 1e6) return [1e6, "M"];
  if (abs >= 1e3) return [1e3, "k"];
  return [1, ""];
};

const compactBody = (abs: number): string => {
  const [divisor, suffix] = magnitude(abs);
  const scaled = Number((abs / divisor).toPrecision(3));
  if (scaled < 1e3) return `${scaled}${suffix}`;
  if (suffix === "") return "1k";
  if (suffix === "k") return "1M";
  return `${Number(scaled.toPrecision(3))}M`;
};

/** At most 3 significant digits, with a k or M suffix, so labels stay short and stable. */
export const formatCompact = (value: number): string => {
  if (!Number.isFinite(value) || value === 0) return "0";
  const body = compactBody(Math.abs(value));
  return value < 0 ? `-${body}` : body;
};

export const footprintCellText = (cell: FootprintCell, mode: FootprintMode): string => {
  if (mode === "bid-ask") return `${formatCompact(cell.sell)}×${formatCompact(cell.buy)}`;
  if (mode === "total") return formatCompact(cell.total);
  const text = formatCompact(cell.delta);
  return cell.delta > 0 ? `+${text}` : text;
};

const fillDelta = (context: CanvasRenderingContext2D, box: CellBox, scale: number): void => {
  const paint = deltaCellPaint(box.cell.delta, scale);
  if (paint.intensity <= 0) return;
  context.fillStyle = `rgba(${paint.rgb},${paint.intensity})`;
  context.fillRect(box.left, box.top, box.width, box.height);
};

const paintBox = (context: CanvasRenderingContext2D, box: CellBox, mode: FootprintMode, scale: number): void => {
  context.save();
  context.beginPath();
  context.rect(box.left, box.top, box.width, box.height);
  context.clip();
  if (mode === "delta") fillDelta(context, box, scale);
  if (box.height >= 8) {
    context.fillStyle = TEXT;
    context.fillText(footprintCellText(box.cell, mode), box.left + box.width / 2, box.top + box.height / 2);
  }
  context.restore();
};

const paintBars = (
  context: CanvasRenderingContext2D,
  bars: readonly FootprintBar[],
  mode: FootprintMode,
  space: PlotSpace,
): void => {
  const boxes = bars.flatMap((bar) => boxesForBar(bar, space));
  const scale = mode === "delta" ? largestAbs(bars, (cell) => cell.delta) : 0;
  context.font = FONT;
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const box of boxes) paintBox(context, box, mode, scale);
};

/** Per-bar bid/ask, delta, or total volume. Draws nothing while candles are narrower than 40px. */
export class FootprintPrimitive implements ISeriesPrimitive<Time> {
  private attachedTo: SeriesAttachedParameter<Time> | null = null;
  private bars: readonly FootprintBar[] = [];
  private mode: FootprintMode = "delta";
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

  public setView(bars: readonly FootprintBar[], mode: FootprintMode): void {
    this.bars = bars;
    this.mode = mode;
    this.attachedTo?.requestUpdate();
  }

  public clear(): void {
    this.setView([], this.mode);
  }

  private paint(context: CanvasRenderingContext2D): void {
    const attached = this.attachedTo;
    if (attached === null || this.bars.length === 0) return;
    const barPx = attached.chart.timeScale().options().barSpacing;
    if (!showsFootprint(barPx)) return;
    const space: PlotSpace = {
      timeToX: (time) => attached.chart.timeScale().timeToCoordinate(Math.floor(time / 1000) as Time),
      priceToY: (price) => attached.series.priceToCoordinate(price),
      barPx,
    };
    context.save();
    paintBars(context, this.bars, this.mode, space);
    context.restore();
  }
}
