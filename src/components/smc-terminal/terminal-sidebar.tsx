import React, { useState } from "react";
import styles from "./smc-terminal.module.css";
import { NORMAL, type LevelFilter, type MarketEvent, type SortOption } from "./terminal-types";
import type { SimulationState } from "./terminal-simulation";
import { TerminalDomPanel, TerminalOrderBook } from "./terminal-dom-panel";
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

interface SidebarHeadProps {
  state: SimulationState;
  curPrice: number;
  mid: number;
  isHalted: boolean;
  isOpen: boolean;
  onClose: () => void;
}

function TerminalSidebarHead({
  state, curPrice, mid, isHalted, isOpen, onClose,
}: SidebarHeadProps): React.JSX.Element {
  const fmtP = (p: number): string => fmtPrice(p, tickDecimals(state.tick));
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

  return (
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
  );
}

interface SidebarToolsProps {
  filter: LevelFilter;
  search: string;
  sort: SortOption;
  onFilter: (f: LevelFilter) => void;
  onSearch: (q: string) => void;
  onSort: (s: SortOption) => void;
}

function TerminalSidebarTools({
  filter, search, sort, onFilter, onSearch, onSort,
}: SidebarToolsProps): React.JSX.Element {
  return (
    <div className={styles.sbTools}>
      <div className={styles.chips}>
        {(["all", "bid", "ask", "evt", "dom"] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={`${styles.chipBtn} ${filter === f ? styles.chipBtnOn : ""}`}
            onClick={() => onFilter(f)}
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
          onChange={(e) => onSearch(e.target.value)}
        />
        <select className={styles.sortSel} value={sort} onChange={(e) => onSort(e.target.value as SortOption)}>
          <option value="dist">Distance</option>
          <option value="size">Size</option>
          <option value="new">Newest</option>
        </select>
      </div>
    </div>
  );
}

interface SidebarLevelsProps {
  state: SimulationState;
  rows: LevelRow[];
  mid: number;
  floor: number;
  filter: LevelFilter;
  binSize: number;
  onFocusPrice: (p: number) => void;
  onHighlightPrice: (p: number | null) => void;
}

function TerminalSidebarLevels({
  state, rows, mid, floor, filter, binSize, onFocusPrice, onHighlightPrice,
}: SidebarLevelsProps): React.JSX.Element {
  const fmtP = (p: number): string => fmtPrice(p, tickDecimals(state.tick));

  if (filter === "dom") return <TerminalDomPanel state={state} price={mid} binSize={binSize} />;
  if (rows.length === 0) return <div style={{ padding: "18px 10px", textAlign: "center", color: "var(--faint)", fontSize: 10 }}>No levels match filter.</div>;

  return (
    <div className={styles.levelsList} role="list" onMouseLeave={() => onHighlightPrice(null)}>
      {rows.map((r, i) => {
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
      })}
    </div>
  );
}

export function TerminalSidebar({
  state, curPrice, binSize, isHalted, isOpen, onClose, onFocusPrice, onHighlightPrice,
}: TerminalSidebarProps): React.JSX.Element {
  const [tab, setTab] = useState<"book" | "split" | "levels">("book");
  const [filter, setFilter] = useState<LevelFilter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOption>("dist");

  const floor = Math.floor(state.playhead);
  const mid = state.bars[Math.min(floor, state.bars.length - 1)]?.c ?? curPrice;
  const rows = filterAndSortLevels(state, filter, search.trim(), sort, floor, mid);

  return (
    <aside className={`${styles.sidebar} ${styles.sidebarMobile} ${isOpen ? styles.sidebarOpen : ""}`}>
      <TerminalSidebarHead
        state={state} curPrice={curPrice} mid={mid} isHalted={isHalted} isOpen={isOpen} onClose={onClose}
      />
      <div className={styles.tabBar}>
        {(["book", "split", "levels"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`${styles.tabBtn} ${tab === t ? styles.tabBtnActive : ""}`}
            onClick={() => setTab(t)}
          >
            {t === "book" ? "ORDER BOOK" : t === "split" ? "SPLIT" : "SMC LEVELS"}
          </button>
        ))}
      </div>
      {tab !== "book" && (
        <TerminalSidebarTools
          filter={filter} search={search} sort={sort} onFilter={setFilter} onSearch={setSearch} onSort={setSort}
        />
      )}
      {tab !== "book" && (
        <TerminalSidebarLevels
          state={state} rows={rows} mid={mid} floor={floor} filter={filter} binSize={binSize}
          onFocusPrice={onFocusPrice} onHighlightPrice={onHighlightPrice}
        />
      )}
      {tab !== "levels" && (
        <TerminalOrderBook
          state={state} curPrice={curPrice} binSize={binSize} onFocusPrice={onFocusPrice} onHighlightPrice={onHighlightPrice}
        />
      )}
    </aside>
  );
}
