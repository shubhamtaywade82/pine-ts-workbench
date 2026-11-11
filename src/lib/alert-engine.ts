"use client";

/**
 * Alert engine — TradingView Ultimate parity (P5).
 *
 * - Multi-condition rules: up to 5 conditions combined with AND, like
 *   TradingView's "Add condition" alert builder.
 * - Open-ended alerts: rules never expire; they persist to localStorage and
 *   reload with the workspace.
 * - Per-rule dedupe: a rule fires at most once per (symbol, bar), tracked by
 *   the last bar time it fired on — a tick storm or a reload cannot re-fire it.
 * - Watchlist alerts: percent-change conditions evaluated across every symbol
 *   in the watchlist (TradingView's 15 Ultimate watchlist alerts).
 */

import type { AlertDeliveryResult, AlertEvent, AlertSink } from "./alert-sink-transports";
import { loadWatchlist, findSymbol, type SymbolOption } from "./symbol-catalog";
import type { FiredAlert } from "./alert-sinks";

// Delivery (settings, sinks, script-alert dispatch) lives in alert-sinks; this module owns the rules.
export type { FiredAlert } from "./alert-sinks";

export type {
  AlertDeliveryResult,
  AlertEvent,
  AlertSink,
  DeliveryStatus,
} from "./alert-sink-transports";

// ---------------------------------------------------------------------------
// Condition model
// ---------------------------------------------------------------------------

/** A single measurable predicate; one alert rule combines up to 5 with AND. */
export type AlertConditionKind =
  | "rsi_above"
  | "rsi_below"
  | "price_above"
  | "price_below"
  | "price_above_sma"
  | "price_below_sma"
  | "macd_hist_above"
  | "macd_hist_below"
  | "volume_above_sma"
  | "percent_change_above"
  | "percent_change_below"
  | "script_alert";

/** One condition inside a rule. `threshold` semantics depend on the kind. */
export interface AlertCondition {
  readonly kind: AlertConditionKind;
  readonly threshold: number;
}

/** Placeholder values available inside an alert message template. */
export interface AlertPlaceholders {
  readonly ticker: string;
  readonly close: number;
  readonly interval: string;
  readonly time: string;
  readonly rsi?: number;
  readonly volume?: number;
  readonly change?: number;
}

/** Substitutes {{ticker}}, {{close}}, {{interval}}, {{time}}, {{rsi}}, {{volume}}, {{change}} in a template. */
export const fillPlaceholders = (template: string, values: AlertPlaceholders): string =>
  template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
    switch (key) {
      case "ticker": return values.ticker;
      case "close": return values.close.toString();
      case "interval": return values.interval;
      case "time": return values.time;
      case "rsi": return values.rsi !== undefined ? values.rsi.toFixed(1) : whole;
      case "volume": return values.volume !== undefined ? values.volume.toFixed(2) : whole;
      case "change": return values.change !== undefined ? `${values.change.toFixed(2)}%` : whole;
      default: return whole;
    }
  });

export const PLACEHOLDER_HELP = "{{ticker}} {{close}} {{interval}} {{time}} {{rsi}} {{volume}} {{change}}";

/**
 * An alert rule: 1–5 conditions ANDed together. Firing once per bar per
 * symbol, the rule re-arms itself (open-ended, no expiry).
 */
export interface AlertRule {
  readonly id: string;
  readonly name: string;
  /** Symbol the rule watches; `"*"` = every watchlist symbol (watchlist alert). */
  readonly symbol: string;
  readonly conditions: readonly AlertCondition[];
  /** User message template with {{placeholders}}; empty = auto description. */
  readonly messageTemplate?: string;
  readonly actionSide?: "BUY" | "SELL";
  readonly actionQty?: number;
  readonly enabled: boolean;
  /** ISO timestamp of the last firing, for display. */
  readonly lastFiredAt?: string;
}


/** TradingView Ultimate caps multi-condition alerts at 5 conditions. */
export const MAX_CONDITIONS_PER_RULE = 5;
/** TradingView Ultimate's watchlist-alert quota. */
export const MAX_WATCHLIST_ALERTS = 15;

export const CONDITION_LABELS: Record<AlertConditionKind, string> = {
  rsi_above: "RSI is above",
  rsi_below: "RSI is below",
  price_above: "Price is above",
  price_below: "Price is below",
  price_above_sma: "Price is above SMA",
  price_below_sma: "Price is below SMA",
  macd_hist_above: "MACD histogram is above",
  macd_hist_below: "MACD histogram is below",
  volume_above_sma: "Volume is above SMA(20)",
  percent_change_above: "Change % (24h) is above",
  percent_change_below: "Change % (24h) is below",
  script_alert: "Script alert() fires",
};

