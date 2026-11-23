"use client";

import { useCallback, useEffect, useState } from "react";
import {
  calculatePnlPercentage,
  extractRecords,
  normalizeCoindcxBalance,
  normalizeCoindcxPosition,
  type CoindcxBalance,
  type CoindcxFuturesWallet,
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
  readonly isConnected: boolean; readonly isLoading: boolean;
  readonly streamStatus: CoindcxStreamStatus; readonly error: string | null; readonly lastUpdated: number | null;
  readonly positions: readonly CoindcxPosition[]; readonly balances: readonly CoindcxBalance[];
  readonly futuresWallets: readonly CoindcxFuturesWallet[];
  readonly orders: readonly CoindcxOrder[]; readonly orderHistory: readonly CoindcxOrder[];
  readonly userInfo: CoindcxUserInfo | null; readonly refresh: () => Promise<void>;
}

type SharedState = Omit<CoindcxPortfolioState, "isConnected" | "refresh">;

let sharedState: SharedState = {
  settings: typeof window !== "undefined" ? loadCoindcxSettings() : { apiKey: "", apiSecret: "", autoRefresh: true, refreshIntervalSec: 10 },
  positions: [], balances: [], futuresWallets: [], orders: [], orderHistory: [],
  userInfo: null, streamStatus: "disconnected", isLoading: false, error: null, lastUpdated: null,
};

const listeners = new Set<(state: SharedState) => void>();
let activeFetchPromise: Promise<void> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let wsCleanup: (() => void) | null = null;
let priceCleanup: (() => void) | null = null;
let currentPricePairsKey = "";
let teardownTimer: ReturnType<typeof setTimeout> | null = null;

const notifyListeners = () => listeners.forEach((l) => l(sharedState));

