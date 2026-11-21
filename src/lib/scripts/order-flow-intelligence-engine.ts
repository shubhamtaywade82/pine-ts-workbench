/**
 * Order Flow + Market Structure Confluence Engine for Pine TS Workbench.
 *
 * Combines:
 * - Smart Money Market Structure: 3-bar Fair Value Gaps (FVG) and Swing Pivots
 * - Microstructure Order Flow: Volume absorption, delta exhaustion, liquidity sweep reclaims
 * - Executive Glassmorphism HUD Dashboard with real-time confluence score (0-100)
 */

export const ORDER_FLOW_INTELLIGENCE_ENGINE = String.raw`// Order Flow + Market Structure Confluence Engine — SMC & Microstructure Intelligence.

indicator("Order Flow + Market Structure Confluence", { overlay: true }, (api) => {
  const { ctx, ta, input, draw, open, high, low, close, volume, bar_index } = api;
  const v = (name, init) => ctx.state.var(name, () => init);
  const val = (series, offset = 0) => { const x = series.at(offset); return x === undefined ? NaN : x; };
  const na = (x) => x === undefined || x === null || Number.isNaN(x);
  const bar = val(bar_index);
  const isLast = ctx.barstate.islast;

  // ── Inputs ────────────────────────────────────────────────────────────────
  const G_SMC = "Smart Money Structure (SMC)";
  const pivotLookback = input.int(3, "Swing Pivot Lookback", { min: 2, max: 10, group: G_SMC });
  const showFvgBoxes = input.bool(true, "Draw Shaded Fair Value Gaps (FVG)", { group: G_SMC });
  const showPivots = input.bool(true, "Show Swing Pivots (HH/HL/LH/LL)", { group: G_SMC });

  const G_FLOW = "Microstructure & Order Flow";
  const absVolMult = input.float(2.0, "Absorption Volume Multiplier", { min: 1.2, step: 0.1, group: G_FLOW });
  const sweepMaxPen = input.float(15, "Max Sweep Penetration (Ticks)", { min: 3, max: 50, group: G_FLOW });
  const tickSize = input.float(0.5, "Instrument Tick Size", { min: 0.0001, group: G_FLOW });

  const G_VIS = "Visuals & HUD Dashboard";
  const colorCandles = input.bool(true, "Color Candles by Order Flow Regime", { group: G_VIS });
  const showSignals = input.bool(true, "Show Signal Markers", { group: G_VIS });
  const showHud = input.bool(true, "Show Executive HUD Dashboard", { group: G_VIS });

  const G_RISK = "Execution & Risk Management";
  const accountSize = input.float(50000, "Account Capital ($)", { min: 1000, step: 5000, group: G_RISK });
  const riskPct = input.float(1.0, "Risk Per Trade (%)", { min: 0.25, max: 3.0, step: 0.25, group: G_RISK });
  const atrBuffer = input.float(1.5, "Stop Loss ATR Buffer Multiplier", { min: 0.5, max: 3.0, step: 0.5, group: G_RISK });

  // ── State Variables ───────────────────────────────────────────────────────
  const lastSwingLow = v("lastSwingLow", NaN);
  const lastSwingHigh = v("lastSwingHigh", NaN);
  const activeFvgTop = v("activeFvgTop", NaN);
  const activeFvgBottom = v("activeFvgBottom", NaN);
  const activeFvgBull = v("activeFvgBull", false);

  // ── Calculations ──────────────────────────────────────────────────────────
  const cOpen = val(open);
  const cHigh = val(high);
  const cLow = val(low);
  const cClose = val(close);
  const cVol = val(volume);

  const atrVal = val(ta.atr(14));
  const effectiveAtr = na(atrVal) || atrVal <= 0 ? (cHigh - cLow || 5) : atrVal;
  const avgVolVal = val(ta.sma(volume, 20));
  const avgVol = na(avgVolVal) || avgVolVal <= 0 ? cVol : avgVolVal;

  // ── 1. Smart Money Market Structure: FVG & Pivots ─────────────────────────
  const prev2High = val(high, 2);
  const prev2Low = val(low, 2);

  const isBullFvg = !na(prev2High) && cLow > prev2High;
  const isBearFvg = !na(prev2Low) && cHigh < prev2Low;

  if (isBullFvg) {
    activeFvgTop.value = cLow;
    activeFvgBottom.value = prev2High;
    activeFvgBull.value = true;
    if (showFvgBoxes) {
      draw.box({
        left: bar - 2,
        right: bar + 5,
        top: cLow,
        bottom: prev2High,
        border_color: "#00E676",
        border_width: 1,
        border_style: "dashed",
        bg_color: "rgba(0, 230, 118, 0.12)",
      });
    }
  } else if (isBearFvg) {
    activeFvgTop.value = prev2Low;
    activeFvgBottom.value = cHigh;
    activeFvgBull.value = false;
    if (showFvgBoxes) {
      draw.box({
        left: bar - 2,
        right: bar + 5,
        top: prev2Low,
        bottom: cHigh,
        border_color: "#FF1744",
        border_width: 1,
        border_style: "dashed",
        bg_color: "rgba(255, 23, 68, 0.12)",
      });
    }
  }

  // FVG Mitigation check
  const inFvg = !na(activeFvgTop.value) && cClose >= activeFvgBottom.value && cClose <= activeFvgTop.value;

  // Swing Pivots
  const highestLeft = val(ta.highest(high, pivotLookback), 1);
  const lowestLeft = val(ta.lowest(low, pivotLookback), 1);

  if (!na(highestLeft) && cHigh > highestLeft) {
    lastSwingHigh.value = cHigh;
  }
  if (!na(lowestLeft) && cLow < lowestLeft) {
    lastSwingLow.value = cLow;
  }

  // ── 2. Microstructure: Absorption & Sweeps ─────────────────────────────────
  const isHighVol = cVol >= avgVol * absVolMult;
  const barSpread = Math.abs(cClose - cOpen);
  const isAbsorbed = isHighVol && barSpread <= effectiveAtr * 0.4;

  const isBullAbsorption = isAbsorbed && cClose >= cOpen;
  const isBearAbsorption = isAbsorbed && cClose < cOpen;

  // Sweep Detection
  let isBullSweep = false;
  let isBearSweep = false;

  if (!na(lastSwingLow.value) && cLow < lastSwingLow.value) {
    const penTicks = (lastSwingLow.value - cLow) / tickSize;
    if (penTicks <= sweepMaxPen && cClose > lastSwingLow.value) {
      isBullSweep = true;
    }
  }

  if (!na(lastSwingHigh.value) && cHigh > lastSwingHigh.value) {
    const penTicks = (cHigh - lastSwingHigh.value) / tickSize;
    if (penTicks <= sweepMaxPen && cClose < lastSwingHigh.value) {
      isBearSweep = true;
    }
  }

  // ── 3. Multi-Factor Confluence Scoring (0-100) ─────────────────────────────
  let bullScore = 0;
  if (inFvg && activeFvgBull.value) bullScore += 25;
  if (isBullAbsorption) bullScore += 30;
  if (isBullSweep) bullScore += 30;
  if (cClose > cOpen) bullScore += 15;

  let bearScore = 0;
  if (inFvg && !activeFvgBull.value) bearScore += 25;
  if (isBearAbsorption) bearScore += 30;
  if (isBearSweep) bearScore += 30;
  if (cClose < cOpen) bearScore += 15;

  const isPrimeLong = bullScore >= 70;
  const isPrimeShort = bearScore >= 70;

  // ── 4. Visual Candlestick Coloring ─────────────────────────────────────────
  if (colorCandles) {
    if (isPrimeLong) draw.barcolor("#00E676");       // Emerald Prime Long
    else if (isPrimeShort) draw.barcolor("#D50000"); // Crimson Prime Short
    else if (isBullAbsorption) draw.barcolor("#00E5FF"); // Cyan Absorption
    else if (isBearAbsorption) draw.barcolor("#FF4081"); // Pink Absorption
    else if (isBullSweep || isBearSweep) draw.barcolor("#FFC107"); // Amber Sweep
  }

  // ── 5. Signal Annotations ──────────────────────────────────────────────────
  if (showSignals) {
    if (isPrimeLong) {
      draw.label({
        point: { bar, price: cLow - effectiveAtr * 0.5 },
        text: "▲ PRIME LONG (" + bullScore + "%)",
        color: "#00E676",
        text_color: "#000000",
        style: "label_up",
        size: "normal",
      });
    } else if (isPrimeShort) {
      draw.label({
        point: { bar, price: cHigh + effectiveAtr * 0.5 },
        text: "▼ PRIME SHORT (" + bearScore + "%)",
        color: "#FF1744",
        text_color: "#FFFFFF",
        style: "label_down",
        size: "normal",
      });
    } else if (isBullSweep) {
      draw.label({
        point: { bar, price: cLow },
        text: "▲ SWEEP RECLAIM",
        color: "#FFC107",
        text_color: "#000000",
        style: "label_up",
        size: "small",
      });
    } else if (isBearSweep) {
      draw.label({
        point: { bar, price: cHigh },
        text: "▼ SWEEP RECLAIM",
        color: "#FFC107",
        text_color: "#000000",
        style: "label_down",
        size: "small",
      });
    }
  }

  // --- Strategy Orders ---

  // ── 6. Executive Glassmorphism HUD Dashboard ──────────────────────────────
  if (isLast && showHud) {
    const HD = "#0D1117";
    const ROW = "#161B22";
    const POS = "#00C853";
    const NEG = "#D50000";
    const WARN = "#FFB300";
    const INFO = "#00B0FF";

    const activeScore = Math.max(bullScore, bearScore);
    const scoreColor = activeScore >= 70 ? POS : activeScore >= 50 ? WARN : ROW;
    const scoreGrade = activeScore >= 70 ? "PRIME CONFLUENCE" : activeScore >= 50 ? "MODERATE" : "BUILDING";

    const fvgText = inFvg ? "MITIGATING " + (activeFvgBull.value ? "BULL FVG" : "BEAR FVG") : "OPEN LIQUIDITY";
    const fvgColor = inFvg ? INFO : ROW;

    const absText = isBullAbsorption ? "BULL ABSORPTION (WALL HELD)" : isBearAbsorption ? "BEAR ABSORPTION" : "NORMAL TAPE";
    const absColor = isBullAbsorption ? POS : isBearAbsorption ? NEG : ROW;

    const sweepText = isBullSweep ? "BULLISH STOP SWEEP" : isBearSweep ? "BEARISH STOP SWEEP" : "NO RECENT SWEEP";
    const sweepColor = isBullSweep || isBearSweep ? WARN : ROW;

    const dollarRisk = (accountSize * riskPct) / 100;
    const riskDistance = effectiveAtr * atrBuffer;
    const contracts = Math.max(1, Math.floor(dollarRisk / (riskDistance * 20 || 100)));

    draw.table({
      position: "top_right",
      rows: [
        [{ text: "ORDER FLOW + SMC CONFLUENCE", bg: HD }, { text: "LIVE ●", bg: HD }],
        [{ text: "  Confluence Rating", bg: ROW }, { text: activeScore + "% [" + scoreGrade + "]", bg: scoreColor }],
        [{ text: "  Smart Money FVG", bg: ROW }, { text: fvgText, bg: fvgColor }],
        [{ text: "  Order Flow Absorption", bg: ROW }, { text: absText, bg: absColor }],
        [{ text: "  Liquidity Sweep", bg: ROW }, { text: sweepText, bg: sweepColor }],
        [{ text: "  Swing Low Pivot", bg: ROW }, { text: na(lastSwingLow.value) ? "—" : lastSwingLow.value.toFixed(2), bg: POS }],
        [{ text: "  Swing High Pivot", bg: ROW }, { text: na(lastSwingHigh.value) ? "—" : lastSwingHigh.value.toFixed(2), bg: NEG }],
        [{ text: "  Suggested Risk / Size", bg: ROW }, { text: "$" + Math.round(dollarRisk) + " (" + contracts + " ctr)", bg: INFO }],
      ],
    });
  }
});
`;

