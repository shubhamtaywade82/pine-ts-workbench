/**
 * Binance public market-data endpoints. Overridable so self-hosted mirrors,
 * testnets, or proxied gateways can be swapped in without code changes;
 * unset env vars keep the public mainnet hosts unchanged for end users.
 */
export const BINANCE_REST_URL = process.env.NEXT_PUBLIC_BINANCE_REST_URL ?? "https://data-api.binance.vision";

export const BINANCE_DATA_WS_URL = process.env.NEXT_PUBLIC_BINANCE_DATA_WS_URL ?? "wss://data-stream.binance.vision";

export const BINANCE_STREAM_WS_URL = process.env.NEXT_PUBLIC_BINANCE_STREAM_WS_URL ?? "wss://stream.binance.com:9443";
