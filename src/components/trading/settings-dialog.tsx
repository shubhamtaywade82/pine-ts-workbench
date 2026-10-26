"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Settings } from "lucide-react";

/**
 * Settings storage — API keys + liveTradeEnabled are stored
 * in localStorage. NEVER sent to a server. The user's browser owns them.
 *
 * Security: recommend API key permissions "Spot Trading + Read" only;
 * never enable withdrawals. The Settings dialog shows this warning.
 */

const STORAGE_KEY = "pine-ts-workbench-binance-settings";

export interface BinanceSettings {
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly liveTradeEnabled: boolean;
}

export const DEFAULT_SETTINGS: BinanceSettings = {
  apiKey: "",
  apiSecret: "",
  liveTradeEnabled: false,
};

/** Reads the stored settings from localStorage (client-only). */
export const loadSettings = (): BinanceSettings => {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<BinanceSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

/** Writes settings to localStorage (client-only). */
export const saveSettings = (settings: BinanceSettings): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage may be unavailable (private browsing, quota).
  }
};

export function SettingsDialog({ onSaved }: { onSaved: (s: BinanceSettings) => void }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<BinanceSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  const onSave = () => {
    saveSettings(settings);
    onSaved(settings);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Settings">
          <Settings className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Binance Trading Settings</DialogTitle>
          <DialogDescription>
            Configure API credentials for live order submission. Keys are stored in your
            browser&apos;s localStorage — never sent to a server.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="apiKey">API Key</Label>
            <Input
              id="apiKey"
              type="password"
              value={settings.apiKey}
              onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
              placeholder="Your Binance API key"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="apiSecret">API Secret</Label>
            <Input
              id="apiSecret"
              type="password"
              value={settings.apiSecret}
              onChange={(e) => setSettings({ ...settings, apiSecret: e.target.value })}
              placeholder="Your Binance API secret"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <Label htmlFor="liveTrade">Enable Live Trading</Label>
              <span className="text-xs text-muted-foreground">
                {settings.liveTradeEnabled
                  ? "⚠ Orders will be submitted to Binance mainnet (real funds)"
                  : "Dry-run mode (no real orders)"}
              </span>
            </div>
            <Switch
              id="liveTrade"
              checked={settings.liveTradeEnabled}
              onCheckedChange={(checked) => setSettings({ ...settings, liveTradeEnabled: checked })}
            />
          </div>

          <div className="flex items-center gap-2 rounded border border-yellow-500/30 bg-yellow-500/10 p-2">
            <Badge variant="outline" className="border-yellow-500/50 text-yellow-600 text-[10px]">
              ⚠ Security
            </Badge>
            <span className="text-xs text-muted-foreground">
              Recommend API key permissions: Spot Trading + Read only.
              Never enable withdrawals. Only use on a trusted device.
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={onSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
