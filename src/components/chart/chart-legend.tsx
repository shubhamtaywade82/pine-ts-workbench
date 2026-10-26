"use client";

import type { ReactNode, RefObject } from "react";
import type { Bar } from "@nemesis-oss/pine-ts";
import { Eye, EyeOff, Settings, X } from "lucide-react";
import type { ChartOverlay, ChartSubPane, IndicatorAction } from "@/components/chart/chart-workbench";
import { DEFAULT_CHART_SETTINGS, type ChartSettings } from "@/lib/chart-settings";

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
  /** Attached to the OHLC values while showing the live bar, for {@link writeLiveOhlc}. */
  readonly liveOhlcRef: RefObject<HTMLSpanElement | null>;
  readonly onIndicatorAction?: (ownerId: string, action: IndicatorAction) => void;
  /** What the status line shows (chart Settings → Status line). */
  readonly statusLine?: ChartSettings["statusLine"];
}

interface LegendRow { readonly ownerId: string; readonly name: string; readonly overlays: readonly ChartOverlay[] }

/** One row per indicator (an indicator like Bollinger Bands has several plots). */
const groupByOwner = (overlays: readonly ChartOverlay[]): LegendRow[] => {
  const rows = new Map<string, LegendRow>();
  for (const overlay of overlays) {
    const ownerId = overlay.ownerId ?? overlay.instanceId;
    const row = rows.get(ownerId);
    rows.set(ownerId, { ownerId, name: row?.name ?? overlay.indicatorName, overlays: [...(row?.overlays ?? []), overlay] });
  }
  return [...rows.values()];
};

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

type OhlcvValues = Pick<Bar, "open" | "high" | "low" | "close" | "volume">;

/** Text and colour of every legend value, shared by the React render and {@link writeLiveOhlc}. */
const legendValues = (bar: OhlcvValues) => {
  const change = bar.close - bar.open;
  const sign = change >= 0 ? "+" : "";
  const changePct = bar.open !== 0 ? (change / bar.open) * 100 : 0;
  return {
    color: bar.close >= bar.open ? UP_COLOR : DOWN_COLOR,
    fields: {
      O: formatPrice(bar.open),
      H: formatPrice(bar.high),
      L: formatPrice(bar.low),
      C: formatPrice(bar.close),
      change: `${sign}${formatPrice(change, bar.close)} (${sign}${changePct.toFixed(2)}%)`,
      Vol: VOLUME_FORMAT.format(bar.volume),
    },
  };
};

/**
 * Writes the drawn candle into the live legend at animation-frame rate,
 * bypassing React: re-rendering the chart 60 times a second would be far too heavy.
 * Mutates the existing text nodes, which React still owns and keeps updating.
 */
export const writeLiveOhlc = (container: HTMLSpanElement, bar: OhlcvValues): void => {
  const { color, fields } = legendValues(bar);
  for (const el of container.querySelectorAll<HTMLElement>("[data-field]")) {
    const text = fields[el.dataset.field as keyof typeof fields];
    if (el.firstChild !== null && el.firstChild.nodeValue !== text) el.firstChild.nodeValue = text;
    el.style.color = color;
  }
};

