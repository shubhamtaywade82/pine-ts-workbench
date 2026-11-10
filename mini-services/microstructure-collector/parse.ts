import { isBinanceTrade, isDepthUpdate } from "../../src/lib/binance-payloads";
import type { DepthUpdate } from "../../src/lib/order-book";
import type { BinanceTrade } from "../../src/lib/public-binance-feed";

// Binance combined streams wrap payloads in { data }, whereas direct streams emit the event directly.
const unwrapData = (value: unknown): unknown => {
  if (typeof value === "object" && value !== null && "data" in value) {
    return (value as { data: unknown }).data;
  }
  return value;
};

const textDecoder = new TextDecoder();

// Binary frames from WebSocket transports require UTF-8 decoding before JSON parsing.
const decodeRaw = (raw: unknown): string | undefined => {
  if (typeof raw === "string") return raw;
  if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) {
    return textDecoder.decode(raw);
  }
  return undefined;
};

const safeParseJson = (raw: unknown): unknown => {
  const text = decodeRaw(raw);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** Parses and validates depth socket payloads; drops malformed JSON or invalid depth shapes. */
export const parseDepthMessage = (raw: unknown): DepthUpdate | undefined => {
  const parsed = safeParseJson(raw);
  if (parsed === undefined) return undefined;
  const payload = unwrapData(parsed);
  return isDepthUpdate(payload) ? payload : undefined;
};

/** Parses and validates trade socket payloads; drops malformed JSON or invalid trade shapes. */
export const parseTradeMessage = (raw: unknown): BinanceTrade | undefined => {
  const parsed = safeParseJson(raw);
  if (parsed === undefined) return undefined;
  const payload = unwrapData(parsed);
  return isBinanceTrade(payload) ? payload : undefined;
};

const ONE_MINUTE_MS = 60_000;

// Rate-limits warning logs to avoid flooding console during high-throughput corrupted frames.
export const createMalformedLogger = (
  warn: (message: string) => void = console.warn,
  now: () => number = Date.now,
) => {
  let count = 0;
  let lastLoggedAt = Number.NEGATIVE_INFINITY;

  return {
    record(): void {
      count += 1;
      const current = now();
      if (current - lastLoggedAt >= ONE_MINUTE_MS) {
        lastLoggedAt = current;
        warn(`collector malformed messages; total ${count}`);
      }
    },
    count(): number {
      return count;
    },
    logSummary(): void {
      warn(`collector malformed messages; total ${count}`);
    },
  };
};
