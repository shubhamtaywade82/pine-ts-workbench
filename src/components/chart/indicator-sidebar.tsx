"use client";

import { useCallback, useMemo, useState } from "react";
import { registry, type IndicatorMetadata, type InputsBag } from "@nemesis-oss/pine-ts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
}

export interface IndicatorSidebarProps {
  /** Currently mounted indicators (the parent owns state). */
  readonly mounted: readonly MountedIndicator[];
  /** Called when the user clicks "Add" on an indicator in the catalog. */
  readonly onAdd: (indicatorId: string) => void;
  /** Called when the user removes a mounted indicator. */
  readonly onRemove: (instanceId: string) => void;
  /** Called when the user changes an input value. */
  readonly onInputChange: (instanceId: string, inputName: string, value: number | string | boolean) => void;
}

/** Lists all available indicators + the mounted ones with config forms. */
export function IndicatorSidebar({ mounted, onAdd, onRemove, onInputChange }: IndicatorSidebarProps) {
  const catalog = useMemo(() => registry.list(), []);
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Indicator Catalog</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {catalog.map((meta) => (
            <IndicatorCatalogRow key={meta.id} meta={meta} onAdd={() => onAdd(meta.id)} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Mounted ({mounted.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {mounted.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No indicators mounted. Click an indicator above to add it.
            </p>
          ) : (
            mounted.map((m) => (
              <MountedIndicatorCard
                key={m.instanceId}
                mounted={m}
                meta={registry.metadata(m.indicatorId)}
                onRemove={() => onRemove(m.instanceId)}
                onInputChange={onInputChange}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function IndicatorCatalogRow({ meta, onAdd }: { meta: IndicatorMetadata; onAdd: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded border border-border/50 p-2">
      <div className="flex flex-col">
        <span className="text-sm font-medium">{meta.name}</span>
        <div className="flex items-center gap-1">
          <Badge variant="outline" className="text-[10px]">{meta.category}</Badge>
          {meta.overlay ? (
            <Badge variant="secondary" className="text-[10px]">overlay</Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px]">sub-pane</Badge>
          )}
        </div>
      </div>
      <Button size="sm" variant="default" onClick={onAdd}>Add</Button>
    </div>
  );
}

function MountedIndicatorCard({
  mounted,
  meta,
  onRemove,
  onInputChange,
}: {
  mounted: MountedIndicator;
  meta: IndicatorMetadata | undefined;
  onRemove: () => void;
  onInputChange: (instanceId: string, inputName: string, value: number | string | boolean) => void;
}) {
  if (meta === undefined) {
    return <div className="text-xs text-muted-foreground">Unknown indicator: {mounted.indicatorId}</div>;
  }
  return (
    <div className="flex flex-col gap-2 rounded border border-border/50 p-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{meta.name}</span>
        <Button size="sm" variant="ghost" onClick={onRemove}>×</Button>
      </div>
      {meta.inputs.length === 0 ? (
        <p className="text-xs text-muted-foreground">No inputs.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {meta.inputs.map((input) => (
            <InputField
              key={input.name}
              inputName={input.name}
              displayName={input.displayName ?? input.name}
              kind={input.kind}
              value={mounted.inputs[input.name]}
              options={input.kind === "string" || input.kind === "source" ? input.options : undefined}
              onChange={(v) => onInputChange(mounted.instanceId, input.name, v)}
            />
          ))}
        </div>
      )}
    </div>
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

/** Hook helper: produces a unique instance id per mount. */
let counter = 0;
export const nextInstanceId = (indicatorId: string): string => {
  counter += 1;
  return `${indicatorId}_${counter}`;
};
