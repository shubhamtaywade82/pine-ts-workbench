"use client";

import { useCallback, useEffect, useState } from "react";
import {
  calculatePnlPercentage,
  extractRecords,
  normalizeCoindcxBalance,
  normalizeCoindcxPosition,
  type CoindcxBalance,
  type CoindcxOrder,
  type CoindcxPosition,
  type CoindcxUserInfo,
} from "@/lib/coindcx-client";
import {
  hasCoindcxCredentials,
  loadCoindcxSettings,
  SETTINGS_CHANGE_EVENT,
  type CoindcxSettings,
} from "@/lib/coindcx-settings";
import { connectCoindcxWs, connectLivePriceStream } from "@/lib/coindcx-ws";

export type CoindcxStreamStatus = "live" | "polling" | "connecting" | "disconnected" | "error";

export interface CoindcxPortfolioState {
  readonly settings: CoindcxSettings;
  readonly isConnected: boolean;
  readonly isLoading: boolean;
  readonly streamStatus: CoindcxStreamStatus;
  readonly error: string | null;
  readonly lastUpdated: number | null;
  readonly positions: readonly CoindcxPosition[];
  readonly balances: readonly CoindcxBalance[];
  readonly orders: readonly CoindcxOrder[];
  readonly orderHistory: readonly CoindcxOrder[];
  readonly userInfo: CoindcxUserInfo | null;
  readonly refresh: () => Promise<void>;
}

type SharedState = Omit<CoindcxPortfolioState, "isConnected" | "refresh">;

let sharedState: SharedState = {
  settings: typeof window !== "undefined" ? loadCoindcxSettings() : { apiKey: "", apiSecret: "", autoRefresh: true, refreshIntervalSec: 10 },
  positions: [],
  balances: [],
  orders: [],
  orderHistory: [],
  userInfo: null,
  streamStatus: "disconnected",
  isLoading: false,
  error: null,
  lastUpdated: null,
};

const listeners = new Set<(state: SharedState) => void>();
let activeFetchPromise: Promise<void> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let wsCleanup: (() => void) | null = null;
let priceStreamCleanup: (() => void) | null = null;
let subscribedPairsKey = "";

const notifyListeners = () => listeners.forEach((l) => l(sharedState));

function updatePositionPrice(pair: string, price: number) {
  let changed = false;
  const next = sharedState.positions.map((pos) => {
    if (pos.pair.replace(/^B-/, "").toUpperCase() !== pair.replace(/^B-/, "").toUpperCase()) return pos;
    changed = true;
    const diff = pos.side === "LONG" ? price - pos.entryPrice : pos.entryPrice - price;
    const conv = pos.settlementCurrencyAvgPrice ?? (pos.marginCurrency === "INR" ? 89.5 : 1);
    const unrealizedPnl = pos.marginCurrency === "INR" ? diff * pos.size * conv : diff * pos.size;
    const pnlPercentage = calculatePnlPercentage(pos.entryPrice, price, pos.leverage, pos.side);
    return { ...pos, markPrice: price, unrealizedPnl, pnlPercentage };
  });
  if (changed) {
    sharedState = { ...sharedState, positions: next, lastUpdated: Date.now() };
    notifyListeners();
  }
}

function syncPriceStream() {
  const pairs = Array.from(new Set(sharedState.positions.map((p) => p.pair))).sort();
  const key = pairs.join(",");
  if (key === subscribedPairsKey) return;
  subscribedPairsKey = key;
  if (priceStreamCleanup) { priceStreamCleanup(); priceStreamCleanup = null; }
  if (pairs.length > 0) priceStreamCleanup = connectLivePriceStream(pairs, updatePositionPrice);
}

const updateSharedState = (patch: Partial<SharedState>) => {
  sharedState = { ...sharedState, ...patch };
  if (patch.positions) syncPriceStream();
  notifyListeners();
};

