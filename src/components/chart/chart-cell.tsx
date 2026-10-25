"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { registry, type Bar } from "@nemesis-oss/pine-ts";
import {
  type ChartInterval,
  type SymbolOption,
} from "@/lib/public-binance-feed";
import {
  ChartWorkbench, type ChartOverlay, type ChartSubPane, type TradeMarker,
} from "@/components/chart/chart-workbench";
import {
  type MountedIndicator,
} from "@/components/chart/indicator-sidebar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  SUPPORTED_SYMBOLS, SUPPORTED_INTERVALS,
} from "@/lib/public-binance-feed";
import { X } from "lucide-react";
import { useLiveBars, type LiveStatus } from "@/hooks/use-live-bars";

/**
 * A self-contained chart cell — manages its own symbol, timeframe, bars,
 * stream, indicators, overlays, and sub-panes. Each cell is fully
 * independent from other cells in the grid.
 *
 * Wave 18 — extracted from page.tsx so the page can manage N cells in a grid.
 */

const INDICATOR_COLORS: Record<string, string> = {
  sma: "#1e88e5", ema: "#ff6d00", rsi: "#7e57c2",
  macd: "#1e88e5", bb: "#7e57c2", obv: "#26a69a",
};
const FALLBACK_COLOR = "#1e88e5";

interface IndicatorRunResult {
  readonly plots: Record<string, Array<number | undefined>>;
  readonly meta: ReturnType<typeof registry.metadata>;
}

/** What the page stores (and persists) per chart cell. */
export interface CellSettings {
  readonly symbol: SymbolOption;
  readonly interval: ChartInterval;
  readonly indicators: readonly MountedIndicator[];
}

export interface ChartCellProps extends CellSettings {
  readonly cellId: string;
  readonly onChange: (cellId: string, patch: Partial<CellSettings>) => void;
  readonly isActive: boolean;
  readonly onActivate: (cellId: string) => void;
  readonly onRemove?: (cellId: string) => void;
  readonly canRemove: boolean;
  readonly editorOverlays: ChartOverlay[];
  readonly tradeMarkers?: TradeMarker[];
  /** Receives this cell's bars while it is active, so the editor runs on what the chart shows. */
  readonly onActiveBarsChange?: (bars: readonly Bar[]) => void;
}

