/**
 * "Emka.nq NQ Confluence Engine" for pine-ts TypeScript Editor.
 *
 * Implements the Emka.nq order flow & GEX methodology:
 * - Pillar I: GEX Put Wall, Call Wall, Gamma Flip, shaded defense/supply zones
 * - Pillar II: Footprint absorption, exhaustion sweeps, CVD divergence, candle coloring
 * - Execution: Sweep reclamation entry, structural stop-loss, GEX targets,
 *   exact $20/point NQ position sizing, and high-density HUD dashboard.
 */

export const EMKA_NQ_CONFLUENCE_ENGINE = String.raw`// Emka.nq NQ Trading Confluence Engine — GEX, Absorption & CVD Framework.

indicator("Emka.nq NQ Confluence Engine", { overlay: true }, (api) => {
  const { ctx, ta, input, plot, draw, open, high, low, close, volume, bar_index } = api;
  const v = (name, init) => ctx.state.var(name, () => init);
  const val = (series, offset = 0) => { const x = series.at(offset); return x === undefined ? NaN : x; };
  const na = (x) => x === undefined || x === null || Number.isNaN(x);
  const bar = val(bar_index);
  const isLast = ctx.barstate.islast;

  // ── Inputs ────────────────────────────────────────────────────────────────
  const G_GEX = "Pillar I — GEX Structural Levels";
  const putWallIn = input.float(0, "Put Wall Price (0 = Auto)", { group: G_GEX });
  const callWallIn = input.float(0, "Call Wall Price (0 = Auto)", { group: G_GEX });
  const gammaFlipIn = input.float(0, "Gamma Flip Price (0 = Auto)", { group: G_GEX });

  const G_FLOW = "Pillar II — Order Flow & CVD Mechanics";
  const absVolMult = input.float(1.5, "Absorption Min Volume Mult", { min: 1.0, step: 0.1, group: G_FLOW });
  const sweepMaxVol = input.float(0.7, "Sweep Max Vol vs Absorption", { min: 0.2, max: 0.9, step: 0.05, group: G_FLOW });
  const cvdLookback = input.int(14, "CVD Divergence Lookback", { min: 3, max: 50, group: G_FLOW });

  const G_VIS = "Visuals & Aesthetics";
  const showZones = input.bool(true, "Show Shaded GEX Zones & Rails", { group: G_VIS });
  const colorCandles = input.bool(true, "Color Candles by Order Flow", { group: G_VIS });
  const showRegimeBg = input.bool(true, "Show Subtle Ambient Regime Tint", { group: G_VIS });
  const showSignals = input.bool(true, "Show Order Flow Signal Cards", { group: G_VIS });
  const showHud = input.bool(true, "Show Executive HUD Dashboard", { group: G_VIS });

  const G_RISK = "Execution & Position Sizing ($20/pt)";
  const accountSize = input.float(25000, "Account Capital ($)", { min: 1000, step: 1000, group: G_RISK });
  const riskPct = input.float(1.0, "Risk Per Trade (%)", { min: 0.25, max: 3.0, step: 0.25, group: G_RISK });
  const pointValue = input.float(20, "Contract Point Value ($20=NQ, $2=MNQ)", { options: [20, 2], group: G_RISK });
  const atrBufferMult = input.float(1.0, "Stop Loss ATR Volatility Buffer", { min: 0.5, max: 3.0, step: 0.5, group: G_RISK });

  // ── Calculations ──────────────────────────────────────────────────────────
  const atrVal = val(ta.atr(14));
  const effectiveAtr = na(atrVal) || atrVal <= 0 ? 5 : atrVal;
  const rollingLow = val(ta.lowest(low, 60));
  const rollingHigh = val(ta.highest(high, 60));

  const putWall = putWallIn > 0 ? putWallIn : rollingLow;
  const callWall = callWallIn > 0 ? callWallIn : rollingHigh;
  const gammaFlip = gammaFlipIn > 0 ? gammaFlipIn : (putWall + callWall) / 2;

  const cClose = val(close);
  const cOpen = val(open);
  const cHigh = val(high);
  const cLow = val(low);
  const cVol = val(volume);

  // CVD calculation from displacement relative to bar range
  const barRange = Math.max(0.25, cHigh - cLow);
  const bodyRange = cClose - cOpen;
  const barDelta = (bodyRange / barRange) * cVol;

  const cvdCell = v("cvd", 0);
  cvdCell.set(cvdCell.value + barDelta);
  const curCvd = cvdCell.value;

  const prevLowPrice = v("prevLowPrice", cLow);
  const prevLowCvd = v("prevLowCvd", curCvd);
  if (bar % cvdLookback === 0) {
    prevLowPrice.set(cLow);
    prevLowCvd.set(curCvd);
  }

  // Absorption: heavy negative delta stalls at Put Wall support
  const avgVol = val(ta.sma(volume, 20));
  const nearPutWall = Math.abs(cClose - putWall) <= effectiveAtr * 1.5;
  const isAbsorption = nearPutWall && cVol >= avgVol * absVolMult && barDelta < 0;

  const absVolCell = v("absVol", 0);
  const absBarCell = v("absBar", -999);
  if (isAbsorption) {
    absVolCell.set(cVol);
    absBarCell.set(bar);
  }

  // Exhaustion sweep: low volume probe below Put Wall
  const isSweep = absBarCell.value > 0 && (bar - absBarCell.value) <= 15 &&
    cLow < putWall && cVol < absVolCell.value * sweepMaxVol;

  const sweepHighCell = v("sweepHigh", 0);
  const sweepLowCell = v("sweepLow", 0);
  const sweepArmedCell = v("sweepArmed", false);

  if (isSweep) {
    sweepHighCell.set(cHigh);
    sweepLowCell.set(cLow);
    sweepArmedCell.set(true);
  }

  const isCvdDiv = cLow < prevLowPrice.value && curCvd > prevLowCvd.value;
  const isReclaim = sweepArmedCell.value && cClose > sweepHighCell.value;
  if (isReclaim) {
    sweepArmedCell.set(false);
  }

  // Position sizing with $20/point contract multiplier
  const stopLoss = sweepLowCell.value - (effectiveAtr * atrBufferMult);
  const stopDist = Math.max(1, cClose - stopLoss);
  const dollarRisk = accountSize * (riskPct / 100);
  const positionContracts = Math.max(1, Math.floor(dollarRisk / (stopDist * pointValue)));

  // ── Subtle Ambient Background Tint ────────────────────────────────────────
  if (showRegimeBg) {
    draw.bgcolor(cClose >= gammaFlip ? "rgba(16, 185, 129, 0.03)" : "rgba(244, 63, 94, 0.03)");
  }

  // ── Candlestick Coloring by Order Flow ────────────────────────────────────
  if (colorCandles) {
    if (isReclaim) {
      draw.barcolor("#10b981");
    } else if (isAbsorption) {
      draw.barcolor("#00e5ff");
    } else if (isSweep) {
      draw.barcolor("#f59e0b");
    }
  }

  // ── Institutional GEX Shaded Zones & Price Rails ─────────────────────────
  if (showZones && isLast) {
    const lookback = Math.max(0, bar - 50);
    const lookahead = bar + 10;
    const zoneThickness = effectiveAtr * 0.4;
    draw.box({ id: "pwZone", left: lookback, top: putWall + zoneThickness, right: lookahead, bottom: putWall - zoneThickness, fill: "rgba(16, 185, 129, 0.12)", border: "rgba(16, 185, 129, 0.45)" });
    draw.box({ id: "cwZone", left: lookback, top: callWall + zoneThickness, right: lookahead, bottom: callWall - zoneThickness, fill: "rgba(244, 63, 94, 0.12)", border: "rgba(244, 63, 94, 0.45)" });
    draw.line({ id: "gfRay", x1: lookback, y1: gammaFlip, x2: lookahead, y2: gammaFlip, color: "#c084fc", width: 1, style: "dashed" });
    draw.label({ id: "pwTag", x: lookahead, y: putWall, text: "🛡️ PUT WALL " + putWall.toFixed(1), color: "#10b981", position: "right" });
    draw.label({ id: "cwTag", x: lookahead, y: callWall, text: "🧱 CALL WALL " + callWall.toFixed(1), color: "#f43f5e", position: "right" });
    draw.label({ id: "gfTag", x: lookahead, y: gammaFlip, text: "⚡ GAMMA FLIP " + gammaFlip.toFixed(1), color: "#c084fc", position: "right" });
  }

  // ── Continuous Plots ──────────────────────────────────────────────────────
  plot(putWall, "Put Wall (Support)", { color: "#10b981", linewidth: 2 });
  plot(callWall, "Call Wall (Resistance)", { color: "#f43f5e", linewidth: 2 });
  plot(gammaFlip, "Gamma Flip (Regime)", { color: "#c084fc", linewidth: 1 });

  // --- Signals ---
  if (showSignals) {
    if (isAbsorption) {
      draw.label({
        x: bar, y: cLow - effectiveAtr * 0.8,
        text: "🛡️ ABSORPTION\nDelta: " + Math.round(barDelta) + " | Trapped Vol",
        color: "#ffffff",
        background: "rgba(14, 165, 233, 0.85)",
        position: "below",
      });
    } else if (isSweep) {
      draw.label({
        x: bar, y: cLow - effectiveAtr * 0.8,
        text: "⚡ EXHAUSTION SWEEP\nVol Dried: " + Math.round(cVol),
        color: "#ffffff",
        background: "rgba(245, 158, 11, 0.85)",
        position: "below",
      });
    } else if (isReclaim) {
      draw.label({
        x: bar, y: cLow - effectiveAtr * 1.3,
        text: "▲ EMKA.NQ RECLAIM\nEntry: " + cClose.toFixed(1) + " | SL: " + stopLoss.toFixed(1) + "\nTarget: " + callWall.toFixed(1) + " | Size: " + positionContracts + " NQ",
        color: "#ffffff",
        background: "rgba(16, 185, 129, 0.92)",
        position: "below",
      });
    }
  }

  // --- HUD Table ---
  if (showHud && isLast) {
    const HD = "#090d16";
    const POS = "#059669";
    const NEG = "#dc2626";
    const WARN = "#d97706";
    const CYAN = "#0284c7";
    const ROW = "#111827";

    const isPosGamma = cClose >= gammaFlip;
    const regimeBg = isPosGamma ? POS : NEG;
    const regimeTxt = isPosGamma ? "POSITIVE (DAMPED 🛡️)" : "NEGATIVE (AMPLIFIED ⚡)";
    const absTxt = isAbsorption ? "ACTIVE DEFENSE 🛡️" : "MONITORING";
    const absBg = isAbsorption ? CYAN : ROW;
    const sweepTxt = sweepArmedCell.value ? "ARMED (PROBE ⚡)" : "NONE";
    const sweepBg = sweepArmedCell.value ? WARN : ROW;
    const divTxt = isCvdDiv ? "BULLISH DIVERGENCE ▲" : "NEUTRAL";
    const divBg = isCvdDiv ? POS : ROW;
    const scoreVal = (isPosGamma ? 35 : 10) + (isAbsorption ? 25 : 0) + (sweepArmedCell.value ? 20 : 0) + (isCvdDiv ? 20 : 0);
    const scoreTxt = scoreVal + "% " + (scoreVal >= 75 ? "[HIGH CONFLUENCE]" : scoreVal >= 50 ? "[MODERATE]" : "[BUILDING]");
    const scoreBg = scoreVal >= 75 ? POS : scoreVal >= 50 ? WARN : ROW;

    draw.table({
      position: "top_right",
      rows: [
        [{ text: "EMKA.NQ CONFLUENCE", bg: HD }, { text: "LIVE 1M ●", bg: HD }],
        [{ text: "  Dealer Gamma Regime", bg: ROW }, { text: regimeTxt, bg: regimeBg }],
        [{ text: "  Put Wall Support", bg: ROW }, { text: putWall.toFixed(2), bg: POS }],
        [{ text: "  Call Wall Target", bg: ROW }, { text: callWall.toFixed(2), bg: NEG }],
        [{ text: "  Absorption Status", bg: ROW }, { text: absTxt, bg: absBg }],
        [{ text: "  Exhaustion Sweep", bg: ROW }, { text: sweepTxt, bg: sweepBg }],
        [{ text: "  CVD Divergence", bg: ROW }, { text: divTxt, bg: divBg }],
        [{ text: "  Confluence Rating", bg: ROW }, { text: scoreTxt, bg: scoreBg }],
        [{ text: "  NQ Sizing ($" + Math.round(dollarRisk) + " risk)", bg: ROW }, { text: positionContracts + " ctr (" + pointValue + "$/pt)", bg: POS }],
      ],
    });
  }
});
`;

