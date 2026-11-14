"use client";

import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Bar } from "@nemesis-oss/pine-ts";
import { INTERVAL_MS, type ChartInterval, type SymbolOption } from "@/lib/public-binance-feed";
import { ChartWorkbench, type ChartOverlay, type IndicatorAction, type TradeMarker } from "@/components/chart/chart-workbench";
import { IndicatorSettingsDialog, type MountedIndicator } from "@/components/chart/indicator-dialogs";
import type { ChartDrawing } from "@/components/chart/script-drawings-primitive";
import type { ChartSettings } from "@/lib/chart-settings";
import { Button } from "@/components/ui/button";
import type { ScriptRunner } from "@/lib/script-worker-client";
import { History, X } from "lucide-react";
import { useSymbolFeed } from "@/hooks/use-symbol-feed";
import { LiveBadge } from "@/components/chart/live-badge";
import { htfSourceOf } from "@/lib/htf-bars";
import { useOptionsDashboard } from "@/hooks/use-option-chain";
// Loaded when first opened: most charts never show the option panel.
const OptionChainPanel = dynamic(() => import("@/components/chart/option-chain-panel").then((m) => m.OptionChainPanel), { ssr: false });
import { rememberRemoteSymbol } from "@/lib/remote-symbols";
import { OptionHud } from "@/components/chart/option-hud";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useBarReplay } from "@/hooks/use-bar-replay";
import { ReplayControls } from "@/components/chart/replay-controls";
import { buildSinks, dispatchScriptAlerts, formatScriptAlertMessage, loadAlertSettings } from "@/lib/alert-sinks";
import { loadSettings as loadBinanceSettings } from "@/components/trading/settings-dialog";
import { toast } from "@/hooks/use-toast";
import { DepthDiagnostics } from "@/components/chart/depth-diagnostics";
import {
  computeOverlays,
  runMounted,
  scriptDrawings,
  type IndicatorRunResult,
} from "@/lib/cell-indicators";

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
  readonly editorDrawings?: readonly ChartDrawing[];
  readonly isEditorOverlay?: boolean;
  readonly chartSettings: ChartSettings;
  readonly onChartSettingsChange: (settings: ChartSettings) => void;
  readonly onOpenChartSettings: () => void;
  readonly tradeMarkers?: TradeMarker[];
  readonly onActiveBarsChange?: (bars: readonly Bar[], symbol: SymbolOption) => void;
  readonly onEditorScriptAction?: (action: IndicatorAction) => void;
}

const EDITOR_PANE_ID = "editor";

