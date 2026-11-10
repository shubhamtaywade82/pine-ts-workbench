# Microstructure collector

Records Binance spot depth events, trades, sequence gaps, book snapshots, and wall transitions into the workbench SQLite database.

Apply `prisma/schema.prisma` yourself before the first run. This process does not migrate the database.

## Run

```bash
bun mini-services/microstructure-collector/index.ts
```

Stop it with SIGINT or SIGTERM. The process flushes its buffer before exiting.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `COLLECTOR_SYMBOLS` | `BTCUSDT` | Comma-separated Binance symbols (`BTCUSDT`, `ETHUSDT`, `SOLUSDT`, `BNBUSDT`) |
| `RETENTION_DAYS` | `3` | Delete `MarketEvent` rows older than this many days. Snapshots and wall transitions are kept. |
| `DATABASE_URL` | | SQLite URL used by the Next app |
