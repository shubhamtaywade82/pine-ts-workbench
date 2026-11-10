# pine-ts Workbench

A complete TradingView replacement for Binance (and DhanHQ), built on [pine-ts](https://github.com/shubhamtaywade82/pine-ts) — a Pine Script v6-compatible TypeScript runtime with 67/67 `ta.*` functions (14 verified bit-for-bit against PineScript reference vectors).

## Features

- **Interactive charting** — lightweight-charts v5 with pan/zoom/crosshair, multi-pane oscillators, candlestick + line series, trade markers (entry/exit arrows)
- **Real-time streaming** — Binance WebSocket kline stream + Coinbase REST historical candles (no API key needed for market data)
- **Order book walls** — live bubbles beside the forming candle at the largest resting bid (green) and ask (red) inside a search window around mid (default ±0.5%, set in Settings → Trading → Search window). Each bubble is labelled with its price, its notional in the chart's quote currency (derived from the symbol, never assumed to be USDT), how long this client has continuously observed it ("observed for"), and the window actually searched ("max in ±X%"). The bubble is the largest level inside that window, not the market-wide maximum. A minimum wall size (Settings → Trading) filters smaller levels, in the same quote currency. The search never reads prices outside the snapshot's verified coverage, so a wide window can be clipped and labelled "(coverage)". Observation restarts after a gap, a resync, a stall or a reconnect, so a wall seen again after one is not shown as continuously observed. A wall is displayed liquidity: it can be pulled or refilled at any time, and it is not traded volume or evidence of support or resistance. The local book follows Binance's snapshot + diff-depth sync rules (`data-stream.binance.vision` / `data-api.binance.vision`), resyncs on gaps, and greys the bubbles out ("stale" / "syncing") when the feed is not live.
  Beyond the resting bubbles, the workbench provides order-flow tools: the DOM ladder for dynamic price-level depth, the liquidity heatmap for resting-depth history over time, the big-levels panel for tracking significant walls, footprint charts showing bid/ask traded volume per price level, the background microstructure collector (`mini-services/microstructure-collector`), and the outcome donut visualization. **Data limitations & caveats**: resting liquidity is not intent; an order removal is shown as "pulled", never as a cancellation; historical outcome percentages are descriptive, always shown with sample count $n$ and a 95% confidence interval; the microstructure collector requires running `npx prisma db push` once before use.
- **Second-based intervals** — 1s charts (Binance spot 1s klines on REST + WebSocket)
- **Deep history** — 5000 bars initial load via paged backward fetching (1000/request), with more pages loading as you scroll back
- **Multi-chart grid** — 1/2/3/4/6/8/9/12/16 independent charts (TradingView Ultimate's 16-chart cap), each with its own symbol, timeframe, bars, indicators, and overlays
- **13 drawing tools** — trendline, ray, extended line, horizontal/vertical line, parallel channel, fib retracement, rectangle, measure, long/short position (2:1 R:R with qty-for-risk sizing), text note, arrow
- **Indicator registry** — 6 built-in indicators (SMA, EMA, RSI, MACD, Bollinger Bands, OBV) + custom indicators authored in TypeScript via the Pine editor with live preview
- **Pine editor** — write custom indicators in TypeScript using the pine-ts API (`ta.*`, `ctx.*`) with sucrase transpilation + hot-reload + live preview on the chart
- **Strategy backtest** — write trading strategies in TypeScript, run them against historical bars via the StrategyEngine + built-in broker emulator, see P&L summary, equity curve, trade list, and trade markers on the chart
- **Strategy-to-live bridge** — "Go Live" button submits the last bar's trading signal as a REAL order to Binance mainnet
- **Live Binance broker** — order forms (market/limit/stop/stop-limit), confirmation dialog, account panel with auto-refreshing balance + open orders
- **Multi-condition alerts** — rules combine up to 5 conditions with AND (TradingView's alert builder); 12 condition kinds (RSI/price/SMA/MACD histogram/volume-vs-SMA/24h % change/script alert); open-ended rules that persist across reloads; per-bar dedupe; watchlist-level rules (symbol `*` fires on every watchlist symbol)
- **Alert delivery** — 5 channels (webhook, Telegram, email, browser notifications, Binance broker action), fired-alerts history with per-sink delivery status
- **Script runtime limits** — request.*() call-site quota of 40 (TradingView Ultimate parity, enforced in pine-ts) and a 100s script execution timeout on the worker
- **Saved layouts** — persist chart grid configs (symbols, timeframes, layout size) to localStorage; load them anytime
- **Lerp animation** — smooth candle formation animation (150ms easeOutCubic) when real-time ticks update the last bar
- **Dark/light theme** — one-click toggle
- **Mobile responsive** — sidebar collapses, chart grid adapts to 1 column, touch-friendly controls
- **Error handling** — sonner toast notifications for network failures + stream connect/disconnect

## Prerequisites

- **Node.js** >= 22
- **Bun** — install: `curl -fsSL https://bun.sh/install | bash`
- **pnpm** — install: `npm install -g pnpm`

## Setup

### 1. Clone both repos

The workbench references pine-ts as a `file:./pine-ts` dependency — both repos need to be side-by-side:

```bash
git clone https://github.com/shubhamtaywade82/pine-ts-workbench.git
cd pine-ts-workbench
git clone https://github.com/shubhamtaywade82/pine-ts.git pine-ts
```

### 2. Build the pine-ts library

```bash
cd pine-ts
pnpm install
pnpm build
cd ..
```

### 3. Install workbench dependencies

```bash
bun install
```

### 4. Set up the database

```bash
echo "DATABASE_URL=file:./db/custom.db" > .env
bun run db:push
```

### 5. Run

```bash
bun run dev
```

Open http://localhost:3417

## Usage

### Header controls

| Button | Function |
|--------|----------|
| Layout dropdown (grid icon) | Switch between 1/2/4/6 charts |
| Layouts dropdown (save icon) | Load a saved layout |
| Save | Save current chart grid config |
| Add | Add a chart cell (max 6) |
| Sun/Moon | Toggle dark/light theme |
| Alerts (bell) | Configure alert delivery channels |
| Settings | Configure Binance API keys |

### Each chart cell

- Symbol selector (BTC/ETH/SOL/BNB)
- Timeframe selector (1m/5m/15m/1h/4h/1d)
- Stream button (start/stop real-time Binance WebSocket)
- Status dot (green=live, yellow=connecting, gray=disconnected, red=error)

### Bottom panel tabs

| Tab | Function |
|-----|----------|
| Indicator Editor | Write custom indicators in TypeScript (live preview on chart) |
| Strategy Backtest | Write trading strategies (backtest with P&L + equity curve + trade markers) |

### Custom indicator example

```typescript
indicator("RSI", ({ close, input, plot, hline }) => {
  plot(ta.rsi(close, input.int(14, "Length", { min: 1 })), "RSI");
  hline(70);
  hline(30);
});
```

The body runs once per bar. In scope: `open`, `high`, `low`, `close`, `volume`,
`hl2`, `hlc3`, `ohlc4`, `time`, `bar_index`, `input`, `plot`, `hline`, `ta`,
`math`, and `ctx` (the full Pine context). The `@nemesis-oss/pine-ts` import is
optional in the editor.

### Strategy example

```typescript
defineStrategy("SMA Crossover", { initial_capital: 10_000, default_qty_value: 0.001 },
  ({ close, input, strategy }) => {
    const sma = ta.sma(close, input.int(20, "Length"));
    strategy.entry("long", "long", { when: ta.crossover(close, sma) });
    strategy.close("long", { when: ta.crossunder(close, sma) });
  });
```

`ta.crossover(...)` returns a boolean *series*: pass it as `when`, or use
`.value` inside an `if`. Backtests run on confirmed bars only (the forming bar
is excluded). Legacy `calculate({ ta, ctx, inputs })` / `strategy({ ta, ctx,
engine, inputs })` functions still run unchanged.

## DhanHQ access token (shared with algo_scalper_api)

Dhan issues one active token per login, so generating a new one invalidates every other holder
(`DH-906 Invalid Token`). The workbench therefore **reuses algo_scalper_api's token** and only
logs in itself when algo_scalper_api is **not running**:

| Situation | What happens |
|---|---|
| algo_scalper_api reachable | token fetched from `GET {DHAN_AUTHORITY_URL}/api/dhan/token`; the workbench never generates or renews it |
| algo_scalper_api answers with an error (401/503) | the error is surfaced; no login is attempted (it is running and owns the token) |
| connection to algo_scalper_api fails | log in with `DHAN_CLIENT_ID` / `DHAN_PIN` / `DHAN_TOTP_SECRET`, re-checking every 30 s and switching back as soon as it returns |

```bash
DHAN_AUTHORITY_URL=http://localhost:3011      # default
DHAN_AUTHORITY_TOKEN=<algo_scalper_api API_OPERATOR_TOKEN>
# fallback login, used only while algo_scalper_api is down
DHAN_CLIENT_ID=...  DHAN_PIN=...  DHAN_TOTP_SECRET=...
```

Use `getDhanClient()` from `src/lib/dhan-client.ts` (server-side only) — never send the token to the browser.

## Binance trading setup

1. Click Settings in the header
2. Enter Binance API Key + Secret (binance.com — mainnet only, real funds)
3. Toggle Enable Live Trading ON
4. Save

API keys stored in browser localStorage. Recommend "Spot Trading + Read" permissions only. Never enable withdrawals.

### Binance market data endpoints

Public market-data endpoints default to Binance mainnet without requiring API keys. Overrides can be supplied via environment variables:

- `NEXT_PUBLIC_BINANCE_REST_URL` — REST endpoint for depth snapshots (default: `https://data-api.binance.vision`).
- `NEXT_PUBLIC_BINANCE_DATA_WS_URL` — WebSocket endpoint for order-book diff depth stream (default: `wss://data-stream.binance.vision`).
- `NEXT_PUBLIC_BINANCE_STREAM_WS_URL` — WebSocket endpoint for kline, trade, and watchlist ticker streams (default: `wss://stream.binance.com:9443`).

## Architecture

```
src/
├── app/page.tsx                    # Multi-chart grid + split-view
├── components/
│   ├── chart/chart-workbench.tsx    # LWC v5 chart + lerp animation + trade markers
│   ├── chart/chart-cell.tsx         # Self-contained chart cell
│   ├── chart/indicator-sidebar.tsx # Indicator catalog + config
│   ├── trading/settings-dialog.tsx  # Binance API key config
│   ├── trading/trading-panel.tsx    # Order form + confirmation
│   ├── trading/account-panel.tsx    # Balance + open orders
│   ├── alerts/alert-settings-dialog.tsx  # Webhook/Telegram/Email/Broker config
│   ├── alerts/alerts-panel.tsx      # Alert rules + fired alerts
│   ├── editor/pine-editor.tsx       # TS editor + sucrase + hot-reload
│   └── strategy/strategy-panel.tsx  # Strategy editor + backtest + Go Live
├── lib/
│   ├── public-binance-feed.ts      # Coinbase REST + Binance WS
│   ├── real-binance-trading-surface.ts  # Binance SDK adapter
│   ├── alert-sinks.ts               # 4 delivery sinks
│   ├── strategy-runner.ts           # Backtest + live signal runner
│   └── saved-layouts.ts            # Layout persistence
└── hooks/use-is-mobile.ts           # Responsive breakpoint
```

## Tech stack

Next.js 16 + React 19 + TypeScript 5 + Tailwind CSS 4 + shadcn/ui + lightweight-charts v5 + sucrase + Prisma/SQLite + sonner + @nemesis-oss/pine-ts + @nemesis-oss/binance-sdk

## License

MIT
