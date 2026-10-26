"use client";

import { useEffect, useState } from "react";
import { fetchHistoricalBars, type BinanceSymbol, type ChartInterval } from "@/lib/public-binance-feed";
import { computeTechnicals, PIVOT_STYLES, type TechnicalRow, type Technicals } from "@/lib/technicals";
import { toRating, type Action } from "@/lib/technical-ratings";
import { RatingGauge } from "@/components/technicals/rating-gauge";

/** TradingView's Technicals: rating gauges, oscillator and moving-average tables, pivots. */

const TIMEFRAMES: readonly (readonly [ChartInterval, string])[] = [
  ["1m", "1 minute"], ["5m", "5 minutes"], ["15m", "15 minutes"], ["30m", "30 minutes"], ["1h", "1 hour"],
  ["2h", "2 hours"], ["4h", "4 hours"], ["1d", "1 day"], ["1w", "1 week"], ["1M", "1 month"],
];
// 200-bar MAs need 200 bars, plus room for warm-up of the smoothed oscillators.
const HISTORY_BARS = 500;
const REFRESH_MS = 30_000;
const PIVOT_LABELS = ["P", "R1", "R2", "R3", "S1", "S2", "S3"];
const PIVOT_TITLES: Record<string, string> = { CLASSIC: "Classic", FIBONACCI: "Fibonacci", CAMARILLA: "Camarilla", WOODIE: "Woodie", DE_MARK: "DM" };
// Rows as TradingView lists pivots: R3 down to S3.
const PIVOT_ROW_ORDER = [3, 2, 1, 0, 4, 5, 6];

function useTechnicals(symbol: BinanceSymbol, interval: ChartInterval) {
  const [technicals, setTechnicals] = useState<Technicals | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let isCurrent = true;
    const load = async () => {
      try {
        const result = await computeTechnicals(await fetchHistoricalBars(symbol, interval, HISTORY_BARS));
        if (isCurrent) { setTechnicals(result); setError(null); }
      } catch (err) {
        if (isCurrent) setError(err instanceof Error ? err.message : String(err));
      }
    };
    setTechnicals(null);
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => { isCurrent = false; clearInterval(timer); };
  }, [symbol, interval]);
  return { technicals, error };
}

export function TechnicalsPanel({ symbol, initialInterval }: { symbol: BinanceSymbol; initialInterval: ChartInterval }) {
  const [interval, setTimeframe] = useState<ChartInterval>(initialInterval);
  const { technicals, error } = useTechnicals(symbol, interval);
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background px-4 py-3">
      <h3 className="pb-2 text-base font-semibold">Technicals</h3>
      <div className="flex flex-wrap gap-1 pb-4">
        {TIMEFRAMES.map(([value, label]) => (
          <button key={value} type="button" onClick={() => setTimeframe(value)}
            className={`rounded px-2 py-1 text-xs ${value === interval ? "bg-muted font-semibold" : "text-muted-foreground hover:text-foreground"}`}>
            {label}
          </button>
        ))}
      </div>
      {error !== null && <p className="text-sm text-[#f23645]">{error}</p>}
      {technicals === null && error === null && <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>}
      {technicals !== null && <TechnicalsBody technicals={technicals} />}
      <p className="pt-6 text-xs text-muted-foreground">Not investment advice. Ratings follow TradingView&apos;s published rules, computed with pine-ts.</p>
    </div>
  );
}

function TechnicalsBody({ technicals }: { technicals: Technicals }) {
  const { oscillators, movingAverages } = technicals;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-center gap-x-6 gap-y-4">
        <RatingGauge title="Oscillators" score={technicals.oscillatorScore} rating={toRating(technicals.oscillatorScore)} counts={countActions(oscillators)} />
        <RatingGauge title="Summary" score={technicals.summaryScore} rating={toRating(technicals.summaryScore)} counts={countActions([...oscillators, ...movingAverages])} isLarge />
        <RatingGauge title="Moving Averages" score={technicals.movingAverageScore} rating={toRating(technicals.movingAverageScore)} counts={countActions(movingAverages)} />
      </div>
      <RatingTable title="Oscillators" rows={oscillators} />
      <RatingTable title="Moving Averages" rows={movingAverages} />
      <PivotTable pivots={technicals.pivots} />
    </div>
  );
}

const countActions = (rows: readonly TechnicalRow[]) => ({
  sell: rows.filter((r) => r.action === -1).length,
  neutral: rows.filter((r) => r.action === 0).length,
  buy: rows.filter((r) => r.action === 1).length,
});

const ACTION_LABEL: Record<Action, string> = { 1: "Buy", 0: "Neutral", [-1]: "Sell" };
const ACTION_CLASS: Record<Action, string> = { 1: "text-[#2962ff]", 0: "text-muted-foreground", [-1]: "text-[#f23645]" };
const formatValue = (value: number) => (Number.isFinite(value) ? value.toFixed(2) : "—");

function RatingTable({ title, rows }: { title: string; rows: readonly TechnicalRow[] }) {
  return (
    <table className="w-full text-sm">
      <caption className="pb-2 text-left font-semibold">{title}</caption>
      <thead className="text-xs text-muted-foreground">
        <tr className="border-b border-border"><th className="py-2 text-left font-normal">Name</th><th className="text-right font-normal">Value</th><th className="w-20 text-right font-normal">Action</th></tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.name} className="border-b border-border/60">
            <td className="py-2">{row.name}</td>
            <td className="text-right tabular-nums">{formatValue(row.value)}</td>
            <td className={`text-right ${ACTION_CLASS[row.action]}`}>{ACTION_LABEL[row.action]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PivotTable({ pivots }: { pivots: Technicals["pivots"] }) {
  return (
    <table className="w-full text-sm">
      <caption className="pb-2 text-left font-semibold">Pivots <span className="font-normal text-muted-foreground">(previous bar)</span></caption>
      <thead className="text-xs text-muted-foreground">
        <tr className="border-b border-border">
          <th className="py-2 text-left font-normal">Pivot</th>
          {PIVOT_STYLES.map((style) => <th key={style} className="text-right font-normal">{PIVOT_TITLES[style]}</th>)}
        </tr>
      </thead>
      <tbody>
        {PIVOT_ROW_ORDER.map((level) => (
          <tr key={level} className="border-b border-border/60">
            <td className="py-2">{PIVOT_LABELS[level]}</td>
            {PIVOT_STYLES.map((style) => <td key={style} className="text-right tabular-nums">{formatValue(pivots[style][level] ?? Number.NaN)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
