# FEATURE-002: CoinDCX Read-Only Portfolio and Active Positions

## Overview
Provides a read-only integration with CoinDCX exchange allowing users to configure their CoinDCX API Key and Secret, view active/open futures positions and account balances, and display active position levels (entry price, liquidation price, PnL) directly on the chart workbench and on a dedicated CoinDCX portfolio page.

## Problem
Users who trade or monitor positions on CoinDCX lack visibility into their active futures positions, margin usage, and account balances within the workbench. Furthermore, to eliminate risk of unintended executions or errors, this integration must be strictly read-only and explicitly prevent any order placement.

## Scope
### In Scope
- Client-side configuration and persistent local storage of CoinDCX API Key and Secret.
- Server-side read-only API proxy routes to circumvent CoinDCX browser CORS restrictions.
- Live real-time WebSocket connection (`wss://stream.coindcx.com`) subscribing to authenticated channels for `df-position-update`, `df-order-update`, and `balance-update`.
- Fallback/bootstrap REST API polling with correct epoch timestamp in seconds for futures positions.
- Strict currency discrimination supporting both INR (`₹`) and USDT (`$`) margin contracts and wallets.
- Fetching and normalization of active futures positions, account balances, user info, and open orders.
- Direct visualization of open positions on the chart workbench with entry lines, liquidation price lines, and position HUD.
- Dedicated CoinDCX dashboard page (`/coindcx`) displaying account summary, active positions, open orders, and token balances with quick chart navigation.
- Strict enforcement of read-only mode with zero order placement or mutation capabilities.

### Out of Scope
- Placing new orders (market, limit, stop) on CoinDCX.
- Canceling or modifying existing orders.
- Funds transfer, deposits, or withdrawals.
- Multi-account switching.

## Actors
- Trader: End-user monitoring active crypto futures positions and balances.
- ChartWorkbench: Component rendering candlestick bars and position overlay drawings.
- CoinDcxProxy: Server-side Next.js route proxying authenticated requests to CoinDCX without CORS barriers.

## Functional Requirements
- REQ-001: System shall allow the user to input and persist CoinDCX API Key and API Secret in local storage.
- REQ-002: System shall provide server-side proxy routes for fetching user balances, user info, futures positions, and open orders.
- REQ-003: System shall sign all private CoinDCX API requests using HMAC-SHA256 with the user secret and timestamp.
- REQ-004: System shall normalize CoinDCX futures positions into a structured format containing pair, side, quantity, entry price, mark price, leverage, margin, liquidation price, and unrealized PnL.
- REQ-005: System shall render horizontal price lines and labels on the active chart for open positions matching the displayed symbol.
- REQ-006: System shall provide a dedicated CoinDCX portfolio page (`/coindcx`) displaying account metrics, positions table, open orders, and balance breakdowns.
- REQ-007: System shall strictly reject and forbid any order placement or modification requests.

## Non-Functional Requirements
- NFR-001: All functions must be ≤ 30 lines and files ≤ 300 lines complying with project code quality standards.
- NFR-002: Private API keys and secrets must never be permanently logged or saved to the server filesystem.
- NFR-003: Chart drawings for positions must execute smoothly without blocking UI thread rendering.

## Acceptance Criteria
- ACC-001: User can enter CoinDCX credentials, test connection, and see connection status.
- ACC-002: Active futures positions are retrieved and displayed in a structured table on `/coindcx`.
- ACC-003: When viewing a symbol with an open position, entry and liquidation price lines appear on the chart with PnL labels.
- ACC-004: Clicking "View on Chart" on any active position navigates to the chart with that symbol selected.
- ACC-005: No order submission forms, buttons, or mutation endpoints exist.

## Edge Cases
- CoinDCX API credentials missing or invalid (handled gracefully with clear error state).
- User has zero active positions (clean empty state displayed).
- Position pair format matching between CoinDCX (`B-BTC_USDT`) and Binance (`BTCUSDT`).
- Network timeout or CoinDCX API rate limiting (handled with non-blocking error display).

## Dependencies
- Node.js crypto module for server-side HMAC-SHA256 signing.
- Lightweight-charts / ScriptDrawingsPrimitive for position price line rendering.
- Next.js App Router for server proxy endpoints and dashboard page.

## Risks
- RISK-001 (low): Differences in pair naming conventions between CoinDCX and chart feed providers.
- RISK-002 (low): Temporary CoinDCX API downtime or rate limiting.

## Open Questions
- Q-001: Should order placement ever be enabled in the future? (resolved: true)
- Q-002: Should credentials be stored in browser localStorage or server session? (resolved: true)
