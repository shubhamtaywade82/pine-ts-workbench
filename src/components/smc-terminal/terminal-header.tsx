import React from "react";
import Link from "next/link";
import styles from "./smc-terminal.module.css";
import { fmtP, fmtT } from "./terminal-formatters";

interface TerminalHeaderProps {
  curPrice: number;
  priceDecimals: number;
  openPrice: number;
  timeframe: number;
  currentTime: number;
  isSoundOn: boolean;
  isHalted: boolean;
  isLiveFeed: boolean;
  isLiveConnected: boolean;
  levelCount: number;
  onTimeframeChange: (tf: number) => void;
  onToggleSound: () => void;
  onToggleKill: () => void;
  onToggleLiveFeed: () => void;
  onToggleSidebar: () => void;
}

export function TerminalHeader({
  curPrice, priceDecimals, openPrice, timeframe, currentTime, isSoundOn, isHalted,
  isLiveFeed, isLiveConnected, levelCount, onTimeframeChange,
  onToggleSound, onToggleKill, onToggleLiveFeed, onToggleSidebar,
}: TerminalHeaderProps): React.JSX.Element {
  const delta = curPrice - openPrice;
  const pct = openPrice ? (delta / openPrice) * 100 : 0;
  const isUp = delta >= 0;

  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <svg viewBox="0 0 26 26" fill="none" style={{ width: 26, height: 26, flex: "none" }} aria-hidden="true">
          <rect x="1" y="1" width="24" height="24" rx="6" stroke="#24375E" />
          <path d="M6 17 L10 11 L13 14 L17 7 L20 10" stroke="#3FC1FF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="8.6" y="12.5" width="2.8" height="6" rx="0.7" fill="#19E3B1" />
          <rect x="15.6" y="8.5" width="2.8" height="7" rx="0.7" fill="#FF4D6D" />
          <circle cx="20" cy="10" r="1.6" fill="#FFB224" />
        </svg>
        <div>
          <b>NEMESIS</b>
          <span>SMC CONFLUENCE v9</span>
        </div>
      </div>
      <div className={styles.vsep} />
      <div className={styles.sym}>
        <span className={styles.pair}>SOL / USDT</span>
        <span className={styles.exch}>BINANCE PERP</span>
        <span className={`${styles.hdrPrice} ${isUp ? styles.up : styles.dn}`}>{fmtP(curPrice, priceDecimals)}</span>
        <span className={`${styles.hdrDelta} ${isUp ? styles.deltaUp : styles.deltaDn}`}>
          {isUp ? "+" : ""}{pct.toFixed(2)}%
        </span>
      </div>
      <div className={styles.tfs} role="tablist" aria-label="Timeframe">
        {[1, 5, 15, 60].map((tf) => (
          <button
            key={tf}
            type="button"
            className={`${styles.tfBtn} ${timeframe === tf ? styles.tfBtnOn : ""}`}
            onClick={() => onTimeframeChange(tf)}
          >
            {tf === 60 ? "1h" : `${tf}m`}
          </button>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      <span className={styles.clock}>{currentTime ? fmtT(currentTime) : "—"} · {isLiveFeed ? "live ws" : "sim"}</span>
      <button
        type="button"
        className={isLiveFeed ? styles.badgeLive : styles.badgeDry}
        onClick={onToggleLiveFeed}
        title="Click to toggle between real Binance WebSocket and Replay Simulation"
      >
        {isLiveFeed ? (isLiveConnected ? "● LIVE BINANCE" : "○ CONNECTING...") : "DRY-RUN SIM"}
      </button>
      <button
        type="button"
        className={`${styles.hbtn} ${isSoundOn ? styles.sndOn : ""}`}
        onClick={onToggleSound}
        title="Mute all sound (M)"
      >
        <svg viewBox="0 0 16 16" fill="none" style={{ width: 14, height: 14 }}>
          <path d="M2 6v4h3l4 3V3L5 6H2z" fill="currentColor" />
          <path
            d="M11 5.5c1.4 1.4 1.4 3.6 0 5M12.8 3.8c2.4 2.4 2.4 6 0 8.4"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            style={{ opacity: isSoundOn ? 1 : 0.15 }}
          />
        </svg>
        <span>{isSoundOn ? "SOUND ON" : "MUTED"}</span>
      </button>
      <button
        type="button"
        className={`${styles.hbtn} ${styles.killBtn} ${isHalted ? styles.killEngaged : ""}`}
        onClick={onToggleKill}
        title="Halt engine (K)"
      >
        {isHalted ? "⏻ RESUME ENGINE" : "⏻ KILL SWITCH"}
      </button>
      <Link href="/" className={styles.hbtn} title="Return to Multi-Chart Workbench">
        <span>◫ WORKBENCH</span>
      </Link>
      <button
        type="button"
        className={`${styles.hbtn} ${styles.sideToggle}`}
        onClick={onToggleSidebar}
        title="Confluence panel"
      >
        ☰ <span className={styles.sideCnt}>{levelCount}</span>
      </button>
    </header>
  );
}
