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