export function ChartCell({
  cellId, symbol, interval, indicators: mounted, onChange,
  isActive, onActivate, onRemove, canRemove, editorOverlays, tradeMarkers, onActiveBarsChange,
}: ChartCellProps) {
  const { bars, status, error } = useLiveBars(symbol.binanceSymbol, interval);
  const [runResults, setRunResults] = useState<Record<string, IndicatorRunResult>>({});

  // Drive indicators.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: Record<string, IndicatorRunResult> = {};
      for (const m of mounted) {
        const meta = registry.metadata(m.indicatorId);
        const instance = registry.instantiate(m.indicatorId, m.inputs);
        if (!instance || !meta) continue;
        const perPlot: Record<string, Array<number | undefined>> = {};
        let barIndex = 0;
        for await (const r of instance.run(bars as never)) {
          for (const [plotId, value] of Object.entries(r)) {
            if (perPlot[plotId] === undefined) perPlot[plotId] = [];
            perPlot[plotId]![barIndex] = value;
          }
          barIndex++;
        }
        out[m.instanceId] = { plots: perPlot, meta };
      }
      if (!cancelled) setRunResults(out);
    })();
    return () => { cancelled = true; };
  }, [bars, mounted]);

  const { mainOverlays, subPanes } = useMemo(() => {
    return computeOverlays(bars, mounted, runResults);
  }, [bars, mounted, runResults]);

  useEffect(() => {
    if (isActive) onActiveBarsChange?.(bars);
  }, [isActive, bars, onActiveBarsChange]);

  // Editor plots have no overlay flag; a sub-pane keeps oscillators (RSI etc.)
  // from squashing the price scale.
  const allSubPanes = editorOverlays.length > 0
    ? [...subPanes, { paneId: "editor", title: "Custom", overlays: editorOverlays }]
    : subPanes;

  return (
    <div
      // Highlight only matters when there are several charts to pick from, as on TradingView.
      className={`flex h-full flex-col border ${isActive && canRemove ? "border-primary" : "border-transparent"}`}
      onClick={() => onActivate(cellId)}
    >
      {/* Cell header — symbol/timeframe + stream + remove */}
      <div className="flex items-center justify-between px-2 py-1">
        <div className="flex items-center gap-1.5">
          <Select
            value={symbol.binanceSymbol}
            onValueChange={(v) => { const o = SUPPORTED_SYMBOLS.find((s) => s.binanceSymbol === v); if (o) onChange(cellId, { symbol: o }); }}
          >
            <SelectTrigger className="h-9 w-28 text-xs sm:h-7 sm:w-28 sm:text-[10px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SUPPORTED_SYMBOLS.map((s) => <SelectItem key={s.binanceSymbol} value={s.binanceSymbol}>{s.displayName}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={interval} onValueChange={(v) => onChange(cellId, { interval: v as ChartInterval })}>
            <SelectTrigger className="h-9 w-16 text-xs sm:h-7 sm:w-16 sm:text-[10px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SUPPORTED_INTERVALS.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
            </SelectContent>
          </Select>
          <LiveBadge status={status} />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">{bars.length} bars</span>
          {canRemove && onRemove && (
            <Button variant="ghost" size="sm" className="h-9 w-9 p-0 sm:h-7 sm:w-7" onClick={(e) => { e.stopPropagation(); onRemove(cellId); }}>
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Chart body */}
      <div className="flex-1 overflow-hidden px-1 pb-1">
        {bars.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {error ?? `Loading ${symbol.displayName} from Binance…`}
          </div>
        ) : (
          <ChartWorkbench title={`${symbol.displayName} · ${interval} · Binance`} interval={interval} bars={bars} mainOverlays={mainOverlays} subPanes={allSubPanes} tradeMarkers={tradeMarkers} />
        )}
      </div>
    </div>
  );
}

// React.memo: prevents re-render when parent state changes but this cell's
// props haven't changed (e.g. when another cell is activated). Wave 23.
export const MemoizedChartCell = memo(ChartCell);

const LIVE_BADGE: Record<LiveStatus, { label: string; dotClass: string }> = {
  loading: { label: "Loading", dotClass: "bg-[#787b86]" },
  live: { label: "Live", dotClass: "bg-[#089981] animate-pulse" },
  reconnecting: { label: "Reconnecting…", dotClass: "bg-[#ff9800]" },
};

function LiveBadge({ status }: { status: LiveStatus }) {
  const { label, dotClass } = LIVE_BADGE[status];
  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
      <span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} />{label}
    </span>
  );
}

function computeOverlays(
  bars: readonly { time: number }[],
  mounted: readonly MountedIndicator[],
  runResults: Record<string, IndicatorRunResult>,
): { mainOverlays: ChartOverlay[]; subPanes: ChartSubPane[] } {
  const mainOverlays: ChartOverlay[] = [];
  const subPanes: ChartSubPane[] = [];
  for (const m of mounted) {
    const result = runResults[m.instanceId];
    if (!result || !result.meta) continue;
    const paneOverlays: ChartOverlay[] = [];
    for (const plot of result.meta.plots) {
      if (plot.kind !== "line" && plot.kind !== "histogram") continue;
      const seriesValues = result.plots[plot.id] ?? [];
      const data: { time: number; value: number }[] = [];
      for (let i = 0; i < bars.length; i++) {
        const v = seriesValues[i];
        if (v === undefined || Number.isNaN(v)) continue;
        data.push({ time: bars[i]!.time, value: v });
      }
      paneOverlays.push({
        instanceId: `${m.instanceId}:${plot.id}`,
        indicatorId: `${m.indicatorId}.${plot.id}`,
        indicatorName: `${m.indicatorName} (${plot.id})`,
        color: plot.color ?? INDICATOR_COLORS[m.indicatorId] ?? FALLBACK_COLOR,
        data,
      });
    }
    if (m.pane === "main") mainOverlays.push(...paneOverlays);
    else subPanes.push({ paneId: m.instanceId, title: m.indicatorName, overlays: paneOverlays });
  }
  return { mainOverlays, subPanes };
}
