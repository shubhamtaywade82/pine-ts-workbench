import { createHmac } from "node:crypto";

const BASE_URL = "https://api.coindcx.com";
const TIMEOUT_MS = 15_000;

export interface CoindcxBalance { readonly currency: string; readonly balance: number; readonly lockedBalance: number; readonly availableBalance: number; }
export interface CoindcxUserInfo { readonly coindcxId: string; readonly firstName?: string; readonly lastName?: string; readonly email?: string; }
export interface CoindcxPosition {
  readonly id: string; readonly pair: string; readonly side: "LONG" | "SHORT"; readonly size: number;
  readonly entryPrice: number; readonly markPrice: number; readonly liquidationPrice: number; readonly leverage: number;
  readonly margin: number; readonly marginCurrency: string; readonly settlementCurrencyAvgPrice?: number;
  readonly unrealizedPnl: number; readonly pnlPercentage: number;
  readonly takeProfitTrigger?: number; readonly stopLossTrigger?: number; readonly maintenanceMargin?: number;
}
export interface CoindcxOrder {
  readonly id: string; readonly pair: string; readonly side: "buy" | "sell"; readonly price: number;
  readonly quantity: number; readonly status: string; readonly createdAt: number;
  readonly orderType?: string; readonly avgPrice?: number; readonly feeAmount?: number;
}

/** Computes HMAC-SHA256 hex signature required by CoinDCX authenticated endpoints. */
export const signCoindcxPayload = (secret: string, bodyJson: string): string =>
  createHmac("sha256", secret).update(bodyJson).digest("hex");

/** Safely extracts record array whether response is an array or wrapped in a data/positions object. */
export function extractRecords(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  if (typeof raw === "object" && raw !== null) {
    const o = raw as Record<string, unknown>;
    for (const k of ["data", "positions", "active_positions", "result", "orders", "items"]) {
      if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
    }
  }
  return [];
}

/** Returns true if a pair or currency is INR-denominated. */
export const isPairInr = (pair: string): boolean => {
  const p = pair.toUpperCase();
  return p.startsWith("I-") || p.endsWith("INR") || p.includes("_INR");
};

/** Returns currency symbol for price ($ for USDT/USD pairs, ₹ for INR pairs). */
export const pairPriceSymbol = (pair: string): string => isPairInr(pair) ? "₹" : "$";

/** Returns currency symbol for margin or PnL based on margin currency code. */
export const marginCurrencySymbol = (curr: string): string => curr.toUpperCase() === "INR" ? "₹" : "$";

/** Calculates ROE percentage invariant to currency conversion. */
export function calculatePnlPercentage(entry: number, mark: number, lev: number, side: "LONG" | "SHORT"): number {
  if (entry <= 0 || lev <= 0) return 0;
  const diff = side === "LONG" ? mark - entry : entry - mark;
  return (diff / entry) * lev * 100;
}

/** Calculates percentage distance from mark price to liquidation price. */
export function calculateLiqDistance(mark: number, liq: number): number | undefined {
  return mark > 0 && liq > 0 ? ((liq - mark) / mark) * 100 : undefined;
}

const resolveMargin = (m: number, notional: number, conv: number, toInr: boolean) =>
  toInr && m > 0 && m < notional * 2 ? m * conv : m === 0 && notional > 0 ? notional * conv : m;

const resolvePnl = (pnl: number, diff: number, size: number, conv: number) =>
  pnl !== 0 ? pnl : diff * size * conv;

