import React from "react";
import type { SimulationState } from "./terminal-simulation";
import { binTicks } from "./terminal-simulation";
import { fmtP, fmtS, tickDecimals } from "./terminal-formatters";

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
