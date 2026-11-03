/**
 * "ALMA Ribbon & Confluence Engine" for pine-ts TypeScript Editor.
 *
 * Implements a 4-layer Arnaud Legoux Moving Average (ALMA) trend ribbon
 * (Fast 9, Signal 21, Trend 50, Macro 150) with pairwise crossover detection,
 * alignment scoring, ATR-normalized spread and compression, pullback signals,
 * and an on-chart HUD dashboard.
 */
export const ALMA_RIBBON_ENGINE = String.raw`// ALMA Ribbon & Confluence Engine — Multi-ALMA trend, crossover & regime framework.

indicator("ALMA Ribbon & Confluence Engine", { overlay: true }, (api) => {
  const { ctx, ta, input, plot, draw, open, high, low, close, bar_index } = api;
  const val = (series, offset = 0) => { const x = series.at(offset); return x === undefined ? NaN : x; };
  const na = (x) => x === undefined || x === null || Number.isNaN(x);
  const bar = val(bar_index);
  const isLast = ctx.barstate.islast;

  // ── Inputs ────────────────────────────────────────────────────────────────
  const G_ALMA = "ALMA Parameters";
  const fastLen = input.int(9, "Fast Length", { min: 1, max: 500, group: G_ALMA });
  const signalLen = input.int(21, "Signal Length", { min: 1, max: 1000, group: G_ALMA });
  const trendLen = input.int(50, "Trend Length", { min: 1, max: 2000, group: G_ALMA });
  const macroLen = input.int(150, "Macro Length", { min: 1, max: 5000, group: G_ALMA });
  const offset = input.float(0.85, "Offset (Peak Center)", { min: 0, max: 1, step: 0.05, group: G_ALMA });
  const sigma = input.float(6, "Sigma (Gaussian Width)", { min: 0.1, max: 50, step: 0.5, group: G_ALMA });

  const G_VIS = "Visuals & HUD";
  const showSignals = input.bool(true, "Show Crossover & Pullback Signals", { group: G_VIS });
  const showTable = input.bool(true, "Show Dashboard HUD Table", { group: G_VIS });

  // ── Calculation Layer ─────────────────────────────────────────────────────
  const fastAlma = ta.alma(close, fastLen, offset, sigma);
  const signalAlma = ta.alma(close, signalLen, offset, sigma);
  const trendAlma = ta.alma(close, trendLen, offset, sigma);
  const macroAlma = ta.alma(close, macroLen, offset, sigma);

  const cFast = val(fastAlma);
  const cSignal = val(signalAlma);
  const cTrend = val(trendAlma);
  const cMacro = val(macroAlma);

  const pFast = val(fastAlma, 1);
  const pSignal = val(signalAlma, 1);

  const atrVal = val(ta.atr(14));
  const effectiveAtr = na(atrVal) || atrVal <= 0 ? 1 : atrVal;

  // ── Analysis Layer ────────────────────────────────────────────────────────
  // Alignment: 4 lines have 3 consecutive pairs.
  const bullPairs = (cFast > cSignal ? 1 : 0) + (cSignal > cTrend ? 1 : 0) + (cTrend > cMacro ? 1 : 0);
  const bearPairs = (cFast < cSignal ? 1 : 0) + (cSignal < cTrend ? 1 : 0) + (cTrend < cMacro ? 1 : 0);
  const alignScore = Math.round(((bullPairs - bearPairs) / 3) * 100);
  const isFullBull = bullPairs === 3;
  const isFullBear = bearPairs === 3;
  const alignState = isFullBull ? "BULLISH" : isFullBear ? "BEARISH" : Math.abs(alignScore) >= 50 ? "TRANSITION" : "MIXED";

  // Spread and Compression
  const spread = Math.abs(cFast - cMacro);
  const prevSpread = Math.abs(val(fastAlma, 1) - val(macroAlma, 1));
  const atrNormSpread = spread / effectiveAtr;
  const isSqueeze = atrNormSpread < 0.35;
  const spreadState = isSqueeze ? "SQUEEZE" : spread >= prevSpread ? "EXPANDING" : "CONTRACTING";

  // Normalized Slope of Fast ALMA
  const slope = (cFast - pFast) / effectiveAtr;
  const momentum = slope > 0.05 ? "POSITIVE" : slope < -0.05 ? "NEGATIVE" : "NEUTRAL";

  // Regime classification
  const regime = isFullBull && !isSqueeze ? "BULL TREND" : isFullBear && !isSqueeze ? "BEAR TREND" : isSqueeze ? "RANGING (SQUEEZE)" : "TRANSITION";

  // Pairwise Crossovers
  const goldenCross = cFast > cSignal && pFast <= pSignal;
  const deathCross = cFast < cSignal && pFast >= pSignal;

  // Pullback: price touches Signal/Trend line in prevailing trend
  const cLow = val(low);
  const cHigh = val(high);
  const cClose = val(close);
  const cOpen = val(open);
  const bullPullback = isFullBull && cLow <= cSignal + 0.15 * effectiveAtr && cClose > cSignal && cClose >= cOpen;
  const bearPullback = isFullBear && cHigh >= cSignal - 0.15 * effectiveAtr && cClose < cSignal && cClose <= cOpen;

  // ── Plots ─────────────────────────────────────────────────────────────────
  plot(fastAlma, "Fast ALMA", { color: "#facc15", linewidth: 2 });
  plot(signalAlma, "Signal ALMA", { color: "#3b82f6", linewidth: 2 });
  plot(trendAlma, "Trend ALMA", { color: "#a855f7", linewidth: 2 });
  plot(macroAlma, "Macro ALMA", { color: "#ef4444", linewidth: 2 });

  // ── Signals ───────────────────────────────────────────────────────────────
  if (showSignals) {
    if (goldenCross) {
      draw.label({ x: bar, y: cLow - 0.5 * effectiveAtr, text: "GOLDEN CROSS", position: "below", color: "#22c55e" });
    } else if (deathCross) {
      draw.label({ x: bar, y: cHigh + 0.5 * effectiveAtr, text: "DEATH CROSS", position: "above", color: "#ef4444" });
    } else if (bullPullback) {
      draw.label({ x: bar, y: cLow - 0.3 * effectiveAtr, text: "PULLBACK", position: "below", color: "#3b82f6" });
    } else if (bearPullback) {
      draw.label({ x: bar, y: cHigh + 0.3 * effectiveAtr, text: "PULLBACK", position: "above", color: "#a855f7" });
    }
  }

  // ── HUD Table ─────────────────────────────────────────────────────────────
  if (showTable && isLast) {
    const HD = "#1e222d";
    const POS = "#089981";
    const NEG = "#f23645";
    const WARN = "#d97706";
    const NEU = "#2a2e39";

    const alignBg = isFullBull ? POS : isFullBear ? NEG : alignState === "TRANSITION" ? WARN : NEU;
    const spreadBg = isSqueeze ? WARN : spreadState === "EXPANDING" ? POS : NEU;
    const momBg = momentum === "POSITIVE" ? POS : momentum === "NEGATIVE" ? NEG : NEU;
    const regimeBg = isFullBull ? POS : isFullBear ? NEG : isSqueeze ? WARN : NEU;

    draw.table({
      position: "top_right",
      rows: [
        [{ text: "ALMA RIBBON ENGINE", bg: HD }, { text: "STATUS", bg: HD }],
        [{ text: "  Alignment", bg: NEU }, { text: alignState + " (" + alignScore + "%)", bg: alignBg }],
        [{ text: "  Spread / Compression", bg: NEU }, { text: spreadState + " (" + atrNormSpread.toFixed(2) + " ATR)", bg: spreadBg }],
        [{ text: "  Momentum", bg: NEU }, { text: momentum, bg: momBg }],
        [{ text: "  Regime", bg: NEU }, { text: regime, bg: regimeBg }],
      ],
    });
  }
});
`;

