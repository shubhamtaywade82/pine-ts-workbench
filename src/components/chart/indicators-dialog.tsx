"use client";

import { useState, useMemo } from "react";
import { registry } from "@nemesis-oss/pine-ts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Search, Plus, Settings2, X, TrendingUp, Activity, BarChart3, Waves } from "lucide-react";
import type { MountedIndicator } from "@/components/chart/indicator-sidebar";
import { nextInstanceId } from "@/components/chart/indicator-sidebar";

/**
 * TradingView-style indicators dialog + chart action toolbar.
 *
 * Two components:
 *
 * 1. IndicatorsDialog — a searchable modal list of all registered indicators
 *    (SMA, EMA, RSI, MACD, BB, OBV + custom). Click to add to the active
 *    chart cell. Categories: Trend, Momentum, Volatility, Volume.
 *
 * 2. ChartActionToolbar — a floating toolbar on each chart cell with quick
 *    actions: Add Indicator (+), Drawing Tools (horizontal line, trend line),
 *    Chart Settings (candles/bars/line), Alert, Fullscreen, Screenshot.
 *
 * The toolbar mimics TradingView's left toolbar + top action bar.
 */

// ---------- category metadata ----------

const CATEGORY_META: Record<string, { label: string; icon: typeof TrendingUp }> = {
  overlay: { label: "Trend", icon: TrendingUp },
  trend: { label: "Trend", icon: TrendingUp },
  momentum: { label: "Momentum", icon: Activity },
  oscillator: { label: "Momentum", icon: Activity },
  bands: { label: "Volatility", icon: Waves },
  volatility: { label: "Volatility", icon: Waves },
  volume: { label: "Volume", icon: BarChart3 },
  custom: { label: "Custom", icon: Plus },
};

// ---------- Indicators dialog ----------

export interface IndicatorsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (indicator: MountedIndicator) => void;
  /** Currently mounted indicators (to show "added" state). */
  mounted: readonly MountedIndicator[];
}

export function IndicatorsDialog({ open, onOpenChange, onAdd, mounted }: IndicatorsDialogProps) {
  const [search, setSearch] = useState("");
  const all = useMemo(() => registry.list(), []);
  const mountedIds = useMemo(() => new Set(mounted.map((m) => m.indicatorId)), [mounted]);

  const filtered = useMemo(() => {
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter((m) =>
      m.name.toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q),
    );
  }, [all, search]);

  // Group by category.
  const grouped = useMemo(() => {
    const groups: Record<string, typeof all> = {};
    for (const meta of filtered) {
      const cat = CATEGORY_META[meta.category]?.label ?? "Other";
      if (groups[cat] === undefined) groups[cat] = [];
      groups[cat]!.push(meta);
    }
    return groups;
  }, [filtered]);

  const handleAdd = (indicatorId: string) => {
    const meta = registry.metadata(indicatorId);
    if (!meta) return;
    const inputs: Record<string, unknown> = {};
    for (const input of meta.inputs) inputs[input.name] = input.defaultValue;
    onAdd({
      instanceId: nextInstanceId(indicatorId),
      indicatorId,
      indicatorName: meta.name,
      inputs,
      pane: meta.overlay ? "main" : "sub",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="p-3 border-b border-border">
          <DialogTitle className="text-sm flex items-center gap-2">
            <Plus className="h-4 w-4" /> Add Indicator
          </DialogTitle>
        </DialogHeader>
        {/* Search */}
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search indicators..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-7 text-xs"
              autoFocus
            />
          </div>
        </div>
        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category} className="mb-2">
              <div className="px-3 py-1 text-[10px] font-semibold uppercase text-muted-foreground sticky top-0 bg-card/95 backdrop-blur">
                {category}
              </div>
              {items.map((meta) => {
                const Icon = CATEGORY_META[meta.category]?.icon ?? Plus;
                const isAdded = mountedIds.has(meta.id);
                return (
                  <button
                    key={meta.id}
                    onClick={() => { handleAdd(meta.id); onOpenChange(false); }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent/50 transition-colors"
                  >
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{meta.name}</div>
                      {meta.description && (
                        <div className="text-[10px] text-muted-foreground truncate">{meta.description}</div>
                      )}
                    </div>
                    {isAdded && <Badge variant="secondary" className="text-[9px]">Added</Badge>}
                    <Plus className="h-3 w-3 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="p-4 text-center text-xs text-muted-foreground">No indicators found.</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Chart action toolbar ----------

export interface ChartActionToolbarProps {
  onAddIndicator: () => void;
  onToggleSettings: () => void;
  onToggleFullscreen: () => void;
  isFullscreen: boolean;
  /** Mounted indicators (for the indicator legend). */
  mounted: readonly MountedIndicator[];
  onRemoveIndicator: (instanceId: string) => void;
  onToggleIndicatorSettings: (instanceId: string) => void;
}

export function ChartActionToolbar({
  onAddIndicator, onToggleSettings, onToggleFullscreen, isFullscreen,
  mounted, onRemoveIndicator, onToggleIndicatorSettings,
}: ChartActionToolbarProps) {
  return (
    <>
      {/* Left floating toolbar (TradingView-style) */}
      <div className="absolute left-1 top-1 z-10 flex flex-col gap-0.5 rounded-md bg-card/80 backdrop-blur p-0.5 shadow-sm">
        <ToolbarButton onClick={onAddIndicator} title="Add Indicator" active={false}>
          <Plus className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={onToggleSettings} title="Chart Settings" active={false}>
          <Settings2 className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={onToggleFullscreen} title="Fullscreen" active={isFullscreen}>
          <MaximizeIcon />
        </ToolbarButton>
      </div>

      {/* Indicator legend (top-left, below toolbar) — TradingView style */}
      {mounted.length > 0 && (
        <div className="absolute left-8 top-1 z-10 flex flex-col gap-0.5 max-w-[60%]">
          {mounted.map((m) => (
            <div
              key={m.instanceId}
              className="flex items-center gap-1 rounded bg-card/60 backdrop-blur px-1.5 py-0.5 text-[10px] hover:bg-card/80 transition-colors group"
            >
              <span className="font-medium truncate max-w-[120px]">{m.indicatorName}</span>
              {/* Show key inputs inline */}
              {Object.entries(m.inputs).slice(0, 2).map(([key, val]) => (
                <span key={key} className="text-muted-foreground">{val}</span>
              ))}
              <button
                onClick={(e) => { e.stopPropagation(); onToggleIndicatorSettings(m.instanceId); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity"
                title="Settings"
              >
                <Settings2 className="h-2.5 w-2.5 text-muted-foreground" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onRemoveIndicator(m.instanceId); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity"
                title="Remove"
              >
                <X className="h-2.5 w-2.5 text-muted-foreground hover:text-red-500" />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function ToolbarButton({ children, onClick, title, active }: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active: boolean;
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
        active ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function MaximizeIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 2h4M2 2v4M14 2h-4M14 2v4M2 14h4M2 14v-4M14 14h-4M14 14v-4" />
    </svg>
  );
}