/** Normalizes raw CoinDCX position payload into clean domain type. */
export function normalizeCoindcxPosition(raw: Record<string, unknown>): CoindcxPosition {
  const activePos = Number(raw.active_pos ?? raw.active_units ?? raw.size ?? raw.total_quantity ?? raw.current_qty ?? 0);
  const rawSide = String(raw.side ?? raw.position_type ?? "").toLowerCase();
  const side: "LONG" | "SHORT" = activePos < 0 || rawSide === "sell" || rawSide === "short" ? "SHORT" : "LONG";
  const size = Math.abs(activePos || Number(raw.size ?? raw.quantity ?? 0));
  const entryPrice = Number(raw.avg_price ?? raw.entry_price ?? raw.price ?? 0);
  const markPrice = Number(raw.mark_price ?? raw.current_price ?? entryPrice);
  const leverage = Number(raw.leverage ?? 1);
  const rawPair = String(raw.pair ?? raw.market ?? raw.symbol ?? "");
  const rawMarginCurr = String(raw.margin_currency_short_name ?? raw.margin_currency ?? "").toUpperCase();
  const marginCurrency = rawMarginCurr === "INR" || isPairInr(rawPair) ? "INR" : (rawMarginCurr || "USDT");
  const settlementCurrencyAvgPrice = Number(raw.settlement_currency_avg_price ?? raw.settlement_avg_price ?? 0);

  const conv = settlementCurrencyAvgPrice > 0 ? settlementCurrencyAvgPrice : (marginCurrency === "INR" && !isPairInr(rawPair) ? 89.5 : 1);
  const notional = (entryPrice * size) / (leverage || 1);
  const rawMargin = Number(raw.locked_user_margin ?? raw.margin ?? raw.locked_margin ?? 0);
  const margin = resolveMargin(rawMargin, notional, conv, marginCurrency === "INR" && !isPairInr(rawPair));
  const diff = side === "LONG" ? markPrice - entryPrice : entryPrice - markPrice;
  const unrealizedPnl = resolvePnl(Number(raw.unrealized_pnl ?? raw.pnl ?? 0), diff, size, conv);
  const pnlPercentage = margin > 0 && Math.abs(unrealizedPnl) > 0 ? (unrealizedPnl / margin) * 100 : calculatePnlPercentage(entryPrice, markPrice, leverage, side);
  const tp = Number(raw.take_profit_trigger ?? raw.take_profit ?? 0);
  const sl = Number(raw.stop_loss_trigger ?? raw.stop_loss ?? 0);
  const mm = Number(raw.maintenance_margin ?? 0);

  return {
    id: String(raw.id ?? raw.position_id ?? Math.random().toString(36).slice(2)),
    pair: rawPair,
    side,
    size,
    entryPrice,
    markPrice,
    liquidationPrice: Number(raw.liquidation_price ?? raw.liq_price ?? 0),
    leverage,
    margin,
    marginCurrency,
    settlementCurrencyAvgPrice: settlementCurrencyAvgPrice > 0 ? settlementCurrencyAvgPrice : undefined,
    unrealizedPnl,
    pnlPercentage,
    takeProfitTrigger: tp > 0 ? tp : undefined,
    stopLossTrigger: sl > 0 ? sl : undefined,
    maintenanceMargin: mm > 0 ? mm : undefined,
  };
}

export type CoindcxFuturesWallet = CoindcxBalance;

/** Normalizes raw balance or futures wallet into standard CoindcxBalance. */
export function normalizeCoindcxBalance(raw: Record<string, unknown>): CoindcxBalance {
  const rawBal = Number(raw.balance ?? 0);
  const lockedBalance = Number(raw.locked_balance ?? raw.locked_margin ?? raw.cross_user_margin ?? 0);
  const avail = Number(raw.available_balance ?? raw.free_balance ?? 0);
  // CoinDCX Futures wallet reports available balance in "balance" with total = balance + locked_balance
  const availableBalance = avail > 0 ? avail : (rawBal < lockedBalance ? rawBal : Math.max(0, rawBal - lockedBalance));
  const balance = rawBal < lockedBalance ? rawBal + lockedBalance : rawBal;
  return {
    currency: String(raw.currency_short_name ?? raw.currency ?? raw.margin_currency ?? "").toUpperCase(),
    balance,
    lockedBalance,
    availableBalance,
  };
}

/** Prepares and executes authenticated POST request to CoinDCX. */
async function postSignedRequest<T>(
  endpoint: string,
  apiKey: string,
  apiSecret: string,
  payload: Record<string, unknown>,
  fetchFn: typeof fetch = fetch,
): Promise<T> {
  const jsonBody = JSON.stringify(payload);
  const signature = signCoindcxPayload(apiSecret, jsonBody);
  const url = `${BASE_URL}${endpoint}`;
  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AUTH-APIKEY": apiKey,
      "X-AUTH-SIGNATURE": signature,
    },
    body: jsonBody,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`CoinDCX ${endpoint} HTTP ${res.status}: ${errorText.slice(0, 160)}`);
  }
  return (await res.json()) as T;
}

/** Fetches user wallet balances (spot assets). */
export async function fetchCoindcxBalances(apiKey: string, apiSecret: string, fetchFn?: typeof fetch): Promise<CoindcxBalance[]> {
  const res = await postSignedRequest<unknown>("/exchange/v1/users/balances", apiKey, apiSecret, { timestamp: Date.now() }, fetchFn);
  return extractRecords(res).map(normalizeCoindcxBalance).filter((b) => b.balance > 0 || b.lockedBalance > 0);
}