function getRawList(raw: unknown): Record<string, unknown>[] {
  const recs = extractRecords(raw);
  return recs.length > 0 ? recs : (typeof raw === "object" && raw ? [raw as Record<string, unknown>] : []);
}

function mergePositions(current: readonly CoindcxPosition[], raw: unknown): CoindcxPosition[] {
  const items = getRawList(raw);
  if (items.length === 0) return [...current];
  let next = [...current];
  for (const item of items) {
    const activePos = Number(item.active_pos ?? item.active_units ?? item.size ?? 0);
    const id = String(item.id ?? item.position_id ?? "");
    const pair = String(item.pair ?? item.market ?? item.symbol ?? "");
    if (activePos === 0) {
      next = next.filter((p) => p.id !== id && (id ? true : p.pair !== pair));
    } else {
      const pos = normalizeCoindcxPosition(item);
      const idx = next.findIndex((p) => p.id === pos.id || (pos.pair && p.pair === pos.pair));
      if (idx >= 0) next[idx] = pos;
      else next.push(pos);
    }
  }
  return next;
}

function mergeBalances(current: readonly CoindcxBalance[], raw: unknown): CoindcxBalance[] {
  const items = getRawList(raw);
  if (items.length === 0) return [...current];
  const next = [...current];
  for (const item of items) {
    const bal = normalizeCoindcxBalance(item);
    if (!bal.currency) continue;
    const idx = next.findIndex((b) => b.currency === bal.currency);
    if (idx >= 0) next[idx] = bal;
    else if (bal.balance > 0 || bal.lockedBalance > 0) next.push(bal);
  }
  return next;
}

function mergeOrders(current: readonly CoindcxOrder[], raw: unknown): CoindcxOrder[] {
  const items = getRawList(raw);
  if (items.length === 0) return [...current];
  let next = [...current];
  for (const item of items) {
    const id = String(item.id ?? item.order_id ?? "");
    const status = String(item.status ?? "").toLowerCase();
    if (status && status !== "open") {
      next = next.filter((o) => o.id !== id);
    } else if (id) {
      const ord: CoindcxOrder = {
        id,
        pair: String(item.pair ?? item.market ?? item.symbol ?? ""),
        side: String(item.side ?? "buy").toLowerCase() === "sell" ? "sell" : "buy",
        price: Number(item.price ?? 0),
        quantity: Number(item.total_quantity ?? item.quantity ?? 0),
        status: status || "open",
        createdAt: Number(item.created_at ?? Date.now()),
      };
      const idx = next.findIndex((o) => o.id === id);
      if (idx >= 0) next[idx] = ord;
      else next.push(ord);
    }
  }
  return next;
}

