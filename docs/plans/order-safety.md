# Order Safety for Alert-Triggered Orders — Plan

## Problem
A fired alert with **Broker action** enabled sends a live **Binance mainnet MARKET order** from the browser (`BrokerActionSink` in `src/lib/alert-sink-transports.ts`). It only needs API keys, `liveTradeEnabled` and `brokerActionEnabled`. There is no cap on order size, order rate or daily volume, and no symbol allowlist. A rule fires at most once per bar, but a misconfigured quantity or many rules can still place large or frequent orders.

## Phase 1 — Client-side order guard (this round)
Every alert-triggered order must pass a pure guard before it is sent. Blocked orders are not sent. Each one shows up in the fired-alert history as `skipped` with the reason.

**Rules** (defaults in brackets, editable in Alert settings → Broker action):
- **Armed**: alert orders run only while armed. Arming needs the typed phrase `ARM LIVE ORDERS` and expires after [24 h]. Disarm any time.
- **Max notional per order**: [100 USDT].
- **Max orders per rolling hour**: [3].
- **Max notional per rolling 24 h**: [500 USDT].
- **Symbol allowlist**: [BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT].
- **Price for notional**: a MARKET order has no price, so the sink fetches the public last price (`/api/v3/ticker/price` on the market-data host). If that fetch fails, the order is blocked (fail closed).
- The **kill switch is not guarded**. Flattening must always work.

**Code**
- New `src/lib/order-guard.ts` (pure): `checkOrder`, `recordOrder`, `arm`, `disarm`, and limits/state types.
- `BrokerActionSink` gets injectable deps: `fetchPrice`, a guard state store and `submit`. The defaults are the public ticker, localStorage and the lazily imported `RealBinanceTradingSurface`.
- `AlertSettings` gains `orderGuard` limits, with defaults and validation. The Alert settings dialog shows armed status, an Arm control with the typed phrase, and Disarm.

**Tests** (agreed seams): `order-guard.ts` through its public functions, and `BrokerActionSink.deliver` with injected deps (no network). The arm/disarm UI is checked manually.

## Phase 2 — Binance testnet (later)
Add a TESTNET environment (`testnet.binance.vision`, separate keys) and a paper → testnet → mainnet promotion gate with typed confirmation. This is requirements tracker item 5.2. Paper mode simulates fills instead of skipping.

## Phase 3 — Server-side evaluation (later)
Evaluate alert rules on the server, reusing the microstructure collector's process model, with a delivery retry queue for non-order sinks (webhook/Telegram/email). Orders are never retried automatically. The guard moves server-side with its state persisted. This is requirements tracker item 4.

## Non-goals
- Automatic order retries.
- Position sizing or risk models beyond the caps above.