/** Market context a rule evaluates against, all optional (rules need what they use). */
export interface AlertContext {
  readonly symbol: string;
  readonly price: number;
  /** Chart timeframe, for the {{interval}} placeholder. */
  readonly interval?: string;
  readonly rsi?: number;
  readonly sma?: number;
  readonly macdHist?: number;
  readonly volume?: number;
  readonly volumeSma?: number;
  readonly percentChange24h?: number;
  /** Current forming bar's open time — the dedupe key. */
  readonly barTime?: number;
  /** True when a mounted script fired an alert() this bar. */
  readonly scriptFired?: boolean;
}

const checkOne = (condition: AlertCondition, ctx: AlertContext): boolean => {
  const { kind, threshold } = condition;
  switch (kind) {
    case "rsi_above": return ctx.rsi !== undefined && ctx.rsi > threshold;
    case "rsi_below": return ctx.rsi !== undefined && ctx.rsi < threshold;
    case "price_above": return ctx.price > threshold;
    case "price_below": return ctx.price < threshold;
    case "price_above_sma": return ctx.sma !== undefined && ctx.price > ctx.sma;
    case "price_below_sma": return ctx.sma !== undefined && ctx.price < ctx.sma;
    case "macd_hist_above": return ctx.macdHist !== undefined && ctx.macdHist > threshold;
    case "macd_hist_below": return ctx.macdHist !== undefined && ctx.macdHist < threshold;
    case "volume_above_sma":
      return ctx.volume !== undefined && ctx.volumeSma !== undefined && ctx.volume > ctx.volumeSma * (1 + threshold / 100);
    case "percent_change_above": return ctx.percentChange24h !== undefined && ctx.percentChange24h > threshold;
    case "percent_change_below": return ctx.percentChange24h !== undefined && ctx.percentChange24h < threshold;
    case "script_alert": return ctx.scriptFired === true;
    default: return false;
  }
};

/** All conditions must hold (AND) — TradingView multi-condition semantics. */
export const ruleTriggers = (rule: AlertRule, ctx: AlertContext): boolean =>
  rule.conditions.length > 0 && rule.conditions.every((c) => checkOne(c, ctx));

const describeRule = (rule: AlertRule, ctx: AlertContext): string => {
  const parts = rule.conditions.map((c) => {
    const label = CONDITION_LABELS[c.kind];
    const needsValue = c.kind !== "price_above_sma" && c.kind !== "price_below_sma"
      && c.kind !== "volume_above_sma" && c.kind !== "script_alert";
    return needsValue ? `${label} ${c.threshold}` : label;
  });
  return `${ctx.symbol}: ${rule.name} — ${parts.join(" AND ")}`;
};

// ---------------------------------------------------------------------------
// Evaluation + dedupe
// ---------------------------------------------------------------------------

/** In-memory dedupe: ruleId → last barTime it fired on (per symbol via key). */
const lastFiredBar = new Map<string, number>();

/**
 * Evaluates rules against one symbol's context and delivers through `sinks`.
 * A rule fires at most once per (rule, symbol, barTime); conditions AND.
 * Returns the fired alerts; rules are also stamped with `lastFiredAt`.
 */
