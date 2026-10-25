"use client";

import type { BinanceSettings } from "@/components/trading/settings-dialog";
import { RealBinanceTradingSurface } from "@/lib/real-binance-trading-surface";

/**
 * Alert delivery sinks for the chart workbench — Wave 16.
 *
 * Each sink receives an `AlertEvent` and delivers it via its channel:
 *  - WebhookSink: HTTP POST JSON to a configurable URL.
 *  - TelegramSink: HTTP POST to the Telegram Bot API (sendMessage).
 *  - EmailSink: HTTP POST to a user-configured email-webhook URL (any
 *    server-side service that accepts an email payload and sends it —
 *    e.g. Resend, SendGrid, or a custom serverless function).
 *  - BrokerActionSink: places a real Binance order via
 *    RealBinanceTradingSurface (closes the signal→alert→order loop).
 *
 * Settings for each sink are stored in localStorage (same pattern as
 * the Binance API settings from Wave 15).
 */

// ---------- alert event ----------

export interface AlertEvent {
  /** Unique id for this alert firing. */
  readonly id: string;
  /** ISO timestamp. */
  readonly timestamp: string;
  /** The symbol that triggered the alert (e.g. "BTCUSDT"). */
  readonly symbol: string;
  /** Human-readable condition (e.g. "RSI(14) crossed above 70"). */
  readonly condition: string;
  /** The value at trigger time (e.g. 72.5 for RSI). */
  readonly value: number;
  /** The threshold that was crossed (e.g. 70). */
  readonly threshold: number;
  /** Optional broker action to take (e.g. "SELL 0.001 MARKET"). */
  readonly action?: string;
  /** Human-readable message. */
  readonly message: string;
}

// ---------- alert sink interface ----------

export type DeliveryStatus = "delivered" | "failed" | "skipped";

export interface AlertDeliveryResult {
  readonly sinkId: string;
  readonly sinkName: string;
  readonly status: DeliveryStatus;
  readonly message: string;
  readonly timestamp: string;
}

export interface AlertSink {
  readonly id: string;
  readonly name: string;
  /** Delivers the alert. Returns the delivery status. */
  deliver(event: AlertEvent): Promise<AlertDeliveryResult>;
}

// ---------- webhook sink ----------

export interface WebhookSinkConfig {
  readonly url: string;
  /** Optional headers as JSON string. */
  readonly headers?: string;
}

export class WebhookSink implements AlertSink {
  public readonly id = "webhook";
  public readonly name = "Webhook";
  public constructor(private readonly config: WebhookSinkConfig) {}

  public async deliver(event: AlertEvent): Promise<AlertDeliveryResult> {
    if (!this.config.url) {
      return { sinkId: this.id, sinkName: this.name, status: "skipped", message: "No URL configured", timestamp: new Date().toISOString() };
    }
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.config.headers) {
        try {
          Object.assign(headers, JSON.parse(this.config.headers));
        } catch { /* ignore malformed headers */ }
      }
      const res = await fetch(this.config.url, {
        method: "POST",
        headers,
        body: JSON.stringify(event),
      });
      if (!res.ok) {
        return { sinkId: this.id, sinkName: this.name, status: "failed", message: `HTTP ${res.status}: ${await res.text().catch(() => "unknown")}`.slice(0, 200), timestamp: new Date().toISOString() };
      }
      return { sinkId: this.id, sinkName: this.name, status: "delivered", message: "Posted", timestamp: new Date().toISOString() };
    } catch (err) {
      return { sinkId: this.id, sinkName: this.name, status: "failed", message: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() };
    }
  }
}

// ---------- telegram sink ----------

export interface TelegramSinkConfig {
  readonly botToken: string;
  readonly chatId: string;
}

export class TelegramSink implements AlertSink {
  public readonly id = "telegram";
  public readonly name = "Telegram";
  public constructor(private readonly config: TelegramSinkConfig) {}

