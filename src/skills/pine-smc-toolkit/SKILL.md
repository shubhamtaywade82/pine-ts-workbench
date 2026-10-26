---
name: pine-smc-toolkit
description: Smart Money Concepts (SMC) in Pine-TS: BOS, CHoCH, Order Blocks, FVGs, and Liquidity Sweeps.
allowed-tools:
  - validate_script
---

# Smart Money Concepts in @nemesis-oss/pine-ts

When writing SMC scripts, use the native `smc` and `draw` namespaces.

### 1. Fair Value Gaps (FVG)
```typescript
indicator("FVG Detector", ({ high, low, draw, smc }) => {
  const fvgs = smc.fairValueGaps({ minGapPercent: 0.1 });
  if (fvgs.bullish) {
    draw.fvg(fvgs.current, { color: "#08998120", border: "#089981" });
  }
  if (fvgs.bearish) {
    draw.fvg(fvgs.current, { color: "#f2364520", border: "#f23645" });
  }
});
```

### 2. Market Structure (BOS & CHoCH)
```typescript
indicator("Market Structure", ({ high, low, close, draw, smc }) => {
  const structure = smc.structure({ swingLength: 5 });
  if (structure.bos) {
    draw.structure(structure.lastSwing, { label: "BOS", color: "#2962ff" });
  }
  if (structure.choch) {
    draw.structure(structure.lastSwing, { label: "CHoCH", color: "#ff9800" });
  }
});
```

### 3. Liquidity Sweeps
```typescript
indicator("Liquidity Sweeps", ({ high, low, close, smc }) => {
  const sweeps = smc.liquidity({ lookback: 20 });
  if (sweeps.sweptHigh) {
    // Price pierced previous swing high and closed back inside
  }
});
```
