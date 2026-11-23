"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  loadAlertSettings, normalizeOrderGuard, saveAlertSettings, testTelegram,
  type AlertSettings, DEFAULT_ALERT_SETTINGS,
} from "@/lib/alert-sinks";
import { loadGuardState, saveGuardState } from "@/lib/alert-sink-transports";
import { ARM_PHRASE, arm, disarm, type GuardState, type OrderGuardLimits } from "@/lib/order-guard";
import { AlarmClockPlus, Sparkles, Send, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const LIMIT_FIELDS = [
  { key: "maxOrderNotional", label: "Max per order (USDT)" },
  { key: "maxOrdersPerHour", label: "Max orders / hour" },
  { key: "maxDailyNotional", label: "Max per 24 h (USDT)" },
] as const;

/** Arm/disarm and caps for alert-placed orders. Arming saves at once: it is a deliberate act, not a draft setting. */
function OrderGuardControls({ limits, onLimitsChange }: {
  readonly limits: OrderGuardLimits;
  readonly onLimitsChange: (limits: OrderGuardLimits) => void;
}) {
  const [guard, setGuard] = useState<GuardState>(() => loadGuardState());
  const [phrase, setPhrase] = useState("");
  const isArmed = guard.armedUntil !== null && guard.armedUntil > Date.now();
  const apply = (next: GuardState) => { saveGuardState(next); setGuard(next); setPhrase(""); };

  return (
    <div className="flex flex-col gap-2 rounded border border-amber-500/40 p-2">
      <div className="flex items-center justify-between text-xs">
        <span className={isArmed ? "text-red-500 font-medium" : "text-muted-foreground"}>
          {isArmed ? `LIVE orders armed until ${new Date(guard.armedUntil ?? 0).toLocaleString()}` : "Alert orders disarmed: nothing is sent"}
        </span>
        {isArmed && <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => apply(disarm(guard))}>Disarm</Button>}
      </div>
      {!isArmed && (
        <div className="flex gap-2">
          <Input value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder={`Type ${ARM_PHRASE}`} className="h-7 text-xs" />
          <Button variant="destructive" size="sm" className="h-7 text-xs" disabled={phrase !== ARM_PHRASE}
            onClick={() => apply(arm(guard, { now: Date.now(), phrase, limits }))}>Arm</Button>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        {LIMIT_FIELDS.map(({ key, label }) => (
          <div key={key} className="flex flex-col gap-1">
            <Label className="text-[10px]">{label}</Label>
            <Input type="number" min="0" value={limits[key]} onChange={(e) => onLimitsChange({ ...limits, [key]: Number(e.target.value) })} className="h-7 text-xs" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-[10px]">Allowed symbols (comma separated)</Label>
        <Input value={limits.allowedSymbols.join(",")} onChange={(e) => onLimitsChange({ ...limits, allowedSymbols: e.target.value.split(",") })} className="h-7 text-xs" />
      </div>
    </div>
  );
}

export function AlertSettingsDialog({ onSaved }: { onSaved: (s: AlertSettings) => void }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<AlertSettings>(DEFAULT_ALERT_SETTINGS);
  const [models, setModels] = useState<string[]>(["tev1:4b", "tev1:0.8b"]);
  const [testingTg, setTestingTg] = useState(false);

  // Sync settings whenever dialog opens so fresh localStorage values are always shown
  useEffect(() => {
    if (!open) return;
    setSettings(loadAlertSettings());
    fetch("/api/ai/decisions")
      .then((r) => r.json())
      .then((d) => { if (d.ok && Array.isArray(d.models)) setModels(d.models); })
      .catch(() => {});
  }, [open]);

  const handleTestTg = async () => {
    if (!settings.telegramBotToken || !settings.telegramChatId) return;
    setTestingTg(true);
    const res = await testTelegram(settings.telegramBotToken, settings.telegramChatId);
    setTestingTg(false);
    toast({
      variant: res.ok ? "default" : "destructive",
      title: res.ok ? "Telegram Connected" : "Telegram Failed",
      description: res.message,
    });
  };

  const onSave = () => {
    const saved = { ...settings, orderGuard: normalizeOrderGuard(settings.orderGuard) };
    saveAlertSettings(saved);
    onSaved(saved);
    toast({ title: "Alert Settings Saved", description: "Telegram and alert delivery channels updated." });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 text-sm">
          <AlarmClockPlus className="h-4 w-4 mr-1" /> Alert
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col p-0">
        <div className="p-6 pb-2 shrink-0">
          <DialogHeader>
            <DialogTitle>Alert Delivery Settings</DialogTitle>
            <DialogDescription>
              Configure delivery channels for alert events. All fields stored in your browser&apos;s localStorage.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-2 flex flex-col gap-4">
          {/* Browser Notifications */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">Browser Notifications</Badge>
              <span className="text-xs text-muted-foreground">Desktop popups when alerts trigger</span>
            </div>
            <Switch
              checked={settings.browserNotificationsEnabled}
              onCheckedChange={(v) => {
                if (v && typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
                  void Notification.requestPermission();
                }
                setSettings({ ...settings, browserNotificationsEnabled: v });
              }}
            />
          </div>

          {/* AI Smart Filter */}
          <div className="flex flex-col gap-2 rounded border border-indigo-500/30 p-2.5 bg-indigo-500/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] border-indigo-400 text-indigo-400 flex items-center gap-1">
                  <Sparkles className="h-3 w-3" /> AI Smart Gate
                </Badge>
                <span className="text-xs text-muted-foreground">Filter noise & adverse regimes before dispatch</span>
              </div>
              <Switch
                checked={settings.aiFilterEnabled ?? false}
                onCheckedChange={(v) => setSettings({ ...settings, aiFilterEnabled: v })}
              />
            </div>
            {settings.aiFilterEnabled && (
              <div className="flex flex-col gap-2 pt-1 border-t border-indigo-500/20">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Decision Model</Label>
                  <Select value={settings.aiFilterModel || models[0] || "tev1:4b"} onValueChange={(v) => setSettings({ ...settings, aiFilterModel: v })}>
                    <SelectTrigger className="h-7 w-36 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{models.map((m) => (<SelectItem key={m} value={m}>{m}</SelectItem>))}</SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Minimum Confidence</Label>
                  <Select value={String(settings.aiFilterMinConfidence ?? 0.70)} onValueChange={(v) => setSettings({ ...settings, aiFilterMinConfidence: Number(v) })}>
                    <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0.6">60% (Relaxed)</SelectItem><SelectItem value="0.7">70% (Standard)</SelectItem>
                      <SelectItem value="0.8">80% (Strict)</SelectItem><SelectItem value="0.9">90% (Ultra)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>

          {/* Webhook */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">Webhook</Badge>
              <span className="text-xs text-muted-foreground">HTTP POST JSON</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="whUrl" className="text-xs">URL</Label>
                <Input id="whUrl" type="text" value={settings.webhookUrl} onChange={(e) => setSettings({ ...settings, webhookUrl: e.target.value })} placeholder="https://hooks.example.com/alert" className="h-8 text-xs" />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="whHeaders" className="text-xs">Headers (JSON, optional)</Label>
                <Input id="whHeaders" type="text" value={settings.webhookHeaders} onChange={(e) => setSettings({ ...settings, webhookHeaders: e.target.value })} placeholder='{"Authorization":"Bearer ..."}' className="h-8 text-xs" />
              </div>
            </div>
          </div>

          {/* Telegram */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">Telegram</Badge>
                <span className="text-xs text-muted-foreground">Bot API sendMessage</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 text-[10px] px-2"
                disabled={!settings.telegramBotToken || !settings.telegramChatId || testingTg}
                onClick={handleTestTg}
              >
                {testingTg ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Send className="h-3 w-3 mr-1" />}
                Test Send
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="tgToken" className="text-xs">Bot Token</Label>
                <Input id="tgToken" type="password" value={settings.telegramBotToken}
                  onChange={(e) => setSettings({ ...settings, telegramBotToken: e.target.value })}
                  placeholder="123456:ABC-DEF..." className="h-8 text-xs" />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="tgChat" className="text-xs">Chat ID</Label>
                <Input id="tgChat" type="text" value={settings.telegramChatId}
                  onChange={(e) => setSettings({ ...settings, telegramChatId: e.target.value })}
                  placeholder="-1001234567890" className="h-8 text-xs" />
              </div>
            </div>
          </div>

          {/* Email */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">Email</Badge>
              <span className="text-xs text-muted-foreground">Webhook-based (server-side sends)</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="emUrl" className="text-xs">Email Webhook URL</Label>
                <Input id="emUrl" type="text" value={settings.emailWebhookUrl}
                  onChange={(e) => setSettings({ ...settings, emailWebhookUrl: e.target.value })}
                  placeholder="https://api.resend.com/emails" className="h-8 text-xs" />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="emRec" className="text-xs">Recipient Email</Label>
                <Input id="emRec" type="email" value={settings.emailRecipient}
                  onChange={(e) => setSettings({ ...settings, emailRecipient: e.target.value })}
                  placeholder="you@example.com" className="h-8 text-xs" />
              </div>
            </div>
          </div>

          {/* Broker Action */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">Broker Action</Badge>
                <span className="text-xs text-muted-foreground">Place a Binance order on alert</span>
              </div>
              <Switch checked={settings.brokerActionEnabled}
                onCheckedChange={(v) => setSettings({ ...settings, brokerActionEnabled: v })} />
            </div>
            {settings.brokerActionEnabled && (
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Side</Label>
                  <Select value={settings.brokerActionSide} onValueChange={(v) => setSettings({ ...settings, brokerActionSide: v as "BUY" | "SELL" })}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="BUY">Buy</SelectItem><SelectItem value="SELL">Sell</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Quantity</Label>
                  <Input type="number" step="0.0001" min="0" value={settings.brokerActionQty}
                    onChange={(e) => setSettings({ ...settings, brokerActionQty: Number(e.target.value) })} className="h-7 text-xs" />
                </div>
              </div>
            )}
            {settings.brokerActionEnabled && (
              <OrderGuardControls
                limits={settings.orderGuard}
                onLimitsChange={(orderGuard) => setSettings({ ...settings, orderGuard })}
              />
            )}
          </div>
        </div>

        <div className="p-4 border-t shrink-0 bg-muted/20">
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={onSave}>Save</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
