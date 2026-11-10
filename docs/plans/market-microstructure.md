# Market Microstructure & Order Flow — Implementation Plan

Target: Binance Spot (BTC/ETH/SOL/BNB-USDT). Read-only public data. Futures and DhanHQ come later.
The source spec is the requirements reference. This plan maps it onto the code that exists and cuts what is not needed yet.

Decisions:
- Persistence runs in a **server collector** (Bun process in `mini-services/`, Prisma SQLite), so history keeps recording when no tab is open.
- **Extend existing files.** A new file is added only where the concept is new. The spec's proposed `src/market-data/*` tree is not adopted.

## 1. What already exists (reuse, don't rebuild)

| Spec concept | Existing code | Gap |
|---|---|---|
| Synced local book, sequence gaps, resync, zero-qty removal | `src/lib/order-book.ts` `LocalOrderBook` (pure, tested) | none |
| Snapshot coverage | `BookCoverage` (`bidFloor`/`askCeiling`) + `WallFrame.clippedByCoverage` | none |
| Shared per-symbol socket, backoff, watchdog, coverage re-centre | `src/lib/depth-feed.ts` `DepthFeed` (deps injected) | status set is `syncing/live/stale`; no `disconnected`, no counters |
| Wall detection + hysteresis + observed-since reset | `src/lib/depth-walls.ts` `WallTracker`, `WallObserver` | one wall per side; no baseline or relative strength |
| Wall rendering, price-anchored, rAF batched | `depth-walls-primitive.ts`, `depth-wall-painters.ts`, `use-depth-walls.ts` | none |
| Trade stream | `public-binance-feed.ts` `openMarketStream` (`@trade`) | drops `m` (aggressor) and trade id |
| Settings validation and persistence | `chart-settings.ts` `normalizeTrading` | new fields needed |
| Durable storage | Prisma SQLite (`prisma/schema.prisma`), API routes such as `api/layouts` | no market tables |
| Bar replay | `lib/bar-replay.ts`, `use-bar-replay.ts` | bars only, no book |

Rules that follow from this:
- One book: `LocalOrderBook`. One feed per symbol: `DepthFeed`. No second engine, no event bus. `DepthFeed.subscribe` already is the pub/sub.
- No provider-adapter interface until Futures arrives (YAGNI).
- Renderers are lightweight-charts primitives that repaint via `requestUpdate`. React never renders per depth event (already the pattern).

## 2. Corrections to current code (spec compliance)

1. `LiquidityStatus` uses `absorbing`/`absorbed`, which claims consumption the depth feed can't prove. Rename to `reduced`/`removed`. Add `consumption-inferred` only when the Phase 6 matching rule holds.
2. `LiveTrade` has no aggressor side. Add `aggressor: "buy" | "sell"` from `m` (`m=true` → sell) and `id` from `t`. Raw `@trade` already carries `m`, so no new stream is needed.
3. `DepthStatus`: add `disconnected` (socket closed), separate from `stale` (connected but silent). Expose `resyncCount`, `gapCount` and `lastMessageAt` on `DepthFeedState` for diagnostics.

## 3. Phases (one PR each, tests green before merge)

### Phase 1 — Feed hardening + trade aggressor (S)
- `public-binance-feed.ts`: `LiveTrade.aggressor`, `LiveTrade.id`. Test the `m` → side mapping.
- `depth-feed.ts`: `disconnected` status and counters. Update `depth-feed.test.ts`.
- `depth-walls.ts`: status rename (§2.1). Update painter labels.
- Instrument tick and step size: fetch `exchangeInfo` once per symbol into `symbol-catalog.ts`. Used for bucket alignment.

### Phase 2 — DOM ladder (M)
- New `src/lib/price-buckets.ts`: pure `bucketize(levels, tickSize, bucketTicks, low, high)`. Keys are integer tick indexes (`Math.round(price / tick)`), so float prices never collide. Bid and ask stay separate. Levels outside coverage are dropped, never treated as zero.
- New `src/components/chart/dom-ladder-primitive.ts`: draws bid/ask bars at the right edge, at each bucket's price coordinate. It subscribes through `subscribeBook(symbol, cb)` in `depth-feed.ts`, alongside `subscribeDepthWalls`. When the book is not live, the ladder dims and shows `stale`/`syncing`/`disconnected`. Prices beyond coverage are hatched.
- Settings: `trading.dom { enabled, bucketTicks, visibleBuckets }`.
- Tests: bucket alignment, coverage clip, empty sides.

