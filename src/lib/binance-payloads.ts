import type { DepthSnapshot, DepthUpdate } from "./order-book";
import type { BinanceTrade } from "./public-binance-feed";

// Socket frames arrive as untyped JSON, and the book/candle code assumes the
// documented field shapes; these guards are the single boundary that proves
// it before untrusted data reaches either.
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isInteger = (value: unknown): value is number =>
  isFiniteNumber(value) && Number.isInteger(value);

const parseText = (value: unknown): number | undefined => {
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const isNonNegativeText = (value: unknown): boolean => (parseText(value) ?? -1) >= 0;

const isPositiveText = (value: unknown): boolean => (parseText(value) ?? 0) > 0;

const isLevelPair = (value: unknown): boolean =>
  Array.isArray(value) && value.length === 2 && isNonNegativeText(value[0]) && isNonNegativeText(value[1]);

/** `depthUpdate` frame: integer ids with `U <= u`, bid/ask levels as `[price, qty]` decimal strings. */
export const isDepthUpdate = (value: unknown): value is DepthUpdate => {
  if (typeof value !== "object" || value === null) return false;
  const frame = value as Partial<DepthUpdate>;
  if (!isInteger(frame.U) || !isInteger(frame.u) || frame.U > frame.u) return false;
  if (!Array.isArray(frame.b) || !Array.isArray(frame.a)) return false;
  return frame.b.every(isLevelPair) && frame.a.every(isLevelPair);
};

/** REST `GET /api/v3/depth` snapshot: integer `lastUpdateId`, bid/ask levels as `[price, qty]` decimal strings. */
export const isDepthSnapshot = (value: unknown): value is DepthSnapshot => {
  if (typeof value !== "object" || value === null) return false;
  const snap = value as Partial<DepthSnapshot>;
  if (!isInteger(snap.lastUpdateId)) return false;
  if (!Array.isArray(snap.bids) || !Array.isArray(snap.asks)) return false;
  return snap.bids.every(isLevelPair) && snap.asks.every(isLevelPair);
};

/** Raw trade frame: `e === "trade"`, integer id, positive price/qty strings, finite time, boolean maker flag. */
export const isBinanceTrade = (value: unknown): value is BinanceTrade => {
  if (typeof value !== "object" || value === null) return false;
  const frame = value as Partial<BinanceTrade>;
  if (frame.e !== "trade" || !isInteger(frame.t) || !isFiniteNumber(frame.T)) return false;
  if (typeof frame.m !== "boolean") return false;
  return isPositiveText(frame.p) && isPositiveText(frame.q);
};
