import React, { useState } from "react";
import styles from "./smc-terminal.module.css";
import { NORMAL, type LevelFilter, type MarketEvent, type SortOption } from "./terminal-types";
import type { SimulationState } from "./terminal-simulation";
import { TerminalDomPanel } from "./terminal-dom-panel";
import { fmtAge, fmtP as fmtPrice, fmtS, fmtT, tickDecimals } from "./terminal-formatters";

interface TerminalSidebarProps {
  state: SimulationState;
  curPrice: number;
  binSize: number;
  isHalted: boolean;
  isOpen: boolean;
  onClose: () => void;
  onFocusPrice: (price: number) => void;
  onHighlightPrice: (price: number | null) => void;
}

interface LevelRow {
  kind: "lvl" | "evt";
  type?: MarketEvent["type"];
  price: number;
  size: number;
  side: "bid" | "ask";
  born?: number;
  bar?: number;
}

function filterAndSortLevels(state: SimulationState, filter: LevelFilter, query: string, sort: SortOption, floor: number, mid: number): LevelRow[] {
  let rows: LevelRow[] = [];
  if (filter === "evt") {
    rows = state.events.filter((e) => e.bar <= floor && e.type !== "wall").slice(-40).reverse()
      .map((e) => ({ kind: "evt", type: e.type, price: e.price, size: e.size, side: e.side, bar: e.bar }));
  } else {
    const bigs = state.bigsSnap[floor] || [];
    rows = bigs.map((b) => ({ kind: "lvl", price: b.idx * state.tick, size: b.size, side: b.side, born: b.born }));
    if (filter !== "all") rows = rows.filter((r) => r.side === filter);
  }
  if (query) rows = rows.filter((r) => fmtPrice(r.price, tickDecimals(state.tick)).includes(query));
  if (sort === "size") rows.sort((a, b) => b.size - a.size);
  else if (sort === "new") rows.sort((a, b) => (b.bar ?? b.born ?? 0) - (a.bar ?? a.born ?? 0));
  else rows.sort((a, b) => Math.abs(a.price - mid) - Math.abs(b.price - mid));
  return rows.slice(0, 40);
}