/** Converts Emka.nq Confluence Engine indicator into a backtestable strategy. */
export const toEmkaNqStrategy = (code: string): string =>
  code
    .replace("// Emka.nq NQ Trading Confluence Engine — GEX, Absorption & CVD Framework.", "// Emka.nq NQ Trading Strategy — Automated Execution on Reclaimed Exhaustion Sweeps.")
    .replace(
      'indicator("Emka.nq NQ Confluence Engine", { overlay: true }, (api) => {',
      `defineStrategy("Emka.nq NQ Strategy", {
  initial_capital: 25_000,
  default_qty_value: 1,
  default_qty_type: "fixed",
  commission_type: "percent",
  commission_value: 0.02,
}, (api) => {
  const { strategy } = api;`,
    )
    .replace(
      "  // --- Signals ---",
      `  // --- Strategy Orders ---
  if (isReclaim && strategy.engine.position_size === 0) {
    strategy.entry("LongReclaim", "long", { qty: positionContracts });
  }
  if (strategy.engine.position_size > 0) {
    if (cLow <= stopLoss) {
      strategy.close("LongReclaim");
    } else if (cHigh >= callWall) {
      strategy.close("LongReclaim");
    }
  }

  // --- Signals ---`,
    );

export const EMKA_NQ_CONFLUENCE_STRATEGY = toEmkaNqStrategy(EMKA_NQ_CONFLUENCE_ENGINE);
