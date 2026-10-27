/**
 * "SMC Confluence Engine v7.1 [nemesis]" ported from Pine Script v6 to a
 * pine-ts concise indicator, as Pine Editor template source.
 *
 * Kept: the 4-layer MTF stack (4H/1H/15m via `security`), 5m structure with
 * displacement, armed triggers, order blocks, FVGs with partial fills, HH/HL
 * labels and zigzag, trendline break/retest, liquidity sweeps, PDH/PDL and
 * session levels, the rolling volume profile, the three setups, structural
 * SL/TP/RR, the 100-point score, hard gates, signal labels, Supertrend, bias
 * background, bar colours and the dashboard.
 * Not ported: the XGBoost ML shadow model (no XGBoost library; it never gated
 * signals) and the JSON alert() payloads.
 *
 * Template literals are avoided inside the script so it can live in String.raw.
 */
export const SMC_CONFLUENCE_ENGINE = String.raw`// SMC Confluence Engine v7.1 [nemesis] — pine-ts port of the Pine Script v6 indicator.
// ML shadow (XGBoost) and alert() payloads are not ported; everything else is.

indicator("SMC Confluence Engine v7.1", { overlay: true }, (api) => {
  const { ctx, ta, math, input, plot, draw, security, alert, open, high, low, close, volume, hlc3, bar_index } = api;
  const v = (name, init) => ctx.state.var(name, () => init);
  const val = (series, offset = 0) => { const x = series.at(offset); return x === undefined ? NaN : x; };
  const na = (x) => x === undefined || x === null || Number.isNaN(x);
  const nz = (x, fallback = 0) => (na(x) ? fallback : x);
  const bar = val(bar_index);
  const isLast = ctx.barstate.islast;

  // ── Inputs ────────────────────────────────────────────────────────────────
  const G_MTF = "MTF Architecture (4-Layer Stack)";
  const htfTf = input.string("240", "Layer A — HTF Macro TF", { options: ["60", "120", "240", "D"], group: G_MTF });
  const setupTf = input.string("60", "Layer B — Setup / 1H TF", { options: ["15", "30", "60", "120", "240"], group: G_MTF });
  const entryTf = input.string("15", "Layer C — Context / 15m TF", { options: ["5", "15", "30", "60"], group: G_MTF });
  const htfEmaFast = input.int(9, "HTF Fast EMA", { min: 3, group: G_MTF });
  const htfEmaSlow = input.int(21, "HTF Slow EMA", { min: 5, group: G_MTF });
  const htfSwing = input.int(5, "HTF Pivot Swing Length", { min: 2, max: 20, group: G_MTF });
  const htfPdLen = input.int(50, "HTF Premium/Discount Lookback", { min: 10, max: 200, group: G_MTF });
  const setupSwing = input.int(5, "1H Pivot Swing Length", { min: 2, max: 20, group: G_MTF });
  const entryLiqLb = input.int(15, "15m Lookback (bars on entry TF)", { min: 3, max: 50, group: G_MTF });
  const showHtfLines = input.bool(true, "Show 4H EMA lines", { group: G_MTF });
  const show4hZones = input.bool(true, "Show Premium/Discount zone", { group: G_MTF });

  const G_SMC = "Layer D — 5m SMC & Trigger Engine";
  const smcSwing = input.int(10, "Swing Length (BOS/CHoCH)", { min: 3, max: 50, group: G_SMC });
  const chValidity = input.int(12, "Trigger Armed Validity (bars)", { min: 3, max: 30, group: G_SMC });
  const dispMult = input.float(0.8, "Displacement Min ATR Mult", { min: 0.4, step: 0.1, group: G_SMC });
  const dispBodyPct = input.float(0.55, "Displacement Min Body %", { min: 0.3, step: 0.05, group: G_SMC });
  const obSearchLen = input.int(5, "OB Origin Search Lookback", { min: 1, max: 10, group: G_SMC });
  const obExpire = input.int(40, "OB Expires (bars)", { min: 5, max: 300, group: G_SMC });
  const liqLookback = input.int(20, "Liquidity Swing Lookback", { min: 5, max: 100, group: G_SMC });
  const liqWickPct = input.float(0.12, "Sweep Min Wick %", { min: 0.02, step: 0.02, group: G_SMC });
  const showOb = input.bool(true, "Show Order Block Boxes", { group: G_SMC });
  const showBos = input.bool(true, "Show BOS/CHoCH Lines", { group: G_SMC });
  const showLiq = input.bool(true, "Show Liquidity Sweeps", { group: G_SMC });

  const G_MS = "5m Market Structure";
  const msSwing = input.int(10, "Structure Swing Length", { min: 3, max: 30, group: G_MS });
  const showMs = input.bool(true, "Show HH/HL/LH/LL Labels", { group: G_MS });
  const showMsLine = input.bool(true, "Show Structure ZigZag Lines", { group: G_MS });

  const G_TL = "Trendlines";
  const tlPivotLen = input.int(10, "Pivot Length", { min: 3, max: 30, group: G_TL });
  const showTl = input.bool(true, "Show Trendlines", { group: G_TL });
  const showTlBreak = input.bool(true, "Show Break/Retest Labels", { group: G_TL });

  const G_FVG = "Fair Value Gaps";
  const showFvg = input.bool(true, "Show FVG Boxes", { group: G_FVG });
  const fvgMinPct = input.float(0.10, "Min Gap Size %", { min: 0, step: 0.01, group: G_FVG });
  const fvgExpire = input.int(80, "FVG Expires (bars)", { min: 10, max: 500, group: G_FVG });

  const G_SESS = "Session Levels";
  const showPdhPdl = input.bool(true, "Show PDH/PDL Lines", { group: G_SESS });
  const sessLiqPct = input.float(0.10, "Level Buffer Zone %", { min: 0.02, step: 0.02, group: G_SESS });
  const asiaSess = input.string("0000-0800", "Asia Session (UTC)", { group: G_SESS });
  const londonSess = input.string("0800-1600", "London Session (UTC)", { group: G_SESS });

  const G_VP = "Volume Profile";
  const vpBars = input.int(100, "VP Lookback (bars)", { min: 20, max: 500, group: G_VP });
  const pocZonePct = input.float(0.2, "POC / VA Zone Proximity %", { min: 0.05, step: 0.05, group: G_VP });
  const showVp = input.bool(true, "Show VP Lines (POC/VAH/VAL)", { group: G_VP });

  const G_SIG = "Signal Engine & Risk/Reward";
  const minScore = input.int(70, "Min Confluence Score (0–100)", { min: 50, max: 95, group: G_SIG });
  const minRr = input.float(1.8, "Min Risk:Reward (TP2/Risk)", { min: 1.2, step: 0.1, group: G_SIG });
  const minScoreCt = input.int(82, "Min Score — Countertrend Setup C", { min: 60, max: 99, group: G_SIG });
  const sigCooldown = input.int(8, "Signal Cooldown (bars)", { min: 1, max: 30, group: G_SIG });
  const showSignals = input.bool(true, "Show Trade Entry/SL/TP Labels", { group: G_SIG });
  const showScore = input.bool(true, "Show Confluence Score", { group: G_SIG });

  const G_VIS = "Visuals";
  const showDash = input.bool(true, "Show Live Dashboard Table", { group: G_VIS });
  const showSt = input.bool(true, "Show Supertrend Overlay", { group: G_VIS });
  const drawMaxAtr = input.float(3.0, "Max Draw Distance (ATR)", { min: 0.5, max: 20, step: 0.5, group: G_VIS });

  const BULL = "#00c4ff";
  const BEAR = "#ff3d3d";
  const alpha = (hex, transparency) => hex + Math.round((100 - transparency) * 2.55).toString(16).padStart(2, "0");

  // ── Base calculations ─────────────────────────────────────────────────────
  const atr14 = val(ta.atr(14));
  const volSma = val(ta.sma(volume, 20));
  const c = val(close), o = val(open), h = val(high), l = val(low);
  const near = (price) => !na(price) && Math.abs(price - c) <= atr14 * drawMaxAtr;
  const dayIndex = Math.floor(val(api.time) / 86400000);
  const prevDayCell = v("prevDay", dayIndex);
  const isNewDay = dayIndex !== prevDayCell.value;
  prevDayCell.set(dayIndex);

  // ── Layer A — HTF macro bias (previous closed HTF bar, non-repainting) ────
  const htf = security(htfTf, (x) => ({
    emaF: val(x.ta.ema(x.close, htfEmaFast)),
    emaS: val(x.ta.ema(x.close, htfEmaSlow)),
    close: val(x.close),
    high50: val(x.ta.highest(x.high, htfPdLen)),
    low50: val(x.ta.lowest(x.low, htfPdLen)),
    ph: val(x.ta.pivothigh(x.high, htfSwing, htfSwing)),
    pl: val(x.ta.pivotlow(x.low, htfSwing, htfSwing)),
  })) ?? { emaF: NaN, emaS: NaN, close: NaN, high50: NaN, low50: NaN, ph: NaN, pl: NaN };

  const htfLastPh = v("htfLastPh", NaN);
  const htfLastPl = v("htfLastPl", NaN);
  if (!na(htf.ph)) htfLastPh.set(htf.ph);
  if (!na(htf.pl)) htfLastPl.set(htf.pl);

  const htfEmaFSeries = ctx.series("htfEmaF", () => htf.emaF);
  const htfEmaSSeries = ctx.series("htfEmaS", () => htf.emaS);
  const htfCrossUp = ta.crossover(htfEmaFSeries, htfEmaSSeries).value === true;
  const htfCrossDown = ta.crossunder(htfEmaFSeries, htfEmaSSeries).value === true;
  const htfBiasCell = v("htfBias", 0);
  let htfBias = htfBiasCell.value;
  const htfBullInvalid = htfBias === 1 && !na(htfLastPl.value) && htf.close < htfLastPl.value;
  const htfBearInvalid = htfBias === -1 && !na(htfLastPh.value) && htf.close > htfLastPh.value;
  if ((htfCrossDown && htfBias === 1) || (htfCrossUp && htfBias === -1) || htfBullInvalid || htfBearInvalid) htfBias = 0;
  if (htf.emaF > htf.emaS && !na(htfLastPh.value) && htf.close > htfLastPh.value) htfBias = 1;
  else if (htf.emaF < htf.emaS && !na(htfLastPl.value) && htf.close < htfLastPl.value) htfBias = -1;
  htfBiasCell.set(htfBias);

  const htfRangeMid = (htf.high50 + htf.low50) / 2;
  const inDiscount = c < htfRangeMid;
  const inPremium = c > htfRangeMid;

  if (isLast) drawHtfLevels();
  function drawHtfLevels() {
    const emaLine = (id, price, color, text) => {
      if (!showHtfLines || !near(price)) { draw.remove(id); draw.remove(id + ":lbl"); return; }
      draw.line({ id, x1: bar - 5, y1: price, x2: bar + 20, y2: price, color: alpha(color, 30), style: "dashed" });
      draw.label({ id: id + ":lbl", x: bar + 20, y: price, text, color, position: "right" });
    };
    emaLine("htfEmaF", htf.emaF, BULL, "4H EMA" + htfEmaFast);
    emaLine("htfEmaS", htf.emaS, BEAR, "4H EMA" + htfEmaSlow);
    if (!show4hZones || na(htf.high50) || na(htf.low50)) return;
    const reach = atr14 * drawMaxAtr;
    const top = Math.min(htf.high50, c + reach);
    const bot = Math.max(htf.low50, c - reach);
    const mid = Math.max(bot, Math.min(top, htfRangeMid));
    const left = bar - htfPdLen;
    draw.box({ id: "pdPrem", left, top, right: bar + 10, bottom: mid, fill: alpha(BEAR, 92) });
    draw.box({ id: "pdDisc", left, top: mid, right: bar + 10, bottom: bot, fill: alpha(BULL, 92) });
    draw.label({ id: "pdPremLbl", x: left, y: top, text: "Premium", color: BEAR, position: "left" });
    draw.label({ id: "pdDiscLbl", x: left, y: bot, text: "Discount", color: BULL, position: "left" });
  }

  // ── Layer B — 1H directional structure ────────────────────────────────────
  const h1 = security(setupTf, (x) => ({
    emaF: val(x.ta.ema(x.close, htfEmaFast)),
    emaS: val(x.ta.ema(x.close, htfEmaSlow)),
    close: val(x.close),
    ph: val(x.ta.pivothigh(x.high, setupSwing, setupSwing)),
    pl: val(x.ta.pivotlow(x.low, setupSwing, setupSwing)),
  })) ?? { emaF: NaN, emaS: NaN, close: NaN, ph: NaN, pl: NaN };
  const h1LastPh = v("h1LastPh", NaN);
  const h1LastPl = v("h1LastPl", NaN);
  const h1BiasCell = v("h1Bias", 0);
  if (!na(h1.ph)) h1LastPh.set(h1.ph);
  if (!na(h1.pl)) h1LastPl.set(h1.pl);
  let h1Bias = h1BiasCell.value;
  const h1AbovePh = !na(h1LastPh.value) && h1.close > h1LastPh.value;
  const h1BelowPl = !na(h1LastPl.value) && h1.close < h1LastPl.value;
  const h1BosBull = h1AbovePh && h1.emaF > h1.emaS;
  const h1BosBear = h1BelowPl && h1.emaF < h1.emaS;
  const h1ChochBull = h1AbovePh && h1Bias === -1;
  const h1ChochBear = h1BelowPl && h1Bias === 1;
  if (h1BosBull || h1ChochBull) h1Bias = 1;
  if (h1BosBear || h1ChochBear) h1Bias = -1;
  if ((h1Bias === 1 && h1BelowPl) || (h1Bias === -1 && h1AbovePh)) h1Bias = 0;
  h1BiasCell.set(h1Bias);

  // ── Layer C — 15m context & location ──────────────────────────────────────
  const m15 = security(entryTf, (x) => ({
    high: val(x.high), low: val(x.low), close: val(x.close),
    priorSwingHi: val(x.ta.highest(x.high, entryLiqLb), 1),
    priorSwingLo: val(x.ta.lowest(x.low, entryLiqLb), 1),
  })) ?? { high: NaN, low: NaN, close: NaN, priorSwingHi: NaN, priorSwingLo: NaN };
  const m15BreakoutLong = m15.close > m15.priorSwingHi;
  const m15BreakoutShort = m15.close < m15.priorSwingLo;
  const m15SslSweep = m15.low < m15.priorSwingLo && m15.close > m15.priorSwingLo;
  const m15BslSweep = m15.high > m15.priorSwingHi && m15.close < m15.priorSwingHi;

  // ── Layer D — structure, displacement & trigger lifecycle ─────────────────
  const ph = val(ta.pivothigh(high, smcSwing, smcSwing));
  const pl = val(ta.pivotlow(low, smcSwing, smcSwing));
  const lastPh = v("lastPh", NaN), lastPl = v("lastPl", NaN);
  const lastPhBar = v("lastPhBar", -999), lastPlBar = v("lastPlBar", -999);
  const phAge = v("phAge", 0), plAge = v("plAge", 0);
  phAge.set(phAge.value + 1);
  plAge.set(plAge.value + 1);
  if (!na(ph)) { lastPh.set(ph); lastPhBar.set(bar - smcSwing); phAge.set(0); }
  if (!na(pl)) { lastPl.set(pl); lastPlBar.set(bar - smcSwing); plAge.set(0); }
  const phValid = !na(lastPh.value) && phAge.value <= obExpire;
  const plValid = !na(lastPl.value) && plAge.value <= obExpire;

  const candleRange = Math.max(h - l, 1e-8);
  const isDispBull = c - o >= atr14 * dispMult && (c - o) / candleRange >= dispBodyPct;
  const isDispBear = o - c >= atr14 * dispMult && (o - c) / candleRange >= dispBodyPct;
  const prevClose = val(close, 1);
  const bosBull = phValid && c > lastPh.value && prevClose <= lastPh.value && isDispBull;
  const bosBear = plValid && c < lastPl.value && prevClose >= lastPl.value && isDispBear;
  const structureBiasCell = v("structureBias", 0);
  const chochBull = bosBull && structureBiasCell.value === -1;
  const chochBear = bosBear && structureBiasCell.value === 1;
  if (bosBull) structureBiasCell.set(1);
  if (bosBear) structureBiasCell.set(-1);
  const structureBias = structureBiasCell.value;

  const armedLong = v("armedLong", false), armedShort = v("armedShort", false);
  const armedLongBar = v("armedLongBar", -999), armedShortBar = v("armedShortBar", -999);
  const armedLongLvl = v("armedLongLvl", NaN), armedShortLvl = v("armedShortLvl", NaN);
  if (bosBull) { armedLong.set(true); armedShort.set(false); armedLongBar.set(bar); armedLongLvl.set(lastPh.value); }
  if (bosBear) { armedShort.set(true); armedLong.set(false); armedShortBar.set(bar); armedShortLvl.set(lastPl.value); }
  if (armedLong.value && bar - armedLongBar.value > chValidity) armedLong.set(false);
  if (armedShort.value && bar - armedShortBar.value > chValidity) armedShort.set(false);

  drawStructureBreaks();
  function drawStructureBreaks() {
    if (!showBos) return;
    const lastBullLbl = v("lastBosBullLbl", -999), lastBearLbl = v("lastBosBearLbl", -999);
    const gap = Math.max(3, smcSwing);
    const breakLine = (fromBar, price, color, text, isChoch) => {
      const left = Math.max(fromBar, bar - 100);
      draw.line({ x1: left, y1: price, x2: bar, y2: price, color: isChoch ? color : alpha(color, 50), style: isChoch ? "solid" : "dashed" });
      draw.label({ x: Math.round((left + bar) / 2), y: price, text, color, position: "center" });
    };
    if (chochBull) { breakLine(lastPhBar.value, lastPh.value, BULL, "CHoCH", true); lastBullLbl.set(bar); }
    if (chochBear) { breakLine(lastPlBar.value, lastPl.value, BEAR, "CHoCH", true); lastBearLbl.set(bar); }
    if (bosBull && !chochBull && bar - lastBullLbl.value >= gap) { breakLine(lastPhBar.value, lastPh.value, BULL, "BOS", false); lastBullLbl.set(bar); }
    if (bosBear && !chochBear && bar - lastBearLbl.value >= gap) { breakLine(lastPlBar.value, lastPl.value, BEAR, "BOS", false); lastBearLbl.set(bar); }
  }

  // ── Order blocks (origin candle search & ATR mitigation) ──────────────────
  const bullOb = v("bullOb", { hi: NaN, lo: NaN, bar: -999 });
  const bearOb = v("bearOb", { hi: NaN, lo: NaN, bar: -999 });
  const originIndex = (isBullishBreak) => {
    for (let k = 1; k <= obSearchLen; k++) {
      const isOpposite = isBullishBreak ? val(close, k) < val(open, k) : val(close, k) > val(open, k);
      if (isOpposite) return k;
    }
    return 1;
  };
  if (bosBull) { const k = originIndex(true); bullOb.set({ hi: val(high, k), lo: val(low, k), bar: bar - k }); }
  if (bosBear) { const k = originIndex(false); bearOb.set({ hi: val(high, k), lo: val(low, k), bar: bar - k }); }
  const bull = bullOb.value, bear = bearOb.value;
  const bullObValid = !na(bull.hi) && bar - bull.bar <= obExpire && c >= bull.lo - atr14 * 0.25;
  const bearObValid = !na(bear.hi) && bar - bear.bar <= obExpire && c <= bear.hi + atr14 * 0.25;
  const inBullOb = bullObValid && l <= bull.hi + atr14 * 0.1 && h >= bull.lo;
  const inBearOb = bearObValid && h >= bear.lo - atr14 * 0.1 && l <= bear.hi;

  drawOrderBlocks();
  function drawOrderBlocks() {
    if (!showOb) return;
    const zone = (id, ob, isValid, color) => {
      if (!isValid || !near((ob.hi + ob.lo) / 2)) { draw.remove(id); draw.remove(id + ":lbl"); return; }
      draw.box({ id, left: ob.bar, top: ob.hi, right: bar + 3, bottom: ob.lo, fill: alpha(color, 85) });
      draw.label({ id: id + ":lbl", x: ob.bar, y: ob.hi, text: "OB", color, position: "left" });
    };
    if (isLast) { zone("bullOb", bull, bullObValid, BULL); zone("bearOb", bear, bearObValid, BEAR); }
    const wasBullValid = v("bullObPrev", false), wasBearValid = v("bearObPrev", false);
    if (wasBullValid.value && !bullObValid) draw.label({ x: bar, y: c, text: "OB mitigated", color: BULL });
    if (wasBearValid.value && !bearObValid) draw.label({ x: bar, y: c, text: "OB mitigated", color: BEAR });
    wasBullValid.set(bullObValid);
    wasBearValid.set(bearObValid);
  }

  // ── Fair value gaps (partial fills, expiry, retest) ───────────────────────
  const fvgCell = v("fvgs", []);
  const h2 = val(high, 2), l2 = val(low, 2);
  const fvgs = [];
  for (const gap of fvgCell.value) {
    const mitigated = gap.bias === 1 ? l <= gap.bot : h >= gap.top;
    const expired = bar - gap.bar > fvgExpire;
    if (mitigated && showFvg) draw.label({ x: bar, y: gap.bias === 1 ? gap.bot : gap.top, text: "FVG filled", color: gap.bias === 1 ? BULL : BEAR });
    if (mitigated || expired) continue;
    // Price entering the gap consumes it: the zone shrinks to the unfilled part.
    const top = gap.bias === 1 && l < gap.top ? l : gap.top;
    const bot = gap.bias === -1 && h > gap.bot ? h : gap.bot;
    fvgs.push({ ...gap, top, bot });
  }
  if (l > h2 && ((l - h2) / h2) * 100 >= fvgMinPct) fvgs.push({ top: l, bot: h2, bias: 1, bar });
  if (h < l2 && ((l2 - h) / l2) * 100 >= fvgMinPct) fvgs.push({ top: l2, bot: h, bias: -1, bar });
  while (fvgs.length > 15) fvgs.shift();
  fvgCell.set(fvgs);
  const inBullFvg = fvgs.some((g) => g.bias === 1 && l <= g.top && h >= g.bot);
  const inBearFvg = fvgs.some((g) => g.bias === -1 && h >= g.bot && l <= g.top);
  if (isLast) {
    for (let i = 0; i < 15; i++) {
      const gap = fvgs[i];
      const id = "fvg" + i;
      if (gap === undefined || !showFvg || !near((gap.top + gap.bot) / 2)) { draw.remove(id); draw.remove(id + ":lbl"); continue; }
      const color = gap.bias === 1 ? BULL : BEAR;
      draw.box({ id, left: gap.bar - 2, top: gap.top, right: bar + 3, bottom: gap.bot, fill: alpha(color, 75) });
      draw.label({ id: id + ":lbl", x: gap.bar - 2, y: gap.bias === 1 ? gap.top : gap.bot, text: "FVG", color, position: "left" });
    }
  }

  // ── Market structure HH/HL/LH/LL & zigzag ─────────────────────────────────
  const msPh = val(ta.pivothigh(high, msSwing, msSwing));
  const msPl = val(ta.pivotlow(low, msSwing, msSwing));
  const prevMsPh = v("prevMsPh", NaN), prevMsPl = v("prevMsPl", NaN);
  const lastMsPhVal = v("lastMsPhVal", NaN), lastMsPlVal = v("lastMsPlVal", NaN);
  const msHH = !na(msPh) && !na(prevMsPh.value) && msPh > prevMsPh.value;
  const msLH = !na(msPh) && !na(prevMsPh.value) && msPh < prevMsPh.value;
  const msHL = !na(msPl) && !na(prevMsPl.value) && msPl > prevMsPl.value;
  const msLL = !na(msPl) && !na(prevMsPl.value) && msPl < prevMsPl.value;
  if (!na(msPh)) { prevMsPh.set(lastMsPhVal.value); lastMsPhVal.set(msPh); }
  if (!na(msPl)) { prevMsPl.set(lastMsPlVal.value); lastMsPlVal.set(msPl); }
  const lastMsLbl = v("lastMsLbl", -999);
  if (showMs && bar - msSwing - lastMsLbl.value >= Math.max(3, msSwing)) {
    const at = bar - msSwing;
    const tag = (price, text, color, position) => { draw.label({ x: at, y: price, text, color, position }); lastMsLbl.set(at); };
    if (msHH) tag(msPh, "HH", BULL, "above");
    if (msLH) tag(msPh, "LH", BEAR, "above");
    if (msHL) tag(msPl, "HL", BULL, "below");
    if (msLL) tag(msPl, "LL", BEAR, "below");
  }
  if (showMsLine && !na(msPh)) draw.line({ id: "msPhLine", x1: bar - 2 * msSwing, y1: nz(prevMsPh.value, msPh), x2: bar - msSwing, y2: msPh, color: alpha(BEAR, 50), style: "dashed" });
  if (showMsLine && !na(msPl)) draw.line({ id: "msPlLine", x1: bar - 2 * msSwing, y1: nz(prevMsPl.value, msPl), x2: bar - msSwing, y2: msPl, color: alpha(BULL, 50), style: "dashed" });

  // ── Trendlines (breaks & ATR retests) ─────────────────────────────────────
  const tlPh = val(ta.pivothigh(high, tlPivotLen, tlPivotLen));
  const tlPl = val(ta.pivotlow(low, tlPivotLen, tlPivotLen));
  const tlHighs = v("tlHighs", { p1: NaN, b1: -999, p2: NaN, b2: -999 });
  const tlLows = v("tlLows", { p1: NaN, b1: -999, p2: NaN, b2: -999 });
  if (!na(tlPh)) tlHighs.set({ p2: tlHighs.value.p1, b2: tlHighs.value.b1, p1: tlPh, b1: bar - tlPivotLen });
  if (!na(tlPl)) tlLows.set({ p2: tlLows.value.p1, b2: tlLows.value.b1, p1: tlPl, b1: bar - tlPivotLen });
  const projected = (pts) => {
    if (na(pts.p1) || na(pts.p2) || pts.b1 === pts.b2 || pts.b1 === -999 || pts.b2 === -999) return NaN;
    return pts.p1 + ((pts.p1 - pts.p2) / (pts.b1 - pts.b2)) * (bar - pts.b1);
  };
  const tlBearVal = projected(tlHighs.value);
  const tlBullVal = projected(tlLows.value);
  const tlBearPrev = val(ctx.series("tlBearVal", () => tlBearVal), 1);
  const tlBullPrev = val(ctx.series("tlBullVal", () => tlBullVal), 1);
  const tlBearBreak = !na(tlBearVal) && c > tlBearVal && prevClose <= tlBearPrev;
  const tlBullBreak = !na(tlBullVal) && c < tlBullVal && prevClose >= tlBullPrev;
  const tlBear = v("tlBearState", { broken: false, retested: false, breakBar: -999 });
  const tlBull = v("tlBullState", { broken: false, retested: false, breakBar: -999 });
  if (!na(tlPh)) tlBear.set({ broken: false, retested: false, breakBar: -999 });
  if (!na(tlPl)) tlBull.set({ broken: false, retested: false, breakBar: -999 });
  if (tlBearBreak) tlBear.set({ broken: true, retested: false, breakBar: bar });
  if (tlBullBreak) tlBull.set({ broken: true, retested: false, breakBar: bar });
  const retestDist = atr14 * 0.5;
  const tlBearRetest = tlBear.value.broken && !tlBear.value.retested && !na(tlBearVal) && bar - tlBear.value.breakBar > 1 && Math.abs(c - tlBearVal) <= retestDist && c > tlBearVal;
  const tlBullRetest = tlBull.value.broken && !tlBull.value.retested && !na(tlBullVal) && bar - tlBull.value.breakBar > 1 && Math.abs(c - tlBullVal) <= retestDist && c < tlBullVal;
  if (tlBearRetest) tlBear.set({ ...tlBear.value, retested: true });
  if (tlBullRetest) tlBull.set({ ...tlBull.value, retested: true });
  if (showTl && isLast) {
    const trend = (id, pts, value, color, broken) => {
      if (!near(value)) { draw.remove(id); return; }
      draw.line({ id, x1: pts.b2, y1: pts.p2, x2: bar, y2: value, color: alpha(color, 30), style: broken ? "dashed" : "solid" });
    };
    trend("tlBear", tlHighs.value, tlBearVal, BEAR, tlBear.value.broken);
    trend("tlBull", tlLows.value, tlBullVal, BULL, tlBull.value.broken);
  }
  if (showTlBreak) {
    if (tlBearBreak) draw.label({ x: bar, y: l, text: "◆ Break", color: BULL, position: "below" });
    if (tlBullBreak) draw.label({ x: bar, y: h, text: "◆ Break", color: BEAR, position: "above" });
    if (tlBearRetest) draw.label({ x: bar, y: l, text: "● Retest", color: BULL, position: "below" });
    if (tlBullRetest) draw.label({ x: bar, y: h, text: "● Retest", color: BEAR, position: "above" });
  }

  // ── Liquidity sweeps ──────────────────────────────────────────────────────
  const bslSeries = ta.highest(high, liqLookback);
  const sslSeries = ta.lowest(low, liqLookback);
  const bslPrev = val(bslSeries, 1), sslPrev = val(sslSeries, 1);
  const liqSweepBull = l < sslPrev - sslPrev * (liqWickPct / 100) && c > sslPrev;
  const liqSweepBear = h > bslPrev + bslPrev * (liqWickPct / 100) && c < bslPrev;
  const lastSslSw = v("lastSslSw", -999), lastBslSw = v("lastBslSw", -999);
  if (liqSweepBull || m15SslSweep) lastSslSw.set(bar);
  if (liqSweepBear || m15BslSweep) lastBslSw.set(bar);
  const recentSslSweep = bar - lastSslSw.value <= smcSwing * 3;
  const recentBslSweep = bar - lastBslSw.value <= smcSwing * 3;
  const lastLiqBullLbl = v("lastLiqBullLbl", -999), lastLiqBearLbl = v("lastLiqBearLbl", -999);
  const liqGap = Math.max(3, smcSwing);
  if (showLiq && liqSweepBull && bar - lastLiqBullLbl.value >= liqGap) {
    draw.label({ x: bar, y: l, text: "• Sell-side", color: "#9c27b0", position: "below" });
    lastLiqBullLbl.set(bar);
  }
  if (showLiq && liqSweepBear && bar - lastLiqBearLbl.value >= liqGap) {
    draw.label({ x: bar, y: h, text: "• Buy-side", color: "#ff9800", position: "above" });
    lastLiqBearLbl.set(bar);
  }

  // ── Session levels: PDH/PDL, Asia & London ranges (UTC) ───────────────────
  const day = v("day", { high: h, low: l, pdh: NaN, pdl: NaN });
  if (isNewDay) day.set({ pdh: day.value.high, pdl: day.value.low, high: h, low: l });
  else day.set({ ...day.value, high: Math.max(day.value.high, h), low: Math.min(day.value.low, l) });
  const { pdh, pdl } = day.value;
  const minuteOfDay = Math.floor((val(api.time) % 86400000) / 60000);
  const inSession = (spec) => {
    const m = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(spec);
    if (m === null) return false;
    const start = Number(m[1]) * 60 + Number(m[2]);
    const end = Number(m[3]) * 60 + Number(m[4]);
    return start <= end ? minuteOfDay >= start && minuteOfDay < end : minuteOfDay >= start || minuteOfDay < end;
  };
  const sessionRange = (name, spec) => {
    const s = v(name, { hi: NaN, lo: NaN, was: false });
    if (inSession(spec)) {
      const fresh = na(s.value.hi) || !s.value.was;
      s.set({ hi: fresh ? h : Math.max(s.value.hi, h), lo: fresh ? l : Math.min(s.value.lo, l), was: true });
    } else if (s.value.was) s.set({ ...s.value, was: false });
    return s.value;
  };
  const asia = sessionRange("asia", asiaSess);
  const london = sessionRange("london", londonSess);
  if (isLast) {
    const dayLine = (id, price, color, text) => {
      if (!showPdhPdl || !near(price)) { draw.remove(id); draw.remove(id + ":lbl"); return; }
      draw.line({ id, x1: bar - 50, y1: price, x2: bar + 20, y2: price, color: alpha(color, 20), style: "dotted" });
      draw.label({ id: id + ":lbl", x: bar + 20, y: price, text, color, position: "right" });
    };
    dayLine("pdh", pdh, BEAR, "PDH");
    dayLine("pdl", pdl, BULL, "PDL");
  }
  const within = (level) => !na(level) && (Math.abs(c - level) / c) * 100 <= sessLiqPct;
  const pdhSweep = !na(pdh) && h > pdh * (1 + sessLiqPct / 100) && c < pdh;
  const pdlSweep = !na(pdl) && l < pdl * (1 - sessLiqPct / 100) && c > pdl;
  const sessLevelBull = within(pdl) || within(asia.lo) || within(london.lo) || pdlSweep;
  const sessLevelBear = within(pdh) || within(asia.hi) || within(london.hi) || pdhSweep;

  // ── Volume profile (rolling sums, confirmed bars) ─────────────────────────
  const tp = val(hlc3);
  const tpSeries = ctx.series("vpTp", () => tp);
  const vpWv = val(ta.sma(volume, vpBars));
  const vpTpVol = val(ta.sma(ctx.series("vpTpVol", () => tp * val(volume)), vpBars));
  const vpTp2Vol = val(ta.sma(ctx.series("vpTp2Vol", () => tp * tp * val(volume)), vpBars));
  const vpWm = vpWv > 0 ? vpTpVol / vpWv : c;
  const vpVar = vpWv > 0 ? vpTp2Vol / vpWv - vpWm * vpWm : 0;
  const vpSigma = vpVar > 0 ? Math.sqrt(vpVar) : atr14;
  const vpPocOff = val(ta.highestbars(volume, vpBars));
  const vp = v("vp", { poc: NaN, vah: NaN, val: NaN });
  if (ctx.barstate.isconfirmed && bar >= vpBars) vp.set({ poc: val(tpSeries, -vpPocOff), vah: vpWm + vpSigma, val: vpWm - vpSigma });
  const nearVp = (level) => !na(level) && (Math.abs(c - level) / c) * 100 <= pocZonePct;
  const vpBullConf = nearVp(vp.value.poc) || nearVp(vp.value.val);
  const vpBearConf = nearVp(vp.value.poc) || nearVp(vp.value.vah);
  if (isLast) {
    const vpLine = (id, price, color, text, width) => {
      if (!showVp || !near(price)) { draw.remove(id); draw.remove(id + ":lbl"); return; }
      draw.line({ id, x1: bar - vpBars, y1: price, x2: bar, y2: price, color, width, style: width === 2 ? "solid" : "dashed" });
      draw.label({ id: id + ":lbl", x: bar, y: price, text, color, position: "right" });
    };
    vpLine("poc", vp.value.poc, "#ffeb3b", "POC", 2);
    vpLine("vah", vp.value.vah, alpha(BEAR, 40), "VAH", 1);
    vpLine("val", vp.value.val, alpha(BULL, 40), "VAL", 1);
  }

  // ── The three setup engines & trigger validation ──────────────────────────
  const canRetestLong = armedLong.value && bar - armedLongBar.value >= 1;
  const canRetestShort = armedShort.value && bar - armedShortBar.value >= 1;
  const lvlL = armedLongLvl.value, lvlS = armedShortLvl.value;
  const retestBull = canRetestLong && (inBullOb || inBullFvg || (!na(lvlL) && l <= lvlL + atr14 * 0.35 && c >= lvlL - atr14 * 0.25));
  const retestBear = canRetestShort && (inBearOb || inBearFvg || (!na(lvlS) && h >= lvlS - atr14 * 0.35 && c <= lvlS + atr14 * 0.25));
  const aligned = htfBias === h1Bias ? htfBias : 0;
  const setupALong = aligned === 1 && inDiscount && recentSslSweep && (inBullOb || inBullFvg || retestBull);
  const setupAShort = aligned === -1 && inPremium && recentBslSweep && (inBearOb || inBearFvg || retestBear);
  const setupBLong = aligned === 1 && m15BreakoutLong && retestBull;
  const setupBShort = aligned === -1 && m15BreakoutShort && retestBear;
  const setupCShort = inPremium && (liqSweepBear || recentBslSweep) && (structureBias === -1 || chochBear) && isDispBear;
  const setupCLong = inDiscount && (liqSweepBull || recentSslSweep) && (structureBias === 1 || chochBull) && isDispBull;
  const triggerLong = ((setupALong || setupBLong) && retestBull) || (setupCLong && isDispBull);
  const triggerShort = ((setupAShort || setupBShort) && retestBear) || (setupCShort && isDispBear);
  const setupNameLong = setupALong ? "Pullback SSL Sweep" : setupBLong ? "Breakout Retest" : setupCLong ? "Liquidity Reversal" : "Standard Retest";
  const setupNameShort = setupAShort ? "Pullback BSL Sweep" : setupBShort ? "Breakdown Retest" : setupCShort ? "Liquidity Reversal" : "Standard Retest";

  // ── Structural risk/reward: targets from opposing liquidity ───────────────
  const nearestAbove = (floor, levels) => levels.reduce((best, x) => (!na(x) && x > floor && (na(best) || x < best) ? x : best), NaN);
  const nearestBelow = (ceil, levels) => levels.reduce((best, x) => (!na(x) && x < ceil && (na(best) || x > best) ? x : best), NaN);
  const longSl = Math.min(nz(bull.lo, l), nz(lastPl.value, l), l) - atr14 * 0.35;
  const longRisk = Math.max(c - longSl, atr14 * 0.5);
  const longTp1 = nearestAbove(c + atr14 * 0.25, [lastPh.value, bslPrev, pdh, london.hi, asia.hi]);
  const longTp2 = nz(nearestAbove(longTp1, [bslPrev, htfLastPh.value, pdh, htf.high50]), longTp1);
  const longTp3 = nz(nearestAbove(longTp2, [htf.high50, htfLastPh.value, pdh]), longTp2);
  const longRr = na(longTp2) ? NaN : (longTp2 - c) / longRisk;
  const shortSl = Math.max(nz(bear.hi, h), nz(lastPh.value, h), h) + atr14 * 0.35;
  const shortRisk = Math.max(shortSl - c, atr14 * 0.5);
  const shortTp1 = nearestBelow(c - atr14 * 0.25, [lastPl.value, sslPrev, pdl, london.lo, asia.lo]);
  const shortTp2 = nz(nearestBelow(shortTp1, [sslPrev, htfLastPl.value, pdl, htf.low50]), shortTp1);
  const shortTp3 = nz(nearestBelow(shortTp2, [htf.low50, htfLastPl.value, pdl]), shortTp2);
  const shortRr = na(shortTp2) ? NaN : (c - shortTp2) / shortRisk;

  // ── 100-point confluence score ────────────────────────────────────────────
  const highVolume = val(volume) > volSma * 1.25;
  const longScore = (htfBias === 1 ? 15 : 0) + (h1Bias === 1 ? 15 : 0) + (inDiscount ? 10 : 0) + (inBullOb || inBullFvg ? 10 : 0)
    + (recentSslSweep ? 15 : 0) + (m15BreakoutLong || m15SslSweep ? 10 : 0) + (isDispBull ? 10 : 0)
    + (retestBull || tlBearRetest || vpBullConf || sessLevelBull ? 5 : 0) + (highVolume ? 5 : 0) + (longRr >= 2 ? 5 : 0);
  const shortScore = (htfBias === -1 ? 15 : 0) + (h1Bias === -1 ? 15 : 0) + (inPremium ? 10 : 0) + (inBearOb || inBearFvg ? 10 : 0)
    + (recentBslSweep ? 15 : 0) + (m15BreakoutShort || m15BslSweep ? 10 : 0) + (isDispBear ? 10 : 0)
    + (retestBear || tlBullRetest || vpBearConf || sessLevelBear ? 5 : 0) + (highVolume ? 5 : 0) + (shortRr >= 2 ? 5 : 0);

  // ── Hard gates & deterministic decision ───────────────────────────────────
  const longMin = setupCLong && !(setupALong || setupBLong) ? minScoreCt : minScore;
  const shortMin = setupCShort && !(setupAShort || setupBShort) ? minScoreCt : minScore;
  const longGate = triggerLong && longRr >= minRr && longScore >= longMin;
  const shortGate = triggerShort && shortRr >= minRr && shortScore >= shortMin;
  const conflict = longGate && shortGate;
  const prevGates = v("prevGates", { long: false, short: false });
  const lastSigBar = v("lastSigBar", -999);
  const cooldownOk = bar - lastSigBar.value >= sigCooldown;
  const finalLong = longGate && !prevGates.value.long && cooldownOk && !conflict;
  const finalShort = shortGate && !prevGates.value.short && cooldownOk && !conflict;
  prevGates.set({ long: longGate, short: shortGate });
  if (finalLong) { armedLong.set(false); armedLongLvl.set(NaN); }
  if (finalShort) { armedShort.set(false); armedShortLvl.set(NaN); }
  if (finalLong || finalShort) lastSigBar.set(bar);
  const grade = (score) => (score >= 90 ? "A+" : score >= 80 ? "A" : "B");
  const qualityGrade = conflict ? "" : longGate ? grade(longScore) : shortGate ? grade(shortScore) : "";

  // ── Plots, trade labels, background & bar colours ─────────────────────────
  const st = ta.supertrend(3.0, 10);
  const stVal = val(st.supertrend), stDir = val(st.direction);
  plot(showSt && stDir < 0 ? stVal : NaN, "ST Bull", { color: alpha(BULL, 50) });
  plot(showSt && stDir > 0 ? stVal : NaN, "ST Bear", { color: alpha(BEAR, 50) });
  plot(longScore, "CE Long Score", { display: "none" });
  plot(shortScore, "CE Short Score", { display: "none" });

  const fmt = (x, digits = 2) => (na(x) ? "—" : x.toFixed(digits));
  const tradeText = (side, name, sl, tp1, tp2, tp3, rr, score) =>
    side + " [" + qualityGrade + "]\nSetup: " + name + "\nEntry: " + fmt(c) + "\nSL:    " + fmt(sl)
    + "\nTP1:   " + fmt(tp1) + "\nTP2:   " + fmt(tp2) + " (" + fmt(rr, 1) + "R)\nTP3:   " + fmt(tp3)
    + (showScore ? "\nScore: " + score + "/100" : "");
  if (finalLong) {
    if (showSignals) {
      draw.label({ x: bar, y: l - atr14 * 1.5, text: tradeText("LONG", setupNameLong, longSl, longTp1, longTp2, longTp3, longRr, longScore), color: "#ffffff", background: alpha("#00c87a", 10), position: "below" });
    }
    alert(JSON.stringify({ event: "SMC_ENTRY", side: "LONG", setup: setupNameLong, entry: c, sl: longSl, tp1: longTp1, tp2: longTp2, tp3: longTp3, rr: longRr, score: longScore }));
  }
  if (finalShort) {
    if (showSignals) {
      draw.label({ x: bar, y: h + atr14 * 1.5, text: tradeText("SHORT", setupNameShort, shortSl, shortTp1, shortTp2, shortTp3, shortRr, shortScore), color: "#ffffff", background: alpha(BEAR, 10), position: "above" });
    }
    alert(JSON.stringify({ event: "SMC_ENTRY", side: "SHORT", setup: setupNameShort, entry: c, sl: shortSl, tp1: shortTp1, tp2: shortTp2, tp3: shortTp3, rr: shortRr, score: shortScore }));
  }

  const bg = aligned === 1 ? alpha(BULL, 95) : aligned === -1 ? alpha(BEAR, 95) : htfBias === 1 ? alpha(BULL, 98) : htfBias === -1 ? alpha(BEAR, 98) : null;
  if (bg !== null) draw.bgcolor(bg);
  if (structureBias !== 0) draw.barcolor(alpha(structureBias === 1 ? BULL : BEAR, 65));

  // ── Live dashboard ────────────────────────────────────────────────────────
  if (showDash && isLast) {
    const POS = alpha("#00c87a", 20), NEG = alpha(BEAR, 20), NEU = alpha("#242436", 40), HD = alpha("#121224", 10), WARN = alpha("#ff9800", 40);
    const head = (text) => [{ text, bg: HD }, { text: "", bg: HD }, { text: "", bg: HD }];
    const row = (text, bullText, bullOn, bearText, bearOn) => [{ text: "  " + text, bg: NEU }, { text: bullText, bg: bullOn ? POS : NEU }, { text: bearText, bg: bearOn ? NEG : NEU }];
    const decision = conflict ? "CONFLICT" : longGate && cooldownOk ? "LONG" : shortGate && cooldownOk ? "SHORT" : "NO TRADE";
    const decisionBg = conflict ? WARN : longGate && cooldownOk ? POS : shortGate && cooldownOk ? NEG : NEU;
    draw.table({
      position: "top_right",
      rows: [
        [{ text: "SMC-CE v7.1 [EXEC]", bg: HD }, { text: "BULL", bg: HD }, { text: "BEAR", bg: HD }],
        head("4H MACRO"),
        row("4H Bias", htfBias === 1 ? "BULL ✓" : "—", htfBias === 1, htfBias === -1 ? "BEAR ✓" : "—", htfBias === -1),
        [{ text: "  P/D Location", bg: NEU }, { text: inDiscount ? "Discount ✓" : "Premium ⚠", bg: inDiscount ? POS : WARN }, { text: inPremium ? "Premium ✓" : "Discount ⚠", bg: inPremium ? NEG : WARN }],
        head("1H DIRECTION"),
        row("1H Structure", h1Bias === 1 ? "BULL ✓" : "—", h1Bias === 1, h1Bias === -1 ? "BEAR ✓" : "—", h1Bias === -1),
        head("15m CONTEXT"),
        row("15m Sweep/BO", m15SslSweep ? "SSL SWEPT" : m15BreakoutLong ? "BREAKOUT" : "—", m15SslSweep || m15BreakoutLong, m15BslSweep ? "BSL SWEPT" : m15BreakoutShort ? "BREAKDOWN" : "—", m15BslSweep || m15BreakoutShort),
        head("5m TRIGGER"),
        row("Armed CHoCH", armedLong.value ? "ARMED ✓" : "WAIT", armedLong.value, armedShort.value ? "ARMED ✓" : "WAIT", armedShort.value),
        row("OB/FVG Retest", retestBull ? "TESTED ✓" : "WAIT", retestBull, retestBear ? "TESTED ✓" : "WAIT", retestBear),
        row("Displacement", isDispBull ? "STRONG ✓" : "—", isDispBull, isDispBear ? "STRONG ✓" : "—", isDispBear),
        [{ text: "Confluence", bg: HD }, { text: longScore + "/100", bg: longScore >= 80 ? POS : longScore >= 70 ? WARN : NEU }, { text: shortScore + "/100", bg: shortScore >= 80 ? NEG : shortScore >= 70 ? WARN : NEU }],
        row("Setup Type", triggerLong ? setupNameLong : "—", triggerLong, triggerShort ? setupNameShort : "—", triggerShort),
        row("R:R (TP2)", triggerLong && !na(longRr) ? fmt(longRr, 1) + "R" : "—", triggerLong && longRr >= 2, triggerShort && !na(shortRr) ? fmt(shortRr, 1) + "R" : "—", triggerShort && shortRr >= 2),
        [{ text: "DECISION", bg: HD }, { text: decision, bg: decisionBg }, { text: qualityGrade !== "" ? "[" + qualityGrade + "]" : "AVOID", bg: decisionBg }],
      ],
    });
  }
});
`;

