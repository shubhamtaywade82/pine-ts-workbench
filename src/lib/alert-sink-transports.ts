import type { BinanceSettings } from "@/components/trading/settings-dialog";
import { BINANCE_REST_URL } from "./binance-endpoints";
import {
  EMPTY_GUARD_STATE,
  checkOrder,
  recordOrder,
  type GuardState,
  type GuardedOrder,
  type OrderGuardLimits,
} from "./order-guard";

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

export interface BrokerOrderRequest {
  readonly symbol: string;
  readonly side: "BUY" | "SELL";
  readonly type: "MARKET" | "LIMIT";
  readonly quantity: number;
  readonly clientOrderId: string;
}

/** The sink's outside world, injected so the guard path is testable without a network or storage. */
export interface BrokerSinkDeps {
  readonly now: () => number;
  /** Last traded price, used for the notional check because a MARKET order carries no price. */
  readonly fetchPrice: (symbol: string) => Promise<number>;
  readonly readGuard: () => GuardState;
  readonly writeGuard: (state: GuardState) => void;
  readonly submit: (order: BrokerOrderRequest, keys: BinanceSettings) => Promise<{ orderId: string | number; status: string }>;
}

export class BrokerActionSink implements AlertSink {
  public readonly id = "broker-action";
  public readonly name = "Broker Action";
  public constructor(
    private readonly config: {
      readonly binanceSettings: BinanceSettings;
      readonly side: "BUY" | "SELL";
      readonly quantity: number;
      readonly orderType: "MARKET" | "LIMIT";
      readonly limits: OrderGuardLimits;
    },
    private readonly deps: BrokerSinkDeps = BROWSER_BROKER_DEPS,
  ) {}

  public async deliver(event: AlertEvent): Promise<AlertDeliveryResult> {
    const s = this.config.binanceSettings;
    if (!s.apiKey || !s.apiSecret || !s.liveTradeEnabled) return this.result("skipped", "Live trading disabled or unconfigured");
    let price: number;
    try {
      price = await this.deps.fetchPrice(event.symbol);
    } catch (err) {
      // Fail closed: without a price the notional caps cannot be checked.
      return this.result("skipped", `Blocked - price unavailable: ${errorText(err)}`);
    }
    const order = { symbol: event.symbol, notional: price * this.config.quantity, at: this.deps.now() };
    const state = this.deps.readGuard();
    const verdict = checkOrder(order, this.config.limits, state);
    if (!verdict.ok) return this.result("skipped", `Blocked - ${verdict.reason}`);
    return this.send(event, order, state);
  }

  private async send(event: AlertEvent, order: GuardedOrder, state: GuardState): Promise<AlertDeliveryResult> {
    try {
      const res = await this.deps.submit({
        symbol: event.symbol, side: this.config.side, type: this.config.orderType,
        quantity: this.config.quantity, clientOrderId: `alert-${event.id}`,
      }, this.config.binanceSettings);
      // Recorded once the exchange accepted the request, so the caps count real orders only.
      this.deps.writeGuard(recordOrder(state, order));
      const ok = res.status === "FILLED" || res.status === "NEW";
      return this.result(ok ? "delivered" : "failed", `Order ${res.orderId}: ${res.status}`);
    } catch (err) {
      return this.result("failed", errorText(err));
    }
  }

  private result(status: DeliveryStatus, message: string): AlertDeliveryResult {
    return { sinkId: this.id, sinkName: this.name, status, message, timestamp: new Date().toISOString() };
  }
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const GUARD_STORAGE_KEY = "pine-ts-workbench-order-guard";

const isGuardState = (value: unknown): value is GuardState => {
  if (typeof value !== "object" || value === null) return false;
  const { armedUntil, history } = value as Partial<GuardState>;
  const armedOk = armedUntil === null || (typeof armedUntil === "number" && Number.isFinite(armedUntil));
  return armedOk && Array.isArray(history)
    && history.every((entry) => Number.isFinite(entry?.at) && Number.isFinite(entry?.notional));
};

/** Reads the persisted guard state; anything unreadable counts as disarmed with no history. */
export const loadGuardState = (): GuardState => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(GUARD_STORAGE_KEY) ?? "null");
    return isGuardState(parsed) ? parsed : EMPTY_GUARD_STATE;
  } catch (err) {
    console.warn("Order guard state unreadable; treating alert orders as disarmed:", err);
    return EMPTY_GUARD_STATE;
  }
};

export const saveGuardState = (state: GuardState): void => {
  try {
    window.localStorage.setItem(GUARD_STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn("Order guard state could not be saved:", err);
  }
};

const fetchLastPrice = async (symbol: string): Promise<number> => {
  const res = await fetch(`${BINANCE_REST_URL}/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const price = Number(((await res.json()) as { price?: unknown }).price);
  if (!(price > 0) || !Number.isFinite(price)) throw new Error("no valid price in response");
  return price;
};

const submitWithSdk: BrokerSinkDeps["submit"] = async (order, keys) => {
  // Loaded on first use: the Binance SDK is the largest chunk in the app and most alerts never trade.
  const { RealBinanceTradingSurface } = await import("@/lib/real-binance-trading-surface");
  const surface = new RealBinanceTradingSurface({ apiKey: keys.apiKey, apiSecret: keys.apiSecret, liveTradeEnabled: keys.liveTradeEnabled });
  return surface.newOrder({ ...order, price: undefined, stopPrice: undefined, timeInForce: "GTC" });
};

const BROWSER_BROKER_DEPS: BrokerSinkDeps = {
  now: () => Date.now(),
  fetchPrice: fetchLastPrice,
  readGuard: loadGuardState,
  writeGuard: saveGuardState,
  submit: submitWithSdk,
};

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
