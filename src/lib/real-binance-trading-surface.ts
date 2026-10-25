"use client";

import { BinanceClient } from "@nemesis-oss/binance-sdk";
import type { BinanceTradingSurface, BinanceOrderResponse, BinanceNewOrderParams, BinancePositionResponse, BinanceOrderUpdateEvent } from "@nemesis-oss/pine-ts";

/**
 * Real Binance SDK → pine-ts BinanceTradingSurface adapter.
 *
 * Wraps `@nemesis-oss/binance-sdk`'s `BinanceClient.spot.trading` +
 * `BinanceClient.spot.account` surfaces so they satisfy the
 * `BinanceTradingSurface` contract from pine-ts. When the user provides
 * real API credentials in the workbench Settings dialog, this adapter:
 *
 *  - `newOrder(params)` → `spot.trading.createOrder(params)` and maps the
 *    SDK's SpotOrder response to `BinanceOrderResponse`.
 *  - `cancelOrder({ symbol, orderId })` → `spot.trading.cancelOrder(...)`.
 *  - `getPosition(symbol)` → Spot positions don't exist (spot is
 *    "deliver now, pay now"); we synthesize one from the account's
 *    `balances` array for the base asset.
 *  - `getBalance()` → `spot.account.account()` and returns the USDT
 *    free balance.
 *  - `onOrderUpdate(callback)` → subscribes to `spot.userStream` (the
 *    user-data WebSocket stream that pushes execution reports).
 *
 * Security notes (surfaced in the Settings dialog):
 *  - API keys are stored in the browser's `localStorage`. Only use this
 *    on a trusted device. For production, run pine-ts as a backend
 *    service.
 *  - Recommend API key permissions: "Spot Trading + Read" only; never
 *    enable withdrawals.
 *  - Testnet by default (`testnet: true`). Mainnet requires the user
 *    to explicitly toggle `liveTradeEnabled` AND select "mainnet" in
 *    the Settings dialog — two intentional confirmations.
 */

export interface RealBinanceOptions {
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly testnet: boolean;
  /** When false (default), every order submission throws "Live trading disabled". */
  readonly liveTradeEnabled: boolean;
}

export class RealBinanceTradingSurface implements BinanceTradingSurface {
  private readonly client: BinanceClient;
  private readonly liveTradeEnabled: boolean;
  private userStreamStarted = false;
  private userStreamCallbacks = new Set<(event: BinanceOrderUpdateEvent) => void>();

  public constructor(options: RealBinanceOptions) {
    this.client = new BinanceClient({
      apiKey: options.apiKey,
      apiSecret: options.apiSecret,
      testnet: options.testnet,
    });
    this.liveTradeEnabled = options.liveTradeEnabled;
  }

  /** Guards every order submission. Returns true if the live-trade flag is enabled. */
  private assertLiveEnabled(): void {
    if (!this.liveTradeEnabled) {
      throw new Error(
        "Live trading is disabled. Enable 'liveTradeEnabled' in Settings and confirm you understand the risk.",
      );
    }
  }

  public async newOrder(params: BinanceNewOrderParams): Promise<BinanceOrderResponse> {
    this.assertLiveEnabled();
    // The SDK's createOrder takes the Binance REST order params directly.
    const order = await this.client.spot.trading.createOrder({
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      quantity: params.quantity,
      price: params.price,
      stopPrice: params.stopPrice,
      timeInForce: params.timeInForce,
      newClientOrderId: params.clientOrderId,
    });
    return {
      orderId: String(order.orderId),
      status: mapBinanceStatusToPine(order.status),
      executedQty: Number(order.executedQty),
      avgPrice: order.avgPrice !== undefined ? Number(order.avgPrice) : undefined,
      rejectReason: undefined,
    };
  }

  public async cancelOrder(params: { symbol: string; orderId: string }): Promise<void> {
    this.assertLiveEnabled();
    await this.client.spot.trading.cancelOrder({
      symbol: params.symbol,
      orderId: Number(params.orderId),
    });
  }

