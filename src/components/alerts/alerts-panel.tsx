"use client";

import { useCallback, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Trash2, Plus, Bell, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import {
  CONDITION_LABELS, MAX_CONDITIONS_PER_RULE, rearmRules,
  type AlertCondition, type AlertConditionKind, type AlertRule, type FiredAlert,
} from "@/lib/alert-engine";

export interface AlertsPanelProps {
  /** The currently-configured alert rules. */
  readonly rules: AlertRule[];
  /** Called when a rule is added/removed/toggled/edited. */
  readonly onRulesChange: (rules: AlertRule[]) => void;
  /** Fired alerts (most recent first). */
  readonly firedAlerts: readonly FiredAlert[];
  /** The current symbol (prefilled in new rules). */
  readonly symbol: string;
}

/** Condition kinds that take no threshold input. */
const NO_THRESHOLD: ReadonlySet<AlertConditionKind> = new Set([
  "price_above_sma", "price_below_sma", "volume_above_sma", "script_alert",
]);

const DEFAULT_THRESHOLDS: Partial<Record<AlertConditionKind, number>> = {
  rsi_above: 70,
  rsi_below: 30,
  price_above: 0,
  price_below: 0,
  macd_hist_above: 0,
  macd_hist_below: 0,
  volume_above_sma: 100,
  percent_change_above: 5,
  percent_change_below: -5,
};

export function AlertsPanel({
  rules, onRulesChange, firedAlerts, symbol,
}: AlertsPanelProps) {
  const [newName, setNewName] = useState("");
  const [newSymbol, setNewSymbol] = useState<string>(symbol);
  const [newConditions, setNewConditions] = useState<AlertCondition[]>([
    { kind: "rsi_above", threshold: 70 },
  ]);

  const setCondition = useCallback((index: number, patch: Partial<AlertCondition>) => {
    setNewConditions((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }, []);

  const addCondition = useCallback(() => {
    if (newConditions.length >= MAX_CONDITIONS_PER_RULE) return;
    setNewConditions((prev) => [...prev, { kind: "price_above", threshold: 0 }]);
  }, [newConditions.length]);

  const removeCondition = useCallback((index: number) => {
    setNewConditions((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }, []);

  const addRule = useCallback(() => {
    const conditions = newConditions
      .filter((c) => NO_THRESHOLD.has(c.kind) || Number.isFinite(c.threshold))
      .slice(0, MAX_CONDITIONS_PER_RULE);
    if (conditions.length === 0) return;
    const rule: AlertRule = {
      id: `rule-${Date.now()}`,
      name: newName.trim() || `${symbol} ${conditions.map((c) => CONDITION_LABELS[c.kind]).join(" + ")}`.slice(0, 60),
      symbol: newSymbol.trim().toUpperCase() || symbol,
      conditions,
      enabled: true,
    };
    rearmRules();
    onRulesChange([...rules, rule]);
    setNewName("");
    setNewConditions([{ kind: "rsi_above", threshold: 70 }]);
  }, [rules, newName, newSymbol, newConditions, symbol, onRulesChange]);

  const removeRule = useCallback((id: string) => {
    rearmRules();
    onRulesChange(rules.filter((r) => r.id !== id));
  }, [rules, onRulesChange]);

  const toggleRule = useCallback((id: string) => {
    rearmRules();
    onRulesChange(rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  }, [rules, onRulesChange]);

  const watchlistRules = useMemo(() => rules.filter((r) => r.symbol === "*").length, [rules]);

  return (
    <div className="flex flex-col gap-4 p-3">
      {/* Alert rules */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2"><Bell className="h-4 w-4" /> Alert Rules ({rules.length})</span>
            {watchlistRules > 0 && (
              <Badge variant="secondary" className="text-[10px]">{watchlistRules} watchlist</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/* Add new rule — TradingView-style condition builder */}
          <div className="flex flex-col gap-2 rounded border border-border/50 p-2">
            <div className="flex items-end gap-2">
              <div className="flex flex-col gap-1 flex-1">
                <Label className="text-xs text-muted-foreground">Name</Label>
                <Input value={newName} placeholder="e.g. BTC overbought"
                  onChange={(e) => setNewName(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="flex flex-col gap-1 w-28">
                <Label className="text-xs text-muted-foreground">Symbol</Label>
                <Input value={newSymbol} placeholder={symbol}
                  onChange={(e) => setNewSymbol(e.target.value)} className="h-8 text-xs font-mono" />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Enter <span className="font-mono">*</span> as the symbol to alert on every watchlist symbol.
            </p>
            {newConditions.map((condition, index) => (
              <div key={index} className="flex items-end gap-2">
                {index > 0 && <span className="pb-2 text-[10px] font-semibold uppercase text-muted-foreground">and</span>}
                <div className="flex flex-col gap-1 flex-1">
                  {index === 0 && <Label className="text-xs text-muted-foreground">Condition</Label>}
                  <Select
                    value={condition.kind}
                    onValueChange={(v) => {
                      const kind = v as AlertConditionKind;
                      setCondition(index, { kind, threshold: DEFAULT_THRESHOLDS[kind] ?? 0 });
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(CONDITION_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {!NO_THRESHOLD.has(condition.kind) && (
                  <div className="flex flex-col gap-1 w-20">
                    {index === 0 && <Label className="text-xs text-muted-foreground">Value</Label>}
                    <Input type="number" step="any" value={condition.threshold}
                      onChange={(e) => setCondition(index, { threshold: Number(e.target.value) })}
                      className="h-8 text-xs font-mono" />
                  </div>
                )}
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Remove condition"
                  disabled={newConditions.length <= 1} onClick={() => removeCondition(index)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={addCondition}
                disabled={newConditions.length >= MAX_CONDITIONS_PER_RULE}>
                <Plus className="h-3 w-3" /> Add condition ({newConditions.length}/{MAX_CONDITIONS_PER_RULE})
              </Button>
              <Button size="sm" onClick={addRule}>Create alert</Button>
            </div>
          </div>

          {/* Existing rules */}
          {rules.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No rules yet. Alerts are open-ended: they stay active until you delete them.
            </p>
          ) : (
            rules.map((rule) => (
              <div key={rule.id} className="flex items-start justify-between rounded border border-border/50 p-2">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Switch checked={rule.enabled} onCheckedChange={() => toggleRule(rule.id)} />
                    <span className="text-xs font-medium">{rule.name}</span>
                    <Badge variant="outline" className="text-[9px] font-mono">{rule.symbol}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-1 pl-6">
                    {rule.conditions.map((c, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 && <span className="text-[9px] uppercase text-muted-foreground">and</span>}
                        <Badge variant="secondary" className="text-[9px]">
                          {CONDITION_LABELS[c.kind]}
                          {!NO_THRESHOLD.has(c.kind) && ` ${c.threshold}`}
                        </Badge>
                      </span>
                    ))}
                  </div>
                  {rule.lastFiredAt && (
                    <span className="pl-6 text-[9px] text-muted-foreground">
                      Last fired {new Date(rule.lastFiredAt).toLocaleString()}
                    </span>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={() => removeRule(rule.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Fired alerts */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Bell className="h-4 w-4" /> Fired Alerts ({firedAlerts.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 max-h-96 overflow-y-auto">
          {firedAlerts.length === 0 ? (
            <p className="text-xs text-muted-foreground">No alerts fired yet.</p>
          ) : (
            firedAlerts.map((fa) => (
              <div key={fa.event.id} className="rounded border border-border/50 p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium">{fa.event.symbol}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(fa.event.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mb-1">{fa.event.message}</p>
                <div className="flex flex-col gap-0.5">
                  {fa.deliveries.map((d) => (
                    <div key={d.sinkId} className="flex items-center gap-1 text-[10px]">
                      {d.status === "delivered" ? <CheckCircle2 className="h-3 w-3 text-green-500" />
                       : d.status === "failed" ? <XCircle className="h-3 w-3 text-red-500" />
                       : <MinusCircle className="h-3 w-3 text-gray-500" />}
                      <span className="text-muted-foreground">{d.sinkName}:</span>
                      <span className={d.status === "delivered" ? "text-green-600" : d.status === "failed" ? "text-red-600" : "text-muted-foreground"}>
                        {d.message}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
