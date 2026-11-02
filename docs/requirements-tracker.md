# Workbench Requirements Tracker — TradingView Replacement Scope

Living gap tracker for `pine-ts-workbench` against the complete product
requirements (18 sections). Priority: **P0** launch-blocking → **P3** never.

Legend: ✅ shipped · 🟡 partial · ❌ missing. Every ❌/🟡 P0 item below has an
owner wave and lands as its own commit + PR.

## P0 scorecard

| # | Requirement (section) | Status | Notes |
|---|---|---|---|
| 1.1 | Candlestick/line/area/bars, log/linear, auto-fit | ✅ | lightweight-charts v5 core |
| 1.1 | Heikin-Ashi, Renko, Kagi, P&F, custom TFs | ❌ | runtime chart types exist; UI selector missing |
| 1.2 | Oscillator panes, overlay toggles, per-indicator settings | ✅ | multi-pane + settings dialog |
| 1.3 | plot/plotshape/hline/fill/bgcolor/barcolor | ✅ | script painters |
| 1.4 | Trendline, hline, ray, rect, fib, measure, text | ✅ | 13-tool set |
| 1.5 | Crosshair + legend values | ✅ | chart-legend |
| 1.5 | Timezone selector, hotkeys, context menus | 🟡 | replay hotkeys exist; no global hotkey map |
| 1.6 | 100k bars, streaming append, Worker compute | ✅ | worker + timeout + deep paging |
| 2 | Monaco/CodeMirror TS editor + hot-reload + inputs panel | ✅ | CodeMirror w/ completions, <300ms preview |
| 2 | Inline diagnostics + error overlay on chart | 🟡 | lint gutter exists; on-chart failure bar missing |
| 2 | Script manager (create/rename/dup/delete, search) | ✅ | script library |
| 2 | Rename "Pine Editor" → "TypeScript Editor" | ❌ | branding cleanup |
| 3 | Backtest metrics, equity curve, trade list, markers | ✅ | full report |
| 3 | Fill-model controls (commission/slippage/sizing) | 🟡 | honored in engine; no UI exposure |
| 3 | Export trades + metrics (CSV/JSON) | ❌ | trades CSV exists; metrics/JSON missing |
| 4 | Multi-condition alerts, 4 channels, dedupe, log | ✅ | 5-condition AND engine |
| 4 | Message templates with placeholders | ❌ | fixed describeRule() text |
| 4 | Server-side evaluation, retry queues | ❌ | client-only, send-once |
| 5.1 | Order ticket, positions, open orders, history | ✅ | Binance adapter |
| 5.1 | Kill switch (flatten-all + cancel-all) | ❌ | biggest live-safety gap |
| 5.2 | Environment banner Paper/Testnet/Mainnet | 🟡 | MAINNET/DRY-RUN badge only; no testnet |
| 5.2 | Promotion gates + typed confirmation | ❌ | single toggle today |
| 5.3 | Go Live signal → order via same engine | ✅ | strategy bridge |
| 6 | Layouts, workspace persistence, 16-chart grid | ✅ | saved layouts |
| 6 | Symbol search (fuzzy, recent, favorites) | 🟡 | substring match only |
| 6 | Watchlists (reorder, columns: last/chg%/vol) | ❌ | no quotes/cols in panel |
| 8 | Provider health badge, data-quality warnings | ❌ | reconnect exists, not surfaced |
| 10 | Examples gallery, in-app docs, hotkey sheet | ❌ | README only |
| 10 | Empty states that teach | 🟡 | tester has one |
| 12 | Auth/2FA/RBAC/key vault | ❌ | single-user localStorage today |
| 13 | Error toasts, correlation IDs, structured logs | 🟡 | toasts exist |

## P1+ deferred (tracked, not blocking)

- Second intervals ✅ (1s shipped) · tick intervals ❌
- Bar replay 🟡 (hook + controls; strategy-fill replay ❌)
- Volume Profile / Footprint / TPO ❌ · compare/symbol overlay ❌
- Screener ❌ · A/B backtests ❌ · parameter sweep ❌
- Server-side alerts ❌ · alert markers on chart ❌
- Share links ❌ · mobile read-only 🟡 · OMS reconciliation ❌

## Explicit non-goals (Section 17)

Pine Script parser — never. Social feed, marketplace, 3.5M symbols,
copy-trading — never. 110 drawing tools — ~30 target.