### Phase 3 — Wall monitor, baseline, lifecycle, heatmap (L)
- `depth-walls.ts`:
  - Top-N walls per side instead of one.
  - Relative strength = level notional ÷ rolling median bucket notional in the same window (median of the last 60 one-second samples). With no baseline yet the value is `null`; it is never invented.
  - Timestamped lifecycle events: `detected / increased / reduced / removed / pulled`. A wall is `pulled` when it is removed before price comes within proximity.
  - Split into `wall-lifecycle.ts` if the file exceeds 300 lines.
- New `src/lib/liquidity-history.ts`: bounded ring buffer of bucketed book samples (1 s × N minutes) that feeds the heatmap.
- New `src/components/chart/liquidity-heatmap-primitive.ts`: bands at bucket price × sample time. Intensity uses a log scale clipped at p99, so one huge wall doesn't wash out the rest. Off by default.
- New `src/components/chart/wall-monitor-panel.tsx`: ranked list of side, zone, notional, relative strength, distance %, observed-for and status, captioned "within ±X% window". Throttled to 4 Hz.
- Tests: identity continuity, reset after gap, null baseline, pulled vs reduced.

### Phase 3b — Ladder and big-levels look (M)
Goal: match the reference screenshots (an index-futures order-flow tool) on Binance Spot.
- Ladder sits beside the forming candle, not at the pane edge. Price column in the middle, bid bars growing left and ask bars growing right, each with its quantity. The last-price row is highlighted with ◀. Rows stay anchored to price through pan and zoom.
- Activity column per row over the last 60 s:
  - `N bought` / `N sold` from executed trades.
  - `N pulled` for resting quantity that left the row without matching trades.
  - `Big Buyers` / `Big Sellers` badge on rows holding a top wall.
  - Pure `src/lib/level-activity.ts` computes all of it.
- Animation: bar widths and activity labels ease toward their targets (τ ≈ 150 ms). New activity flashes, then settles. The animation loop runs only while something is still moving.
- Big-levels panel (restyled wall monitor):
  - Rows read `Big Buyers <zone> · <qty> · <x>× normal · waiting <t>`.
  - `Strong Level (held)` marks a wall that price reached while it stayed.
  - Two collapsed sections: `N more further away` and `Recently pulled (N) — left before price reached them` (from `diffWalls`).
  - Summary cards at the top for the nearest buyer zone and the nearest seller zone.
- Wording: the screenshot says "pulled (cancelled)". We show only "pulled", because the public feed can't prove a cancellation.

### Phase 4 — Trade flow + footprint (M)
- New `src/lib/footprint.ts`: pure `addTrade(bars, trade, intervalMs, tickSize, bucketTicks)` returns per-bar, per-bucket `{buy, sell, delta, total, count}`. Dedupes by trade id, takes bar boundaries from trade time, and keeps cumulative delta per bar.
- Hook into the existing `use-live-bars.ts` `onTrade` path. History comes from the Phase 5 store and is never derived from OHLCV.
- New `src/components/chart/footprint-primitive.ts`: modes bid×ask, delta and total. Shown only when bars are wide enough. Off by default.
- Diagonal imbalance is deferred until aggregation is validated against stored trades.
- Tests: aggressor sums, delta, dedupe, bar boundary, totals reconcile with source trades.

### Phase 5 — Server collector + persistence + replay (L)
- `mini-services/microstructure-collector/index.ts` (Bun): reuses `LocalOrderBook` and `DepthFeed` with server deps (Bun provides `WebSocket` and `fetch`), plus the trade stream. Writes in batches about once a second.
- Prisma models (SQLite):
  - `MarketEvent { id, symbol, kind (depth|trade|gap), seq, exchangeTime, receivedAt, payload, schemaVersion }` with `@@unique([symbol, kind, seq])` for idempotency.
  - `BookSnapshot { symbol, capturedAt, lastUpdateId, bids, asks, coverage }`, saved every 60 s and on every resync.
  - `WallTransition { wallId, symbol, side, price, kind, notional, at, detectorVersion }`.
  - `LiquidityInteraction` (Phase 6).
