# Microstructure collector

Records Binance spot depth events, trades, sequence gaps, book snapshots, and wall transitions into the workbench SQLite database.

Apply `prisma/schema.prisma` yourself before the first run. This process does not migrate the database.
The LiquidityInteraction table needs `npx prisma db push` (run by you) before outcomes appear.

## Run

```bash
bun mini-services/microstructure-collector/index.ts
```

Stop it with SIGINT or SIGTERM. The process flushes its buffer before exiting.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `COLLECTOR_SYMBOLS` | `BTCUSDT` | Comma-separated Binance symbols (`BTCUSDT`, `ETHUSDT`, `SOLUSDT`, `BNBUSDT`) |
| `RETENTION_DAYS` | `3` | Delete `MarketEvent` and `BookSnapshot` rows older than this many days. `WallTransition` and `LiquidityInteraction` are kept (outcomes and their transitions are the research record). |
| `DATABASE_URL` | | SQLite URL used by the Next app |
| `BINANCE_REST_URL` | `https://data-api.binance.vision` | Override Binance REST endpoint host; falls back to `NEXT_PUBLIC_BINANCE_REST_URL` |
| `BINANCE_DATA_WS_URL` | `wss://data-stream.binance.vision` | Override Binance market data WebSocket endpoint host; falls back to `NEXT_PUBLIC_BINANCE_DATA_WS_URL` |
| `BINANCE_STREAM_WS_URL` | `wss://stream.binance.com:9443` | Override Binance stream WebSocket endpoint host; falls back to `NEXT_PUBLIC_BINANCE_STREAM_WS_URL` |
| `NEXT_PUBLIC_BINANCE_REST_URL` | `https://data-api.binance.vision` | Shared default REST endpoint host from workbench frontend |
| `NEXT_PUBLIC_BINANCE_DATA_WS_URL` | `wss://data-stream.binance.vision` | Shared default market data WebSocket endpoint host from workbench frontend |
| `NEXT_PUBLIC_BINANCE_STREAM_WS_URL` | `wss://stream.binance.com:9443` | Shared default stream WebSocket endpoint host from workbench frontend |
