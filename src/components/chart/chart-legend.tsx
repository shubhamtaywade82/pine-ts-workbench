"use client";

import type { Bar } from "@nemesis-oss/pine-ts";
import type { ChartOverlay, ChartSubPane } from "@/components/chart/chart-workbench";

const UP_COLOR = "#089981";
const DOWN_COLOR = "#f23645";
// LWC draws a 1px separator between panes; legends must skip it to line up.
const PANE_SEPARATOR_PX = 1;

export interface ChartLegendProps {
  /** e.g. "BTC / USD · 1m". */
  readonly title: string;
  readonly bars: readonly Bar[];
  readonly mainOverlays: readonly ChartOverlay[];
  readonly subPanes: readonly ChartSubPane[];
  /** Bar time (ms) under the crosshair; null = show the latest bar, like TradingView. */
  readonly hoverTime: number | null;
  /** Pixel height of each LWC pane, main pane first. */
  readonly paneHeights: readonly number[];
}

/** Small prices (e.g. alts under $10) need more decimals to be readable. */
const formatPrice = (value: number): string => value.toFixed(Math.abs(value) < 10 ? 4 : 2);

/** Point at `time`, or the last point when not hovering. */
const pointAt = <T extends { time: number }>(points: readonly T[], time: number | null): T | undefined =>
  time === null ? points[points.length - 1] : points.find((p) => p.time === time);

/** TradingView-style top-left legend: symbol + OHLC, then one line per indicator in each pane. */
export function ChartLegend({ title, bars, mainOverlays, subPanes, hoverTime, paneHeights }: ChartLegendProps) {
  const bar = pointAt(bars, hoverTime);
  let paneTop = 0;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 font-mono text-[11px]">
      <div className="absolute left-2 top-1 flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-sans text-xs font-semibold text-[#d1d4dc]">{title}</span>
          {bar !== undefined && <OhlcValues bar={bar} />}
        </div>
        {mainOverlays.map((overlay) => (
          <OverlayLine key={overlay.instanceId} name={overlay.indicatorName} overlays={[overlay]} hoverTime={hoverTime} />
        ))}
      </div>
      {subPanes.map((pane, i) => {
        paneTop += (paneHeights[i] ?? 0) + PANE_SEPARATOR_PX;
        return (
          <div key={pane.paneId} className="absolute left-2" style={{ top: paneTop + 2 }}>
            <OverlayLine name={pane.title} overlays={pane.overlays} hoverTime={hoverTime} />
          </div>
        );
      })}
    </div>
  );
}

function OhlcValues({ bar }: { bar: Bar }) {
  const color = bar.close >= bar.open ? UP_COLOR : DOWN_COLOR;
  const change = bar.close - bar.open;
  const changePct = bar.open !== 0 ? (change / bar.open) * 100 : 0;
  const fields: [string, number][] = [["O", bar.open], ["H", bar.high], ["L", bar.low], ["C", bar.close]];
  return (
    <span className="flex gap-2">
      {fields.map(([label, value]) => (
        <span key={label} className="text-[#787b86]">
          {label}<span style={{ color }}>{formatPrice(value)}</span>
        </span>
      ))}
      <span style={{ color }}>
        {change >= 0 ? "+" : ""}{formatPrice(change)} ({change >= 0 ? "+" : ""}{changePct.toFixed(2)}%)
      </span>
    </span>
  );
}

function OverlayLine({ name, overlays, hoverTime }: {
  name: string;
  overlays: readonly ChartOverlay[];
  hoverTime: number | null;
}) {
  return (
    <div className="flex gap-2">
      <span className="font-sans text-[#d1d4dc]">{name}</span>
      {overlays.filter((o) => !o.isLevel).map((overlay) => {
        const point = pointAt(overlay.data, hoverTime);
        return (
          <span key={overlay.instanceId} style={{ color: overlay.color }}>
            {point === undefined ? "∅" : formatPrice(point.value)}
          </span>
        );
      })}
    </div>
  );
}