/** Converts the SMC Confluence Engine indicator into a backtestable strategy with entry and exit bracket orders. */
export const toSmcStrategy = (code: string): string =>
  code
    .replace("// SMC Confluence Engine v7.1 [nemesis] — pine-ts port of the Pine Script v6 indicator.", "// SMC Confluence Strategy v7.1 [nemesis] — strategy template with automated backtest execution.")
    .replace(
      'indicator("SMC Confluence Engine v7.1", { overlay: true }, (api) => {',
      `defineStrategy("SMC Confluence Strategy v7.1", {
  initial_capital: 10_000,
  default_qty_value: 0.01,
  default_qty_type: "fixed",
  commission_type: "percent",
  commission_value: 0.05,
}, (api) => {`,
    )
    .replace(
      "const { ctx, ta, math, input, plot, draw, security, alert, open",
      "const { ctx, ta, math, input, plot, draw, security, alert, strategy, open",
    )
    .replace(
      'alert(JSON.stringify({ event: "SMC_ENTRY", side: "LONG", setup: setupNameLong, entry: c, sl: longSl, tp1: longTp1, tp2: longTp2, tp3: longTp3, rr: longRr, score: longScore }));',
      'alert(JSON.stringify({ event: "SMC_ENTRY", side: "LONG", setup: setupNameLong, entry: c, sl: longSl, tp1: longTp1, tp2: longTp2, tp3: longTp3, rr: longRr, score: longScore }));\n    strategy.entry("Long", "long");\n    strategy.exit("Exit Long", { from_entry: "Long", limit: longTp2, stop: longSl });',
    )
    .replace(
      'alert(JSON.stringify({ event: "SMC_ENTRY", side: "SHORT", setup: setupNameShort, entry: c, sl: shortSl, tp1: shortTp1, tp2: shortTp2, tp3: shortTp3, rr: shortRr, score: shortScore }));',
      'alert(JSON.stringify({ event: "SMC_ENTRY", side: "SHORT", setup: setupNameShort, entry: c, sl: shortSl, tp1: shortTp1, tp2: shortTp2, tp3: shortTp3, rr: shortRr, score: shortScore }));\n    strategy.entry("Short", "short");\n    strategy.exit("Exit Short", { from_entry: "Short", limit: shortTp2, stop: shortSl });',
    );

export const SMC_CONFLUENCE_STRATEGY = toSmcStrategy(SMC_CONFLUENCE_ENGINE);

