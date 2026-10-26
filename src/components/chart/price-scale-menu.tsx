"use client";

import { Settings } from "lucide-react";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChartSettings, ScaleMode } from "@/lib/chart-settings";

const MODES: readonly (readonly [ScaleMode, string])[] = [
  ["regular", "Regular"],
  ["percent", "Percent"],
  ["indexed", "Indexed to 100"],
  ["logarithmic", "Logarithmic"],
];

/** TradingView's price-scale gear menu: fit, invert, scale mode, last-price line, more settings. */
export function PriceScaleMenu({ settings, onChange, onMoreSettings }: {
  settings: ChartSettings;
  onChange: (settings: ChartSettings) => void;
  onMoreSettings: () => void;
}) {
  const { scales } = settings;
  const setScales = (patch: Partial<ChartSettings["scales"]>) => onChange({ ...settings, scales: { ...scales, ...patch } });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" title="Scale settings" className="rounded p-1 text-[#b2b5be] hover:bg-[#2a2e39]">
          <Settings className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-64">
        <DropdownMenuCheckboxItem checked={scales.autoScale} onCheckedChange={(autoScale) => setScales({ autoScale })}>
          Auto (fits data to screen)
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={scales.invert} onCheckedChange={(invert) => setScales({ invert })}>
          Invert scale
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {MODES.map(([mode, label]) => (
          <DropdownMenuCheckboxItem key={mode} checked={scales.mode === mode} onCheckedChange={() => setScales({ mode })}>
            {label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={scales.showLastPriceLine} onCheckedChange={(showLastPriceLine) => setScales({ showLastPriceLine })}>
          Last price line
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setScales({ placement: scales.placement === "right" ? "left" : "right" })}>
          Move scale to {scales.placement === "right" ? "left" : "right"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onMoreSettings}>
          <Settings className="h-4 w-4" /> More settings…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
