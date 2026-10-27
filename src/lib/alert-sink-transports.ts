import type { BinanceSettings } from "@/components/trading/settings-dialog";
import { RealBinanceTradingSurface } from "@/lib/real-binance-trading-surface";

export interface AlertEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly symbol: string;
  readonly condition: string;
  readonly value: number;
  readonly threshold: number;
  readonly action?: string;
  readonly message: string;
}

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
  deliver(event: AlertEvent): Promise<AlertDeliveryResult>;
}

export class WebhookSink implements AlertSink {
  public readonly id = "webhook";
  public readonly name = "Webhook";
  public constructor(private readonly config: { readonly url: string; readonly headers?: string }) {}

  public async deliver(event: AlertEvent): Promise<AlertDeliveryResult> {
    if (!this.config.url) {
      return { sinkId: this.id, sinkName: this.name, status: "skipped", message: "No URL", timestamp: new Date().toISOString() };
    }
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.config.headers) {
        try { Object.assign(headers, JSON.parse(this.config.headers)); } catch { /* ignore malformed */ }
      }
      const res = await fetch(this.config.url, { method: "POST", headers, body: JSON.stringify(event) });
      if (!res.ok) {
        return { sinkId: this.id, sinkName: this.name, status: "failed", message: `HTTP ${res.status}`, timestamp: new Date().toISOString() };
      }
      return { sinkId: this.id, sinkName: this.name, status: "delivered", message: "Posted", timestamp: new Date().toISOString() };
    } catch (err) {
      return { sinkId: this.id, sinkName: this.name, status: "failed", message: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() };
    }
  }
}

export class TelegramSink implements AlertSink {
  public readonly id = "telegram";
  public readonly name = "Telegram";
  public constructor(private readonly config: { readonly botToken: string; readonly chatId: string }) {}

  public async deliver(event: AlertEvent): Promise<AlertDeliveryResult> {
    if (!this.config.botToken || !this.config.chatId) {
      return { sinkId: this.id, sinkName: this.name, status: "skipped", message: "Missing token or chat ID", timestamp: new Date().toISOString() };
    }
    try {
      const text = `🔔 *Alert: ${event.symbol}*\n${event.message}\n\nCondition: ${event.condition}\nTime: ${event.timestamp}`;
      const res = await fetch(`https://api.telegram.org/bot${this.config.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: this.config.chatId, text, parse_mode: "Markdown" }),
      });
      return {
        sinkId: this.id,
        sinkName: this.name,
        status: res.ok ? "delivered" : "failed",
        message: res.ok ? "Sent" : `Telegram ${res.status}`,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return { sinkId: this.id, sinkName: this.name, status: "failed", message: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() };
    }
  }
}

export class EmailSink implements AlertSink {
  public readonly id = "email";
  public readonly name = "Email";
  public constructor(private readonly config: { readonly webhookUrl: string; readonly recipient: string }) {}

  public async deliver(event: AlertEvent): Promise<AlertDeliveryResult> {
    if (!this.config.webhookUrl || !this.config.recipient) {
      return { sinkId: this.id, sinkName: this.name, status: "skipped", message: "Missing email config", timestamp: new Date().toISOString() };
    }
    try {
      const res = await fetch(this.config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: this.config.recipient,
          subject: `Alert: ${event.symbol} — ${event.condition}`,
          body: `${event.message}\n\nSymbol: ${event.symbol}\nTimestamp: ${event.timestamp}`,
        }),
      });
      return {
        sinkId: this.id,
        sinkName: this.name,
        status: res.ok ? "delivered" : "failed",
        message: res.ok ? "Sent" : `Email ${res.status}`,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return { sinkId: this.id, sinkName: this.name, status: "failed", message: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() };
    }
  }
}

export class BrokerActionSink implements AlertSink {
  public readonly id = "broker-action";
  public readonly name = "Broker Action";
  public constructor(private readonly config: {
    readonly binanceSettings: BinanceSettings;
    readonly side: "BUY" | "SELL";
    readonly quantity: number;
    readonly orderType: "MARKET" | "LIMIT";
  }) {}

  public async deliver(event: AlertEvent): Promise<AlertDeliveryResult> {
    const s = this.config.binanceSettings;
    if (!s.apiKey || !s.apiSecret || !s.liveTradeEnabled) {
      return { sinkId: this.id, sinkName: this.name, status: "skipped", message: "Live trading disabled or unconfigured", timestamp: new Date().toISOString() };
    }
    try {
      const surface = new RealBinanceTradingSurface({ apiKey: s.apiKey, apiSecret: s.apiSecret, liveTradeEnabled: s.liveTradeEnabled });
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
      const ok = res.status === "FILLED" || res.status === "NEW";
      return { sinkId: this.id, sinkName: this.name, status: ok ? "delivered" : "failed", message: `Order ${res.orderId}: ${res.status}`, timestamp: new Date().toISOString() };
    } catch (err) {
      return { sinkId: this.id, sinkName: this.name, status: "failed", message: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() };
    }
  }
}

export class BrowserNotificationSink implements AlertSink {
  public readonly id = "browser-notification";
  public readonly name = "Browser Notification";
  public constructor(private readonly isEnabled: boolean) {}

  public async deliver(event: AlertEvent): Promise<AlertDeliveryResult> {
    if (!this.isEnabled || typeof window === "undefined" || !("Notification" in window)) {
      return { sinkId: this.id, sinkName: this.name, status: "skipped", message: "Notifications disabled or unsupported", timestamp: new Date().toISOString() };
    }
    try {
      let perm = Notification.permission;
      if (perm === "default") {
        perm = await Notification.requestPermission();
      }
      if (perm !== "granted") {
        return { sinkId: this.id, sinkName: this.name, status: "skipped", message: "Permission not granted", timestamp: new Date().toISOString() };
      }
      new Notification(`[${event.symbol}] Alert`, {
        body: event.message,
        icon: "/favicon.ico",
      });
      return { sinkId: this.id, sinkName: this.name, status: "delivered", message: "Displayed", timestamp: new Date().toISOString() };
    } catch (err) {
      return { sinkId: this.id, sinkName: this.name, status: "failed", message: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() };
    }
  }
}
