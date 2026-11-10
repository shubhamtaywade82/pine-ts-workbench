"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { ChartSettings, DepthWallStyle, FootprintMode } from "@/lib/chart-settings";
import { footprintSupported } from "@/lib/footprint";
import type { ChartInterval } from "@/lib/public-binance-feed";
import { WALL_WINDOW_LIMITS_PCT } from "@/lib/depth-walls";

const MODES: readonly (readonly [FootprintMode, string])[] = [
  ["delta", "Delta"],
  ["bid-ask", "Bid × ask"],
  ["total", "Total"],
];

type SettingsPatch = <K extends keyof ChartSettings>(section: K, values: Partial<ChartSettings[K]>) => void;

const WallSettings = ({ trading, quoteAsset, patch }: {
  trading: ChartSettings["trading"]; quoteAsset: string; patch: SettingsPatch;
}) => {
  const { wallWindowPct, minWallNotional, dom, heatmap } = trading;
  const patchDom = (values: Partial<typeof dom>) => patch("trading", { dom: { ...dom, ...values } });
  const patchHeat = (values: Partial<typeof heatmap>) => patch("trading", { heatmap: { ...heatmap, ...values } });
  return (
    <Group title="Order book walls">
      <Check label="Show the largest resting bid and ask" checked={trading.showOrderBookWalls} onChange={(showOrderBookWalls) => patch("trading", { showOrderBookWalls })} />
      <Row label="Display style">
        <select value={trading.depthWallStyle} onChange={(e) => patch("trading", { depthWallStyle: e.target.value as DepthWallStyle })} className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground focus:outline-none">
          <option value="shelf">Horizontal Shelf & Ray</option><option value="dom">Right-Margin DOM Shelf</option><option value="bracket">Micro-DOM Bracket</option><option value="bubbles">Floating Bubbles</option>
        </select>
      </Row>
      <Row label="Search window (±)"><ValidatedNumber value={wallWindowPct} min={WALL_WINDOW_LIMITS_PCT.min} max={WALL_WINDOW_LIMITS_PCT.max} unit="%" onChange={(next) => patch("trading", { wallWindowPct: next })} /></Row>
      <Row label="Minimum wall size"><ValidatedNumber value={minWallNotional} min={0} max={1_000_000_000} unit={quoteAsset} onChange={(next) => patch("trading", { minWallNotional: next })} /></Row>
      <Check label="DOM ladder" checked={dom.enabled} onChange={(enabled) => patchDom({ enabled })} />
      <Row label="Bucket size"><ValidatedNumber integer value={dom.bucketTicks} min={1} max={10_000} unit="ticks" onChange={(bucketTicks) => patchDom({ bucketTicks })} /></Row>
      <Row label="Visible buckets"><ValidatedNumber integer value={dom.visibleBuckets} min={5} max={200} unit="rows" onChange={(visibleBuckets) => patchDom({ visibleBuckets })} /></Row>
      <Row label="Top walls"><ValidatedNumber integer value={trading.wallTopN} min={1} max={20} unit="levels" onChange={(wallTopN) => patch("trading", { wallTopN })} /></Row>
      <Check label="Liquidity heatmap" checked={heatmap.enabled} onChange={(enabled) => patchHeat({ enabled })} />
      <Row label="Heatmap opacity"><ValidatedNumber value={heatmap.opacity} min={0.05} max={1} unit="" onChange={(opacity) => patchHeat({ opacity })} /></Row>
      <Row label="Heatmap history"><ValidatedNumber integer value={heatmap.minutes} min={1} max={60} unit="min" onChange={(minutes) => patchHeat({ minutes })} /></Row>
    </Group>
  );
};

const FootprintSettings = ({ trading, interval, patch }: {
  trading: ChartSettings["trading"]; interval: ChartInterval; patch: SettingsPatch;
}) => {
  const { footprint } = trading;
  const patchFoot = (values: Partial<typeof footprint>) => patch("trading", { footprint: { ...footprint, ...values } });
  return (
    <Group title="Footprint">
      <Check label="Footprint" checked={footprint.enabled} onChange={(enabled) => patchFoot({ enabled })} />
      {footprint.enabled && !footprintSupported(interval) && (
        <p className="text-xs text-muted-foreground">footprint: intraday and daily charts only</p>
      )}
      <Row label="Mode">
        <select value={footprint.mode} onChange={(e) => patchFoot({ mode: e.target.value as FootprintMode })} className="h-8 rounded border border-border bg-background px-2 text-xs">
          {MODES.map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}
        </select>
      </Row>
      <Row label="Bucket size"><ValidatedNumber integer value={footprint.bucketTicks} min={1} max={10_000} unit="ticks" onChange={(bucketTicks) => patchFoot({ bucketTicks })} /></Row>
    </Group>
  );
};

export function OrderFlowSettings({ trading, quoteAsset, patch }: {
  trading: ChartSettings["trading"]; quoteAsset: string; patch: SettingsPatch;
}) {
  return (
    <>
      <WallSettings trading={trading} quoteAsset={quoteAsset} patch={patch} />
      <FootprintSettings trading={trading} patch={patch} />
    </>
  );
}

export const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="flex flex-col gap-3 py-3">
    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
    {children}
  </div>
);

export const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid grid-cols-[160px_1fr] items-center gap-3 text-sm">
    <span>{label}</span><div className="flex items-center gap-2">{children}</div>
  </div>
);

export const Check = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <label className="flex items-center gap-2 text-sm">
    <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />{label}
  </label>
);

export function ValidatedNumber({ value, min, max, unit, integer = false, onChange }: {
  value: number; min: number; max: number; unit: string; integer?: boolean; onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [isValid, setIsValid] = useState(true);
  useEffect(() => { setText((c) => (Number(c) === value ? c : String(value))); setIsValid(true); }, [value]);
  const onType = (raw: string) => {
    setText(raw);
    const parsed = raw.trim() === "" ? Number.NaN : Number(raw);
    const valid = Number.isFinite(parsed) && parsed >= min && parsed <= max && (!integer || Number.isInteger(parsed));
    setIsValid(valid);
    if (valid) onChange(parsed);
  };
  const hint = integer ? `Enter a whole number from ${min} to ${max}` : `Enter a number from ${min} to ${max}`;
  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center gap-2">
        <input type="number" step={integer ? "1" : "any"} value={text} aria-invalid={!isValid}
          onChange={(e) => onType(e.target.value)} onBlur={() => { setText(String(value)); setIsValid(true); }}
          className={`h-8 w-24 rounded border bg-background px-2 text-sm ${isValid ? "border-border" : "border-red-500"}`} />
        <span className="text-sm text-muted-foreground">{unit}</span>
      </span>
      {!isValid && <span className="text-xs text-red-500">{hint}</span>}
    </span>
  );
}
