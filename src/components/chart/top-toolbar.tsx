"use client";

import { useEffect, useState } from "react";
import { INTERVAL_LABELS, SUPPORTED_INTERVALS, SUPPORTED_SYMBOLS } from "@/lib/public-binance-feed";
import type { CellSettings } from "@/components/chart/chart-cell";
import { IndicatorsDialog } from "@/components/chart/indicators-dialog";
import type { ScriptLibraryState } from "@/hooks/use-script-library";
import { SettingsDialog, type BinanceSettings } from "@/components/trading/settings-dialog";
import { AlertSettingsDialog } from "@/components/alerts/alert-settings-dialog";
import type { AlertSettings } from "@/lib/alert-sinks";
import { loadLayouts, type SavedLayout } from "@/lib/saved-layouts";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChartLine, LayoutGrid, Maximize, Plus, Sun, Moon, Save, Settings } from "lucide-react";

export type GridLayout = 1 | 2 | 4 | 6;

export const LAYOUT_OPTIONS: { value: GridLayout; label: string; cols: number; rows: number }[] = [
  { value: 1, label: "1 chart", cols: 1, rows: 1 },
  { value: 2, label: "2 charts", cols: 2, rows: 1 },
  { value: 4, label: "4 charts", cols: 2, rows: 2 },
  { value: 6, label: "6 charts", cols: 3, rows: 2 },
];

export interface TopToolbarProps {
  /** The active chart: TradingView's top bar always edits the selected chart. */
  readonly activeCell: Pick<CellSettings, "symbol" | "interval">;
  readonly onActiveCellChange: (patch: Partial<CellSettings>) => void;
  readonly onAddIndicator: (indicatorId: string) => void;
  readonly scripts: ScriptLibraryState;
  readonly onAddScript: (scriptId: string) => void;
  readonly onOpenScript: (scriptId: string) => void;
  readonly layout: GridLayout;
  readonly onLayoutChange: (layout: GridLayout) => void;
  readonly canAddCell: boolean;
  readonly onAddCell: () => void;
  /** Saves the current grid under `name`. */
  readonly onSaveLayout: (name: string) => void;
  readonly onLoadLayout: (saved: SavedLayout) => void;
  readonly theme: "dark" | "light";
  readonly onToggleTheme: () => void;
  readonly onAlertSettingsSaved: (settings: AlertSettings) => void;
  readonly onSettingsSaved: (settings: BinanceSettings) => void;
  readonly onOpenChartSettings: () => void;
}

const toggleFullscreen = () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen();
};

