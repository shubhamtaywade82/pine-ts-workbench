---
name: pine-v5-migration
description: Migration guide from TradingView Pine Script v5 to TypeScript @nemesis-oss/pine-ts.
allowed-tools:
  - validate_script
---

# Migrating Pine Script v5 to @nemesis-oss/pine-ts

### 1. Script Header
- Pine v5: `//@version=5\nindicator("My Script", overlay=true)`
- Pine-TS: `indicator("My Script", ({ close, open, high, low, volume, input, plot, ta }) => { ... })`

### 2. Strategy Header
- Pine v5: `strategy("My Strat", overlay=true, default_qty_value=1)`
- Pine-TS: `defineStrategy("My Strat", { default_qty_value: 1 }, ({ close, strategy, ta, input }) => { ... })`

### 3. Built-in Series
- In Pine v5: `close`, `open`, `high`, `low`, `volume`, `bar_index` are global identifiers.
- In Pine-TS: destructured in the script callback: `({ close, open, high, low, bar_index })`.

### 4. Technical Analysis Functions
- In Pine v5: `ta.rsi(close, 14)`, `ta.ema(close, 20)`, `ta.crossover(a, b)`
- In Pine-TS: identically called via `ta.rsi(close, 14)`, `ta.ema(close, 20)`, `ta.crossover(a, b)`.

### 5. Orders
- In Pine v5: `strategy.entry("Long", strategy.long, when=cond)`
- In Pine-TS: `strategy.entry("Long", strategy.long, { when: cond })` or `if (cond) strategy.entry("Long", strategy.long)`.
- In Pine v5: `strategy.close("Long", when=exitCond)`
- In Pine-TS: `if (exitCond) strategy.close("Long")`.