  public async deliver(event: AlertEvent): Promise<AlertDeliveryResult> {
    if (!this.config.botToken || !this.config.chatId) {
      return { sinkId: this.id, sinkName: this.name, status: "skipped", message: "Bot token or chat ID not configured", timestamp: new Date().toISOString() };
    }
    try {
      const text = `🔔 *Alert: ${event.symbol}*\n${event.message}\n\nCondition: ${event.condition}\nValue: ${event.value}\nThreshold: ${event.threshold}${event.action ? `\nAction: ${event.action}` : ""}\nTime: ${event.timestamp}`;
      const res = await fetch(`https://api.telegram.org/bot${this.config.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.config.chatId,
          text,
          parse_mode: "Markdown",
        }),
      });
      if (!res.ok) {
        return { sinkId: this.id, sinkName: this.name, status: "failed", message: `Telegram API ${res.status}`.slice(0, 200), timestamp: new Date().toISOString() };
      }
      return { sinkId: this.id, sinkName: this.name, status: "delivered", message: "Sent", timestamp: new Date().toISOString() };
    } catch (err) {
      return { sinkId: this.id, sinkName: this.name, status: "failed", message: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() };
    }
  }
}

// ---------- email sink (webhook-based) ----------

export interface EmailSinkConfig {
  /** URL of a server-side email-sending endpoint (e.g. Resend, SendGrid, custom). */
  readonly webhookUrl: string;
  /** Recipient email address. */
  readonly recipient: string;
}

export class EmailSink implements AlertSink {
  public readonly id = "email";
  public readonly name = "Email";
  public constructor(private readonly config: EmailSinkConfig) {}

  public async deliver(event: AlertEvent): Promise<AlertDeliveryResult> {
    if (!this.config.webhookUrl || !this.config.recipient) {
      return { sinkId: this.id, sinkName: this.name, status: "skipped", message: "Webhook URL or recipient not configured", timestamp: new Date().toISOString() };
    }
    try {
      const payload = {
        to: this.config.recipient,
        subject: `Alert: ${event.symbol} — ${event.condition}`,
        body: `${event.message}\n\nSymbol: ${event.symbol}\nCondition: ${event.condition}\nValue: ${event.value}\nThreshold: ${event.threshold}${event.action ? `\nAction: ${event.action}` : ""}\nTimestamp: ${event.timestamp}`,
      };
      const res = await fetch(this.config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        return { sinkId: this.id, sinkName: this.name, status: "failed", message: `Email webhook ${res.status}`.slice(0, 200), timestamp: new Date().toISOString() };
      }
      return { sinkId: this.id, sinkName: this.name, status: "delivered", message: "Sent", timestamp: new Date().toISOString() };
    } catch (err) {
      return { sinkId: this.id, sinkName: this.name, status: "failed", message: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() };
    }
  }
}

// ---------- broker action sink ----------

export interface BrokerActionConfig {
  readonly binanceSettings: BinanceSettings;
  /** The side to trade when an alert fires ("BUY" or "SELL"). */
  readonly side: "BUY" | "SELL";
  /** Quantity to trade. */
  readonly quantity: number;
  /** Order type ("MARKET" or "LIMIT"). */
  readonly orderType: "MARKET" | "LIMIT";
}

export class BrokerActionSink implements AlertSink {
  public readonly id = "broker-action";
  public readonly name = "Broker Action";
  public constructor(private readonly config: BrokerActionConfig) {}

  public async deliver(event: AlertEvent): Promise<AlertDeliveryResult> {
    const s = this.config.binanceSettings;
    if (!s.apiKey || !s.apiSecret) {
      return { sinkId: this.id, sinkName: this.name, status: "skipped", message: "Binance API not configured", timestamp: new Date().toISOString() };
    }
    if (!s.liveTradeEnabled) {
      return { sinkId: this.id, sinkName: this.name, status: "skipped", message: "Live trading disabled (dry-run)", timestamp: new Date().toISOString() };
    }
    try {
      const surface = new RealBinanceTradingSurface({
        apiKey: s.apiKey,
        apiSecret: s.apiSecret,
        testnet: s.testnet,
        liveTradeEnabled: s.liveTradeEnabled,
      });
      const res = await surface.newOrder({
        symbol: event.symbol,
        side: this.config.side,
        type: this.config.orderType,
        quantity: this.config.quantity,
        price: undefined,
        stopPrice: undefined,
        timeInForce: "GTC",
        clientOrderId: `alert-${event.id}`,
      });
      return {
        sinkId: this.id,
        sinkName: this.name,
        status: res.status === "FILLED" || res.status === "NEW" ? "delivered" : "failed",
        message: `Order ${res.orderId}: ${res.status} (filled ${res.executedQty})`,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return { sinkId: this.id, sinkName: this.name, status: "failed", message: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() };
    }
  }
}

// ---------- alert engine ----------

export type AlertCondition =
  | "rsi_above"
  | "rsi_below"
  | "price_above_sma"
  | "price_below_sma"
  | "macd_hist_positive"
  | "macd_hist_negative";

export interface AlertRule {
  readonly id: string;
  readonly condition: AlertCondition;
  readonly threshold: number;
  /** Broker action: side + qty + order type. Empty = no broker action. */
  readonly actionSide?: "BUY" | "SELL";
  readonly actionQty?: number;
  /** Enabled or disabled. */
  readonly enabled: boolean;
}

export interface AlertEngineOptions {
  readonly rules: readonly AlertRule[];
  readonly sinks: readonly AlertSink[];
}

export interface FiredAlert {
  readonly event: AlertEvent;
  readonly deliveries: readonly AlertDeliveryResult[];
}

/**
 * Evaluates alert rules against the latest indicator values. When a rule's
 * condition is met, fires the alert to all configured sinks and returns the
 * fired alert + delivery results.
 *
 * Uses a simple "last bar" evaluation: checks the condition on the current
 * (last) bar only. A rule fires at most once per bar — the caller should
 * track which bars have already fired to avoid duplicates.
 */
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
      const result = await sink.deliver(event);
      deliveries.push(result);
    }

    fired.push({ event, deliveries });
  }
  return fired;
};

/** Checks a single rule; returns `{ value }` if triggered, undefined otherwise. */
const checkCondition = (
  rule: AlertRule,
  ctx: { rsi?: number; sma?: number; macdHist?: number; price: number },
): { value: number } | undefined => {
  switch (rule.condition) {
    case "rsi_above":
      if (ctx.rsi === undefined) return undefined;
      return ctx.rsi > rule.threshold ? { value: ctx.rsi } : undefined;
    case "rsi_below":
      if (ctx.rsi === undefined) return undefined;
      return ctx.rsi < rule.threshold ? { value: ctx.rsi } : undefined;
    case "price_above_sma":
      if (ctx.sma === undefined) return undefined;
      return ctx.price > ctx.sma ? { value: ctx.price } : undefined;
    case "price_below_sma":
      if (ctx.sma === undefined) return undefined;
      return ctx.price < ctx.sma ? { value: ctx.price } : undefined;
    case "macd_hist_positive":
      if (ctx.macdHist === undefined) return undefined;
      return ctx.macdHist > rule.threshold ? { value: ctx.macdHist } : undefined;
    case "macd_hist_negative":
      if (ctx.macdHist === undefined) return undefined;
      return ctx.macdHist < rule.threshold ? { value: ctx.macdHist } : undefined;
    default:
      return undefined;
  }
};

// ---------- alert settings storage ----------

const ALERT_SETTINGS_KEY = "pine-ts-workbench-alert-settings";

export interface AlertSettings {
  readonly webhookUrl: string;
  readonly webhookHeaders: string;
  readonly telegramBotToken: string;
  readonly telegramChatId: string;
  readonly emailWebhookUrl: string;
  readonly emailRecipient: string;
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

/** Builds the sink list from the alert settings + Binance settings. */
export const buildSinks = (
  alert: AlertSettings,
  binance: BinanceSettings,
): AlertSink[] => {
  const sinks: AlertSink[] = [
    new WebhookSink({ url: alert.webhookUrl, headers: alert.webhookHeaders }),
    new TelegramSink({ botToken: alert.telegramBotToken, chatId: alert.telegramChatId }),
    new EmailSink({ webhookUrl: alert.emailWebhookUrl, recipient: alert.emailRecipient }),
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
