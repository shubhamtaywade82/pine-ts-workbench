import { describe, expect, it } from "bun:test";
import {
  calculateLiqDistance,
  calculatePnlPercentage,
  extractRecords,
  isPairInr,
  marginCurrencySymbol,
  normalizeCoindcxBalance,
  normalizeCoindcxPosition,
  pairPriceSymbol,
  signCoindcxPayload,
  fetchCoindcxFuturesWallets,
  fetchCoindcxOrders,
  fetchCoindcxPositions,
} from "./coindcx-client";

describe("coindcx-client", () => {
  it("calculatePnlPercentage computes exact ROE invariant to currency", () => {
    // LONG profit: entry $60,000, mark $66,000, 10x leverage -> +100%
    expect(calculatePnlPercentage(60000, 66000, 10, "LONG")).toBe(100);
    // LONG loss: entry $60,000, mark $59,000, 10x leverage -> -16.67%
    expect(calculatePnlPercentage(60000, 59000, 10, "LONG")).toBeCloseTo(-16.67, 1);
    // SHORT profit: entry 6,000,000, mark 5,900,000, 20x leverage -> +33.33%
    expect(calculatePnlPercentage(6000000, 5900000, 20, "SHORT")).toBeCloseTo(33.33, 1);
    // SHORT loss: entry 6,000,000, mark 6,100,000, 20x leverage -> -33.33%
    expect(calculatePnlPercentage(6000000, 6100000, 20, "SHORT")).toBeCloseTo(-33.33, 1);
    // Boundary conditions
    expect(calculatePnlPercentage(0, 60000, 10, "LONG")).toBe(0);
    expect(calculatePnlPercentage(60000, 60000, 0, "LONG")).toBe(0);
  });

  it("pairPriceSymbol and marginCurrencySymbol format currency correctly", () => {
    expect(pairPriceSymbol("B-BTC_USDT")).toBe("$");
    expect(pairPriceSymbol("BTCUSDT")).toBe("$");
    expect(pairPriceSymbol("I-BTC_INR")).toBe("₹");
    expect(pairPriceSymbol("BTCINR")).toBe("₹");

    expect(marginCurrencySymbol("INR")).toBe("₹");
    expect(marginCurrencySymbol("USDT")).toBe("$");
  });

  it("normalizeCoindcxPosition parses settlementCurrencyAvgPrice and calculates INR margin/PnL", () => {
    const raw = {
      id: "pos-inr-usdt-1",
      pair: "B-BTC_USDT",
      active_pos: 0.1,
      avg_price: 60000,
      mark_price: 65000,
      leverage: 10,
      margin_currency_short_name: "INR",
      settlement_currency_avg_price: 90,
    };
    const pos = normalizeCoindcxPosition(raw);
    expect(pos.marginCurrency).toBe("INR");
    expect(pos.settlementCurrencyAvgPrice).toBe(90);
    // Notional in USDT: (60000 * 0.1) / 10 = 600 USDT. In INR: 600 * 90 = 54,000 INR
    expect(pos.margin).toBe(54000);
    // PnL in USDT: (65000 - 60000) * 0.1 = 500 USDT. In INR: 500 * 90 = 45,000 INR
    expect(pos.unrealizedPnl).toBe(45000);
    // ROE percentage: (5,000 / 60,000) * 10 * 100 = 83.33% (NOT 7,500% multiplied by 90)
    expect(pos.pnlPercentage).toBeCloseTo(83.33, 1);
  });

  it("normalizeCoindcxPosition correctly handles raw USDT margin on INR contracts without 89.5x magnification", () => {
    // When CoinDCX returns raw USDT margin (e.g. 5 USDT) for B-BTC_USDT with INR margin mode:
    const raw = {
      id: "pos-inr-usdt-loss",
      pair: "B-BTC_USDT",
      active_pos: 0.001,
      avg_price: 100000,
      mark_price: 99000, // 1% drop
      leverage: 20, // Expected ROE: -1% * 20 = -20%
      margin: 5, // Raw USDT margin reported by CoinDCX
      margin_currency_short_name: "INR",
      settlement_currency_avg_price: 90,
      unrealized_pnl: -90, // CoinDCX reports INR PnL: -1 USDT * 90 = -90 INR
    };
    const pos = normalizeCoindcxPosition(raw);
    expect(pos.marginCurrency).toBe("INR");
    // Margin is converted to INR: 5 * 90 = 450 INR
    expect(pos.margin).toBe(450);
    expect(pos.unrealizedPnl).toBe(-90);
    // ROE is strictly -20%, NEVER -1800% or -930.7%!
    expect(pos.pnlPercentage).toBeCloseTo(-20, 1);
  });
  it("isPairInr accurately detects INR denominated pairs", () => {
    expect(isPairInr("I-BTC_INR")).toBe(true);
    expect(isPairInr("BTCINR")).toBe(true);
    expect(isPairInr("ETH_INR")).toBe(true);
    expect(isPairInr("B-BTC_USDT")).toBe(false);
    expect(isPairInr("BTCUSDT")).toBe(false);
  });

  it("normalizeCoindcxPosition sets marginCurrency to INR for I- prefixed pairs even if missing in payload", () => {
    const raw = {
      id: "pos-inr-1",
      pair: "I-ETH_INR",
      active_pos: 1.5,
      avg_price: 300000,
      mark_price: 310000,
      liquidation_price: 250000,
      leverage: 10,
    };
    const pos = normalizeCoindcxPosition(raw);
    expect(pos.marginCurrency).toBe("INR");
    expect(pos.side).toBe("LONG");
    expect(pos.size).toBe(1.5);
  });
  it("signCoindcxPayload creates correct HMAC-SHA256 hex signature", () => {
    const secret = "test-secret-key-123";
    const payload = JSON.stringify({ timestamp: 1710000000000, page: "1", size: "10" });
    const sig = signCoindcxPayload(secret, payload);
    expect(typeof sig).toBe("string");
    expect(sig.length).toBe(64);
    expect(signCoindcxPayload(secret, payload)).toBe(sig);
  });

  it("extractRecords handles arrays and wrapped response objects", () => {
    expect(extractRecords([{ id: 1 }])).toHaveLength(1);
    expect(extractRecords({ data: [{ id: 2 }] })).toHaveLength(1);
    expect(extractRecords({ positions: [{ id: 3 }] })).toHaveLength(1);
    expect(extractRecords(null)).toHaveLength(0);
    expect(extractRecords("unknown")).toHaveLength(0);
  });

  it("normalizeCoindcxPosition maps active_pos and avg_price for LONG", () => {
    const raw = {
      id: "pos-101",
      pair: "B-BTC_USDT",
      active_pos: 0.5,
      avg_price: 60000,
      mark_price: 66000,
      liquidation_price: 48000,
      leverage: 10,
      locked_margin: 3000,
      margin_currency_short_name: "USDT",
      unrealized_pnl: 3000,
    };
    const pos = normalizeCoindcxPosition(raw);
    expect(pos.id).toBe("pos-101");
    expect(pos.pair).toBe("B-BTC_USDT");
    expect(pos.side).toBe("LONG");
    expect(pos.size).toBe(0.5);
    expect(pos.entryPrice).toBe(60000);
    expect(pos.markPrice).toBe(66000);
    expect(pos.liquidationPrice).toBe(48000);
    expect(pos.leverage).toBe(10);
    expect(pos.margin).toBe(3000);
    expect(pos.unrealizedPnl).toBe(3000);
    expect(pos.pnlPercentage).toBe(100);
  });

  it("normalizeCoindcxPosition maps active_pos negative value as SHORT", () => {
    const raw = {
      id: "pos-102",
      pair: "I-BTC_INR",
      active_pos: -0.25,
      avg_price: 6000000,
      mark_price: 5900000,
      liquidation_price: 6600000,
      leverage: 20,
      locked_margin: 75000,
      margin_currency_short_name: "INR",
      unrealized_pnl: 25000,
    };
    const pos = normalizeCoindcxPosition(raw);
    expect(pos.side).toBe("SHORT");
    expect(pos.size).toBe(0.25);
    expect(pos.marginCurrency).toBe("INR");
    expect(pos.unrealizedPnl).toBe(25000);
    expect(pos.pnlPercentage).toBeCloseTo(33.33, 1);
  });

  it("normalizeCoindcxBalance extracts valid balances and futures wallets", () => {
    const rawSpot = {
      currency: "INR",
      balance: "5000.5",
      locked_balance: "1000",
    };
    const bal = normalizeCoindcxBalance(rawSpot);
    expect(bal.currency).toBe("INR");
    expect(bal.balance).toBe(5000.5);
    expect(bal.lockedBalance).toBe(1000);
    expect(bal.availableBalance).toBe(4000.5);

    const rawFutures = {
      currency_short_name: "INR",
      balance: 33226.36,
      locked_balance: 33221.73,
      available_balance: 4.62,
    };
    const fBal = normalizeCoindcxBalance(rawFutures);
    expect(fBal.currency).toBe("INR");
    expect(fBal.balance).toBe(33226.36);
    expect(fBal.lockedBalance).toBe(33221.73);
    expect(fBal.availableBalance).toBe(4.62);
  });

  it("fetchCoindcxFuturesWallets fetches and parses futures balances from cross_margin_details", async () => {
    const mockFetch = (async () => {
      return new Response(JSON.stringify({
        total_wallet_balance: 33226.36,
        total_initial_margin: 33221.73,
        available_wallet_balance: 4.62,
        total_account_equity: 41464.07,
        pnl: 8237.70,
      }), { status: 200 });
    }) as unknown as typeof fetch;

    const wallets = await fetchCoindcxFuturesWallets("key", "sec", mockFetch);
    expect(wallets).toHaveLength(1);
    expect(wallets[0]?.currency).toBe("INR");
    expect(wallets[0]?.balance).toBe(33226.36);
    expect(wallets[0]?.lockedBalance).toBe(33221.73);
    expect(wallets[0]?.availableBalance).toBe(4.62);
  });

  it("fetchCoindcxPositions queries both INR and USDT margin modes", async () => {
    const queriedBodies: string[] = [];
    const mockFetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      queriedBodies.push(String(init?.body ?? ""));
      return new Response(JSON.stringify([
        {
          id: "pos-1",
          pair: "I-BTC_INR",
          active_pos: 0.1,
          avg_price: 6500000,
          mark_price: 6700000,
          liquidation_price: 5500000,
          leverage: 10,
          margin: 65000,
          margin_currency_short_name: "INR",
          unrealized_pnl: 20000,
        },
      ]), { status: 200 });
    }) as typeof fetch;

    const positions = await fetchCoindcxPositions("key123", "sec456", mockFetch);
    expect(queriedBodies.length).toBe(2);
    expect(queriedBodies.some((b) => b.includes('"INR"'))).toBe(true);
    expect(queriedBodies.some((b) => b.includes('"USDT"'))).toBe(true);
    expect(positions).toHaveLength(1);
    expect(positions[0]?.pair).toBe("I-BTC_INR");
    expect(positions[0]?.side).toBe("LONG");
  });

  it("calculateLiqDistance calculates percentage from mark to liquidation", () => {
    // LONG: mark 100, liq 90 -> -10%
    expect(calculateLiqDistance(100, 90)).toBe(-10);
    // SHORT: mark 100, liq 110 -> +10%
    expect(calculateLiqDistance(100, 110)).toBe(10);
    // Boundary conditions
    expect(calculateLiqDistance(0, 90)).toBeUndefined();
    expect(calculateLiqDistance(100, 0)).toBeUndefined();
  });

  it("normalizeCoindcxPosition extracts TP, SL and maintenance margin", () => {
    const raw = {
      id: "pos-tpsl",
      pair: "B-SOL_USDT",
      active_pos: 45.53,
      avg_price: 71.113,
      mark_price: 72.13,
      take_profit_trigger: 85.0,
      stop_loss_trigger: 68.0,
      maintenance_margin: 1500,
    };
    const pos = normalizeCoindcxPosition(raw);
    expect(pos.takeProfitTrigger).toBe(85.0);
    expect(pos.stopLossTrigger).toBe(68.0);
    expect(pos.maintenanceMargin).toBe(1500);
  });

  it("fetchCoindcxOrders forwards status filter and parses order types", async () => {
    const mockFetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      return new Response(JSON.stringify([
        { id: "ord-1", pair: "B-SOL_USDT", side: "buy", price: 71.0, total_quantity: 45.53, status: body.status, order_type: "limit_order" },
      ]), { status: 200 });
    }) as typeof fetch;

    const orders = await fetchCoindcxOrders("key", "sec", "filled,cancelled", mockFetch);
    expect(orders).toHaveLength(1);
    expect(orders[0]?.status).toBe("filled,cancelled");
    expect(orders[0]?.orderType).toBe("limit_order");
  });
});
