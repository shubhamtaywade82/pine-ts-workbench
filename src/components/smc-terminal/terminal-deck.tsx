import React from "react";
import styles from "./smc-terminal.module.css";
import type { CandleStyle, RaySpan, TerminalParams, ThemeName } from "./terminal-types";

interface TerminalDeckProps {
  params: TerminalParams;
  isPlaying: boolean;
  playhead: number;
  totalBars: number;
  seed: number;
  onTogglePlay: () => void;
  onStep: () => void;
  onScrub: (val: number) => void;
  onToggleFollow: () => void;
  onReseed: () => void;
  onParamChange: <K extends keyof TerminalParams>(key: K, val: TerminalParams[K]) => void;
  onResetView: () => void;
  onExportPng: () => void;
}

export function TerminalDeck({
  params, isPlaying, playhead, totalBars, seed,
  onTogglePlay, onStep, onScrub, onToggleFollow, onReseed,
  onParamChange, onResetView, onExportPng,
}: TerminalDeckProps): React.JSX.Element {
  const floor = Math.floor(playhead);

  return (
    <div className={styles.deck} aria-label="Control deck">
      {/* Session Group */}
      <div className={styles.deckGrp}>
        <span className={styles.deckLabel}>SESSION</span>
        <div className={styles.deckRow}>
          <button type="button" className={`${styles.ctl} ${styles.ctlPlay}`} onClick={onTogglePlay} title="Play / pause (Space)">
            {isPlaying ? "❚❚ PAUSE" : "▶ PLAY"}
          </button>
          <button type="button" className={styles.ctl} onClick={onStep} title="Step one bar (→)">⇥</button>
          <select
            className={styles.sortSel}
            value={params.speed}
            onChange={(e) => onParamChange("speed", Number(e.target.value))}
            title="Replay speed"
          >
            <option value="0.5">0.5×</option>
            <option value="1">1×</option>
            <option value="2">2×</option>
            <option value="4">4×</option>
          </select>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <label style={{ fontSize: 8, color: "var(--faint)", letterSpacing: ".1em" }}>REPLAY</label>
            <input
              type="range"
              className={styles.rangeInput}
              min={10}
              max={Math.max(11, totalBars - 1)}
              value={floor}
              onChange={(e) => onScrub(Number(e.target.value))}
            />
          </div>
          <button
            type="button"
            className={`${styles.ctl} ${params.follow ? styles.ctlFollowOn : ""}`}
            onClick={onToggleFollow}
            title="Follow price (F)"
          >
            ⌖ FOLLOW
          </button>
          <button type="button" className={styles.ctl} onClick={onReseed} title="Deterministic reseed" style={{ color: "var(--violet)" }}>
            ↻ RESEED
          </button>
          <span style={{ fontSize: 9, color: "var(--faint)", fontFamily: '"IBM Plex Mono", monospace' }}>seed {seed}</span>
        </div>
      </div>

      {/* View Group */}
      <div className={styles.deckGrp}>
        <span className={styles.deckLabel}>VIEW</span>
        <div className={styles.deckRow}>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <label style={{ fontSize: 8, color: "var(--faint)", letterSpacing: ".1em" }}>ZOOM</label>
            <input
              type="range"
              className={styles.rangeInput}
              min={40}
              max={220}
              value={params.zoom}
              onChange={(e) => onParamChange("zoom", Number(e.target.value))}
            />
          </div>
          <select className={styles.sortSel} value={params.candle} onChange={(e) => onParamChange("candle", e.target.value as CandleStyle)}>
            <option value="hollow">Hollow</option>
            <option value="solid">Solid</option>
          </select>
          <select className={styles.sortSel} value={params.theme} onChange={(e) => onParamChange("theme", e.target.value as ThemeName)}>
            <option value="ion">Ion</option>
            <option value="classic">Classic</option>
            <option value="ultra">Ultraviolet</option>
          </select>
          <button type="button" className={styles.ctl} onClick={onResetView} title="Reset view (R / double-click)">⟲ RESET</button>
        </div>
      </div>

      {/* Layers Group */}
      <div className={styles.deckGrp}>
        <span className={styles.deckLabel}>LAYERS</span>
        <div className={styles.deckRow}>
          {(["rays", "ladder", "fvg", "bos", "ob", "liq", "pd", "filled", "vol", "pulled"] as const).map((key) => (
            <button
              key={key}
              type="button"
              className={`${styles.ctl} ${params[key] ? styles.ctlOn : ""}`}
              onClick={() => onParamChange(key, !params[key])}
            >
              {key === "vol" ? "VOLUME" : key.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Engine Group */}
      <div className={styles.deckGrp}>
        <span className={styles.deckLabel}>ENGINE</span>
        <div className={styles.deckRow}>
          <select className={styles.sortSel} value={params.bin} onChange={(e) => onParamChange("bin", Number(e.target.value))}>
            <option value="0.05">bin 0.05</option>
            <option value="0.1">bin 0.10</option>
            <option value="0.25">bin 0.25</option>
          </select>
          <select className={styles.sortSel} value={params.raySpan} onChange={(e) => onParamChange("raySpan", e.target.value as RaySpan)}>
            <option value="birth">Rails: birth</option>
            <option value="window">Rails: window</option>
            <option value="full">Rails: full</option>
          </select>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <label style={{ fontSize: 8, color: "var(--faint)", letterSpacing: ".1em" }}>RAIL SCALE</label>
            <input
              type="range"
              className={styles.rangeInput}
              min={0.4}
              max={2}
              step={0.1}
              value={params.rayScale}
              onChange={(e) => onParamChange("rayScale", Number(e.target.value))}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <label style={{ fontSize: 8, color: "var(--faint)", letterSpacing: ".1em" }}>LADDER W</label>
            <input
              type="range"
              className={styles.rangeInput}
              min={40}
              max={180}
              step={5}
              value={params.ladderW}
              onChange={(e) => onParamChange("ladderW", Number(e.target.value))}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <label style={{ fontSize: 8, color: "var(--faint)", letterSpacing: ".1em" }}>GLOW</label>
            <input
              type="range"
              className={styles.rangeInput}
              min={0}
              max={1}
              step={0.05}
              value={params.glow}
              onChange={(e) => onParamChange("glow", Number(e.target.value))}
            />
          </div>
          <select className={styles.sortSel} value={params.density} onChange={(e) => onParamChange("density", Number(e.target.value))}>
            <option value="0">Minimal</option>
            <option value="1">Balanced</option>
            <option value="2">Full</option>
          </select>
        </div>
      </div>

      {/* Actions Group */}
      <div className={styles.deckGrp}>
        <span className={styles.deckLabel}>ACTIONS</span>
        <div className={styles.deckRow}>
          <button type="button" className={`${styles.ctl} ${styles.ctlExport}`} onClick={onExportPng} title="Export current frame as PNG">
            ⤓ EXPORT PNG
          </button>
        </div>
      </div>
    </div>
  );
}
