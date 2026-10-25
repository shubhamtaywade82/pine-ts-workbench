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

const PRICE_FORMAT = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Small prices (e.g. alts under $10) need more decimals to be readable.
const SMALL_PRICE_FORMAT = new Intl.NumberFormat("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const VOLUME_FORMAT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });

/** `scale` picks the precision, so a bar's change uses the same decimals as its price. */
const formatPrice = (value: number, scale: number = value): string =>
  (Math.abs(scale) < 10 ? SMALL_PRICE_FORMAT : PRICE_FORMAT).format(value);

/** Point at `time`, or the last point when not hovering. */
const pointAt = <T extends { time: number }>(points: readonly T[], time: number | null): T | undefined =>
  time === null ? points[points.length - 1] : points.find((p) => p.time === time);

/** TradingView-style top-left legend: symbol + OHLC, then one line per indicator in each pane. */
export function ChartLegend({ title, bars, mainOverlays, subPanes, hoverTime, paneHeights }: ChartLegendProps) {
  const bar = pointAt(bars, hoverTime);
  // Sub-pane i starts below the main pane and every sub-pane before it.
  const paneTops = subPanes.map((_, i) =>
    paneHeights.slice(0, i + 1).reduce((sum, height) => sum + height + PANE_SEPARATOR_PX, 0));
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
      {subPanes.map((pane, i) => (
        <div key={pane.paneId} className="absolute left-2" style={{ top: paneTops[i]! + 2 }}>
          <OverlayLine name={pane.title} overlays={pane.overlays} hoverTime={hoverTime} />
        </div>
      ))}
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
        {change >= 0 ? "+" : ""}{formatPrice(change, bar.close)} ({change >= 0 ? "+" : ""}{changePct.toFixed(2)}%)
      </span>
      <span className="text-[#787b86]">
        Vol <span style={{ color }}>{VOLUME_FORMAT.format(bar.volume)}</span>
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
