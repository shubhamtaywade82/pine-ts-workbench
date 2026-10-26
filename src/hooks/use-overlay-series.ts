"use client";

import { useEffect, type MutableRefObject, type RefObject } from "react";
import {
  customSeriesDefaultOptions,
  type CustomData,
  type CustomSeriesOptions,
  type CustomSeriesPricePlotValues,
  type CustomSeriesWhitespaceData,
  type IChartApi,
  type ICustomSeriesPaneRenderer,
  type ICustomSeriesPaneView,
  type ISeriesApi,
  type PaneRendererCustomData,
  type PriceToCoordinateConverter,
  type Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { ChartOverlay, ChartSubPane } from "@/components/chart/chart-workbench";
import { useLineSmoothing } from "@/hooks/use-line-smoothing";
import type { ScalePlacement } from "@/lib/chart-settings";

export interface BrokenLineData extends CustomData<Time> {
  readonly value?: number;
}

export interface BrokenLineStyleOptions {
  color: string;
  lineWidth?: number;
  lineStyle?: number;
}

export type BrokenLineOptions = CustomSeriesOptions & BrokenLineStyleOptions;

class BrokenLineRenderer implements ICustomSeriesPaneRenderer {
  private data: PaneRendererCustomData<Time, BrokenLineData> | null = null;
  private options: BrokenLineOptions | null = null;

  public update(data: PaneRendererCustomData<Time, BrokenLineData>, options: BrokenLineOptions): void {
    this.data = data;
    this.options = options;
  }

  public draw(target: CanvasRenderingTarget2D, priceConverter: PriceToCoordinateConverter): void {
    if (!this.data || !this.options || this.data.bars.length === 0) return;
    const { bars, visibleRange } = this.data;
    const { color = "#2196f3", lineWidth = 2, lineStyle = 0 } = this.options;
    const from = visibleRange ? Math.max(0, visibleRange.from - 1) : 0;
    const to = visibleRange ? Math.min(bars.length, visibleRange.to + 1) : bars.length;

    target.useMediaCoordinateSpace(({ context: ctx }) => {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.setLineDash(lineStyle === 2 ? [4, 4] : []);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      let isDrawing = false;
      let prevTime: number | null = null;
      let segLen = 0;
      let lastX = 0;
      let lastY = 0;

      for (let i = from; i < to; i++) {
        const bar = bars[i]!;
        const val = bar.originalData.value;
        const y = typeof val === "number" && !Number.isNaN(val) ? priceConverter(val) : null;
        if (y === null || Number.isNaN(y)) {
          if (isDrawing) { this.finishSegment(ctx, segLen, lastX, lastY); isDrawing = false; segLen = 0; }
          prevTime = null;
          continue;
        }

        // Logical gap between consecutive timestamps breaks the line.
        if (!isDrawing || prevTime === null || bar.time !== prevTime + 1) {
          if (isDrawing) this.finishSegment(ctx, segLen, lastX, lastY);
          ctx.beginPath();
          ctx.moveTo(bar.x, y);
          isDrawing = true;
          segLen = 1;
        } else {
          ctx.lineTo(bar.x, y);
          segLen++;
        }
        lastX = bar.x;
        lastY = y;
        prevTime = bar.time;
      }
      if (isDrawing) this.finishSegment(ctx, segLen, lastX, lastY);
    });
  }

  private finishSegment(ctx: CanvasRenderingContext2D, len: number, x: number, y: number): void {
    if (len === 1) {
      const radius = Math.max((this.options?.lineWidth ?? 2) / 2, 1.5);
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.stroke();
    }
  }
}

export class BrokenLineSeriesPaneView implements ICustomSeriesPaneView<Time, BrokenLineData, BrokenLineOptions> {
  private readonly _renderer = new BrokenLineRenderer();

  public renderer(): ICustomSeriesPaneRenderer {
    return this._renderer;
  }

  public update(data: PaneRendererCustomData<Time, BrokenLineData>, options: BrokenLineOptions): void {
    this._renderer.update(data, options);
  }

  public priceValueBuilder(plotRow: BrokenLineData): CustomSeriesPricePlotValues {
    const val = typeof plotRow.value === "number" ? plotRow.value : 0;
    return [val, val, val];
  }

  public isWhitespace(data: BrokenLineData | CustomSeriesWhitespaceData<Time>): data is CustomSeriesWhitespaceData<Time> {
    return !("value" in data) || data.value === undefined || Number.isNaN(data.value);
  }

  public defaultOptions(): BrokenLineOptions {
    return {
      ...customSeriesDefaultOptions,
      color: "#2196f3",
      lineWidth: 2,
      lineStyle: 0,
    };
  }
}

/** `hasValueLabel`: price-axis label for sub-pane plots; levels never get one (TradingView shows only the scale). */
const lineOptions = (overlay: ChartOverlay, placement: ScalePlacement, hasValueLabel = false) => ({
  priceScaleId: placement,
  color: overlay.color,
  lineWidth: 2,
  lineStyle: overlay.isLevel ? 2 : 0, // 2 = Dashed
  priceLineVisible: false,
  visible: !overlay.isHidden,
  lastValueVisible: hasValueLabel && !overlay.isLevel,
});

interface OverlaySeries {
  readonly mainOverlays: readonly ChartOverlay[];
  readonly subPanes: readonly ChartSubPane[];
  /** Custom series by overlay instance id (main pane) and by "pane:instance" key (sub-panes), owned by the chart. */
  readonly overlaySeriesRef: MutableRefObject<Map<string, ISeriesApi<"Custom">>>;
  readonly subPaneSeriesRef: MutableRefObject<Map<string, ISeriesApi<"Custom">>>;
  /** Side of the price scale the series attach to. */
  readonly placement: ScalePlacement;
}

/** Keeps one custom line series per indicator plot in sync with the overlays, adding, moving and removing panes. */
export function useOverlaySeries(
  chartRef: RefObject<IChartApi | null>,
  { mainOverlays, subPanes, overlaySeriesRef, subPaneSeriesRef, placement }: OverlaySeries,
  setPaneHeights: (heights: number[]) => void,
): void {
  const setLineData = useLineSmoothing();

  // Update the main-pane overlays.
  useEffect(() => {
    const chart = chartRef.current;
    if (chart === null) return;
    const known = new Set<string>();
    for (const overlay of mainOverlays) {
      known.add(overlay.instanceId);
      let series = overlaySeriesRef.current.get(overlay.instanceId);
      if (series === undefined) {
        series = chart.addCustomSeries(new BrokenLineSeriesPaneView(), lineOptions(overlay, placement));
        overlaySeriesRef.current.set(overlay.instanceId, series);
      } else {
        series.applyOptions(lineOptions(overlay, placement));
      }
      setLineData(
        series,
        overlay.data.map((d) => (d.value !== undefined ? { time: Math.floor(d.time / 1000) as Time, value: d.value } : { time: Math.floor(d.time / 1000) as Time })),
      );
    }
    // Remove series that are no longer present.
    for (const [id, series] of overlaySeriesRef.current.entries()) {
      if (!known.has(id)) {
        chart.removeSeries(series);
        overlaySeriesRef.current.delete(id);
      }
    }
  }, [mainOverlays, setLineData, chartRef, overlaySeriesRef, placement]);

  // Update the sub-pane overlays.
  useEffect(() => {
    const chart = chartRef.current;
    if (chart === null) return;
    const known = new Set(subPanes.flatMap((pane) => pane.overlays.map((o) => `${pane.paneId}:${o.instanceId}`)));
    // Remove first: LWC drops emptied panes and renumbers the rest, which the moves below rely on.
    for (const [key, series] of subPaneSeriesRef.current.entries()) {
      if (!known.has(key)) {
        chart.removeSeries(series);
        subPaneSeriesRef.current.delete(key);
      }
    }
    subPanes.forEach((pane, i) => {
      const paneIndex = i + 1;
      for (const overlay of pane.overlays) {
        const key = `${pane.paneId}:${overlay.instanceId}`;
        let series = subPaneSeriesRef.current.get(key);
        if (series === undefined) {
          series = chart.addCustomSeries(new BrokenLineSeriesPaneView(), lineOptions(overlay, placement, true), paneIndex);
          subPaneSeriesRef.current.set(key, series);
        } else {
          series.applyOptions(lineOptions(overlay, placement, true));
          // A pane added or removed before this one shifts its index; series don't follow on their own.
          if (series.getPane().paneIndex() !== paneIndex) series.moveToPane(paneIndex);
        }
        setLineData(
          series,
          overlay.data.map((d) => (d.value !== undefined ? { time: Math.floor(d.time / 1000) as Time, value: d.value } : { time: Math.floor(d.time / 1000) as Time })),
        );
      }
    });
    // TradingView gives price ~75% of the height; LWC defaults to equal panes.
    chart.panes().forEach((pane, i) => pane.setStretchFactor(i === 0 ? 3 : 1));
    // Pane heights settle on LWC's next paint, not synchronously.
    requestAnimationFrame(() => setPaneHeights(chart.panes().map((pane) => pane.getHeight())));
  }, [subPanes, setLineData, chartRef, subPaneSeriesRef, setPaneHeights, placement]);
}
