"use client";

import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { PeriodPnl } from "@/lib/backtest-report";
import { formatDate } from "@/components/strategy/report-format";

// TradingView Strategy Tester palette.
export const UP = "#089981";
export const DOWN = "#f23645";
const NEUTRAL = "#ff9800";
const HOLD = "#787b86";
const GRID = "#2a2e39";
const AXIS = { fontSize: 11, fill: "#b2b5be" };
const TOOLTIP = {
  contentStyle: { background: "#1e222d", border: `1px solid ${GRID}`, fontSize: 12 },
  labelStyle: { color: "#d1d4dc" },
};

export interface PerformancePoint {
  readonly label: string;
  readonly cumulative: number;
  readonly trade: number;
  readonly buyHold?: number;
}

/** Cumulative P&L line over per-trade P&L bars, plus optional buy & hold, per closed trade. */
export function PerformanceChart({ points, showBuyHold }: { points: readonly PerformancePoint[]; showBuyHold: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={[...points]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} stroke={GRID} />
        <YAxis orientation="right" tick={AXIS} stroke={GRID} width={64} />
        <Tooltip {...TOOLTIP} />
        <ReferenceLine y={0} stroke={GRID} />
        <Bar dataKey="trade" name="Trade PnL" isAnimationActive={false}>
          {points.map((p, i) => <Cell key={i} fill={p.trade >= 0 ? UP : DOWN} fillOpacity={0.45} />)}
        </Bar>
        <Line dataKey="cumulative" name="Cumulative PnL" stroke={(points.at(-1)?.cumulative ?? 0) >= 0 ? UP : DOWN} dot={{ r: 2 }} isAnimationActive={false} />
        {showBuyHold && <Line dataKey="buyHold" name="Buy & hold PnL" stroke={HOLD} dot={false} isAnimationActive={false} />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Strategy P&L per period as up/down bars, optionally beside buy & hold. */
export function PeriodBars({ periods, withBuyHold }: { periods: readonly PeriodPnl[]; withBuyHold: boolean }) {
  const data = periods.map((p) => ({ ...p, label: formatDate(p.start) }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} stroke={GRID} />
        <YAxis orientation="right" tick={AXIS} stroke={GRID} width={64} />
        <Tooltip {...TOOLTIP} />
        <ReferenceLine y={0} stroke={GRID} />
        <Bar dataKey="strategy" name="Strategy PnL" isAnimationActive={false}>
          {data.map((p, i) => <Cell key={i} fill={withBuyHold ? "#2962ff" : p.strategy >= 0 ? UP : DOWN} />)}
        </Bar>
        {withBuyHold && <Bar dataKey="buyHold" name="Buy and hold PnL" fill={HOLD} isAnimationActive={false} />}
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface HistogramBin {
  readonly label: string;
  readonly winners: number;
  readonly losers: number;
}

/** Count of trades per return bucket, losers red and winners green. */
export function ReturnsHistogram({ bins }: { bins: readonly HistogramBin[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={[...bins]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} stroke={GRID} />
        <YAxis orientation="right" allowDecimals={false} tick={AXIS} stroke={GRID} width={32} />
        <Tooltip {...TOOLTIP} />
        <Bar dataKey="losers" name="Losers" stackId="t" fill={DOWN} isAnimationActive={false} />
        <Bar dataKey="winners" name="Winners" stackId="t" fill={UP} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Winners / losers / breakevens donut with the total in the middle. */
export function TradesDonut({ winners, losers, breakevens }: { winners: number; losers: number; breakevens: number }) {
  const data = [
    { name: "Winners", value: winners, fill: UP },
    { name: "Losers", value: losers, fill: DOWN },
    { name: "Breakevens", value: breakevens, fill: NEUTRAL },
  ];
  const total = winners + losers + breakevens;
  const percent = (n: number) => (total === 0 ? "0.00%" : `${((n / total) * 100).toFixed(2)}%`);
  return (
    <div className="flex items-center gap-8">
      <div className="relative h-44 w-44">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius="72%" outerRadius="100%" stroke="none" isAnimationActive={false}>
              {data.map((d) => <Cell key={d.name} fill={d.fill} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold">{total}</span>
          <span className="text-xs text-muted-foreground">Total trades</span>
        </div>
      </div>
      <div className="grid grid-cols-[auto_auto_auto] gap-x-6 gap-y-1 text-sm">
        {data.map((d) => (
          <div key={d.name} className="contents">
            <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: d.fill }} />{d.name}</span>
            <span className="text-right">{d.value} trades</span>
            <span className="text-right">{percent(d.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** P&L per category (weekday, hour) as up/down bars. */
export function PatternBars({ data }: { data: readonly { label: string; pnl: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={[...data]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} stroke={GRID} />
        <YAxis orientation="right" tick={AXIS} stroke={GRID} width={64} />
        <Tooltip {...TOOLTIP} />
        <ReferenceLine y={0} stroke={GRID} />
        <Bar dataKey="pnl" name="Net PnL" isAnimationActive={false}>
          {data.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? UP : DOWN} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