export function ChartCell({
  cellId, symbol, interval, indicators: mounted, onChange,
  isActive, onActivate, onRemove, canRemove, editorOverlays, editorDrawings,
  isEditorOverlay = false, chartSettings, onChartSettingsChange, onOpenChartSettings,
  tradeMarkers, onActiveBarsChange, onEditorScriptAction,
}: ChartCellProps) {
  const isBinance = symbol.provider === "binance";
  const feed = useSymbolFeed(symbol, interval);
  const { bars, status, error, health, loadOlder, subscribe, feedName } = feed;
  const replay = useBarReplay(bars.length);

  const visibleBars = useMemo(
    () => (replay.isReplay ? bars.slice(0, replay.replayIndex) : bars),
    [replay.isReplay, replay.replayIndex, bars],
  );

  const options = useOptionsDashboard(symbol, visibleBars, INTERVAL_MS[interval]);
  const [isHudExpanded, setIsHudExpanded] = usePersistedState("option-hud-expanded", true);
  const openContract = (contract: SymbolOption) => {
    rememberRemoteSymbol(contract);
    onChange(cellId, { symbol: contract });
    options.setIsOpen(false);
  };

  const [runResults, setRunResults] = useState<Record<string, IndicatorRunResult>>({});
  const [settingsInstanceId, setSettingsInstanceId] = useState<string | null>(null);

  const setIndicators = useCallback((update: (prev: readonly MountedIndicator[]) => readonly MountedIndicator[]) => {
    onChange(cellId, { indicators: update(mounted) });
  }, [onChange, cellId, mounted]);

  const onIndicatorAction = useCallback((ownerId: string, action: IndicatorAction) => {
    if (ownerId === EDITOR_PANE_ID) { onEditorScriptAction?.(action); return; }
    if (action === "settings") { setSettingsInstanceId(ownerId); return; }
    setIndicators((prev) => action === "remove"
      ? prev.filter((m) => m.instanceId !== ownerId)
      : prev.map((m) => (m.instanceId === ownerId ? { ...m, isHidden: !m.isHidden } : m)));
  }, [onEditorScriptAction, setIndicators]);

  const onSettingsInputChange = useCallback((inputName: string, value: number | string | boolean) => {
    setIndicators((prev) => prev.map((m) => (m.instanceId === settingsInstanceId
      ? { ...m, inputs: { ...m.inputs, [inputName]: value } }
      : m)));
  }, [setIndicators, settingsInstanceId]);

  const [liveRunners] = useState(() => new Map<string, ScriptRunner>());
  useEffect(() => () => liveRunners.forEach((runner) => runner.dispose()), [liveRunners]);
  const lastRunTimeRef = useRef(0);
  const prevRunKeyRef = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    for (const [id, runner] of liveRunners) {
      if (visibleBars.length > 0 && mounted.some((m) => m.instanceId === id)) continue;
      runner.dispose();
      liveRunners.delete(id);
    }
    if (visibleBars.length === 0) {
      // Empty feed = symbol/interval change; the loop above dropped the runners, which only append to old history.
      prevRunKeyRef.current = null;
      setRunResults({});
      return;
    }
    const first = visibleBars[0];
    const last = visibleBars[visibleBars.length - 1];
    const runKey = `${symbol.ticker}:${interval}:${visibleBars.length}:${first?.time}:${last?.time}:${mounted.map((m) => m.instanceId).join(",")}`;
    const isNewBarOrConfig = runKey !== prevRunKeyRef.current;
    const now = Date.now();
    // Throttle sub-tick recalculations within a forming candle to reduce main-thread pressure.
    if (!isNewBarOrConfig && now - lastRunTimeRef.current < 2_000) return;
    lastRunTimeRef.current = now;
    prevRunKeyRef.current = runKey;

    (async () => {
      const out: Record<string, IndicatorRunResult> = {};
      for (const m of mounted) {
        try {
          const result = await runMounted(m, visibleBars, liveRunners, htfSourceOf(symbol));
          if (result !== undefined) out[m.instanceId] = result;
        } catch {
          // A saved script that no longer compiles draws nothing.
        }
      }
      if (!cancelled) setRunResults(out);
    })();
    return () => { cancelled = true; };
  }, [visibleBars, mounted, liveRunners, symbol, interval]);

  const { mainOverlays, subPanes } = useMemo(
    () => computeOverlays(visibleBars, mounted, runResults, interval),
    [visibleBars, mounted, runResults, interval],
  );
  const drawings = useMemo(
    () => [...(editorDrawings ?? []), ...scriptDrawings(visibleBars, mounted, runResults, interval), ...options.drawings],
    [editorDrawings, visibleBars, mounted, runResults, interval, options.drawings],
  );

  const dispatchedAlertKeysRef = useRef(new Set<string>());
  useEffect(() => {
    // Built only when an alert actually fires: parsing both settings stores on every run is wasted work.
    let sinks: ReturnType<typeof buildSinks> | undefined;
    for (const [id, res] of Object.entries(runResults)) {
      if (!res.alerts || res.alerts.length === 0) continue;
      const lastAlert = res.alerts[res.alerts.length - 1]!;
      const key = `${id}:${lastAlert.barIndex ?? visibleBars.length}:${lastAlert.message}`;
      if (!dispatchedAlertKeysRef.current.has(key)) {
        dispatchedAlertKeysRef.current.add(key);
        sinks ??= buildSinks(loadAlertSettings(), loadBinanceSettings());
        void dispatchScriptAlerts([lastAlert], sinks, symbol.displayName);
        const { message } = formatScriptAlertMessage(lastAlert.message);
        toast({ title: `[${symbol.displayName}] Alert`, description: message });
      }
    }
  }, [runResults, symbol.displayName, visibleBars.length]);

  const notifiedRef = useRef<string | null>(null);
  const wasActiveRef = useRef(false);
  useEffect(() => {
    if (!isActive) { wasActiveRef.current = false; return; }
    const first = visibleBars[0];
    const last = visibleBars[visibleBars.length - 1];
    if (first === undefined || last === undefined) { notifiedRef.current = null; return; }
    const signature = `${symbol.ticker}:${interval}:${first.time}:${last.time}:${visibleBars.length}`;
    if (wasActiveRef.current && signature === notifiedRef.current) return;
    wasActiveRef.current = true;
    notifiedRef.current = signature;
    onActiveBarsChange?.(visibleBars, symbol);
  }, [isActive, visibleBars, onActiveBarsChange, symbol, interval]);

  const allMainOverlays = isEditorOverlay ? [...mainOverlays, ...editorOverlays] : mainOverlays;
  const allSubPanes = editorOverlays.length > 0 && !isEditorOverlay
    ? [...subPanes, { paneId: EDITOR_PANE_ID, title: editorOverlays[0]?.indicatorName ?? "Custom", overlays: editorOverlays }]
    : subPanes;

  return (
    <div
      className={`relative flex h-full flex-col border transition-colors duration-150 ${isActive && canRemove ? "border-primary" : "border-transparent"}`}
      onClick={() => onActivate(cellId)}
    >
      {replay.isReplay && (
        <ReplayControls
          isPlaying={replay.isPlaying}
          replayIndex={replay.replayIndex}
          totalBars={bars.length}
          speedMs={replay.speedMs}
          onTogglePlay={replay.togglePlay}
          onStepForward={replay.stepForward}
          onRestart={() => replay.startReplay()}
          onSeek={replay.setReplayIndex}
          onSpeedChange={replay.setSpeedMs}
          onClose={replay.stopReplay}
        />
      )}

      <div className="absolute right-16 top-1 z-10 flex items-center gap-1.5">
        {!replay.isReplay ? (
          <>
            <LiveBadge status={status} health={health} interval={interval} symbol={symbol.displayName} isMarketClosed={feed.isMarketClosed} />
            <DepthDiagnostics symbol={isBinance ? symbol.binanceSymbol : undefined} tradeAgeMs={health.lastTickAgeMs} />
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => replay.startReplay()}
              title="Bar Replay mode"
            >
              <History className="mr-1 h-3 w-3" /> Replay
            </Button>
            {options.expiries.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className={`h-5 px-1.5 text-[10px] hover:text-foreground ${options.isOpen ? "text-[#2962ff]" : options.isLinesOnly ? "text-[#089981]" : "text-muted-foreground"}`}
                onClick={(e) => { e.stopPropagation(); options.setIsOpen(!options.isOpen); }}
                title={options.isLinesOnly ? "Options dashboard (its OI levels are still on the chart)" : "Options dashboard: OI levels, PCR, IV, VIX, greeks, and which long option side the evidence supports"}
              >
                Options{options.isLinesOnly ? " •" : ""}
              </Button>
            )}
          </>
        ) : (
          <span className="flex items-center gap-1 text-[10px] font-medium text-[#c084fc]">
            <span className="inline-block h-2 w-2 rounded-full bg-[#a855f7] animate-pulse" /> Replay Mode
          </span>
        )}
        <span className="text-[10px] tabular-nums text-muted-foreground">{visibleBars.length} bars</span>
        {canRemove && onRemove && (
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); onRemove(cellId); }}>
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>

      <div className="relative flex-1 overflow-hidden px-1 pb-1">
        {visibleBars.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {error ?? `Loading ${symbol.displayName} from ${feedName}…`}
          </div>
        ) : (
          <>
          <ChartWorkbench
            cellId={cellId}
            title={`${symbol.displayName} · ${interval} · ${feedName}${replay.isReplay ? " (Replay)" : ""}`}
            interval={interval}
            bars={visibleBars}
            subscribeBars={replay.isReplay ? undefined : subscribe}
            onNeedOlderBars={loadOlder}
            onIndicatorAction={onIndicatorAction}
            mainOverlays={allMainOverlays}
            subPanes={allSubPanes}
            tradeMarkers={tradeMarkers}
            drawings={drawings}
            depthSymbol={replay.isReplay || !isBinance ? undefined : symbol.binanceSymbol}
            subscribeTrades={replay.isReplay || !isBinance ? undefined : feed.subscribeTrades}
            timeZone={symbol.provider === "dhan" ? "Asia/Kolkata" : undefined}
            settings={chartSettings}
            onSettingsChange={onChartSettingsChange}
            onOpenSettings={onOpenChartSettings}
          />
          {options.showLines && options.filter && options.state.summary && (
            <OptionHud filter={options.filter} summary={options.state.summary} vix={options.vix} isExpanded={isHudExpanded} onToggle={() => setIsHudExpanded(!isHudExpanded)} onOpenPanel={() => options.setIsOpen(true)} onTurnOff={() => options.setShowLines(false)} />
          )}
          </>
        )}
      </div>
      {options.isOpen && options.underlying !== undefined && options.expiries.length > 0 && (
        <OptionChainPanel symbol={symbol} dashboard={options} onOpenContract={openContract} />
      )}
      <IndicatorSettingsDialog
        indicator={mounted.find((m) => m.instanceId === settingsInstanceId)}
        onClose={() => setSettingsInstanceId(null)}
        onInputChange={onSettingsInputChange}
      />
    </div>
  );
}

export const MemoizedChartCell = memo(ChartCell);
