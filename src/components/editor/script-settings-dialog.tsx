"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { InputConfig, StrategyOptions } from "@nemesis-oss/pine-ts";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EMPTY_SETTINGS, type InputValue, type ScriptKind, type ScriptSettings } from "@/lib/script-library";
import { INTERVAL_LABELS, SUPPORTED_INTERVALS, type ChartInterval } from "@/lib/public-binance-feed";

type Tab = "inputs" | "properties" | "style" | "visibility";

export interface ScriptSettingsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly kind: ScriptKind;
  /** Inputs the script declared on its last run (defaults come from here). */
  readonly declaredInputs: readonly InputConfig[];
  /** The strategy's own `defineStrategy()` options: the Properties tab's defaults. */
  readonly declaration: StrategyOptions;
  readonly plots: readonly { id: string; color: string }[];
  readonly settings: ScriptSettings;
  readonly onApply: (settings: ScriptSettings) => void;
}

/** TradingView's indicator/strategy settings dialog: Inputs, Properties, Style, Visibility; Ok applies. */
export function ScriptSettingsDialog(props: ScriptSettingsDialogProps) {
  const { open, onOpenChange, title, kind, settings, onApply } = props;
  const tabs: readonly (readonly [Tab, string])[] = kind === "strategy"
    ? [["inputs", "Inputs"], ["properties", "Properties"], ["style", "Style"], ["visibility", "Visibility"]]
    : [["inputs", "Inputs"], ["style", "Style"], ["visibility", "Visibility"]];
  const [tab, setTab] = useState<Tab>("inputs");
  const [draft, setDraft] = useState(settings);
  useEffect(() => { if (open) { setDraft(settings); setTab("inputs"); } }, [open, settings]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-lg">
        <DialogTitle className="px-5 pt-5 pb-2 text-lg">{title}</DialogTitle>
        <div className="flex gap-4 border-b border-border px-5">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)}
              className={`border-b-2 py-2 text-sm font-semibold ${tab === id ? "border-foreground" : "border-transparent text-muted-foreground"}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="min-h-[280px] flex-1 overflow-y-auto px-5 py-4">
          {tab === "inputs" && <InputsTab {...props} draft={draft} onChange={setDraft} />}
          {tab === "properties" && <PropertiesTab {...props} draft={draft} onChange={setDraft} />}
          {tab === "style" && <StyleTab {...props} draft={draft} onChange={setDraft} />}
          {tab === "visibility" && <VisibilityTab draft={draft} onChange={setDraft} />}
        </div>
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <Button variant="outline" size="sm" onClick={() => setDraft(EMPTY_SETTINGS)}>Defaults</Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={() => { onApply(draft); onOpenChange(false); }}>Ok</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface TabProps {
  readonly draft: ScriptSettings;
  readonly onChange: (settings: ScriptSettings) => void;
}

function InputsTab({ declaredInputs, draft, onChange }: ScriptSettingsDialogProps & TabProps) {
  if (declaredInputs.length === 0) return <p className="text-sm text-muted-foreground">This script declares no inputs.</p>;
  const set = (title: string, value: InputValue) => onChange({ ...draft, inputs: { ...draft.inputs, [title]: value } });
  const groups = Map.groupBy(declaredInputs, (input) => input.group ?? "");
  return (
    <div className="flex flex-col gap-3">
      {[...groups].map(([group, inputs]) => (
        <div key={group} className="flex flex-col gap-3">
          {group !== "" && <h4 className="pt-2 text-[11px] font-semibold uppercase text-muted-foreground">{group}</h4>}
          {inputs.map((input) => (
            <InputRow key={input.name} input={input} value={draft.inputs[input.name] ?? (input.defaultValue as InputValue)} onChange={(v) => set(input.name, v)} />
          ))}
        </div>
      ))}
    </div>
  );
}

function InputRow({ input, value, onChange }: { input: InputConfig; value: InputValue; onChange: (value: InputValue) => void }) {
  const label = input.displayName ?? input.name;
  if (input.kind === "bool") {
    return <label className="flex items-center gap-2 text-sm"><Checkbox checked={value === true} onCheckedChange={(c) => onChange(c === true)} />{label}</label>;
  }
  const options = "options" in input ? (input.options as readonly string[] | undefined) : undefined;
  return (
    <Row label={label}>
      {options !== undefined ? (
        <select className={FIELD} value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : input.kind === "int" || input.kind === "float" ? (
        <input type="number" className={FIELD} value={Number(value)} step={input.kind === "int" ? 1 : "any"}
          onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(n); }} />
      ) : (
        <input className={FIELD} value={String(value)} onChange={(e) => onChange(e.target.value)} />
      )}
    </Row>
  );
}

type NumericProperty = "initial_capital" | "default_qty_value" | "pyramiding" | "commission_value" | "slippage" | "margin_long" | "margin_short";

const NUMERIC_PROPERTIES: readonly (readonly [NumericProperty, string, string?])[] = [
  ["initial_capital", "Initial capital", "USD"],
  ["default_qty_value", "Default order size"],
  ["pyramiding", "Pyramiding"],
  ["commission_value", "Commission"],
  ["slippage", "Slippage", "ticks"],
  ["margin_long", "Margin for long positions", "%"],
  ["margin_short", "Margin for short positions", "%"],
];

function PropertiesTab({ declaration, draft, onChange }: ScriptSettingsDialogProps & TabProps) {
  const merged = { ...declaration, ...draft.properties };
  const set = (patch: StrategyOptions) => onChange({ ...draft, properties: { ...draft.properties, ...patch } });
  return (
    <div className="flex flex-col gap-3">
      {NUMERIC_PROPERTIES.map(([key, label, unit]) => (
        <Row key={key} label={label}>
          <input type="number" className={FIELD} value={merged[key] ?? ""} placeholder="default"
            onChange={(e) => { const n = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(n)) set({ [key]: n }); }} />
          {key === "default_qty_value" && (
            <select className={FIELD} value={merged.default_qty_type ?? "fixed"} onChange={(e) => set({ default_qty_type: e.target.value as StrategyOptions["default_qty_type"] })}>
              <option value="fixed">Contracts</option>
              <option value="cash">Cash</option>
              <option value="percent_of_equity">% of equity</option>
            </select>
          )}
          {key === "commission_value" && (
            <select className={FIELD} value={merged.commission_type ?? "percent"} onChange={(e) => set({ commission_type: e.target.value as StrategyOptions["commission_type"] })}>
              <option value="percent">Percent</option>
              <option value="cash">Cash per order</option>
            </select>
          )}
          {unit !== undefined && <span className="text-sm text-muted-foreground">{unit}</span>}
        </Row>
      ))}
    </div>
  );
}

function StyleTab({ plots, draft, onChange }: ScriptSettingsDialogProps & TabProps) {
  if (plots.length === 0) return <p className="text-sm text-muted-foreground">This script has no plots.</p>;
  const set = (id: string, patch: { color?: string; isHidden?: boolean }) =>
    onChange({ ...draft, plotStyles: { ...draft.plotStyles, [id]: { ...draft.plotStyles[id], ...patch } } });
  return (
    <div className="flex flex-col gap-3">
      {plots.map((plot) => {
        const style = draft.plotStyles[plot.id] ?? {};
        return (
          <div key={plot.id} className="flex items-center gap-3 text-sm">
            <Checkbox checked={style.isHidden !== true} onCheckedChange={(c) => set(plot.id, { isHidden: c !== true })} />
            <span className="flex-1">{plot.id}</span>
            <input type="color" value={style.color ?? plot.color} onChange={(e) => set(plot.id, { color: e.target.value })}
              className="h-8 w-8 cursor-pointer rounded border border-border bg-transparent p-0.5" />
          </div>
        );
      })}
    </div>
  );
}

function VisibilityTab({ draft, onChange }: TabProps) {
  const visible = new Set(draft.visibleIntervals ?? SUPPORTED_INTERVALS);
  const toggle = (interval: ChartInterval, isOn: boolean) => {
    const next = SUPPORTED_INTERVALS.filter((i) => (i === interval ? isOn : visible.has(i)));
    onChange({ ...draft, visibleIntervals: next.length === SUPPORTED_INTERVALS.length ? undefined : next });
  };
  return (
    <div className="grid grid-cols-3 gap-3">
      {SUPPORTED_INTERVALS.map((interval) => (
        <label key={interval} className="flex items-center gap-2 text-sm">
          <Checkbox checked={visible.has(interval)} onCheckedChange={(c) => toggle(interval, c === true)} />{INTERVAL_LABELS[interval]}
        </label>
      ))}
    </div>
  );
}

const FIELD = "h-8 min-w-0 flex-1 rounded border border-border bg-background px-2 text-sm";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_1fr] items-center gap-3 text-sm">
      <span>{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
