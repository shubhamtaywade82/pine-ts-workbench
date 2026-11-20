import React from "react";
import type { SimulationState } from "./terminal-simulation";
import { binTicks } from "./terminal-simulation";
import { fmtP, fmtS, tickDecimals } from "./terminal-formatters";
import styles from "./smc-terminal.module.css";

const ROWS_PER_SIDE = 12;
const ROW_HEIGHT_PX = 18;

interface DomRow {
  price: number;
  size: number;
  pulled: number;
  side: "bid" | "ask";
}

interface TerminalDomPanelProps {
  state: SimulationState;
  price: number;
  binSize: number;
}

export interface TerminalOrderBookProps {
  state: SimulationState;
  curPrice: number;
  binSize: number;
  onFocusPrice?: (price: number) => void;
  onHighlightPrice?: (price: number | null) => void;
}

interface BookLevel {
  price: number;
  size: number;
  depth: number;
  isWall?: boolean;
}

interface BookRowData {
  bid?: BookLevel;
  ask?: BookLevel;
}

function sumByBin(source: ReadonlyMap<number, number>, ticksPerBin: number): Map<number, number> {
  const bins = new Map<number, number>();
  for (const [idx, value] of source) {
    const bin = Math.floor(idx / ticksPerBin);
    bins.set(bin, (bins.get(bin) ?? 0) + value);
  }
  return bins;
}

function buildRows(state: SimulationState, price: number, binSize: number): DomRow[] {
  const ticksPerBin = binTicks(binSize, state.tick);
  const binWidth = ticksPerBin * state.tick;
  const sizes = sumByBin(state.book, ticksPerBin);
  const pulledByIdx = new Map([...(state.activity ?? [])].map(([idx, flow]) => [idx, flow.pulled]));
  const pulled = sumByBin(pulledByIdx, ticksPerBin);
  const midBin = Math.floor(price / binWidth);
  const rows: DomRow[] = [];
  for (let bin = midBin + ROWS_PER_SIDE; bin >= midBin - ROWS_PER_SIDE; bin--) {
    rows.push({
      price: bin * binWidth,
      size: sizes.get(bin) ?? 0,
      pulled: pulled.get(bin) ?? 0,
      side: bin * binWidth < price ? "bid" : "ask",
    });
  }
  return rows;
}

