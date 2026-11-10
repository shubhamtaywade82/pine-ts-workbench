import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { PriceBucket } from "@/lib/price-buckets";
import type { LiquiditySample } from "@/lib/liquidity-history";

const BID_RGB = "8, 153, 129";
const ASK_RGB = "242, 54, 69";

const upperPercentile = (values: readonly number[], fraction: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(fraction * sorted.length) - 1;
  const index = Math.min(sorted.length - 1, Math.max(0, rank));
  return sorted[index] ?? 0;
};

/** Log scale clipped at p99 so one huge wall does not flatten every other cell. */
export const heatIntensity = (values: readonly number[]): number[] => {
  const logs = values.map((value) => Math.log1p(Math.max(0, value)));
  const scale = upperPercentile(logs, 0.99);
  if (!(scale > 0)) return logs.map(() => 0);
  return logs.map((value) => Math.min(1, value / scale));
};

interface HeatCell {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly notional: number;
  readonly rgb: string;
}

interface HeatSpace {
  readonly timeToX: (at: number) => number | null;
  readonly priceToY: (price: number) => number | null;
}

const cellFor = (
  bucket: PriceBucket,
  place: { x: number; width: number; rgb: string },
  priceToY: (price: number) => number | null,
): HeatCell | undefined => {
  const y1 = priceToY(bucket.priceFrom);
  const y2 = priceToY(bucket.priceTo);
  if (y1 === null || y2 === null) return undefined;
  return {
    x: place.x,
    y: Math.min(y1, y2),
    width: place.width,
    height: Math.max(1, Math.abs(y2 - y1)),
    notional: bucket.notional,
    rgb: place.rgb,
  };
};

const pushSide = (
  cells: HeatCell[],
  buckets: readonly PriceBucket[],
  place: { x: number; width: number; rgb: string },
  priceToY: (price: number) => number | null,
): void => {
  for (const bucket of buckets) {
    const cell = cellFor(bucket, place, priceToY);
    if (cell !== undefined) cells.push(cell);
  }
};

const sampleCells = (sample: LiquiditySample, nextAt: number | undefined, space: HeatSpace): HeatCell[] => {
  const x = space.timeToX(sample.at);
  if (x === null) return [];
  const nextX = nextAt === undefined ? null : space.timeToX(nextAt);
  const width = nextX === null ? 2 : Math.max(1, nextX - x);
  const cells: HeatCell[] = [];
  pushSide(cells, sample.bids, { x, width, rgb: BID_RGB }, space.priceToY);
  pushSide(cells, sample.asks, { x, width, rgb: ASK_RGB }, space.priceToY);
  return cells;
};

const drawCells = (context: CanvasRenderingContext2D, cells: readonly HeatCell[], opacity: number): void => {
  const intensity = heatIntensity(cells.map((cell) => cell.notional));
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    if (cell === undefined) continue;
    const alpha = (intensity[index] ?? 0) * opacity;
    if (!(alpha > 0)) continue;
    context.fillStyle = `rgba(${cell.rgb},${alpha})`;
    context.fillRect(cell.x, cell.y, cell.width, cell.height);
  }
};

/** Resting size over time: one small rect per bucket per one-second sample. */
export class LiquidityHeatmapPrimitive implements ISeriesPrimitive<Time> {
  private attachedTo: SeriesAttachedParameter<Time> | null = null;
  private samples: readonly LiquiditySample[] = [];
  private opacity = 0.5;
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

  public setView(samples: readonly LiquiditySample[], opacity: number): void {
    this.samples = samples;
    this.opacity = opacity;
    this.attachedTo?.requestUpdate();
  }

  private paint(context: CanvasRenderingContext2D): void {
    const attached = this.attachedTo;
    if (attached === null || this.samples.length === 0) return;
    const space: HeatSpace = {
      timeToX: (at) => attached.chart.timeScale().timeToCoordinate(Math.floor(at / 1000) as Time),
      priceToY: (price) => attached.series.priceToCoordinate(price),
    };
    const cells = this.samples.flatMap((sample, index) =>
      sampleCells(sample, this.samples[index + 1]?.at, space));
    context.save();
    drawCells(context, cells, this.opacity);
    context.restore();
  }
}
