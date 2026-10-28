"use client";


import { registry, type InputsBag } from "@nemesis-oss/pine-ts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Indicators on a chart, plus TradingView's two indicator dialogs: the
 * "Indicators" catalog (add) and an indicator's "Settings" (edit inputs).
 */

/**
 * An indicator instance mounted on the chart. `inputs` is the resolved
 * inputs bag (with defaults filled in); `instanceId` distinguishes multiple
 * instances of the same indicator.
 */
export interface MountedIndicator {
  readonly instanceId: string;
  readonly indicatorId: string;
  readonly indicatorName: string;
  readonly inputs: InputsBag;
  readonly pane: "main" | "sub";
  /** Hidden via the legend's eye icon: kept on the chart (and in the legend), not drawn. */
  readonly isHidden?: boolean;
  /** Set for a "My scripts" indicator: it runs that saved script instead of a registry indicator. */
  readonly scriptId?: string;
}

/** Unique instance id per mounted indicator. */
let counter = 0;
export const nextInstanceId = (indicatorId: string): string => {
  counter += 1;
  // Timestamp part: ids restored from a saved workspace were minted by an earlier page load.
  return `${indicatorId}_${Date.now().toString(36)}_${counter}`;
};

/** Price sources Pine offers for a `source` input when the indicator lists none. */
const PRICE_SOURCES = ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"] as const;

/** A new instance of a registered indicator with its default inputs, or undefined for an unknown id. */
export const createMountedIndicator = (indicatorId: string): MountedIndicator | undefined => {
  const meta = registry.metadata(indicatorId);
  if (meta === undefined) return undefined;
  const inputs: InputsBag = {};
  for (const input of meta.inputs) inputs[input.name] = input.defaultValue;
  return {
    instanceId: nextInstanceId(indicatorId),
    indicatorId,
    indicatorName: meta.name,
    inputs,
    pane: meta.overlay ? "main" : "sub",
  };
};

/** A saved indicator script on the chart; it runs with its declared input defaults. */
export const createScriptIndicator = (script: { id: string; name: string }, isOverlay: boolean): MountedIndicator => ({
  instanceId: nextInstanceId("script"),
  indicatorId: "script",
  indicatorName: script.name,
  inputs: {},
  pane: isOverlay ? "main" : "sub",
  scriptId: script.id,
});

/** TradingView-style legend label: short id then input values, e.g. "SMA close 20"; scripts show their name. */
export const indicatorLabel = (indicator: MountedIndicator): string =>
  indicator.scriptId !== undefined
    ? indicator.indicatorName
    : [indicator.indicatorId.toUpperCase(), ...Object.values(indicator.inputs).map(String)].join(" ");

/** An indicator's "Settings" dialog; edits apply live, like TradingView's inputs tab. */
export function IndicatorSettingsDialog({ indicator, onClose, onInputChange }: {
  indicator: MountedIndicator | undefined;
  onClose: () => void;
  onInputChange: (inputName: string, value: number | string | boolean) => void;
}) {
  const meta = indicator === undefined ? undefined : registry.metadata(indicator.indicatorId);
  return (
    <Dialog open={indicator !== undefined} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm gap-3">
        <DialogHeader>
          <DialogTitle>{meta?.name ?? "Settings"}</DialogTitle>
          <DialogDescription className="sr-only">
            Configure parameters and inputs for {meta?.name ?? "indicator"}.
          </DialogDescription>
        </DialogHeader>
        {meta === undefined || indicator === undefined ? null : meta.inputs.length === 0 ? (
          <p className="text-xs text-muted-foreground">This indicator has no inputs.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {meta.inputs.map((input) => (
              <InputField
                key={input.name}
                inputName={input.name}
                displayName={input.displayName ?? input.name}
                kind={input.kind}
                value={indicator.inputs[input.name]}
                options={input.kind === "source" ? (input.options ?? PRICE_SOURCES) : input.kind === "string" ? input.options : undefined}
                onChange={(v) => onInputChange(input.name, v)}
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InputField({
  inputName,
  displayName,
  kind,
  value,
  options,
  onChange,
}: {
  inputName: string;
  displayName: string;
  kind: string;
  value: unknown;
  options?: readonly string[];
  onChange: (value: number | string | boolean) => void;
}) {
  return (
    <div key={inputName} className="flex flex-col gap-1">
      <Label htmlFor={inputName} className="text-xs text-muted-foreground">{displayName}</Label>
      {kind === "int" || kind === "float" ? (
        <Input
          id={inputName}
          type="number"
          value={typeof value === "number" ? value : 0}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-8 text-xs"
        />
      ) : kind === "bool" ? (
        <Switch
          id={inputName}
          checked={typeof value === "boolean" ? value : false}
          onCheckedChange={onChange}
        />
      ) : (kind === "string" || kind === "source" || kind === "color" || kind === "timeframe") && options ? (
        <Select value={String(value)} onValueChange={onChange}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={inputName}
          type="text"
          value={typeof value === "string" ? value : String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 text-xs"
        />
      )}
    </div>
  );
}