  public async getPosition(symbol: string): Promise<BinancePositionResponse | undefined> {
    // Spot trading: "deliver now, pay now" — there's no real position.
    // We synthesize one from the account balances: the base asset's free
    // balance is the "position size" (always LONG, since spot can't be short).
    const base = extractBaseAsset(symbol);
    if (base === undefined) return undefined;
    const account = await this.client.spot.account.account();
    const balance = account.balances?.find((b) => b.asset === base);
    if (balance === undefined) return undefined;
    const qty = Number(balance.free);
    if (qty === 0) return undefined;
    return {
      symbol,
      side: "LONG",
      qty,
      avgEntryPrice: 0,
      unrealisedPnl: 0,
    };
  }

  public async getBalance(): Promise<number> {
    const account = await this.client.spot.account.account();
    const usdt = account.balances?.find((b) => b.asset === "USDT");
    return usdt !== undefined ? Number(usdt.free) : 0;
  }

  public onOrderUpdate(callback: (event: BinanceOrderUpdateEvent) => void): () => void {
    this.userStreamCallbacks.add(callback);
    void this.startUserStreamIfNeeded();
    return () => {
      this.userStreamCallbacks.delete(callback);
    };
  }

  /** Starts the user-data WebSocket stream (order execution reports). */
  private async startUserStreamIfNeeded(): Promise<void> {
    if (this.userStreamStarted) return;
    this.userStreamStarted = true;
    try {
      // The SDK exposes spot.userStream or spot.wsUser depending on version.
      // We use the userStream API if available; otherwise fall back to wsUser.
      const userStream = (this.client.spot as unknown as {
        userStream?: { start: () => Promise<string>; onExecutionReport?: (cb: (e: unknown) => void) => void };
        wsUser?: { start: () => Promise<string>; onExecutionReport?: (cb: (e: unknown) => void) => void };
      }).userStream ?? (this.client.spot as unknown as {
        wsUser?: { start: () => Promise<string>; onExecutionReport?: (cb: (e: unknown) => void) => void };
      }).wsUser;
      if (userStream === undefined) return;
      await userStream.start();
      userStream.onExecutionReport?.((raw) => {
        const event = mapExecutionReportToPine(raw);
        if (event === undefined) return;
        for (const cb of this.userStreamCallbacks) cb(event);
      });
    } catch {
      // User-data stream failed to start — order updates won't fire.
      // Trading still works; the workbench will poll getOpenOrders instead.
    }
  }
}

/** Maps a Binance SDK order status string to pine-ts's BinanceOrderStatus. */
const mapBinanceStatusToPine = (
  status: string,
): "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" => {
  switch (status) {
    case "FILLED": return "FILLED";
    case "PARTIALLY_FILLED": return "PARTIALLY_FILLED";
    case "CANCELED": return "CANCELED";
    case "REJECTED":
    case "EXPIRED": return "REJECTED";
    case "NEW":
    case "PENDING_NEW":
    default: return "NEW";
  }
};

/** Maps a raw execution report from the user-data stream to a BinanceOrderUpdateEvent. */
const mapExecutionReportToPine = (raw: unknown): BinanceOrderUpdateEvent | undefined => {
  if (typeof raw !== "object" || raw === null) return undefined;
  const e = raw as Record<string, unknown>;
  return {
    orderId: String(e.i ?? e.orderId ?? ""),
    clientOrderId: String(e.c ?? e.clientOrderId ?? ""),
    status: mapBinanceStatusToPine(String(e.X ?? e.status ?? "NEW")),
    executedQty: Number(e.z ?? e.executedQty ?? 0),
    avgPrice: e.avgPrice !== undefined ? Number(e.avgPrice) : undefined,
    rejectReason: undefined,
    symbol: String(e.s ?? e.symbol ?? ""),
  };
};

/** Extracts the base asset from a Binance symbol (e.g. "BTCUSDT" → "BTC"). */
const extractBaseAsset = (symbol: string): string | undefined => {
  // Common quote assets on Binance Spot: USDT, BUSD, USDC, TUSD, FDUSD, BTC, ETH, BNB.
  const quotes = ["USDT", "BUSD", "USDC", "TUSD", "FDUSD", "BTC", "ETH", "BNB"];
  for (const q of quotes) {
    if (symbol.endsWith(q) && symbol.length > q.length) {
      return symbol.slice(0, -q.length);
    }
  }
  return undefined;
};