/** DOM-style ladder: resting size per price row, big-wall tags, and size pulled in the last minute. */
export function TerminalDomPanel({ state, price, binSize }: TerminalDomPanelProps): React.JSX.Element {
  const decimals = tickDecimals(state.tick);
  const rows = buildRows(state, price, binSize);
  const maxSize = Math.max(1, ...rows.map((row) => row.size));
  const ticksPerBin = binTicks(binSize, state.tick);
  const wallBins = new Set((state.bigsSnap[Math.floor(state.playhead)] ?? []).map((w) => Math.floor(w.idx / ticksPerBin)));

  return (
    <div style={{ fontSize: 10, fontFamily: '"IBM Plex Mono", monospace' }}>
      {rows.map((row) => {
        const color = row.side === "bid" ? "var(--bid)" : "var(--ask)";
        const isWall = wallBins.has(Math.floor(row.price / (ticksPerBin * state.tick) + 1e-9));
        return (
          <div
            key={row.price}
            style={{ display: "grid", gridTemplateColumns: "1fr 62px 1fr", alignItems: "center", height: ROW_HEIGHT_PX }}
          >
            <div style={{ position: "relative", height: ROW_HEIGHT_PX - 2, textAlign: "right" }}>
              {isWall && <span style={{ color, fontWeight: 700, fontSize: 8, paddingRight: 4 }}>{row.side === "bid" ? "BIG BUYERS" : "BIG SELLERS"}</span>}
            </div>
            <div style={{ textAlign: "center", color: "var(--muted)" }}>{fmtP(row.price, decimals)}</div>
            <div style={{ position: "relative", height: ROW_HEIGHT_PX - 2, display: "flex", alignItems: "center", gap: 6 }}>
              <i
                style={{
                  position: "absolute", left: 0, top: 0, bottom: 0,
                  width: `${(row.size / maxSize) * 100}%`, background: color, opacity: 0.35,
                }}
              />
              <span style={{ position: "relative", paddingLeft: 3, color: "var(--text)" }}>{row.size > 0 ? fmtS(row.size) : ""}</span>
              {row.pulled > 0 && <span style={{ position: "relative", marginLeft: "auto", color: "var(--amber)", paddingRight: 3 }}>{fmtS(row.pulled)} pulled</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function aggregateBins(book: ReadonlyMap<number, number>, ticksPerBin: number, tick: number): Map<number, number> {
  const binWidth = ticksPerBin * tick;
  const bins = new Map<number, number>();
  for (const [idx, size] of book) {
    if (size <= 0) continue;
    const bin = Math.round((idx * tick) / binWidth);
    bins.set(bin, (bins.get(bin) ?? 0) + size);
  }
  return bins;
}

const DEPTH_ROWS = 24;

function collectSideLevels(
  entries: Array<[number, number]>,
  binWidth: number,
  fallbackStart: number,
  stepDir: number,
): BookLevel[] {
  const levels: BookLevel[] = [];
  let cum = 0;
  for (let i = 0; i < DEPTH_ROWS; i++) {
    const item = entries[i];
    const price = item ? item[0] * binWidth : fallbackStart + i * stepDir * binWidth;
    const size = item ? item[1] : 0;
    cum += size;
    levels.push({ price, size, depth: cum });
  }
  return levels;
}

function buildOrderBookData(state: SimulationState, curPrice: number, binSize: number) {
  const ticksPerBin = binTicks(binSize, state.tick);
  const binWidth = ticksPerBin * state.tick;
  const sizes = aggregateBins(state.book, ticksPerBin, state.tick);
  const wallBins = new Set((state.bigsSnap[Math.floor(state.playhead)] ?? []).map((w) => Math.floor(w.idx / ticksPerBin)));

  const bidEntries = [...sizes.entries()].filter(([bin]) => bin * binWidth < curPrice - 1e-9).sort((a, b) => b[0] - a[0]);
  const askEntries = [...sizes.entries()].filter(([bin]) => bin * binWidth >= curPrice - 1e-9).sort((a, b) => a[0] - b[0]);

  const bestBid = bidEntries[0] ? bidEntries[0][0] * binWidth : Math.floor(curPrice / binWidth) * binWidth;
  const bestAsk = askEntries[0] ? askEntries[0][0] * binWidth : bestBid + binWidth;

  const bids = collectSideLevels(bidEntries, binWidth, bestBid, -1);
  const asks = collectSideLevels(askEntries, binWidth, bestAsk, 1);
  const maxDepth = Math.max(bids[bids.length - 1]?.depth ?? 1, asks[asks.length - 1]?.depth ?? 1, 1);

  const rows: BookRowData[] = [];
  for (let i = 0; i < DEPTH_ROWS; i++) {
    const b = bids[i];
    const a = asks[i];
    rows.push({
      bid: b ? { ...b, isWall: wallBins.has(Math.round(b.price / binWidth)) } : undefined,
      ask: a ? { ...a, isWall: wallBins.has(Math.round(a.price / binWidth)) } : undefined,
    });
  }

  return {
    rows,
    maxDepth,
    markPrice: (bestBid + bestAsk) / 2,
    futurePrice: curPrice,
    spread: Math.max(0, bestAsk - bestBid),
  };
}

interface BookRowProps {
  row: BookRowData;
  maxDepth: number;
  dec: number;
  onFocusPrice?: (price: number) => void;
  onHighlightPrice?: (price: number | null) => void;
}

function TerminalOrderBookRow({
  row, maxDepth, dec, onFocusPrice, onHighlightPrice,
}: BookRowProps): React.JSX.Element {
  const bidDepthPct = row.bid && row.bid.size > 0 ? Math.min(100, (row.bid.depth / maxDepth) * 100) : 0;
  const askDepthPct = row.ask && row.ask.size > 0 ? Math.min(100, (row.ask.depth / maxDepth) * 100) : 0;

  return (
    <div className={styles.bookRow} onClick={() => onFocusPrice?.(row.bid?.price ?? row.ask?.price ?? 0)}>
      {bidDepthPct > 0 && (
        <div
          className={`${styles.bidDepthBar} ${row.bid?.isWall ? styles.depthBarWall : ""}`}
          style={{ width: `${Math.max(2, bidDepthPct * 0.5)}%` }}
        />
      )}
      {askDepthPct > 0 && (
        <div
          className={`${styles.askDepthBar} ${row.ask?.isWall ? styles.depthBarWall : ""}`}
          style={{ width: `${Math.max(2, askDepthPct * 0.5)}%` }}
        />
      )}
      <span className={styles.colDepthBid}>{row.bid && row.bid.size > 0 ? fmtS(row.bid.depth) : ""}</span>
      <span className={styles.colBid}>{row.bid && row.bid.size > 0 ? fmtS(row.bid.size) : ""}</span>
      <span
        className={`${styles.colPriceBid} ${row.bid?.isWall ? styles.wallPrice : ""}`}
        onMouseEnter={() => row.bid && onHighlightPrice?.(row.bid.price)}
        onClick={(e) => { e.stopPropagation(); if (row.bid) onFocusPrice?.(row.bid.price); }}
      >
        {row.bid ? fmtP(row.bid.price, dec) : ""}
      </span>
      <span
        className={`${styles.colPriceAsk} ${row.ask?.isWall ? styles.wallPrice : ""}`}
        onMouseEnter={() => row.ask && onHighlightPrice?.(row.ask.price)}
        onClick={(e) => { e.stopPropagation(); if (row.ask) onFocusPrice?.(row.ask.price); }}
      >
        {row.ask ? fmtP(row.ask.price, dec) : ""}
      </span>
      <span className={styles.colAsk}>{row.ask && row.ask.size > 0 ? fmtS(row.ask.size) : ""}</span>
      <span className={styles.colDepthAsk}>{row.ask && row.ask.size > 0 ? fmtS(row.ask.depth) : ""}</span>
    </div>
  );
}

/** Dual-ladder order book showing mark/future price, bid/ask depth, and animated background liquidity bars. */
export function TerminalOrderBook({
  state, curPrice, binSize, onFocusPrice, onHighlightPrice,
}: TerminalOrderBookProps): React.JSX.Element {
  const dec = tickDecimals(state.tick);
  const { rows, maxDepth, markPrice, futurePrice, spread } = buildOrderBookData(state, curPrice, binSize);

  return (
    <div className={styles.bookPanel} onMouseLeave={() => onHighlightPrice?.(null)}>
      <div className={styles.bookHeaderFirst}>
        <div className={styles.bookPriceStat}>
          <span className={styles.bookPriceStatLabel}>Mark price</span>
          <span className={styles.bookPriceStatVal}>{fmtP(markPrice, dec)}</span>
        </div>
        <div className={styles.bookSpreadBadge}>
          <span>SPREAD {fmtP(spread, dec)}</span>
        </div>
        <div className={styles.bookPriceStat}>
          <span className={styles.bookPriceStatLabel}>Future price</span>
          <span className={`${styles.bookPriceStatVal} ${futurePrice >= markPrice ? styles.up : styles.dn}`}>
            {fmtP(futurePrice, dec)}
          </span>
        </div>
      </div>

      <div className={styles.bookColsHeader}>
        <span className={styles.colDepthBid}>VOL/DEPTH</span>
        <span className={styles.colBid}>BID</span>
        <span className={styles.colPriceBid}>PRICE</span>
        <span className={styles.colPriceAsk}>PRICE</span>
        <span className={styles.colAsk}>ASK</span>
        <span className={styles.colDepthAsk}>VOL/DEPTH</span>
      </div>

      <div className={styles.bookRowsList}>
        {rows.map((row, i) => (
          <TerminalOrderBookRow
            key={i}
            row={row}
            maxDepth={maxDepth}
            dec={dec}
            onFocusPrice={onFocusPrice}
            onHighlightPrice={onHighlightPrice}
          />
        ))}
      </div>
    </div>
  );
}

