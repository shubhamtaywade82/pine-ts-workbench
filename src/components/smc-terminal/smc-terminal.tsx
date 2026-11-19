"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import styles from "./smc-terminal.module.css";
import {
  TF_MS, THEMES, type Bar, type MarketEvent, type PlotLayout, type RayHit, type TerminalParams,
  type ThemeColors, type ToastItem, type ViewportState,
} from "./terminal-types";
import {
  aggregateSnap, buildIntraBarPath, buildSession, clamp, computeAllFvgZones, ensureBars,
  makeUiState, restoreSnapshot, syncOrderBookSnap, updatePriceBounds,
  type SimulationState, type UiState,
} from "./terminal-simulation";
import { initAudio, isSoundEnabled, playSound, setSoundMuted } from "./terminal-audio";
import { drawScene } from "./terminal-scene-painter";
import { drawOverlay, type FlashEvent } from "./terminal-overlay-painter";
import { TerminalHeader } from "./terminal-header";
import { TerminalSidebar } from "./terminal-sidebar";
import { TerminalDeck } from "./terminal-deck";
import { useTerminalGestures } from "./use-terminal-gestures";
import { useBinanceLive } from "./use-binance-live";
import { loadTerminalState, saveTerminalState } from "./terminal-storage";
import type { LevelFlow } from "@/lib/level-activity";
import { exportCanvasAsPng, findHoveredRay, formatRayTooltip } from "./terminal-actions";
import { fmtP, fmtS, tickDecimals } from "./terminal-formatters";

// Per-ms easing rate; ~80ms time constant keeps the forming candle smooth without lagging the tape.
const LIVE_PRICE_EASE = 0.012;
const HOVER_RENDER_MS = 100;
const DEFAULT_TF = 5;

const DEF_PARAMS: TerminalParams = {
  zoom: 96, candle: "hollow", theme: "ion", rays: true, ladder: true, fvg: true, filled: false,
  bos: true, ob: true, liq: true, pd: false, vol: true, grid: true, gridAlpha: 0.3, pulled: true, bin: 0.05, rayScale: 1, ladderW: 110, glow: 0.6, density: 1, raySpan: "birth", speed: 1, follow: true,
};

