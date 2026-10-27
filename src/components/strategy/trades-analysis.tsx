"use client";

import { usePersistedState } from "@/hooks/use-persisted-state";
import { returnHistogram, streaks, timePatterns, tradeReturnPercent, type ReportTrade } from "@/lib/backtest-report";
import { PatternBars, ReturnsHistogram, TradesDonut } from "@/components/strategy/report-charts";
import { formatMoney, formatPercent } from "@/components/strategy/report-format";
import { Empty, Pills, Stat, StatGrid, SubSection } from "@/components/strategy/report-ui";

const TABS = ["Distribution", "Streaks", "Time patterns"] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const average = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

/** "Trades analysis": distribution, streaks and time patterns of closed trades. */
export function TradesAnalysis({ trades, currency }: { trades: readonly ReportTrade[]; currency: string }) {
  const [tab, setTab] = usePersistedState<(typeof TABS)[number]>("tester-trades-tab", "Distribution");
  return (
    <div className="flex flex-col gap-6">
      <Pills options={TABS.map((t) => [t, t] as const)} value={tab} onChange={setTab} />
      {tab === "Distribution" && <Distribution trades={trades} currency={currency} />}
      {tab === "Streaks" && <Streaks trades={trades} />}
      {tab === "Time patterns" && <TimePatterns trades={trades} />}
    </div>
  );
}

function Distribution({ trades, currency }: { trades: readonly ReportTrade[]; currency: string }) {
  const profits = trades.map((t) => t.profit);
  const returns = trades.map(tradeReturnPercent);
  const bins = returnHistogram(trades).map((b) => ({ label: `${b.from.toFixed(2)}%`, winners: b.winners, losers: b.losers }));
  const count = (keep: (profit: number) => boolean) => profits.filter(keep).length;
  return (
    <>
      <StatGrid>
        <Stat label="Expectancy" value={formatMoney(average(profits), currency)} extra={formatPercent(average(returns))} tone={average(profits)} />
        <Stat label="Average win" value={formatPercent(average(returns.filter((r) => r > 0)))} />
        <Stat label="Largest profit" value={formatMoney(Math.max(0, ...profits), currency)} />
        <Stat label="Largest loss" value={formatMoney(Math.min(0, ...profits), currency)} />
      </StatGrid>
      <div className="grid gap-8 lg:grid-cols-2">
        <SubSection title="Returns distribution">{bins.length === 0 ? <Empty /> : <ReturnsHistogram bins={bins} />}</SubSection>
        <SubSection title="Trades distribution">
          <TradesDonut winners={count((p) => p > 0)} losers={count((p) => p < 0)} breakevens={count((p) => p === 0)} />
        </SubSection>
      </div>
    </>
  );
}

function Streaks({ trades }: { trades: readonly ReportTrade[] }) {
  const runs = streaks(trades);
  return (
    <StatGrid>
      <Stat label="Longest winning streak" value={`${runs.wins} trades`} />
      <Stat label="Longest losing streak" value={`${runs.losses} trades`} />
    </StatGrid>
  );
}

function TimePatterns({ trades }: { trades: readonly ReportTrade[] }) {
  const { byWeekday, byHour } = timePatterns(trades);
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <SubSection title="PnL by entry weekday (UTC)">
        <PatternBars data={byWeekday.map((pnl, i) => ({ label: WEEKDAYS[i]!, pnl }))} />
      </SubSection>
      <SubSection title="PnL by entry hour (UTC)">
        <PatternBars data={byHour.map((pnl, i) => ({ label: String(i), pnl }))} />
      </SubSection>
    </div>
  );
}
