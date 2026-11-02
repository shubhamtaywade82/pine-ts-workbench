"use client";

import { Badge } from "@/components/ui/badge";
import type { BinanceSettings } from "@/components/trading/settings-dialog";

/**
 * Environment banner (P0 live-safety). A permanent, color-coded strip that
 * tells the user exactly which environment their orders target:
 *
 *  - DRY-RUN (grey):    no keys configured — every order path refuses to send
 *  - PAPER (blue):      keys set, live trading off — orders are simulated
 *  - MAINNET (red):     keys set, live trading ON — real funds at risk
 *
 * Testnet arrives with the broker adapter for it; the banner already knows
 * the vocabulary so adding it is a one-line change.
 */

export type TradingEnvironment = "dry-run" | "paper" | "mainnet";

export const environmentOf = (settings: BinanceSettings): TradingEnvironment => {
  if (settings.apiKey === "" || settings.apiSecret === "") return "dry-run";
  return settings.liveTradeEnabled ? "mainnet" : "paper";
};

const STYLES: Record<TradingEnvironment, { label: string; className: string; hint: string }> = {
  "dry-run": {
    label: "DRY-RUN",
    className: "bg-muted text-muted-foreground border-border",
    hint: "No API keys — orders cannot be sent",
  },
  paper: {
    label: "PAPER",
    className: "bg-blue-500/15 text-blue-400 border-blue-500/40",
    hint: "Live trading disabled — orders are simulated",
  },
  mainnet: {
    label: "MAINNET",
    className: "bg-red-500/15 text-red-500 border-red-500/50 animate-pulse",
    hint: "Live trading ON — real funds at risk",
  },
};

export function EnvironmentBanner({ environment }: { readonly environment: TradingEnvironment }) {
  const style = STYLES[environment];
  return (
    <Badge
      variant="outline"
      className={`h-6 shrink-0 px-2 text-[10px] font-bold tracking-wider ${style.className}`}
      title={style.hint}
    >
      {style.label}
    </Badge>
  );
}