/** TradingView-style top-left legend: symbol + OHLC, then one line per indicator in each pane. */
export function ChartLegend({
  title, bars, mainOverlays, subPanes, hoverTime, paneHeights, liveOhlcRef, onIndicatorAction,
  statusLine = DEFAULT_CHART_SETTINGS.statusLine,
}: ChartLegendProps) {
  const bar = pointAt(bars, hoverTime);
  // Sub-pane i starts below the main pane and every sub-pane before it.
  const paneTops = subPanes.map((_, i) =>
    paneHeights.slice(0, i + 1).reduce((sum, height) => sum + height + PANE_SEPARATOR_PX, 0));
  return (
    <div className="pointer-events-none absolute inset-0 z-10 font-mono text-[11px]">
      <div className="absolute left-2 top-1 flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          {statusLine.showTitle && <span className="font-sans text-xs font-semibold text-[#d1d4dc]">{title}</span>}
          {/* Keyed by mode: switching hover ↔ live remounts, so no frame-written colour lingers. */}
          {statusLine.showOhlc && bar !== undefined && (
            <OhlcValues key={hoverTime === null ? "live" : "hover"} bar={bar} valuesRef={hoverTime === null ? liveOhlcRef : undefined} />
          )}
        </div>
        {groupByOwner(mainOverlays).map((row) => (
          <OverlayLine key={row.ownerId} row={row} hoverTime={hoverTime} onAction={onIndicatorAction} statusLine={statusLine} />
        ))}
      </div>
      {subPanes.map((pane, i) => (
        <div key={pane.paneId} className="absolute left-2" style={{ top: paneTops[i]! + 2 }}>
          <OverlayLine row={{ ownerId: pane.paneId, name: pane.title, overlays: pane.overlays }} hoverTime={hoverTime} onAction={onIndicatorAction} statusLine={statusLine} />
        </div>
      ))}
    </div>
  );
}

function OhlcValues({ bar, valuesRef }: { bar: Bar; valuesRef?: RefObject<HTMLSpanElement | null> }) {
  const { color, fields } = legendValues(bar);
  const labels = ["O", "H", "L", "C"] as const;
  return (
    <span ref={valuesRef} className="flex gap-2">
      {labels.map((label) => (
        <span key={label} className="text-[#787b86]">
          {label}<span data-field={label} style={{ color }}>{fields[label]}</span>
        </span>
      ))}
      <span data-field="change" style={{ color }}>{fields.change}</span>
      <span className="text-[#787b86]">
        Vol <span data-field="Vol" style={{ color }}>{fields.Vol}</span>
      </span>
    </span>
  );
}

const ROW_ACTIONS = [
  { action: "settings", label: "Settings", Icon: Settings },
  { action: "remove", label: "Remove", Icon: X },
] as const;

function OverlayLine({ row, hoverTime, onAction, statusLine }: {
  row: LegendRow;
  hoverTime: number | null;
  onAction?: (ownerId: string, action: IndicatorAction) => void;
  statusLine: ChartSettings["statusLine"];
}) {
  const isHidden = row.overlays.every((o) => o.isHidden);
  const VisibilityIcon = isHidden ? EyeOff : Eye;
  return (
    // pointer-events back on for the row only, so the rest of the legend never blocks chart dragging.
    <div className={`group pointer-events-auto flex w-fit items-center gap-2 rounded px-1 hover:bg-[#2a2e39]/80 ${isHidden ? "opacity-50" : ""}`}>
      {statusLine.showIndicatorTitles && <span className="font-sans text-[#d1d4dc]">{row.name}</span>}
      {/* Values stay (dimmed with the row) so the buttons don't jump under the cursor when hiding. */}
      {statusLine.showIndicatorValues && row.overlays.filter((o) => !o.isLevel).map((overlay) => {
        const point = pointAt(overlay.data, hoverTime);
        return (
          <span key={overlay.instanceId} style={{ color: overlay.color }}>
            {point === undefined ? "∅" : formatPrice(point.value)}
          </span>
        );
      })}
      {onAction !== undefined && (
        // TradingView reveals the row's buttons on hover only.
        <span className="hidden items-center gap-0.5 group-hover:flex">
          <LegendButton label={isHidden ? "Show" : "Hide"} onClick={() => onAction(row.ownerId, "toggle-visibility")}>
            <VisibilityIcon className="h-3.5 w-3.5" />
          </LegendButton>
          {ROW_ACTIONS.map(({ action, label, Icon }) => (
            <LegendButton key={action} label={label} onClick={() => onAction(row.ownerId, action)}>
              <Icon className="h-3.5 w-3.5" />
            </LegendButton>
          ))}
        </span>
      )}
    </div>
  );
}

function LegendButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button" title={label} aria-label={label}
      className="rounded p-0.5 text-[#b2b5be] hover:bg-[#363a45] hover:text-[#d1d4dc]"
      // Stop the click reaching the chart cell (which would just re-activate it).
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      {children}
    </button>
  );
}
