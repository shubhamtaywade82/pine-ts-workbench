"use client";

import { useEffect, useRef } from "react";
import { loadSettings as loadBinanceSettings } from "@/components/trading/settings-dialog";
import { toast } from "@/hooks/use-toast";
import { buildNotificationSinks, dispatchScriptAlerts, loadAlertSettings } from "@/lib/alert-sinks";
import { hudReason, type LongOptionFilter } from "@/lib/option-filter";
import type { SymbolOption } from "@/lib/symbol-catalog";
import { INITIAL_VERDICT_STATE, nextVerdictState } from "@/lib/verdict-alerts";

/** Where a verdict change is announced: nowhere, in the app only, or in the app and the user's alert channels too. */
export type VerdictAlertMode = "off" | "toast" | "all";

const announce = (symbol: SymbolOption, filter: LongOptionFilter, mode: VerdictAlertMode): void => {
  const reason = hudReason(filter);
  toast({ title: `[${symbol.displayName}] ${filter.label}`, description: reason });
  if (mode !== "all") return;
  // A verdict is information: these channels never include the broker sink, which places orders.
  const sinks = buildNotificationSinks(loadAlertSettings(), loadBinanceSettings());
  void dispatchScriptAlerts([{ message: `${filter.label}${reason === undefined ? "" : `: ${reason}`}` }], sinks, symbol.displayName);
};

/**
 * Announces a change in the long-option verdict. It runs once per new chain reading (`readingCount`), not on
 * every render or bar tick, so it adds no polling and almost no work: a comparison and, rarely, a message.
 */
export function useVerdictAlerts(symbol: SymbolOption, filter: LongOptionFilter | undefined, mode: VerdictAlertMode, readingCount: number, isReady: boolean): void {
  const state = useRef(INITIAL_VERDICT_STATE);
  const latest = useRef(filter);
  useEffect(() => { latest.current = filter; });
  // A different instrument starts a new baseline: switching charts must not read as a verdict change.
  useEffect(() => { state.current = INITIAL_VERDICT_STATE; }, [symbol.ticker]);

  useEffect(() => {
    const current = latest.current;
    // Until every input has loaded the verdict is provisional: comparing it would announce the loading itself.
    if (mode === "off" || current === undefined || !isReady) return;
    const step = nextVerdictState(state.current, current.side, Date.now());
    state.current = step.state;
    if (step.alert !== undefined) announce(symbol, current, mode);
  }, [readingCount, mode, symbol, isReady]);
}