export const evaluateAlerts = async (
  rules: readonly AlertRule[],
  sinks: readonly AlertSink[],
  ctx: AlertContext,
): Promise<{ fired: FiredAlert[]; rules: readonly AlertRule[] }> => {
  const fired: FiredAlert[] = [];
  const updated: AlertRule[] = [];
  for (const rule of rules) {
    if (!rule.enabled) { updated.push(rule); continue; }
    if (rule.symbol !== "*" && rule.symbol !== ctx.symbol) { updated.push(rule); continue; }
    // Dedupe: same forming bar (or same second when barTime is unknown).
    const dedupeKey = `${rule.id}:${ctx.symbol}`;
    const stamp = ctx.barTime ?? Math.floor(Date.now() / 1000) * 1000;
    if (lastFiredBar.get(dedupeKey) === stamp) { updated.push(rule); continue; }
    if (!ruleTriggers(rule, ctx)) { updated.push(rule); continue; }

    lastFiredBar.set(dedupeKey, stamp);
    const template = rule.messageTemplate?.trim();
    const message = template !== undefined && template !== ""
      ? fillPlaceholders(template, {
        ticker: ctx.symbol,
        close: ctx.price,
        interval: ctx.interval ?? "",
        time: new Date().toISOString(),
        rsi: ctx.rsi,
        volume: ctx.volume,
        change: ctx.percentChange24h,
      })
      : describeRule(rule, ctx);
    const event: AlertEvent = {
      id: `alert-${Date.now()}-${rule.id}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      symbol: ctx.symbol,
      condition: rule.conditions[0]?.kind ?? "script_alert",
      value: ctx.price,
      threshold: rule.conditions[0]?.threshold ?? 0,
      action: rule.actionSide ? `${rule.actionSide} ${rule.actionQty ?? 0} MARKET` : undefined,
      message,
    };
    const deliveries: AlertDeliveryResult[] = [];
    for (const sink of sinks) deliveries.push(await sink.deliver(event));
    fired.push({ event, deliveries });
    updated.push({ ...rule, lastFiredAt: event.timestamp });
  }
  return { fired, rules: updated };
};

/** Clears dedupe memory (called when rules are edited so they can re-arm). */
export const rearmRules = (): void => {
  lastFiredBar.clear();
};

// ---------------------------------------------------------------------------
// Watchlist alerts
// ---------------------------------------------------------------------------

export interface WatchlistQuote {
  readonly symbol: string;
  readonly price: number;
  readonly percentChange24h: number;
}

/**
 * Evaluates watchlist rules (symbol "*") against every watchlist quote.
 * Binance's 24h ticker endpoint powers the quotes; the caller fetches them.
 */
export const evaluateWatchlistAlerts = async (
  rules: readonly AlertRule[],
  sinks: readonly AlertSink[],
  quotes: readonly WatchlistQuote[],
): Promise<{ fired: FiredAlert[]; rules: readonly AlertRule[] }> => {
  const fired: FiredAlert[] = [];
  const updated: AlertRule[] = [];
  for (const rule of rules) {
    if (!rule.enabled) { updated.push(rule); continue; }
    const isWatchlist = rule.symbol === "*";
    const usesPct = rule.conditions.some(
      (c) => c.kind === "percent_change_above" || c.kind === "percent_change_below",
    );
    if (!isWatchlist && !usesPct) { updated.push(rule); continue; }
    const targets = isWatchlist
      ? quotes
      : quotes.filter((q) => q.symbol === rule.symbol);
    let firedThisRule = false;
    for (const quote of targets) {
      const { fired: ruleFired, rules: _ } = await evaluateAlerts(
        [rule], sinks,
        { symbol: quote.symbol, price: quote.price, percentChange24h: quote.percentChange24h },
      );
      if (ruleFired.length > 0) firedThisRule = true;
      fired.push(...ruleFired);
    }
    updated.push(firedThisRule ? { ...rule, lastFiredAt: new Date().toISOString() } : rule);
  }
  return { fired, rules: updated };
};

/** The symbols a watchlist-level alert covers. */
export const watchlistSymbols = (): SymbolOption[] =>
  loadWatchlist()
    .map((ticker) => findSymbol(ticker))
    .filter((s): s is SymbolOption => s !== undefined);

// ---------------------------------------------------------------------------
// Persistence (open-ended: rules survive reloads, never expire)
// ---------------------------------------------------------------------------

const RULES_KEY = "pine-ts-workbench-alert-rules";
const FIRED_KEY = "pine-ts-workbench-fired-alerts";
const FIRED_HISTORY_LIMIT = 100;

export const loadAlertRules = (): AlertRule[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RULES_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as AlertRule[];
    // Sanitize: cap conditions at 5 (forward compatibility).
    return parsed.map((r) => ({ ...r, conditions: r.conditions.slice(0, MAX_CONDITIONS_PER_RULE) }));
  } catch {
    return [];
  }
};

export const saveAlertRules = (rules: readonly AlertRule[]): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RULES_KEY, JSON.stringify(rules));
  } catch { /* storage unavailable */ }
};

export const loadFiredAlerts = (): FiredAlert[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FIRED_KEY);
    if (raw === null) return [];
    return JSON.parse(raw) as FiredAlert[];
  } catch {
    return [];
  }
};

export const saveFiredAlerts = (fired: readonly FiredAlert[]): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FIRED_KEY, JSON.stringify(fired.slice(0, FIRED_HISTORY_LIMIT)));
  } catch { /* storage unavailable */ }
};