export function SmcTerminal(): React.JSX.Element {
  const [params, setParams] = useState<TerminalParams>(DEF_PARAMS);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isHalted, setIsHalted] = useState(false);
  const [isSoundOn, setIsSoundOn] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isLiveFeed, setIsLiveFeed] = useState(true);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [hover, setHover] = useState<{ px: number; py: number } | null>(null);
  const hoverRef = useRef<{ px: number; py: number } | null>(null);
  const lastHoverRenderRef = useRef(0);
  const [highlightPrice, setHighlightPrice] = useState<number | null>(null);
  const [focusPrice, setFocusPrice] = useState<{ price: number; until: number } | null>(null);
  const [ui, setUi] = useState<UiState>(() => makeUiState(buildSession(0, 5)));
  const dec = tickDecimals(ui.sim.tick);
  const [isRestored, setIsRestored] = useState(false);
  const simRef = useRef<SimulationState>(buildSession(0, 5));
  const sceneRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rayHitsRef = useRef<RayHit[]>([]);
  const flashesRef = useRef<FlashEvent[]>([]);
  const viewportRef = useRef<ViewportState>({ center: 167, visible: 96, tCenter: 167, tVisible: 96, minP: 70, maxP: 75, tMinP: 70, tMaxP: 75 });
  const dimsRef = useRef({ w: 800, h: 500, dpr: 1, axisW: 64, timeH: 26 });

  const addToast = useCallback((msg: string, kind?: ToastItem["kind"]) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, msg, kind }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2800);
  }, []);

  // Restored after mount, not in the initial state, so server and first client render still match.
  useEffect(() => {
    const saved = loadTerminalState({ params: DEF_PARAMS, tf: DEFAULT_TF, isSoundOn: true, isLiveFeed: true });
    // Follow is session state: restoring "off" after a drag would leave the chart stuck while live candles scroll away.
    setParams({ ...saved.params, follow: true });
    setIsSoundOn(saved.isSoundOn);
    setSoundMuted(!saved.isSoundOn);
    setIsLiveFeed(saved.isLiveFeed);
    viewportRef.current.tVisible = saved.params.zoom;
    viewportRef.current.visible = saved.params.zoom;
    simRef.current = buildSession(0, saved.tf);
    setUi(makeUiState(simRef.current));
    setIsRestored(true);
  }, []);

  useEffect(() => {
    if (isRestored) saveTerminalState({ params, tf: ui.tf, isSoundOn, isLiveFeed });
  }, [isRestored, params, ui.tf, isSoundOn, isLiveFeed]);

  const onParamChange = useCallback(<K extends keyof TerminalParams>(key: K, val: TerminalParams[K]) => {
    setParams((prev) => (prev[key] === val ? prev : { ...prev, [key]: val }));
  }, []);

  // The canvas reads the ref every frame; React state only feeds the tooltip, so it updates at ~10Hz.
  const updateHover = useCallback((pos: { px: number; py: number } | null) => {
    hoverRef.current = pos;
    const now = performance.now();
    if (pos !== null && now - lastHoverRenderRef.current < HOVER_RENDER_MS) return;
    lastHoverRenderRef.current = now;
    setHover(pos);
  }, []);

  const { dragRef, onPointerDown, onPointerMove, onPointerUp, resetView } = useTerminalGestures({
    canvasRef: overlayRef, viewportRef, dimsRef, simRef, setHover: updateHover, onParamChange, addToast, setFocusPrice,
  });

  const handleResize = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const [w, h] = [Math.max(80, r.width), Math.max(80, r.height)];
    dimsRef.current = { w, h, dpr, axisW: w < 560 ? 52 : 64, timeH: 26 };
    for (const cv of [sceneRef.current, overlayRef.current]) { if (cv) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); } }
  }, []);

  useEffect(() => {
    handleResize();
    const ro = new ResizeObserver(handleResize);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [handleResize]);

  const handleHistorical = useCallback((bars: Bar[], tick: number) => {
    const sim = simRef.current;
    sim.tick = tick;
    sim.bars = bars;
    sim.playhead = bars.length - 1;
    sim.zones = computeAllFvgZones(bars, tick);
    const v = viewportRef.current;
    v.tCenter = sim.playhead - v.tVisible * 0.34;
    v.center = v.tCenter;
    let minP = Infinity;
    let maxP = -Infinity;
    for (const b of bars.slice(-Math.round(v.visible))) { minP = Math.min(minP, b.l); maxP = Math.max(maxP, b.h); }
    if (Number.isFinite(minP) && Number.isFinite(maxP)) {
      v.minP = Math.floor((minP - 0.2) / tick) * tick;
      v.maxP = Math.ceil((maxP + 0.2) / tick) * tick;
      v.tMinP = v.minP;
      v.tMaxP = v.maxP;
    }
    setUi(makeUiState(sim));
  }, []);

  const handleBook = useCallback((book: Map<number, number>, tick: number, activity: ReadonlyMap<number, LevelFlow>) => {
    const sim = simRef.current;
    sim.tick = tick;
    sim.book = book;
    sim.activity = activity;
    syncOrderBookSnap(sim, book);
    setUi(makeUiState(sim));
  }, []);

  const handleTrade = useCallback((price: number, qty: number, aggressor: "buy" | "sell") => {
    const sim = simRef.current;
    const lastIdx = sim.bars.length - 1;
    if (lastIdx >= 0) {
      const bar = sim.bars[lastIdx];
      bar.c = price;
      bar.h = Math.max(bar.h, price);
      bar.l = Math.min(bar.l, price);
      bar.v += qty;
      bar.path = buildIntraBarPath({ o: bar.o, c: price, h: bar.h, l: bar.l });
    }
    setUi(makeUiState(sim));
  }, []);

  const handleTape = useCallback((event: Omit<MarketEvent, "bar">) => {
    const sim = simRef.current;
    sim.events.push({ ...event, bar: Math.max(0, sim.bars.length - 1) });
    if (sim.events.length > 250) sim.events.splice(0, sim.events.length - 150);
  }, []);

  const handleKline = useCallback((bar: Bar) => {
    const sim = simRef.current;
    const last = sim.bars[sim.bars.length - 1];
    if (last && last.t === bar.t) {
      last.h = Math.max(last.h, bar.h);
      last.l = Math.min(last.l, bar.l);
      last.c = bar.c;
      last.v = bar.v;
      last.path = buildIntraBarPath({ o: last.o, c: last.c, h: last.h, l: last.l });
    } else {
      sim.bars.push(bar);
      sim.playhead = sim.bars.length - 1;
      sim.zones = computeAllFvgZones(sim.bars, sim.tick);
      if (sim.book.size > 0) syncOrderBookSnap(sim, sim.book);
    }
    setUi(makeUiState(sim));
  }, []);

  const { isConnected: isLiveConnected } = useBinanceLive("SOLUSDT", ui.tf, isLiveFeed, {
    onHistoricalLoaded: handleHistorical, onBook: handleBook, onLiveTrade: handleTrade, onLiveKline: handleKline, onTapeEvent: handleTape,
  });

  useEffect(() => {
    let animId = 0;
    let prevTime = 0;
    let evCursor = 0;
    const loop = (now: number) => {
      const dt = Math.min(50, now - (prevTime || now));
      prevTime = now;
      const sim = simRef.current;
      const v = viewportRef.current;
      const { w, h, dpr, axisW, timeH } = dimsRef.current;
      const plot: PlotLayout = { x: 8, y: 8, w: w - axisW - 12, h: h - timeH - 14, r: w - axisW - 4, b: h - timeH - 6 };

      if (isPlaying && !isHalted) {
        if (isLiveFeed) {
          const curBar = sim.bars[sim.bars.length - 1];
          const progress = curBar ? clamp((Date.now() - curBar.t) / (TF_MS[sim.tf] || 300e3), 0, 0.999) : 0;
          sim.playhead = Math.max(0, sim.bars.length - 1) + progress;
          if (curBar) {
            const from = sim.shown ?? curBar.o;
            sim.shown = from + (curBar.c - from) * (1 - Math.exp(-dt * LIVE_PRICE_EASE));
          }
        } else {
          sim.shown = undefined;
          const prevFloor = Math.floor(sim.playhead);
          sim.playhead += dt / (1600 / params.speed);
          ensureBars(sim, Math.floor(sim.playhead) + 2);
          const f = Math.floor(sim.playhead);
          if (f !== prevFloor) {
            while (evCursor < sim.events.length && sim.events[evCursor].bar <= f) {
              const ev = sim.events[evCursor++];
              if (ev.bar > prevFloor) { flashesRef.current.push({ ...ev, t0: now }); playSound[ev.type]?.(); }
            }
            restoreSnapshot(sim, f); setUi(makeUiState(sim));
          }
        }
      }

      if (params.follow && isPlaying) v.tCenter = sim.playhead - v.tVisible * 0.34;
      v.tCenter = clamp(v.tCenter, v.tVisible * 0.35, sim.playhead + 14);
      const k = 1 - Math.exp(-dt * 0.012);
      v.center += (v.tCenter - v.center) * k;
      v.visible += (v.tVisible - v.visible) * k;
      updatePriceBounds(v, sim, focusPrice, k);

      const sc = sceneRef.current?.getContext("2d");
      const oc = overlayRef.current?.getContext("2d");
      const themeColors: ThemeColors = THEMES[params.theme] || THEMES.ion;
      const hl = focusPrice && now < focusPrice.until ? focusPrice.price : highlightPrice;

      if (sc) rayHitsRef.current = drawScene(sc, sim, v, params, themeColors, plot, dpr, hl, axisW, timeH, w, h);
      if (oc) {
        const map = aggregateSnap(sim.snaps[Math.floor(sim.playhead)] ?? [], params.bin, sim.tick);
        let maxS = 1;
        if (map) for (const s of map.values()) maxS = Math.max(maxS, s);
        flashesRef.current = flashesRef.current.filter((fl) => now - fl.t0 < 900);
        drawOverlay(oc, sim, v, params, themeColors, plot, dpr, map, maxS, flashesRef.current, hoverRef.current, !!dragRef.current, now, axisW, w, h);
      }
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, isHalted, isLiveFeed, params, focusPrice, highlightPrice, dragRef]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/INPUT|SELECT|TEXTAREA/.test((e.target as HTMLElement)?.tagName)) return;
      initAudio();
      const k = e.key.toLowerCase();
      if (k === " ") { e.preventDefault(); setIsPlaying((p) => !p); }
      else if (k === "arrowright") { e.preventDefault(); simRef.current.playhead = Math.floor(simRef.current.playhead) + 1.999; setUi(makeUiState(simRef.current)); }
      else if (k === "arrowleft") { e.preventDefault(); simRef.current.playhead = Math.max(10, Math.floor(simRef.current.playhead) - 0.001); setUi(makeUiState(simRef.current)); }
      else if (k === "r") resetView();
      else if (k === "m") { const next = !isSoundEnabled(); setSoundMuted(!next); setIsSoundOn(next); }
      else if (k === "k") setIsHalted((h) => !h);
      else if (k === "f") onParamChange("follow", !params.follow);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [params.follow, onParamChange, resetView]);

  const onExportPng = () => { exportCanvasAsPng(sceneRef.current, overlayRef.current, "SOLUSDT", ui.tf, ui.seed); addToast("Frame exported as PNG", "ok"); };
  const hitRay = findHoveredRay(hover, rayHitsRef.current);
  const rayInfo = hitRay ? formatRayTooltip(hitRay, Math.floor(ui.playhead), ui.tf) : null;

  return (
    <div className={styles.terminalContainer}>
      <TerminalHeader
        curPrice={ui.curPrice} priceDecimals={dec} openPrice={ui.openPrice} timeframe={ui.tf} currentTime={ui.currentTime}
        isSoundOn={isSoundOn} isHalted={isHalted} isLiveFeed={isLiveFeed} isLiveConnected={isLiveConnected}
        levelCount={ui.sim.bigsSnap[Math.floor(ui.playhead)]?.length ?? 0}
        onTimeframeChange={(tf) => {
          simRef.current.tf = tf;
          if (!isLiveFeed) { simRef.current = buildSession(ui.seedIdx, tf); setUi(makeUiState(simRef.current)); }
          else setUi((prev) => ({ ...prev, tf }));
          addToast(`Timeframe ${tf}m`, "ok");
        }}
        onToggleSound={() => { initAudio(); const next = !isSoundOn; setSoundMuted(!next); setIsSoundOn(next); }}
        onToggleKill={() => { setIsHalted((h) => !h); playSound.kill(); addToast(isHalted ? "Engine resumed" : "Kill switch engaged", isHalted ? "ok" : "danger"); }}
        onToggleLiveFeed={() => setIsLiveFeed((v) => !v)}
        onToggleSidebar={() => setIsSidebarOpen((v) => !v)}
      />

      <main className={styles.mainGrid}>
        <div ref={wrapRef} className={styles.chartWrap}>
          <canvas ref={sceneRef} className={`${styles.canvasLayer} ${styles.sceneCanvas}`} />
          <canvas
            ref={overlayRef} className={`${styles.canvasLayer} ${styles.overlayCanvas}`}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp} onPointerLeave={() => { updateHover(null); dragRef.current = null; }}
            onDoubleClick={resetView}
          />
          <div className={styles.ohlc}>
            <span className={styles.ohlcTitle}>SOL/USDT · {ui.tf}m</span>
            <span>O <b>{fmtP(ui.curBar.o, dec)}</b></span><span>H <b>{fmtP(ui.curBar.h, dec)}</b></span><span>L <b>{fmtP(ui.curBar.l, dec)}</b></span><span>C <b>{fmtP(ui.curPrice, dec)}</b></span>
            <span style={{ color: ui.curPrice >= ui.curBar.o ? "var(--bid)" : "var(--ask)" }}>{ui.curBar.o ? (((ui.curPrice - ui.curBar.o) / ui.curBar.o) * 100).toFixed(2) : "0.00"}%</span>
            <span className={styles.ohlcTitle}>Vol <b style={{ color: "var(--cyan)" }}>{fmtS(ui.curBar.v)}</b></span>
          </div>
          <div className={styles.legend}>
            <div style={{ letterSpacing: ".16em", color: "var(--faint)", marginBottom: 6 }}>SMC LAYERS + LIQUIDITY RAILS</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><span>FVG</span><span>BOS/CHoCH</span><span>OB</span><span>EQH/EQL</span><span>ladder</span><span>✕ pulled</span><span>◎ held</span><span>▮ wall</span></div>
          </div>
          {isHalted && <div className={styles.banner}>⏻ KILL SWITCH ENGAGED — ENGINE HALTED</div>}
          {rayInfo && hover && (
            <div className={styles.tooltip} style={{ left: Math.min(hover.px + 14, dimsRef.current.w - 240), top: Math.max(10, hover.py - 60) }}>
              <div style={{ fontWeight: 600, color: rayInfo.col }}>{rayInfo.title}</div>
              <div style={{ color: "var(--muted)", fontSize: 9 }}>{rayInfo.meta}</div>
            </div>
          )}
        </div>

        <TerminalSidebar
          state={ui.sim} curPrice={ui.curPrice} binSize={params.bin} isHalted={isHalted} isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          onFocusPrice={(price) => { setFocusPrice({ price, until: performance.now() + 3000 }); viewportRef.current.tCenter = simRef.current.playhead - viewportRef.current.tVisible * 0.34; }}
          onHighlightPrice={setHighlightPrice}
        />
      </main>

      <TerminalDeck
        params={params} isPlaying={isPlaying} playhead={ui.playhead} totalBars={ui.totalBars} seed={ui.seed}
        onTogglePlay={() => { if (isHalted) { addToast("Engine halted", "danger"); return; } setIsPlaying((p) => !p); }}
        onStep={() => { setIsPlaying(false); simRef.current.playhead = Math.floor(simRef.current.playhead) + 1.999; setUi(makeUiState(simRef.current)); }}
        onScrub={(v) => { ensureBars(simRef.current, v + 2); simRef.current.playhead = v + 0.999; restoreSnapshot(simRef.current, v); setUi(makeUiState(simRef.current)); }}
        onToggleFollow={() => onParamChange("follow", !params.follow)}
        onReseed={() => { const next = (ui.seedIdx + 1) % 6; simRef.current = buildSession(next, ui.tf); setUi(makeUiState(simRef.current)); addToast(`Reseeded · seed ${simRef.current.seed}`, "ok"); }}
        onParamChange={onParamChange} onResetView={resetView} onExportPng={onExportPng}
      />

      {isSidebarOpen && <div className={styles.scrim} onClick={() => setIsSidebarOpen(false)} />}
      <div className={styles.toasts}>
        {toasts.map((t) => (
          <div key={t.id} className={`${styles.toast} ${t.kind === "warn" ? styles.toastWarn : t.kind === "danger" ? styles.toastDanger : t.kind === "ok" ? styles.toastOk : ""}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
