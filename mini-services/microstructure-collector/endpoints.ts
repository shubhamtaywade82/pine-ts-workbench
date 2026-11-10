import {
  BINANCE_DATA_WS_URL,
  BINANCE_REST_URL,
} from "../../src/lib/binance-endpoints";

// Collector runs in Bun/Node outside Next.js, so server-only env vars take precedence over NEXT_PUBLIC_*.
export const resolveRestUrl = (env: Record<string, string | undefined> = process.env): string =>
  env.BINANCE_REST_URL ?? BINANCE_REST_URL;

export const resolveDataWsUrl = (env: Record<string, string | undefined> = process.env): string =>
  env.BINANCE_DATA_WS_URL ?? BINANCE_DATA_WS_URL;

export const COLLECTOR_REST_URL = resolveRestUrl();
export const COLLECTOR_DATA_WS_URL = resolveDataWsUrl();