async function getSignedFuturesWallets(apiKey: string, apiSecret: string, fetchFn?: typeof fetch): Promise<unknown> {
  const timestamp = Math.floor(Date.now() / 1000);
  const jsonBody = JSON.stringify({ timestamp });
  const signature = signCoindcxPayload(apiSecret, jsonBody);
  const headers = { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0", "X-AUTH-APIKEY": apiKey, "X-AUTH-SIGNATURE": signature };
  if (fetchFn) {
    const res = await fetchFn(`${BASE_URL}/exchange/v1/derivatives/futures/wallets`, { method: "GET", headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  const https = await import("node:https");
  return new Promise((resolve, reject) => {
    const req = https.request(`${BASE_URL}/exchange/v1/derivatives/futures/wallets`, {
      method: "GET",
      headers: { ...headers, "Content-Length": Buffer.byteLength(jsonBody) },
      timeout: TIMEOUT_MS,
    }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        if ((res.statusCode ?? 500) >= 400) reject(new Error(`HTTP ${res.statusCode}`));
        else { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    req.write(jsonBody);
    req.end();
  });
}

/** Fetches derivatives futures wallets and margin balance metrics. */
export async function fetchCoindcxFuturesWallets(apiKey: string, apiSecret: string, fetchFn?: typeof fetch): Promise<CoindcxFuturesWallet[]> {
  try {
    const res = await getSignedFuturesWallets(apiKey, apiSecret, fetchFn);
    if (typeof res === "object" && res !== null && !Array.isArray(res)) {
      const o = res as Record<string, unknown>;
      if (o.total_wallet_balance !== undefined || o.available_wallet_balance !== undefined) {
        return [{
          currency: "INR",
          balance: Number(o.total_wallet_balance ?? 0),
          lockedBalance: Number(o.total_initial_margin ?? o.locked_balance ?? 0),
          availableBalance: Number(o.available_wallet_balance ?? 0),
        }];
      }
    }
    return extractRecords(res).map(normalizeCoindcxBalance).filter((b) => b.balance > 0 || b.lockedBalance > 0);
  } catch {
    return [];
  }
}

/** Fetches basic user info for account identification. */
export async function fetchCoindcxUserInfo(apiKey: string, apiSecret: string, fetchFn?: typeof fetch): Promise<CoindcxUserInfo> {
  const raw = (await postSignedRequest<Record<string, unknown>>("/exchange/v1/users/info", apiKey, apiSecret, { timestamp: Date.now() }, fetchFn)) ?? {};
  return {
    coindcxId: String(raw.coindcx_id ?? raw.id ?? "coindcx-user"),
    firstName: raw.first_name ? String(raw.first_name) : undefined,
    lastName: raw.last_name ? String(raw.last_name) : undefined,
    email: raw.email ? String(raw.email) : undefined,
  };
}

/** Fetches active/open futures positions for both INR and USDT margin modes. */
export async function fetchCoindcxPositions(apiKey: string, apiSecret: string, fetchFn?: typeof fetch): Promise<CoindcxPosition[]> {
  const currencies = [["INR"], ["USDT"]];
  const timestampSec = Math.floor(Date.now() / 1000);
  const results = await Promise.allSettled(currencies.map((c) =>
    postSignedRequest<unknown>("/exchange/v1/derivatives/futures/positions", apiKey, apiSecret, { timestamp: timestampSec, page: "1", size: "50", margin_currency_short_name: c }, fetchFn)
  ));
  const seen = new Set<string>();
  const positions: CoindcxPosition[] = [];
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    const defaultCurrency = currencies[i]?.[0] ?? "USDT";
    for (const raw of extractRecords(r.value)) {
      const pos = normalizeCoindcxPosition({ margin_currency_short_name: defaultCurrency, ...raw });
      if (pos.size > 0 && pos.pair.length > 0 && !seen.has(pos.id)) { seen.add(pos.id); positions.push(pos); }
    }
  });
  return positions;
}

/** Fetches futures orders (read-only) across INR and USDT margin modes. */
export async function fetchCoindcxOrders(apiKey: string, apiSecret: string, status = "open", fetchFn?: typeof fetch): Promise<CoindcxOrder[]> {
  const currencies = [["INR"], ["USDT"]];
  const timestampSec = Math.floor(Date.now() / 1000);
  const results = await Promise.allSettled(currencies.map((c) =>
    postSignedRequest<unknown>("/exchange/v1/derivatives/futures/orders", apiKey, apiSecret, { timestamp: timestampSec, status, page: "1", size: "50", margin_currency_short_name: c }, fetchFn)
  ));
  const seen = new Set<string>();
  const orders: CoindcxOrder[] = [];
  results.forEach((r) => {
    if (r.status !== "fulfilled") return;
    for (const raw of extractRecords(r.value)) {
      const id = String(raw.id ?? raw.order_id ?? "");
      if (id && !seen.has(id)) {
        seen.add(id);
        orders.push({
          id,
          pair: String(raw.pair ?? raw.market ?? raw.symbol ?? ""),
          side: String(raw.side ?? "buy").toLowerCase() === "sell" ? "sell" : "buy",
          price: Number(raw.price ?? 0),
          quantity: Number(raw.total_quantity ?? raw.quantity ?? 0),
          status: String(raw.status ?? "open"),
          createdAt: Number(raw.created_at ?? Date.now()),
          orderType: String(raw.order_type ?? "limit_order"),
          avgPrice: Number(raw.avg_price ?? raw.price ?? 0),
          feeAmount: Number(raw.fee_amount ?? 0),
        });
      }
    }
  });
  return orders;
}

export const fetchCoindcxActiveOrders = (k: string, s: string, f?: typeof fetch) => fetchCoindcxOrders(k, s, "open", f);
export const fetchCoindcxOrderHistory = (k: string, s: string, f?: typeof fetch) => fetchCoindcxOrders(k, s, "filled,cancelled", f);
