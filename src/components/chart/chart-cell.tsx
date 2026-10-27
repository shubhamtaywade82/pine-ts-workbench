"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Bar } from "@nemesis-oss/pine-ts";
import { type ChartInterval, type SymbolOption } from "@/lib/public-binance-feed";
import { ChartWorkbench, type ChartOverlay, type IndicatorAction, type TradeMarker } from "@/components/chart/chart-workbench";
import { IndicatorSettingsDialog, type MountedIndicator } from "@/components/chart/indicator-dialogs";
import type { ChartDrawing } from "@/components/chart/script-drawings-primitive";
import type { ChartSettings } from "@/lib/chart-settings";
import { Button } from "@/components/ui/button";
import type { ScriptRunner } from "@/lib/script-worker-client";
import { History, X } from "lucide-react";
import { useLiveBars, type LiveStatus } from "@/hooks/use-live-bars";
import { useBarReplay } from "@/hooks/use-bar-replay";
import { ReplayControls } from "@/components/chart/replay-controls";
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
  readonly onActiveBarsChange?: (bars: readonly Bar[]) => void;
  readonly onEditorScriptAction?: (action: IndicatorAction) => void;
}

const EDITOR_PANE_ID = "editor";

export function ChartCell({
  cellId, symbol, interval, indicators: mounted, onChange,
  isActive, onActivate, onRemove, canRemove, editorOverlays, editorDrawings,
  isEditorOverlay = false, chartSettings, onChartSettingsChange, onOpenChartSettings,
  tradeMarkers, onActiveBarsChange, onEditorScriptAction,
}: ChartCellProps) {
  const { bars, status, error, loadOlder, subscribe } = useLiveBars(symbol.binanceSymbol, interval);
  const replay = useBarReplay(bars.length);
  const visibleBars = useMemo(
    () => (replay.isReplay ? bars.slice(0, replay.replayIndex) : bars),
    [replay.isReplay, replay.replayIndex, bars],
  );

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
  useEffect(() => {
    let cancelled = false;
    for (const [id, runner] of liveRunners) {
      if (mounted.some((m) => m.instanceId === id)) continue;
      runner.dispose();
      liveRunners.delete(id);
    }
    (async () => {
      const out: Record<string, IndicatorRunResult> = {};
      for (const m of mounted) {
        try {
          const result = await runMounted(m, visibleBars, liveRunners, symbol.binanceSymbol);
          if (result !== undefined) out[m.instanceId] = result;
        } catch {
          // A saved script that no longer compiles draws nothing.
        }
      }
      if (!cancelled) setRunResults(out);
    })();
    return () => { cancelled = true; };
  }, [visibleBars, mounted, liveRunners, symbol.binanceSymbol]);

  const { mainOverlays, subPanes } = useMemo(
    () => computeOverlays(visibleBars, mounted, runResults, interval),
    [visibleBars, mounted, runResults, interval],
  );
  const drawings = useMemo(
    () => [...(editorDrawings ?? []), ...scriptDrawings(visibleBars, mounted, runResults, interval)],
    [editorDrawings, visibleBars, mounted, runResults, interval],
  );

  const notifiedRef = useRef<string | null>(null);
  const wasActiveRef = useRef(false);
  useEffect(() => {
    if (!isActive) { wasActiveRef.current = false; return; }
    const first = visibleBars[0];
    const last = visibleBars[visibleBars.length - 1];
    if (first === undefined || last === undefined) { notifiedRef.current = null; return; }
    const signature = `${symbol.binanceSymbol}:${interval}:${first.time}:${last.time}:${visibleBars.length}:${last.close}`;
    if (wasActiveRef.current && signature === notifiedRef.current) return;
    wasActiveRef.current = true;
    notifiedRef.current = signature;
    onActiveBarsChange?.(visibleBars);
  }, [isActive, visibleBars, onActiveBarsChange, symbol.binanceSymbol, interval]);

  const allMainOverlays = isEditorOverlay ? [...mainOverlays, ...editorOverlays] : mainOverlays;
  const allSubPanes = editorOverlays.length > 0 && !isEditorOverlay
    ? [...subPanes, { paneId: EDITOR_PANE_ID, title: "Custom", overlays: editorOverlays }]
    : subPanes;

  return (
    <div
      className={`relative flex h-full flex-col border ${isActive && canRemove ? "border-primary" : "border-transparent"}`}
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
            <LiveBadge status={status} />
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-white"
              onClick={() => replay.startReplay()}
              title="Bar Replay mode"
            >
              <History className="mr-1 h-3 w-3" /> Replay
            </Button>
          </>
        ) : (
          <span className="flex items-center gap-1 text-[10px] font-medium text-[#c084fc]">
            <span className="inline-block h-2 w-2 rounded-full bg-[#a855f7] animate-pulse" /> Replay Mode
          </span>
        )}
        <span className="text-[10px] text-muted-foreground">{visibleBars.length} bars</span>
        {canRemove && onRemove && (
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); onRemove(cellId); }}>
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-hidden px-1 pb-1">
        {visibleBars.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {error ?? `Loading ${symbol.displayName} from Binance…`}
          </div>
        ) : (
          <ChartWorkbench
            title={`${symbol.displayName} · ${interval} · Binance${replay.isReplay ? " (Replay)" : ""}`}
            interval={interval}
            bars={visibleBars}
            subscribeBars={replay.isReplay ? undefined : subscribe}
            onNeedOlderBars={loadOlder}
            onIndicatorAction={onIndicatorAction}
            mainOverlays={allMainOverlays}
            subPanes={allSubPanes}
            tradeMarkers={tradeMarkers}
            drawings={drawings}
            depthSymbol={replay.isReplay ? undefined : symbol.binanceSymbol}
            settings={chartSettings}
            onSettingsChange={onChartSettingsChange}
            onOpenSettings={onOpenChartSettings}
          />
        )}
      </div>
      <IndicatorSettingsDialog
        indicator={mounted.find((m) => m.instanceId === settingsInstanceId)}
        onClose={() => setSettingsInstanceId(null)}
        onInputChange={onSettingsInputChange}
      />
    </div>
  );
}

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