const updateSharedState = (patch: Partial<SharedState>) => {
  sharedState = { ...sharedState, ...patch };
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

function matchPair(a: string, b: string): boolean {
  if (a === b) return true;
  const ca = a.toUpperCase().replace(/^B-/, "").replace(/[^A-Z0-9]/g, "");
  const cb = b.toUpperCase().replace(/^B-/, "").replace(/[^A-Z0-9]/g, "");
  return ca.length > 0 && ca === cb;
}

function updatePositionPrice(pair: string, price: number) {
  let changed = false;
  const positions = sharedState.positions.map((pos) => {
    if (!matchPair(pos.pair, pair) || pos.markPrice === price) return pos;
    changed = true;
    const diff = pos.side === "LONG" ? price - pos.entryPrice : pos.entryPrice - price;
    const conv = pos.settlementCurrencyAvgPrice ?? (pos.marginCurrency === "INR" ? 102 : 1);
    const unrealizedPnl = diff * pos.size * conv;
    const pnlPercentage = pos.margin > 0 ? (unrealizedPnl / pos.margin) * 100 : 0;
    return { ...pos, markPrice: price, unrealizedPnl, pnlPercentage };
  });
  if (changed) updateSharedState({ positions, lastUpdated: Date.now() });
}

function syncPriceStream() {
  if (typeof window === "undefined") return;
  const pairs = Array.from(new Set(sharedState.positions.map((p) => p.pair))).sort();
  const key = pairs.join(",");
  if (key === currentPricePairsKey) return;
  currentPricePairsKey = key;
  if (priceCleanup) { priceCleanup(); priceCleanup = null; }
  if (pairs.length === 0 || listeners.size === 0) return;
  priceCleanup = connectLivePriceStream(pairs, updatePositionPrice);
}

function preserveLivePrices(fetched: readonly CoindcxPosition[], current: readonly CoindcxPosition[]): CoindcxPosition[] {
  return fetched.map((pos) => {
    const existing = current.find((p) => p.id === pos.id || p.pair === pos.pair);
    if (!existing || existing.markPrice === pos.markPrice || existing.markPrice === existing.entryPrice) return pos;
    const diff = pos.side === "LONG" ? existing.markPrice - pos.entryPrice : pos.entryPrice - existing.markPrice;
    const conv = pos.settlementCurrencyAvgPrice ?? (pos.marginCurrency === "INR" ? 102 : 1);
    const unrealizedPnl = diff * pos.size * conv;
    const pnlPercentage = pos.margin > 0 ? (unrealizedPnl / pos.margin) * 100 : 0;
    return { ...pos, markPrice: existing.markPrice, unrealizedPnl, pnlPercentage };
  });
}

async function executeFetch(): Promise<void> {
  const { settings } = sharedState;
  if (!hasCoindcxCredentials(settings)) {
    updateSharedState({ positions: [], balances: [], futuresWallets: [], orders: [], orderHistory: [], userInfo: null, error: null });
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
    const nextPositions = preserveLivePrices(pData.positions ?? [], sharedState.positions);
    updateSharedState({
      positions: nextPositions,
      balances: aData.balances ?? [],
      futuresWallets: aData.futuresWallets ?? [],
      userInfo: aData.userInfo ?? null,
      orders: oData.ok && oData.orders ? oData.orders : [],
      orderHistory: hData.ok && hData.orders ? hData.orders : [],
      lastUpdated: Date.now(),
      error: null,
    });
    syncPriceStream();
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

function startContinuousPolling() {
  if (pollTimer) clearInterval(pollTimer);
  const { settings } = sharedState;
  if (!settings.autoRefresh || !hasCoindcxCredentials(settings)) return;
  const intervalMs = Math.max(settings.refreshIntervalSec, 3) * 1000;
  pollTimer = setInterval(() => void triggerSharedRefresh(), intervalMs);
}

function syncWsAndPolling() {
  const { settings } = sharedState;
  const hasCreds = hasCoindcxCredentials(settings);
  if (listeners.size === 0 || !hasCreds) {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (wsCleanup) { wsCleanup(); wsCleanup = null; }
    if (priceCleanup) { priceCleanup(); priceCleanup = null; currentPricePairsKey = ""; }
    updateSharedState({ streamStatus: "disconnected" });
    return;
  }
  startContinuousPolling();
  syncPriceStream();
  if (!wsCleanup) {
    const pairs = Array.from(new Set(sharedState.positions.map((p) => p.pair)));
    wsCleanup = connectCoindcxWs(settings.apiKey.trim(), settings.apiSecret.trim(), {
      onStatusChange: (status) => updateSharedState({ streamStatus: status }),
      onPositionUpdate: (data) => {
        updateSharedState({ positions: mergePositions(sharedState.positions, data), lastUpdated: Date.now() });
        syncPriceStream();
      },
      onOrderUpdate: (data) => updateSharedState({ orders: mergeOrders(sharedState.orders, data), lastUpdated: Date.now() }),
      onBalanceUpdate: (data) => updateSharedState({ balances: mergeBalances(sharedState.balances, data), lastUpdated: Date.now() }),
      onPriceTick: (pair, price) => updatePositionPrice(pair, price),
    }, undefined, pairs);
  }
}

export function useCoindcxPortfolio(): CoindcxPortfolioState {
  const [state, setState] = useState<SharedState>(sharedState);

  useEffect(() => {
    if (teardownTimer) { clearTimeout(teardownTimer); teardownTimer = null; }
    listeners.add(setState);
    if (listeners.size === 1) {
      updateSharedState({ settings: loadCoindcxSettings() });
      void triggerSharedRefresh();
    }
    syncWsAndPolling();

    const onSettingsChange = () => {
      if (wsCleanup) { wsCleanup(); wsCleanup = null; }
      if (priceCleanup) { priceCleanup(); priceCleanup = null; currentPricePairsKey = ""; }
      updateSharedState({ settings: loadCoindcxSettings() });
      void triggerSharedRefresh();
      syncWsAndPolling();
    };
    window.addEventListener(SETTINGS_CHANGE_EVENT, onSettingsChange);

    return () => {
      listeners.delete(setState);
      window.removeEventListener(SETTINGS_CHANGE_EVENT, onSettingsChange);
      if (listeners.size === 0) {
        teardownTimer = setTimeout(() => {
          if (listeners.size === 0) {
            syncWsAndPolling();
            if (priceCleanup) { priceCleanup(); priceCleanup = null; currentPricePairsKey = ""; }
          }
        }, 5000);
      } else {
        syncWsAndPolling();
      }
    };
  }, []);

  const refresh = useCallback(() => triggerSharedRefresh(), []);

  return {
    settings: state.settings,
    isConnected: hasCoindcxCredentials(state.settings) && state.error === null && state.lastUpdated !== null,
    isLoading: state.isLoading, streamStatus: state.streamStatus, error: state.error, lastUpdated: state.lastUpdated,
    positions: state.positions, balances: state.balances, futuresWallets: state.futuresWallets,
    orders: state.orders, orderHistory: state.orderHistory, userInfo: state.userInfo, refresh,
  };
}