/** Converts Confluence Engine indicator into an automated strategy. */
export const toOrderFlowStrategy = (code: string): string =>
  code
    .replace(
      'indicator("Order Flow + Market Structure Confluence", { overlay: true }, (api) => {',
      `defineStrategy("Order Flow Confluence Strategy", {
  initial_capital: 50_000,
  default_qty_value: 1,
  default_qty_type: "fixed",
  commission_type: "percent",
  commission_value: 0.02,
}, (api) => {
  const { strategy } = api;`,
    )
    .replace(
      "  // --- Strategy Orders ---",
      `  // --- Strategy Orders ---
  if (isPrimeLong && strategy.engine.position_size === 0) {
    strategy.entry("LongConfluence", "long", { qty: 1 });
  } else if (isPrimeShort && strategy.engine.position_size === 0) {
    strategy.entry("ShortConfluence", "short", { qty: 1 });
  }

  if (strategy.engine.position_size > 0) {
    if (cLow <= cClose - effectiveAtr * atrBuffer) {
      strategy.close("LongConfluence");
    } else if (!na(lastSwingHigh.value) && cHigh >= lastSwingHigh.value) {
      strategy.close("LongConfluence");
    }
  } else if (strategy.engine.position_size < 0) {
    if (cHigh >= cClose + effectiveAtr * atrBuffer) {
      strategy.close("ShortConfluence");
    } else if (!na(lastSwingLow.value) && cLow <= lastSwingLow.value) {
      strategy.close("ShortConfluence");
    }
  }`,
    );

export const ORDER_FLOW_INTELLIGENCE_STRATEGY = toOrderFlowStrategy(ORDER_FLOW_INTELLIGENCE_ENGINE);