/** Converts ALMA Ribbon indicator into a backtestable strategy. */
export const toAlmaStrategy = (code: string): string =>
  code
    .replace("// ALMA Ribbon & Confluence Engine — Multi-ALMA trend, crossover & regime framework.", "// ALMA Ribbon Strategy — Backtest execution on ALMA alignment & crossovers.")
    .replace(
      'indicator("ALMA Ribbon & Confluence Engine", { overlay: true }, (api) => {',
      `defineStrategy("ALMA Ribbon Strategy", {
  initial_capital: 10_000,
  default_qty_value: 0.01,
  default_qty_type: "fixed",
  commission_type: "percent",
  commission_value: 0.05,
}, (api) => {
  const { strategy } = api;`,
    )
    .replace(
      "// ── Signals ───────────────────────────────────────────────────────────────",
      `// ── Automated Strategy Execution ──────────────────────────────────────────
  if (goldenCross && isFullBull) {
    strategy.entry("Long", "long");
  } else if (deathCross && isFullBear) {
    strategy.entry("Short", "short");
  }
  if (strategy.engine.position.size > 0 && cFast < cSignal) {
    strategy.close("Long");
  } else if (strategy.engine.position.size < 0 && cFast > cSignal) {
    strategy.close("Short");
  }

  // ── Signals ───────────────────────────────────────────────────────────────`,
    );
