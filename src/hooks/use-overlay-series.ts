"use client";

import { useEffect, type MutableRefObject, type RefObject } from "react";
import { LineSeries, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import type { ChartOverlay, ChartSubPane } from "@/components/chart/chart-workbench";
import { useLineSmoothing } from "@/hooks/use-line-smoothing";

/** `hasValueLabel`: price-axis label for sub-pane plots; levels never get one (TradingView shows only the scale). */
const lineOptions = (overlay: ChartOverlay, hasValueLabel = false) => ({
  color: overlay.color,
  lineWidth: 1 as const,
  lineStyle: overlay.isLevel ? 2 : 0, // 2 = Dashed
  priceLineVisible: false,
  crosshairMarkerVisible: !overlay.isLevel,
  visible: !overlay.isHidden,
  lastValueVisible: hasValueLabel && !overlay.isLevel,
});

interface OverlaySeries {
  readonly mainOverlays: readonly ChartOverlay[];
  readonly subPanes: readonly ChartSubPane[];
  /** Line series by overlay instance id (main pane) and by "pane:instance" key (sub-panes), owned by the chart. */
  readonly overlaySeriesRef: MutableRefObject<Map<string, ISeriesApi<"Line">>>;
  readonly subPaneSeriesRef: MutableRefObject<Map<string, ISeriesApi<"Line">>>;
}

/** Keeps one line series per indicator plot in sync with the overlays, adding, moving and removing panes. */
export function useOverlaySeries(
  chartRef: RefObject<IChartApi | null>,
  { mainOverlays, subPanes, overlaySeriesRef, subPaneSeriesRef }: OverlaySeries,
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
        series = chart.addSeries(LineSeries, lineOptions(overlay));
        overlaySeriesRef.current.set(overlay.instanceId, series);
      } else {
        series.applyOptions(lineOptions(overlay));
      }
      setLineData(series, overlay.data.map((d) => ({ time: Math.floor(d.time / 1000) as Time, value: d.value })));
    }
    // Remove series that are no longer present.
    for (const [id, series] of overlaySeriesRef.current.entries()) {
      if (!known.has(id)) {
        chart.removeSeries(series);
        overlaySeriesRef.current.delete(id);
      }
    }
  }, [mainOverlays, setLineData, chartRef, overlaySeriesRef]);

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
          series = chart.addSeries(LineSeries, lineOptions(overlay, true), paneIndex);
          subPaneSeriesRef.current.set(key, series);
        } else {
          series.applyOptions(lineOptions(overlay, true));
          // A pane added or removed before this one shifts its index; series don't follow on their own.
          if (series.getPane().paneIndex() !== paneIndex) series.moveToPane(paneIndex);
        }
        setLineData(series, overlay.data.map((d) => ({ time: Math.floor(d.time / 1000) as Time, value: d.value })));
      }
    });
    // TradingView gives price ~75% of the height; LWC defaults to equal panes.
    chart.panes().forEach((pane, i) => pane.setStretchFactor(i === 0 ? 3 : 1));
    // Pane heights settle on LWC's next paint, not synchronously.
    requestAnimationFrame(() => setPaneHeights(chart.panes().map((pane) => pane.getHeight())));
  }, [subPanes, setLineData, chartRef, subPaneSeriesRef, setPaneHeights]);
}