- Sequence gaps are stored as `kind=gap`. Replay shows them and never stitches across them.
- Retention: raw events older than N days are deleted (setting, default 3). Snapshots and transitions are kept longer.
- Expected volume is about 10 depth events/s per symbol plus trades. Batched SQLite handles this. Measure DB growth in the first week.
- API routes:
  - `GET /api/microstructure/events?symbol&from&to`
  - `GET /api/microstructure/snapshots`
  - `GET /api/microstructure/interactions`
- Replay: extend `use-bar-replay.ts`. Seek to the nearest snapshot ≤ t, then feed events through the same `LocalOrderBook`, `WallTracker` and `footprint` code. There is no separate replay analytics path.
- Tests: idempotent insert, snapshot + events reproduce the live book (parity test), gaps surfaced.

### Phase 6 — Outcomes + stats (M)
- New `src/lib/liquidity-outcomes.ts`, shared by the collector and the UI: a pure classifier with `CLASSIFIER_VERSION = "1"`.
  - An interaction starts when price comes within `proximityPct` of a wall detected **before** that moment.
  - Outcomes for a bid wall (ask walls are mirrored):

    | Outcome | Rule |
    |---|---|
    | `TURNED` | Price rises `reversalPct` before falling `breakoutPct` through the level |
    | `BROKE` | Price falls `breakoutPct` through the level before rising `reversalPct` |
    | `PULLED_BEFORE_TOUCH` | Wall removed before price reached proximity |
    | `NO_REACTION` | Neither threshold reached within `evaluationWindowMs` |
    | `UNRESOLVED` | Data gap, or the window is still open |
    | `CONSUMED` | Trades at the level during the touch window sum to ≥ X% of the removed quantity; otherwise the outcome stays `BROKE` or `REMOVED` |

  - One interaction per wall life (its first touch, or pulled before touch). Re-touches are not counted as new observations (spec §13.4); this keeps repeated collector scans idempotent.
- The collector classifies and stores interactions as they resolve. Each row keeps its `classifierVersion`; old rows are never rewritten.
- New `src/components/chart/outcome-panel.tsx`: counts, %, **Wilson 95% CI**, n, date range, and filters (side, size bucket, distance). Unresolved outcomes are excluded from denominators.
  - Headline: a "Big levels: did price turn or break?" donut showing turned vs broke %, with counts and "since <date> · N sessions" (as in the reference screenshot). The CI and n are always shown beside it.
- Tests: each outcome path, no look-ahead, re-touch counting, Wilson CI.

### Phase 7 — Hardening (S–M)
- 24 h collector soak: memory stays flat and resyncs are logged.
- Replay stress at a high event rate.
- Multi-symbol isolation.
- Diagnostics popover on the chart: status, message age, gaps, resyncs, coverage % and collector lag.

## 4. Deliberately skipped (add when needed)
- Event-bus/envelope types, provider-adapter interfaces and a storage-adapter interface each have one implementation. Add them when Futures or a second store arrives.
- Fixed-point decimals: analytics use `number`, with prices keyed by integer tick index. Switch to decimals if quantities ever feed order sizing.
- Percentage-mode buckets, diagonal imbalance and large-trade percentiles wait until Phases 2 and 4 are validated.
- Futures, liquidations and DhanHQ depth.

## 5. Invariants (enforced by tests)
- No liquidity is drawn or classified outside verified coverage.
- A stale, syncing or disconnected book is never shown as live.
- A depth decrease is never labelled "cancelled".
- `observedSince` resets after any non-live interval.
- No future data is used to detect a wall. Outcomes are versioned.
- Percentages are always shown with n and a CI.

## 6. Verification per phase
1. Run `bun run typecheck && bun run lint && bun test src`.
2. Start `bun run dev` (port 3417) and open BTCUSDT in the browser. Check that the ladder and walls stay aligned through pan and zoom.
3. Kill the network. The chart should show `disconnected`, then resync when the network returns.
4. Phase 5 only: run the collector for 1 h and check that row counts rise. Then replay that hour and diff the replayed walls and footprint against the logged live output.
