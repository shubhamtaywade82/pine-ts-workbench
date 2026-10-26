"use client";

import { useMemo, useState } from "react";
import { ChartLine, List, Settings, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AiAuditDialog } from "@/components/strategy/ai-audit-dialog";
import type { BacktestSummary } from "@/lib/strategy-runner";
import {
  buyHoldEquity, cagr, drawdownPeriods, isLong, maxDrawdown, periodPnl, profitFactor, riskRatios,
  type EquityPoint, type Period, type ReportTrade,
} from "@/lib/backtest-report";
import { PerformanceChart, PeriodBars, type PerformancePoint } from "@/components/strategy/report-charts";
import { TradeList } from "@/components/strategy/trade-list";
import { TradesAnalysis } from "@/components/strategy/trades-analysis";
import { formatDate, formatDuration, formatMoney, formatPercent, formatRatio, pnlClass } from "@/components/strategy/report-format";
import { Empty, IconToggle, Pills, Section, Stat, StatGrid, SubSection } from "@/components/strategy/report-ui";

export interface ReportData {
  readonly trades: readonly ReportTrade[];
  readonly equity: readonly EquityPoint[];
  readonly initialCapital: number;
  readonly currency: string;
}

export interface StrategyReportProps extends ReportData {
  /** The strategy's settings dialog (Inputs, Properties, ...), as TradingView's tester gear. */
  readonly onOpenSettings: () => void;
  readonly strategyCode?: string | null;
  readonly onApplyCode?: (code: string) => void;
}

/** TradingView-style Strategy Tester: the metrics report or the list of trades. */
export function StrategyReport({ onOpenSettings, strategyCode, onApplyCode, ...data }: StrategyReportProps) {
  const [view, setView] = useState<"metrics" | "trades">("metrics");
  const [isAuditOpen, setIsAuditOpen] = useState(false);

  const summary = useMemo((): BacktestSummary => {
    const netPnl = data.trades.reduce((total, t) => total + t.profit, 0);
    const grossProfit = data.trades.filter((t) => t.profit > 0).reduce((tot, t) => tot + t.profit, 0);
    const grossLoss = Math.abs(data.trades.filter((t) => t.profit < 0).reduce((tot, t) => tot + t.profit, 0));
    const drawdown = maxDrawdown(data.equity);
    const winners = data.trades.filter((t) => t.profit > 0).length;
    return {
      initialCapital: data.initialCapital,
      netProfit: netPnl,
      grossProfit,
      grossLoss,
      maxDrawdown: drawdown.amount,
      finalEquity: data.initialCapital + netPnl,
      winTrades: winners,
      lossTrades: data.trades.length - winners,
      profitFactor: profitFactor(data.trades),
      winRate: data.trades.length === 0 ? 0 : winners / data.trades.length,
      totalTrades: data.trades.length,
    };
  }, [data.trades, data.equity, data.initialCapital]);

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1.5">
        <IconToggle isActive={view === "metrics"} onClick={() => setView("metrics")} title="Metrics"><ChartLine className="h-4 w-4" /></IconToggle>
        <IconToggle isActive={view === "trades"} onClick={() => setView("trades")} title="List of trades"><List className="h-4 w-4" /></IconToggle>
        <span className="mx-1 h-4 w-px bg-border" />
        <IconToggle isActive={false} onClick={onOpenSettings} title="Strategy settings"><Settings className="h-4 w-4" /></IconToggle>
        {strategyCode && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs gap-1 border-indigo-500/40 text-indigo-300 hover:bg-indigo-950/40 ml-auto"
            onClick={() => setIsAuditOpen(true)}
            title="AI Quant Strategy Auditor & Autonomous Optimizer"
          >
            <Sparkles className="h-3 w-3 text-indigo-400" /> AI Audit & Optimize
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === "trades" ? <TradeList trades={data.trades} quoteCurrency={data.currency} /> : <Metrics {...data} />}
      </div>
      <AiAuditDialog
        isOpen={isAuditOpen}
        onClose={() => setIsAuditOpen(false)}
        strategyCode={strategyCode ?? null}
        summary={summary}
        trades={data.trades}
        onApplyOptimizedCode={(code) => onApplyCode?.(code)}
      />
    </div>
  );
}