async function executeFetch(): Promise<void> {
  const { settings } = sharedState;
  if (!hasCoindcxCredentials(settings)) {
    updateSharedState({ positions: [], balances: [], orders: [], orderHistory: [], userInfo: null, error: null });
    return;
  }
  updateSharedState({ isLoading: true, error: null });
  try {
    const headers = { "x-coindcx-apikey": settings.apiKey.trim(), "x-coindcx-secret": settings.apiSecret.trim() };
    const [pRes, aRes, oRes, hRes] = await Promise.all([
      fetch("/api/coindcx/positions", { headers, cache: "no-store" }),
      fetch("/api/coindcx/account", { headers, cache: "no-store" }),
      fetch("/api/coindcx/orders?status=open", { headers, cache: "no-store" }),
      fetch("/api/coindcx/orders?status=history", { headers, cache: "no-store" }).catch(() => null),
    ]);
    const [pData, aData, oData, hData] = await Promise.all([
      pRes.json(), aRes.json(), oRes.json(),
      hRes && hRes.ok ? hRes.json().catch(() => ({ ok: false })) : { ok: false },
    ]);
    if (!pData.ok) throw new Error(pData.error ?? "Failed to fetch CoinDCX positions");
    if (!aData.ok) throw new Error(aData.error ?? "Failed to fetch CoinDCX account");
    updateSharedState({
      positions: pData.positions ?? [],
      balances: aData.balances ?? [],
      userInfo: aData.userInfo ?? null,
      orders: oData.ok && oData.orders ? oData.orders : [],
      orderHistory: hData.ok && hData.orders ? hData.orders : [],
      lastUpdated: Date.now(),
      error: null,
    });
  } catch (err) {
    updateSharedState({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    updateSharedState({ isLoading: false });
  }
}

function triggerSharedRefresh(): Promise<void> {
  if (activeFetchPromise) return activeFetchPromise;
  activeFetchPromise = executeFetch().finally(() => { activeFetchPromise = null; });
  return activeFetchPromise;
}

function startPollingFallback() {
  if (pollTimer) clearInterval(pollTimer);
  const { settings } = sharedState;
  if (!settings.autoRefresh || !hasCoindcxCredentials(settings)) return;
  const intervalMs = Math.max(settings.refreshIntervalSec, 5) * 1000;
  pollTimer = setInterval(() => void triggerSharedRefresh(), intervalMs);
}

function syncWsAndPolling() {
  const { settings } = sharedState;
  const hasCreds = hasCoindcxCredentials(settings);
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (listeners.size === 0 || !hasCreds) {
    if (wsCleanup) { wsCleanup(); wsCleanup = null; }
    updateSharedState({ streamStatus: "disconnected" });
    return;
  }
  if (!wsCleanup) {
    wsCleanup = connectCoindcxWs(settings.apiKey.trim(), settings.apiSecret.trim(), {
      onStatusChange: (status) => {
        updateSharedState({ streamStatus: status });
        if (status === "disconnected" || status === "error" || status === "polling") startPollingFallback();
        else if (status === "live" && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      },
      onPositionUpdate: (data) => updateSharedState({ positions: mergePositions(sharedState.positions, data), lastUpdated: Date.now() }),
      onOrderUpdate: (data) => updateSharedState({ orders: mergeOrders(sharedState.orders, data), lastUpdated: Date.now() }),
      onBalanceUpdate: (data) => updateSharedState({ balances: mergeBalances(sharedState.balances, data), lastUpdated: Date.now() }),
    });
  }
}

export function useCoindcxPortfolio(): CoindcxPortfolioState {
  const [state, setState] = useState<SharedState>(sharedState);

  useEffect(() => {
    listeners.add(setState);
    if (listeners.size === 1) {
      updateSharedState({ settings: loadCoindcxSettings() });
      void triggerSharedRefresh();
    }
    syncWsAndPolling();

    const onSettingsChange = () => {
      if (wsCleanup) { wsCleanup(); wsCleanup = null; }
      updateSharedState({ settings: loadCoindcxSettings() });
      void triggerSharedRefresh();
      syncWsAndPolling();
    };
    window.addEventListener(SETTINGS_CHANGE_EVENT, onSettingsChange);

    return () => {
      listeners.delete(setState);
      window.removeEventListener(SETTINGS_CHANGE_EVENT, onSettingsChange);
      syncWsAndPolling();
      if (listeners.size === 0 && priceStreamCleanup) {
        priceStreamCleanup();
        priceStreamCleanup = null;
        subscribedPairsKey = "";
      }
    };
  }, []);

  const refresh = useCallback(() => triggerSharedRefresh(), []);

  return {
    settings: state.settings,
    isConnected: hasCoindcxCredentials(state.settings) && state.error === null && state.lastUpdated !== null,
    isLoading: state.isLoading,
    streamStatus: state.streamStatus,
    error: state.error,
    lastUpdated: state.lastUpdated,
    positions: state.positions,
    balances: state.balances,
    orders: state.orders,
    orderHistory: state.orderHistory,
    userInfo: state.userInfo,
    refresh,
  };
}
