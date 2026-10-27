import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { CandleFrame } from "@/hooks/use-candle-series";

const RADIUS = { min: 2.5, max: 9 };
const DASH = [1, 2];

export interface LastPriceStyle {
  readonly isVisible: boolean;
  readonly upColor: string;
  readonly downColor: string;
}

/** Dot radius: area grows with the forming candle's volume against the recent average, capped at 4×. */
export const volumeDotRadius = (volume: number, averageVolume: number): number => {
  if (!(averageVolume > 0)) return RADIUS.min;
  const ratio = Math.min(volume / averageVolume, 4) / 4;
  return RADIUS.min + (RADIUS.max - RADIUS.min) * Math.sqrt(ratio);
};

/**
 * The last-price line, but only from the forming candle to the price scale,
 * with a dot at the live price on that candle sized by its volume. Replaces
 * LWC's full-width price line, which runs across every past candle.
 */
export class LastPricePrimitive implements ISeriesPrimitive<Time> {
  private attachedTo: SeriesAttachedParameter<Time> | null = null;
  private frame: CandleFrame | null = null;
  private averageVolume = 0;
  private style: LastPriceStyle = { isVisible: true, upColor: "#089981", downColor: "#f23645" };
  private readonly view: IPrimitivePaneView = { renderer: () => this.renderer };
  private readonly renderer: IPrimitivePaneRenderer = {
    draw: (target: CanvasRenderingTarget2D) =>
      target.useMediaCoordinateSpace(({ context, mediaSize }) => this.paint(context, mediaSize.width)),
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

  public setFrame(frame: CandleFrame): void {
    this.frame = frame;
    this.attachedTo?.requestUpdate();
  }

  public setAverageVolume(averageVolume: number): void {
    this.averageVolume = averageVolume;
  }

  public setStyle(style: LastPriceStyle): void {
    this.style = style;
    this.attachedTo?.requestUpdate();
  }

  private paint(context: CanvasRenderingContext2D, width: number): void {
    const attached = this.attachedTo;
    const frame = this.frame;
    if (attached === null || frame === null || !this.style.isVisible) return;
    const x = attached.chart.timeScale().timeToCoordinate(Math.floor(frame.time / 1000) as Time);
    const y = attached.series.priceToCoordinate(frame.close);
    if (x === null || y === null) return;
    const color = frame.close >= frame.open ? this.style.upColor : this.style.downColor;
    context.strokeStyle = color;
    context.lineWidth = 1;
    context.setLineDash(DASH);
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(width, y);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = color;
    context.beginPath();
    context.arc(x, y, volumeDotRadius(frame.volume, this.averageVolume), 0, Math.PI * 2);
    context.fill();
  }
}