export function TerminalSidebar({
  state, curPrice, binSize, isHalted, isOpen, onClose, onFocusPrice, onHighlightPrice,
}: TerminalSidebarProps): React.JSX.Element {
  const fmtP = (p: number): string => fmtPrice(p, tickDecimals(state.tick));
  const [filter, setFilter] = useState<LevelFilter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOption>("dist");

  const floor = Math.floor(state.playhead);
  const mid = state.bars[Math.min(floor, state.bars.length - 1)]?.c ?? curPrice;
  const isLive = state.playhead >= state.bars.length - 1.01;
  const bestBid = Math.floor(curPrice / state.tick) * state.tick;

  let bidsTotal = 0;
  let asksTotal = 0;
  for (const [idx, size] of state.book) {
    const p = idx * state.tick;
    if (Math.abs(p - curPrice) <= 1.2) {
      if (p < curPrice) bidsTotal += size;
      else asksTotal += size;
    }
  }
  const totalBook = bidsTotal + asksTotal || 1;
  const rows = filterAndSortLevels(state, filter, search.trim(), sort, floor, mid);
  const tapeEvents = state.events.filter((e) => e.bar <= floor).slice(-24).reverse();

  return (
    <aside className={`${styles.sidebar} ${styles.sidebarMobile} ${isOpen ? styles.sidebarOpen : ""}`}>
      <div className={styles.sbHead}>
        <div className={styles.sbTitle}>
          <span className={`${styles.statusDot} ${isHalted ? styles.dotHalted : isLive ? "" : styles.dotReplay}`} />
          <b>CONFLUENCE ENGINE</b>
          <span style={{ color: "var(--faint)" }}>v9.0</span>
          <span style={{ marginLeft: "auto", fontSize: 9, color: isHalted ? "var(--danger)" : isLive ? "var(--lime)" : "var(--amber)" }}>
            {isHalted ? "HALTED" : isLive ? "LIVE" : "REPLAY"}
          </span>
          <button type="button" onClick={onClose} style={{ marginLeft: 8, cursor: "pointer", display: isOpen ? "block" : "none" }}>✕</button>
        </div>
        <div className={styles.spot}>
          <span className={`${styles.spotPrice} ${curPrice >= mid ? styles.up : styles.dn}`}>{fmtP(curPrice)}</span>
          <span className={styles.spotSpread}>spread {fmtP(state.tick)} · bid {fmtP(bestBid)} / ask {fmtP(bestBid + state.tick)}</span>
        </div>
        <div className={styles.totalsBar}>
          <i className={styles.bidBar} style={{ width: `${(bidsTotal / totalBook) * 100}%` }} />
          <i className={styles.askBar} style={{ width: `${(asksTotal / totalBook) * 100}%` }} />
        </div>
        <div className={styles.totalsLabel}>
          <span style={{ color: "var(--bid)" }}>bids {fmtS(bidsTotal)}</span>
          <span style={{ color: "var(--ask)" }}>asks {fmtS(asksTotal)}</span>
        </div>
      </div>

      <div className={styles.sbTools}>
        <div className={styles.chips}>
          {(["all", "bid", "ask", "evt", "dom"] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`${styles.chipBtn} ${filter === f ? styles.chipBtnOn : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f === "bid" ? "Bids" : f === "ask" ? "Asks" : f === "evt" ? "Events" : "DOM"}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 7 }}>
          <input
            className={styles.searchInp}
            type="text"
            placeholder="filter price…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className={styles.sortSel} value={sort} onChange={(e) => setSort(e.target.value as SortOption)}>
            <option value="dist">Distance</option>
            <option value="size">Size</option>
            <option value="new">Newest</option>
          </select>
        </div>
      </div>

      <div className={styles.levelsList} role="list" onMouseLeave={() => onHighlightPrice(null)}>
        {filter === "dom" ? (
          <TerminalDomPanel state={state} price={mid} binSize={binSize} />
        ) : rows.length === 0 ? (
          <div style={{ padding: "18px 10px", textAlign: "center", color: "var(--faint)", fontSize: 10 }}>No levels match filter.</div>
        ) : (
          rows.map((r, i) => {
            const dist = r.price - mid;
            const mult = (r.size / NORMAL).toFixed(1);
            const pillCls = r.kind === "evt"
              ? r.type === "pull" ? styles.pillPull : r.type === "held" ? styles.pillHeld : styles.pillBrk
              : styles.pillRest;
            const sideCls = r.kind === "evt" ? styles.lvlEvt : r.side === "bid" ? styles.lvlBid : styles.lvlAsk;
            return (
              <button
                key={`${r.price}-${r.kind}-${i}`}
                type="button"
                className={`${styles.lvlItem} ${sideCls}`}
                onClick={() => onFocusPrice(r.price)}
                onMouseEnter={() => onHighlightPrice(r.price)}
              >
                <i className={styles.lvlSide} />
                <div>
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12 }}>
                    <span style={{ fontWeight: 600 }}>{fmtP(r.price)}</span>
                    <span style={{ color: "var(--text)", fontSize: 11 }}>{fmtS(r.size)}</span>
                    <span style={{ color: "var(--violet)", fontSize: 10 }}>{mult}× norm</span>
                  </div>
                  <div style={{ fontSize: 9, color: "var(--faint)", marginTop: 2 }}>
                    {r.kind === "evt"
                      ? `${fmtT(state.bars[r.bar ?? 0]?.t ?? 0)} · ${r.type === "pull" ? "vanished" : r.type === "held" ? "absorbed" : "broken"}`
                      : `waiting ${fmtAge(floor - (r.born ?? 0), state.tf)} · ${dist >= 0 ? "+" : ""}${dist.toFixed(2)}`}
                  </div>
                </div>
                <span className={`${styles.pill} ${pillCls}`}>
                  {r.kind === "evt" ? (r.type === "pull" ? "PULLED" : r.type === "held" ? "HELD" : "BROKEN") : "REST"}
                </span>
              </button>
            );
          })
        )}
      </div>

      <div className={styles.tapeList}>
        <div className={styles.tapeHeader}>LIQUIDITY TAPE</div>
        <div>
          {tapeEvents.map((e, i) => (
            <div key={`${e.bar}-${e.type}-${i}`} className={styles.tapeRow}>
              <span style={{ width: 12, textAlign: "center", fontWeight: 600 }}>
                {e.type === "wall" ? "▮" : e.type === "pull" ? "✕" : e.type === "held" ? "◎" : "⚡"}
              </span>
              <span style={{ flex: 1, color: "var(--text)" }}>
                {e.type === "wall" ? "New wall" : e.type === "pull" ? "Pulled" : e.type === "held" ? "Held" : "Broken"}
                <em style={{ fontStyle: "normal", color: "var(--muted)" }}> {fmtS(e.size)} @</em> {fmtP(e.price)}
              </span>
              <span style={{ color: "var(--faint)", fontSize: 9 }}>{fmtT(state.bars[e.bar]?.t ?? 0)}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
