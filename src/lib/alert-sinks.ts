"use client";

import type { BinanceSettings } from "@/components/trading/settings-dialog";
import {
  BrokerActionSink,
  BrowserNotificationSink,
  EmailSink,
  TelegramSink,
  WebhookSink,
  type AlertDeliveryResult,
  type AlertEvent,
  type AlertSink,
} from "./alert-sink-transports";

export type {
  AlertDeliveryResult,
  AlertEvent,
  AlertSink,
  DeliveryStatus,
} from "./alert-sink-transports";
export {
  BrokerActionSink,
  BrowserNotificationSink,
  EmailSink,
  TelegramSink,
  WebhookSink,
} from "./alert-sink-transports";

export type AlertCondition =
  | "rsi_above"
  | "rsi_below"
  | "price_above_sma"
  | "price_below_sma"
  | "macd_hist_positive"
  | "macd_hist_negative"
  | "script_alert";

export interface AlertRule {
  readonly id: string;
  readonly condition: AlertCondition;
  readonly threshold: number;
  readonly actionSide?: "BUY" | "SELL";
  readonly actionQty?: number;
  readonly enabled: boolean;
}

export interface FiredAlert {
  readonly event: AlertEvent;
  readonly deliveries: readonly AlertDeliveryResult[];
}

export function formatScriptAlertMessage(rawMessage: string): { message: string; action?: string } {
  try {
    const parsed = JSON.parse(rawMessage) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && typeof parsed.event === "string") {
      const parts = [`[${parsed.event}]`];
      if (parsed.side) parts.push(String(parsed.side));
      if (parsed.setup) parts.push(`Setup: ${parsed.setup}`);
      if (parsed.entry) parts.push(`Entry: ${parsed.entry}`);
      if (parsed.sl) parts.push(`SL: ${parsed.sl}`);
      if (parsed.tp1 || parsed.tp2) parts.push(`TP: ${parsed.tp1 ?? parsed.tp2}`);
      if (parsed.score) parts.push(`Score: ${parsed.score}`);
      const action = parsed.side ? `${String(parsed.side).toUpperCase()} MARKET` : undefined;
      return { message: parts.join(" | "), action };
    }
  } catch {
    // Not a JSON payload; use as raw text.
  }
  return { message: rawMessage };
}

export const dispatchScriptAlerts = async (
  rawAlerts: readonly { readonly message: string; readonly barIndex?: number; readonly barTime?: number }[],
  sinks: readonly AlertSink[],
  symbol: string,
): Promise<FiredAlert[]> => {
  const fired: FiredAlert[] = [];
  for (const item of rawAlerts) {
    const { message, action } = formatScriptAlertMessage(item.message);
    const event: AlertEvent = {
      id: `alert-script-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      symbol,
      condition: "script_alert",
      value: 0,
      threshold: 0,
      action,
      message,
    };
    const deliveries: AlertDeliveryResult[] = [];
    for (const sink of sinks) {
      deliveries.push(await sink.deliver(event));
    }
    fired.push({ event, deliveries });
  }
  return fired;
};

const checkCondition = (
  rule: AlertRule,
  ctx: { rsi?: number; sma?: number; macdHist?: number; price: number },
): { value: number } | undefined => {
  switch (rule.condition) {
    case "rsi_above":
      return ctx.rsi !== undefined && ctx.rsi > rule.threshold ? { value: ctx.rsi } : undefined;
    case "rsi_below":
      return ctx.rsi !== undefined && ctx.rsi < rule.threshold ? { value: ctx.rsi } : undefined;
    case "price_above_sma":
      return ctx.sma !== undefined && ctx.price > ctx.sma ? { value: ctx.price } : undefined;
    case "price_below_sma":
      return ctx.sma !== undefined && ctx.price < ctx.sma ? { value: ctx.price } : undefined;
    case "macd_hist_positive":
      return ctx.macdHist !== undefined && ctx.macdHist > rule.threshold ? { value: ctx.macdHist } : undefined;
    case "macd_hist_negative":
      return ctx.macdHist !== undefined && ctx.macdHist < rule.threshold ? { value: ctx.macdHist } : undefined;
    default:
      return undefined;
  }
};

export const evaluateAlerts = async (
  rules: readonly AlertRule[],
  sinks: readonly AlertSink[],
  context: {
    readonly symbol: string;
    readonly rsi?: number;
    readonly sma?: number;
    readonly macdHist?: number;
    readonly price: number;
  },
): Promise<FiredAlert[]> => {
  const fired: FiredAlert[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const triggered = checkCondition(rule, context);
    if (triggered === undefined) continue;

    const event: AlertEvent = {
      id: `alert-${Date.now()}-${rule.id}`,
      timestamp: new Date().toISOString(),
      symbol: context.symbol,
      condition: rule.condition,
      value: triggered.value,
      threshold: rule.threshold,
      action: rule.actionSide ? `${rule.actionSide} ${rule.actionQty ?? 0} MARKET` : undefined,
      message: `${context.symbol} ${rule.condition} at ${triggered.value.toFixed(2)} (threshold ${rule.threshold})`,
    };

    const deliveries: AlertDeliveryResult[] = [];
    for (const sink of sinks) {
      deliveries.push(await sink.deliver(event));
    }
    fired.push({ event, deliveries });
  }
  return fired;
};

const ALERT_SETTINGS_KEY = "pine-ts-workbench-alert-settings";

export interface AlertSettings {
  readonly webhookUrl: string;
  readonly webhookHeaders: string;
  readonly telegramBotToken: string;
  readonly telegramChatId: string;
  readonly emailWebhookUrl: string;
  readonly emailRecipient: string;
  readonly browserNotificationsEnabled: boolean;
  readonly brokerActionEnabled: boolean;
  readonly brokerActionSide: "BUY" | "SELL";
  readonly brokerActionQty: number;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  webhookUrl: "",
  webhookHeaders: "",
  telegramBotToken: "",
  telegramChatId: "",
  emailWebhookUrl: "",
  emailRecipient: "",
  browserNotificationsEnabled: true,
  brokerActionEnabled: false,
  brokerActionSide: "SELL",
  brokerActionQty: 0.001,
};

export const loadAlertSettings = (): AlertSettings => {
  if (typeof window === "undefined") return DEFAULT_ALERT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(ALERT_SETTINGS_KEY);
    if (raw === null) return DEFAULT_ALERT_SETTINGS;
    return { ...DEFAULT_ALERT_SETTINGS, ...(JSON.parse(raw) as Partial<AlertSettings>) };
  } catch {
    return DEFAULT_ALERT_SETTINGS;
  }
};

export const saveAlertSettings = (settings: AlertSettings): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ALERT_SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* localStorage unavailable */ }
};

export const buildSinks = (alert: AlertSettings, binance: BinanceSettings): AlertSink[] => {
  const sinks: AlertSink[] = [
    new WebhookSink({ url: alert.webhookUrl, headers: alert.webhookHeaders }),
    new TelegramSink({ botToken: alert.telegramBotToken, chatId: alert.telegramChatId }),
    new EmailSink({ webhookUrl: alert.emailWebhookUrl, recipient: alert.emailRecipient }),
    new BrowserNotificationSink(alert.browserNotificationsEnabled),
  ];
  if (alert.brokerActionEnabled) {
    sinks.push(new BrokerActionSink({
      binanceSettings: binance,
      side: alert.brokerActionSide,
      quantity: alert.brokerActionQty,
      orderType: "MARKET",
    }));
  }
  return sinks;
};