function Metrics(data: ReportData) {
  const [showBuyHold, setShowBuyHold] = useState(false);
  const points = useMemo(() => performancePoints(data), [data]);
  return (
    <div className="flex flex-col gap-8 px-5 py-4">
      <Section title="Key stats"><KeyStats {...data} /></Section>
      <Section
        title="Performance"
        action={<IconToggle isActive={showBuyHold} onClick={() => setShowBuyHold(!showBuyHold)} title="Buy and hold">Buy and hold</IconToggle>}
      >
        {points.length === 0 ? <Empty /> : <PerformanceChart points={points} showBuyHold={showBuyHold} />}
      </Section>
      <Section title="Performance analysis"><PerformanceAnalysis {...data} /></Section>
      <Section title="Trades analysis"><TradesAnalysis trades={data.trades} currency={data.currency} /></Section>
    </div>
  );
}

function KeyStats({ trades, equity, initialCapital, currency }: ReportData) {
  const netPnl = trades.reduce((total, t) => total + t.profit, 0);
  const drawdown = maxDrawdown(equity);
  const winners = trades.filter((t) => t.profit > 0).length;
  const winRate = trades.length === 0 ? 0 : (winners / trades.length) * 100;
  return (
    <StatGrid>
      <Stat label="Total PnL" value={formatMoney(netPnl, currency)} extra={formatPercent((netPnl / initialCapital) * 100)} tone={netPnl} />
      <Stat label="Max drawdown" value={formatMoney(drawdown.amount, currency)} extra={formatPercent(drawdown.percent)} />
      <Stat label="Profitable trades" value={formatPercent(winRate)} extra={`${winners}/${trades.length}`} />
      <Stat label="Profit factor" value={formatRatio(profitFactor(trades))} />
    </StatGrid>
  );
}

const TABS = ["Breakdown", "Periodical", "Benchmarking", "Growth and decline"] as const;

function PerformanceAnalysis(data: ReportData) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Breakdown");
  return (
    <div className="flex flex-col gap-6">
      <Pills options={TABS.map((t) => [t, t] as const)} value={tab} onChange={setTab} />
      {tab === "Breakdown" && <Breakdown {...data} />}
      {tab === "Periodical" && <Periodical {...data} />}
      {tab === "Benchmarking" && <Benchmarking {...data} />}
      {tab === "Growth and decline" && <GrowthAndDecline {...data} />}
    </div>
  );
}

const grossOf = (trades: readonly ReportTrade[]) => ({
  profit: trades.filter((t) => t.profit > 0).reduce((s, t) => s + t.profit, 0),
  loss: -trades.filter((t) => t.profit < 0).reduce((s, t) => s + t.profit, 0),
});

function Breakdown({ trades, initialCapital, currency }: ReportData) {
  const gross = grossOf(trades);
  const sides = [
    { label: "All signals", ...grossOf(trades) },
    { label: "Long", ...grossOf(trades.filter(isLong)) },
    { label: "Short", ...grossOf(trades.filter((t) => !isLong(t))) },
  ];
  const scale = Math.max(1e-9, ...sides.map((s) => s.profit + s.loss));
  return (
    <>
      <StatGrid>
        <Stat label="Gross profit" value={formatMoney(gross.profit, currency)} extra={formatPercent((gross.profit / initialCapital) * 100)} />
        <Stat label="Gross loss" value={formatMoney(gross.loss, currency)} extra={formatPercent((gross.loss / initialCapital) * 100)} />
        <Stat label="Profit factor" value={formatRatio(profitFactor(trades))} />
        <Stat label="Total trades" value={String(trades.length)} />
      </StatGrid>
      <SubSection title="Profits and losses">
        {sides.map((side) => (
          <div key={side.label} className="grid grid-cols-[100px_1fr_120px] items-center gap-4 text-sm">
            <span>{side.label}</span>
            <div className="flex h-1.5 justify-end overflow-hidden rounded">
              <div className="bg-[#089981]" style={{ width: `${(side.profit / scale) * 100}%` }} />
              <div className="bg-[#f23645]" style={{ width: `${(side.loss / scale) * 100}%` }} />
            </div>
            <span className={`text-right ${pnlClass(side.profit - side.loss)}`}>{formatMoney(side.profit - side.loss, currency)}</span>
          </div>
        ))}
      </SubSection>
    </>
  );
}