/** TradingView-style single-row top toolbar. */
export function TopToolbar(props: TopToolbarProps) {
  const { activeCell, onActiveCellChange, layout, onLayoutChange, theme } = props;
  const [isIndicatorsDialogOpen, setIsIndicatorsDialogOpen] = useState(false);

  return (
    <header className="flex h-11 shrink-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] border-b border-border bg-card px-2 text-sm">
      <Select
        value={activeCell.symbol.binanceSymbol}
        onValueChange={(v) => { const o = SUPPORTED_SYMBOLS.find((s) => s.binanceSymbol === v); if (o) onActiveCellChange({ symbol: o }); }}
      >
        <SelectTrigger className="h-8 w-auto gap-2 rounded-full border-0 bg-muted px-3 font-semibold [&>svg:last-child]:hidden">
          <SelectValue>{activeCell.symbol.binanceSymbol}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {SUPPORTED_SYMBOLS.map((s) => <SelectItem key={s.binanceSymbol} value={s.binanceSymbol}>{s.displayName}</SelectItem>)}
        </SelectContent>
      </Select>
      <ToolbarSeparator />
      {SUPPORTED_INTERVALS.map((i) => (
        <Button
          key={i} variant={i === activeCell.interval ? "secondary" : "ghost"} size="sm" className="h-8 px-2 text-sm"
          onClick={() => onActiveCellChange({ interval: i })}
        >
          {INTERVAL_LABELS[i]}
        </Button>
      ))}
      <ToolbarSeparator />
      <Button variant="ghost" size="sm" className="h-8 text-sm" onClick={() => setIsIndicatorsDialogOpen(true)}>
        <ChartLine className="mr-1 h-4 w-4" /> Indicators
      </Button>
      <ToolbarSeparator />
      <Select value={String(layout)} onValueChange={(v) => onLayoutChange(Number(v) as GridLayout)}>
        <SelectTrigger className="h-8 w-auto gap-1 border-0 bg-transparent px-2 shadow-none dark:bg-transparent" title="Select layout">
          <LayoutGrid className="h-4 w-4" />
        </SelectTrigger>
        <SelectContent>
          {LAYOUT_OPTIONS.map((l) => (
            <SelectItem key={l.value} value={String(l.value)}>{l.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Add chart" onClick={props.onAddCell} disabled={!props.canAddCell}>
        <Plus className="h-4 w-4" />
      </Button>
      <ToolbarSeparator />
      <AlertSettingsDialog onSaved={props.onAlertSettingsSaved} />

      <div className="ml-auto flex items-center gap-0.5">
        <SavedLayoutsMenu onSave={props.onSaveLayout} onLoad={props.onLoadLayout} />
        <ToolbarSeparator />
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Toggle theme" onClick={props.onToggleTheme}>
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Chart settings" onClick={props.onOpenChartSettings}>
          <Settings className="h-4 w-4" />
        </Button>
        <SettingsDialog onSaved={props.onSettingsSaved} />
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Fullscreen" onClick={toggleFullscreen}>
          <Maximize className="h-4 w-4" />
        </Button>
      </div>
      <IndicatorsDialog
        open={isIndicatorsDialogOpen} onOpenChange={setIsIndicatorsDialogOpen} scripts={props.scripts}
        onAddBuiltin={props.onAddIndicator} onAddScript={props.onAddScript} onOpenScript={props.onOpenScript}
      />
    </header>
  );
}

function SavedLayoutsMenu({ onSave, onLoad }: {
  readonly onSave: (name: string) => void;
  readonly onLoad: (saved: SavedLayout) => void;
}) {
  const [savedLayouts, setSavedLayouts] = useState<SavedLayout[]>([]);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [layoutName, setLayoutName] = useState("");
  // localStorage isn't available during SSR.
  useEffect(() => setSavedLayouts(loadLayouts()), []);

  const save = () => {
    const name = layoutName.trim();
    if (!name) return;
    onSave(name);
    setSavedLayouts(loadLayouts());
    setLayoutName("");
    setIsSaveDialogOpen(false);
  };

  return (
    <>
      <Select value="" onValueChange={(id) => { const saved = savedLayouts.find((l) => l.id === id); if (saved) onLoad(saved); }}>
        <SelectTrigger className="h-8 w-auto gap-1 border-0 bg-transparent px-2 text-sm shadow-none dark:bg-transparent">
          <span className="text-muted-foreground">Layouts</span>
        </SelectTrigger>
        <SelectContent>
          {savedLayouts.map((l) => (
            <SelectItem key={l.id} value={l.id}>{l.name} ({l.layout} charts)</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="ghost" size="sm" className="h-8 text-sm" onClick={() => setIsSaveDialogOpen(true)}>
        <Save className="mr-1 h-4 w-4" /> Save
      </Button>
      {isSaveDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setIsSaveDialogOpen(false)}>
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-sm font-semibold">Save Layout</h3>
            <input
              type="text"
              placeholder="Layout name (e.g. My Watchlist)"
              value={layoutName}
              onChange={(e) => setLayoutName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
              className="mb-3 w-64 rounded border border-border px-2 py-1 text-xs"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setIsSaveDialogOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={!layoutName.trim()}>Save</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ToolbarSeparator() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-border" />;
}
