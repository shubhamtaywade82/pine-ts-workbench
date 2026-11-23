import { useEffect, useMemo, useRef, useState } from "react";
import type { Bar } from "@nemesis-oss/pine-ts";
import type { ChartDrawing } from "@/components/chart/script-drawings-primitive";
import { INTERVAL_MS, type ChartInterval, type SymbolOption } from "@/lib/public-binance-feed";
import { marginCurrencySymbol, pairPriceSymbol, type CoindcxPosition } from "@/lib/coindcx-client";
import { useCoindcxPortfolio } from "@/hooks/use-coindcx-portfolio";

/** Linear interpolation between two numbers. */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Smoothly lerps a numeric value towards target using requestAnimationFrame. */
export function useLerpNumber(target: number, tauMs = 180): number {
  const [val, setVal] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    let frame = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      const k = 1 - Math.exp(-(now - prev) / tauMs);
      prev = now;
      cur.current += (target - cur.current) * k;
      if (Math.abs(target - cur.current) < 0.001) {
        setVal(target);
        cur.current = target;
        return;
      }
      setVal(cur.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, tauMs]);
  return val;
}

export interface ChartSpan {
  readonly startTime: number;
  readonly lastTime: number;
}

const LOOKAHEAD_BARS = 30;
const COLOR_LONG = "#089981";
const COLOR_SHORT = "#f23645";
const COLOR_LIQ = "#f7b731";

/** Normalizes pair name by removing prefix (CDCX:, B-, I-) and delimiters. */
export function normalizePairString(raw: string): string {
  return raw.toUpperCase().replace(/^CDCX:/, "").replace(/^[BI]-/, "").replace(/[^A-Z0-9]/g, "");
}

/** Determines if a CoinDCX position pair matches a chart symbol option. */
export function isPositionMatchingSymbol(positionPair: string, symbol: SymbolOption): boolean {
  if (symbol.coindcxPair && (symbol.coindcxPair === positionPair || normalizePairString(symbol.coindcxPair) === normalizePairString(positionPair))) return true;
  const normalizedPos = normalizePairString(positionPair);
  if (symbol.binanceSymbol && normalizePairString(symbol.binanceSymbol) === normalizedPos) return true;
  if (symbol.ticker && normalizePairString(symbol.ticker) === normalizedPos) return true;
  if (symbol.displayName && normalizePairString(symbol.displayName) === normalizedPos) return true;
  return false;
}

/** Filters position list for those relevant to the current chart symbol. */
export function findMatchingCoindcxPositions(
  positions: readonly CoindcxPosition[],
  symbol: SymbolOption,
): CoindcxPosition[] {
  return positions.filter((p) => isPositionMatchingSymbol(p.pair, symbol));
}

/** Generates horizontal price lines and labels for open CoinDCX positions. */
export function coindcxPositionDrawings(
  positions: readonly CoindcxPosition[],
  span: ChartSpan | undefined,
  intervalMs: number,
): ChartDrawing[] {
  if (!span || positions.length === 0) return [];
  const to = span.lastTime + LOOKAHEAD_BARS * intervalMs;
  const labelAt = span.lastTime + intervalMs;
  const drawings: ChartDrawing[] = [];

  for (const pos of positions) {
    const isLong = pos.side === "LONG";
    const color = isLong ? COLOR_LONG : COLOR_SHORT;
    const sign = pos.unrealizedPnl >= 0 ? "+" : "-";
    const priceSym = pairPriceSymbol(pos.pair);
    const mrgSym = marginCurrencySymbol(pos.marginCurrency);
    const pnlPctSign = pos.pnlPercentage >= 0 ? "+" : "";
    const pnlText = `${sign}${mrgSym}${Math.abs(pos.unrealizedPnl).toFixed(2)} (${pnlPctSign}${pos.pnlPercentage.toFixed(1)}%)`;

    drawings.push({
      kind: "shape-line",
      from: span.startTime,
      to,
      x1: span.startTime,
      x2: to,
      y1: pos.entryPrice,
      y2: pos.entryPrice,
      color,
      width: 2,
      style: "solid",
    });
    drawings.push({
      kind: "label",
      time: labelAt,
      x: labelAt,
      y: pos.entryPrice,
      text: `CoinDCX ${pos.side} ${pos.size} @ ${priceSym}${pos.entryPrice.toLocaleString()} · PnL: ${pnlText}`,
      color,
      position: "right",
      size: "small",
    });

    if (pos.liquidationPrice > 0) {
      drawings.push({
        kind: "shape-line",
        from: span.startTime,
        to,
        x1: span.startTime,
        x2: to,
        y1: pos.liquidationPrice,
        y2: pos.liquidationPrice,
        color: COLOR_LIQ,
        width: 1.5,
        style: "dashed",
      });
      drawings.push({
        kind: "label",
        time: labelAt,
        x: labelAt,
        y: pos.liquidationPrice,
        text: `CoinDCX LIQ @ ${priceSym}${pos.liquidationPrice.toLocaleString()}`,
        color: COLOR_LIQ,
        position: "right",
        size: "small",
      });
    }
  }
  return drawings;
}

/** Hook producing matching positions and chart drawings for CoinDCX portfolio. */
export function useCoindcxChartOverlay(
  symbol: SymbolOption,
  visibleBars: readonly Bar[],
  interval: ChartInterval,
) {
  const coindcx = useCoindcxPortfolio();
  const positions = useMemo(
    () => findMatchingCoindcxPositions(coindcx.positions, symbol),
    [coindcx.positions, symbol],
  );

  const drawings = useMemo(() => {
    if (positions.length === 0 || visibleBars.length === 0) return [];
    const first = visibleBars[0];
    const last = visibleBars[visibleBars.length - 1];
    if (!first || !last) return [];
    return coindcxPositionDrawings(positions, { startTime: first.time, lastTime: last.time }, INTERVAL_MS[interval]);
  }, [positions, visibleBars, interval]);

  return { positions, drawings };
}