const PERIODS: readonly (readonly [Period, string])[] = [["day", "Daily"], ["week", "Weekly"], ["quarter", "Quarterly"], ["year", "Yearly"]];

function usePeriodPnl({ trades, equity, initialCapital }: ReportData) {
  const [period, setPeriod] = useState<Period>("day");
  const periods = useMemo(() => periodPnl(trades, equity, initialCapital, period), [trades, equity, initialCapital, period]);
  return { periods, picker: <Pills options={PERIODS} value={period} onChange={setPeriod} /> };
}

const totalReturn = (finalValue: number, initialCapital: number) => ((finalValue - initialCapital) / initialCapital) * 100;

function Periodical(data: ReportData) {
  const { periods, picker } = usePeriodPnl(data);
  const { sharpe, sortino } = riskRatios(data.equity, data.initialCapital);
  const strategyReturn = totalReturn(data.equity.at(-1)?.equity ?? data.initialCapital, data.initialCapital);
  return (
    <>
      <StatGrid>
        <Stat label="Annualized return (CAGR)" value={formatPercent(cagr(data.equity, data.initialCapital))} />
        <Stat label="Total return" value={formatPercent(strategyReturn)} tone={strategyReturn} />
        <Stat label="Sharpe ratio" value={formatRatio(sharpe)} />
        <Stat label="Sortino ratio" value={formatRatio(sortino)} />
      </StatGrid>
      <SubSection title="Realised PnL" action={picker}><PeriodBars periods={periods} withBuyHold={false} /></SubSection>
    </>
  );
}

function Benchmarking(data: ReportData) {
  const { periods, picker } = usePeriodPnl(data);
  const strategyReturn = totalReturn(data.equity.at(-1)?.equity ?? data.initialCapital, data.initialCapital);
  const holdReturn = totalReturn(buyHoldEquity(data.equity, data.initialCapital).at(-1) ?? data.initialCapital, data.initialCapital);
  return (
    <>
      <StatGrid>
        <Stat label="Strategy return" value={formatPercent(strategyReturn)} tone={strategyReturn} />
        <Stat label="Buy and hold return" value={formatPercent(holdReturn)} tone={holdReturn} />
        <Stat label="Strategy outperformance" value={formatPercent(strategyReturn - holdReturn)} tone={strategyReturn - holdReturn} />
      </StatGrid>
      <SubSection title="Strategy vs benchmark" action={picker}><PeriodBars periods={periods} withBuyHold /></SubSection>
    </>
  );
}

function GrowthAndDecline({ equity, initialCapital, currency }: ReportData) {
  const durations = drawdownPeriods(equity);
  const drawdown = maxDrawdown(equity);
  return (
    <StatGrid>
      <Stat label="Average run-up duration" value={formatDuration(durations.averageRunupMs)} />
      <Stat label="Average drawdown duration" value={formatDuration(durations.averageDrawdownMs)} />
      <Stat label="Max drawdown" value={formatMoney(drawdown.amount, currency)} extra={formatPercent(drawdown.percent)} />
      <Stat label="Max drawdown as % of initial capital" value={formatPercent((drawdown.amount / initialCapital) * 100)} />
    </StatGrid>
  );
}

const performancePoints = ({ trades, equity, initialCapital }: ReportData): PerformancePoint[] => {
  const hold = buyHoldEquity(equity, initialCapital);
  let cumulative = 0;
  return trades.map((trade) => {
    cumulative += trade.profit;
    const barIndex = equity.findIndex((point) => point.time >= trade.exitTime);
    return { label: formatDate(trade.exitTime), cumulative, trade: trade.profit, buyHold: (hold[barIndex] ?? initialCapital) - initialCapital };
  });
};
