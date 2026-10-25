"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { registry, type InputsBag } from "@nemesis-oss/pine-ts";
import { STUB_BARS } from "@/lib/stub-bars";
import {
  fetchHistoricalBars,
  openKlineStream,
  type ChartInterval,
  type StreamStatus,
  type SymbolOption,
} from "@/lib/public-binance-feed";
import {
  ChartWorkbench, type ChartOverlay, type ChartSubPane, type TradeMarker,
} from "@/components/chart/chart-workbench";
import {
  IndicatorSidebar, nextInstanceId, type MountedIndicator,
} from "@/components/chart/indicator-sidebar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  SUPPORTED_SYMBOLS, SUPPORTED_INTERVALS,
} from "@/lib/public-binance-feed";
import { X } from "lucide-react";

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

export interface ChartCellProps {
  readonly cellId: string;
  readonly isActive: boolean;
  readonly onActivate: (cellId: string) => void;
  readonly onRemove?: (cellId: string) => void;
  readonly canRemove: boolean;
  readonly editorOverlays: ChartOverlay[];
  readonly tradeMarkers?: TradeMarker[];
}

export function ChartCell({
  cellId, isActive, onActivate, onRemove, canRemove, editorOverlays, tradeMarkers,
}: ChartCellProps) {
  const [symbol, setSymbol] = useState<SymbolOption>(SUPPORTED_SYMBOLS[0]!);
  const [interval, setInterval] = useState<ChartInterval>("1m");
  const [bars, setBars] = useState(STUB_BARS);
  const [barsSource, setBarsSource] = useState<"stub" | "live" | "fetching" | "error">("stub");
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("disconnected");
  const disconnectRef = useRef<(() => void) | null>(null);

  const [mounted, setMounted] = useState<MountedIndicator[]>([
    { instanceId: nextInstanceId("sma"), indicatorId: "sma", indicatorName: "Simple Moving Average", inputs: { source: "close", length: 20 }, pane: "main" },
  ]);
  const [runResults, setRunResults] = useState<Record<string, IndicatorRunResult>>({});

  // Fetch historical bars.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBarsSource("fetching");
      try {
        const fetched = await fetchHistoricalBars(symbol.coinbaseProduct, interval, 200);
        if (!cancelled) { setBars(fetched); setBarsSource("live"); }
      } catch { if (!cancelled) setBarsSource("error"); }
    })();
    return () => { cancelled = true; };
  }, [symbol, interval]);

  // Cleanup stream on unmount.
  useEffect(() => {
    return () => { disconnectRef.current?.(); };
  }, []);

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

  const onStreamToggle = useCallback(() => {
    if (disconnectRef.current) { disconnectRef.current(); disconnectRef.current = null; return; }
    disconnectRef.current = openKlineStream(symbol.binanceSymbol, interval, {
      onBar: (bar) => {
        setBars((prev) => {
          if (!prev.length) return [bar];
          const last = prev[prev.length - 1]!;
          if (last.time === bar.time) return [...prev.slice(0, -1), bar];
          if (bar.time > last.time) return [...prev, bar];
          return prev;
        });
      },
      onStatus: setStreamStatus,
    });
  }, [symbol, interval]);

  const onAdd = useCallback((id: string) => {
    const meta = registry.metadata(id);
    if (!meta) return;
    const inputs: InputsBag = {};
    for (const i of meta.inputs) inputs[i.name] = i.defaultValue;
    setMounted((p) => [...p, { instanceId: nextInstanceId(id), indicatorId: id, indicatorName: meta.name, inputs, pane: meta.overlay ? "main" : "sub" }]);
  }, []);
  const onRemoveIndicator = useCallback((id: string) => setMounted((p) => p.filter((m) => m.instanceId !== id)), []);
  const onInputChange = useCallback((id: string, name: string, v: number | string | boolean) =>
    setMounted((p) => p.map((m) => m.instanceId === id ? { ...m, inputs: { ...m.inputs, [name]: v } } : m)), []);

  const allOverlays = [...mainOverlays, ...editorOverlays];

  return (
    <div
      className={`flex h-full flex-col rounded-lg border-2 ${isActive ? "border-blue-500" : "border-transparent"}`}
      onClick={() => onActivate(cellId)}
    >
      {/* Cell header — symbol/timeframe + stream + remove */}
      <div className="flex items-center justify-between px-2 py-1">
        <div className="flex items-center gap-1.5">
          <Select
            value={symbol.coinbaseProduct}
            onValueChange={(v) => { const o = SUPPORTED_SYMBOLS.find((s) => s.coinbaseProduct === v); if (o) setSymbol(o); }}
          >
            <SelectTrigger className="h-7 w-28 text-[10px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SUPPORTED_SYMBOLS.map((s) => <SelectItem key={s.coinbaseProduct} value={s.coinbaseProduct}>{s.displayName}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={interval} onValueChange={(v) => setInterval(v as ChartInterval)}>
            <SelectTrigger className="h-7 w-16 text-[10px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SUPPORTED_INTERVALS.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
            </SelectContent>
          </Select>
          <StreamDot status={streamStatus} />
          <Button
            variant={streamStatus === "live" || streamStatus === "connecting" ? "destructive" : "outline"}
            size="sm" className="h-7 px-2 text-[10px]"
            onClick={(e) => { e.stopPropagation(); onStreamToggle(); }}
          >
            {streamStatus === "live" || streamStatus === "connecting" ? "Stop" : "Stream"}
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">{bars.length} bars</span>
          {canRemove && onRemove && (
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); onRemove(cellId); }}>
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Chart body */}
      <div className="flex-1 overflow-hidden px-1 pb-1">
        {barsSource === "error" ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Failed to load — showing stub bars.
          </div>
        ) : barsSource === "fetching" ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Loading…
          </div>
        ) : (
          <ChartWorkbench bars={bars} mainOverlays={allOverlays} subPanes={subPanes} tradeMarkers={tradeMarkers} />
        )}
      </div>
    </div>
  );
}

function StreamDot({ status }: { status: StreamStatus }) {
  const color = status === "live" ? "bg-green-500" : status === "connecting" ? "bg-yellow-500" : status === "error" ? "bg-red-500" : "bg-gray-500";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
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
