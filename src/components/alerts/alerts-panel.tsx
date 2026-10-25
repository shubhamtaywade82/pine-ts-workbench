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
import type {
  AlertRule, AlertCondition, FiredAlert, AlertSettings,
} from "@/lib/alert-sinks";

export interface AlertsPanelProps {
  /** The currently-configured alert rules. */
  readonly rules: AlertRule[];
  /** Called when a rule is added/removed/toggled. */
  readonly onRulesChange: (rules: AlertRule[]) => void;
  /** Fired alerts (most recent first). */
  readonly firedAlerts: readonly FiredAlert[];
  /** Current alert settings (for showing what's configured). */
  readonly alertSettings: AlertSettings;
  /** The current symbol (prefilled in new rules). */
  readonly symbol: string;
}

const CONDITION_LABELS: Record<AlertCondition, string> = {
  rsi_above: "RSI crosses above",
  rsi_below: "RSI crosses below",
  price_above_sma: "Price above SMA",
  price_below_sma: "Price below SMA",
  macd_hist_positive: "MACD histogram >",
  macd_hist_negative: "MACD histogram <",
};

export function AlertsPanel({
  rules, onRulesChange, firedAlerts, alertSettings, symbol,
}: AlertsPanelProps) {
  const [newCondition, setNewCondition] = useState<AlertCondition>("rsi_above");
  const [newThreshold, setNewThreshold] = useState("70");

  const addRule = useCallback(() => {
    const rule: AlertRule = {
      id: `rule-${Date.now()}`,
      condition: newCondition,
      threshold: Number(newThreshold),
      enabled: true,
    };
    onRulesChange([...rules, rule]);
  }, [rules, newCondition, newThreshold, onRulesChange]);

  const removeRule = useCallback((id: string) => {
    onRulesChange(rules.filter((r) => r.id !== id));
  }, [rules, onRulesChange]);

  const toggleRule = useCallback((id: string) => {
    onRulesChange(rules.map((r) => r.id === id ? { ...r, enabled: !r.enabled } : r));
  }, [rules, onRulesChange]);

  // Show what sinks are configured.
  const configuredSinks = useMemo(() => {
    const sinks: string[] = [];
    if (alertSettings.webhookUrl) sinks.push("Webhook");
    if (alertSettings.telegramBotToken && alertSettings.telegramChatId) sinks.push("Telegram");
    if (alertSettings.emailWebhookUrl && alertSettings.emailRecipient) sinks.push("Email");
    if (alertSettings.brokerActionEnabled) sinks.push("Broker Action");
    return sinks;
  }, [alertSettings]);

  return (
    <div className="flex flex-col gap-4 p-3">
      {/* Configured sinks summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Delivery Channels</CardTitle>
        </CardHeader>
        <CardContent>
          {configuredSinks.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No delivery channels configured. Click the Alerts button in the header to configure.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {configuredSinks.map((s) => (
                <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Alert rules */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Alert Rules ({rules.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/* Add new rule */}
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1 flex-1">
              <Label className="text-xs text-muted-foreground">Condition</Label>
              <Select value={newCondition} onValueChange={(v) => setNewCondition(v as AlertCondition)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CONDITION_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1 w-20">
              <Label className="text-xs text-muted-foreground">Threshold</Label>
              <Input type="number" step="0.1" value={newThreshold}
                onChange={(e) => setNewThreshold(e.target.value)} className="h-8 text-xs" />
            </div>
            <Button size="sm" onClick={addRule}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {/* Existing rules */}
          {rules.length === 0 ? (
            <p className="text-xs text-muted-foreground">No rules yet. Add one above.</p>
          ) : (
            rules.map((rule) => (
              <div key={rule.id} className="flex items-center justify-between rounded border border-border/50 p-2">
                <div className="flex items-center gap-2">
                  <Switch checked={rule.enabled} onCheckedChange={() => toggleRule(rule.id)} />
                  <span className="text-xs">
                    {CONDITION_LABELS[rule.condition]} <span className="font-mono">{rule.threshold}</span>
                  </span>
                  {rule.actionSide && (
                    <Badge variant="destructive" className="text-[10px]">
                      {rule.actionSide} {rule.actionQty}
                    </Badge>
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
