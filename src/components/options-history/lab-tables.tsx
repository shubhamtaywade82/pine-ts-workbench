import { ONE_DAY_SHARE } from "@/lib/lab-stats";
import type { LabTrade, LevelResult, SideReport, Stats } from "@/lib/trade-lab";

const UP = "var(--up)";
const DOWN = "var(--down)";
const signed = (value: number, digits = 1): string => {
  const text = value.toFixed(digits);
  // A value that rounds to zero prints as 0.0, not "-0.0" or "+0.0".
  return Number(text) === 0 ? (0).toFixed(digits) : `${value > 0 ? "+" : ""}${text}`;
};
const tone = (value: number): string => (value > 0 ? UP : value < 0 ? DOWN : "var(--foreground)");
const minutes = (value: number): string => (value >= 60 ? `${Math.floor(value / 60)}h ${Math.round(value % 60)}m` : `${Math.round(value)}m`);
const clock = (time: number): string => new Date(time + 19_800_000).toISOString().slice(11, 16);
const SIDE_NAME = { CE: "Long CE (call)", PE: "Long PE (put)" } as const;

const VERDICT_TONE: Record<Stats["verdict"], string> = { Positive: UP, Negative: DOWN, Unclear: "var(--warn)", "Too few trades": "var(--muted-foreground)" };

/** The interval, breakeven and concentration behind a verdict, in words. */
const evidence = (s: Stats): string => [
  s.avgReturnCi === undefined ? "Too few trades for an interval." : `Average return 95% range: ${signed(s.avgReturnCi.low)}% to ${signed(s.avgReturnCi.high)}%.`,
  `Win rate ${s.winRate.toFixed(0)}% (95% range ${s.winRateCi.low.toFixed(0)}–${s.winRateCi.high.toFixed(0)}%).`,
  s.breakevenWinRate === undefined ? "" : `Breakeven win rate at these win/loss sizes: ${s.breakevenWinRate.toFixed(0)}%.`,
  s.bestDayShare === undefined ? "" : `Best single day carried ${(s.bestDayShare * 100).toFixed(0)}% of all gains.`,
].filter(Boolean).join(" ");

/** The verdict, flagged when one day carries the result. */
export function Verdict({ stats }: { readonly stats: Stats }) {
  const oneDay = stats.verdict === "Positive" && (stats.bestDayShare ?? 0) > ONE_DAY_SHARE;
  return <span className="tone-pill" style={{ color: VERDICT_TONE[stats.verdict] }} title={evidence(stats)}>{stats.verdict}{oneDay ? " (one day)" : ""}</span>;
}

/** Rows too small to judge fade back, so the eye lands on the ones that can carry a verdict. */
const dimmed = (stats: Stats): string => (stats.verdict === "Too few trades" ? "opacity-55" : "");

function StatCells({ stats }: { readonly stats: Stats }) {
  return (
    <>
      <td className="text-left"><Verdict stats={stats} /></td>
      <td>{stats.trades}</td>
      <td>{stats.winRate.toFixed(0)}%</td>
      <td className="font-medium" style={{ color: tone(stats.avgReturn) }}>{signed(stats.avgReturn)}%</td>
      <td className="text-muted-foreground">{signed(stats.avgMfe)}%</td>
      <td className="text-muted-foreground">{signed(stats.avgMae)}%</td>
    </>
  );
}

const STAT_HEADERS = (
  <>
    <th className="text-left font-medium" title="Positive or Negative only when the 95% range of the average return clears zero with at least 8 trades; hover a verdict for the numbers">Read</th>
    <th className="font-medium">Trades</th><th className="font-medium">Won</th><th className="font-medium">Avg return</th>
    <th className="font-medium" title="Average best gain reached while held">Best on the way</th><th className="font-medium" title="Average worst drawdown while held">Worst on the way</th>
  </>
);

export function SideSummary({ report }: { readonly report: SideReport }) {
  const s = report.summary;
  const items: readonly (readonly [string, string, string?, string?])[] = [
    ["Trades", String(s.trades)],
    ["Won", `${s.winRate.toFixed(0)}%`],
    ["Avg return", `${signed(s.avgReturn)}%`, tone(s.avgReturn)],
    ["Avg best on the way", `${signed(s.avgMfe)}%`, undefined, "The average peak gain while held: what was available to take"],
    ["Avg worst on the way", `${signed(s.avgMae)}%`, undefined, "The average drawdown a holder had to sit through"],
    ["Avg time to the peak", minutes(s.avgMinutesToPeak), undefined, "From entry to the best price: after this, holding mostly gave gains back"],
  ];
  return (
    <section className="data-card border-l-4" style={{ borderLeftColor: report.side === "CE" ? UP : DOWN }}>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold" style={{ color: report.side === "CE" ? UP : DOWN }}>{SIDE_NAME[report.side]}</h3>
        <span className="text-[11px]">
          <Verdict stats={s} />
          <span className="ml-2 text-muted-foreground">{s.avgReturnCi === undefined ? "" : `avg return 95% range ${signed(s.avgReturnCi.low)}% to ${signed(s.avgReturnCi.high)}%`}</span>
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 xl:grid-cols-6">
        {items.map(([label, value, colour, hint]) => (
          <div key={label} title={hint}><div className="text-muted-foreground">{label}</div><div className="text-base font-semibold tabular-nums" style={{ color: colour }}>{value}</div></div>
        ))}
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <Callouts title="Entry conditions that helped" items={report.favoured} empty="None stood out with enough trades." colour={UP} />
        <Callouts title="Entry conditions that hurt" items={report.avoided} empty="None stood out with enough trades." colour={DOWN} />
      </div>
    </section>
  );
}

function Callouts({ title, items, empty, colour }: { readonly title: string; readonly items: SideReport["favoured"]; readonly empty: string; readonly colour: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{title}</div>
      {items.length === 0 ? <p className="text-muted-foreground">{empty}</p> : (
        <ul className="space-y-0.5">
          {items.map((h) => <li key={`${h.factor}${h.value}`}><span style={{ color: colour }}>{signed(h.stats.avgReturn)}%</span> {h.factor}: <strong>{h.value}</strong> <span className="text-muted-foreground">({h.stats.trades} trades, {h.stats.winRate.toFixed(0)}% won) · </span><Verdict stats={h.stats} /></li>)}
        </ul>
      )}
    </div>
  );
}

/** One table per condition, with the call and put side by side. */
export function ConditionTables({ ce, pe, kind }: { readonly ce: SideReport; readonly pe: SideReport; readonly kind: "entry" | "after" }) {
  return (
    <div className="grid items-start gap-3 xl:grid-cols-2">
      {ce.byFactor.filter((f) => f.kind === kind).map((factor) => {
        const putGroups = pe.byFactor.find((f) => f.factor === factor.factor)!.groups;
        const values = [...new Set([...factor.groups, ...putGroups].map((g) => g.value))];
        return (
          <table key={factor.factor} className="data-table text-right text-[11px]">
            <thead className="text-muted-foreground">
              <tr><th className="py-1 text-left font-semibold text-foreground">{factor.factor}</th><th />{STAT_HEADERS}</tr>
            </thead>
            <tbody>
              {values.flatMap((value) => (["CE", "PE"] as const).flatMap((side) => {
                const stats = (side === "CE" ? factor.groups : putGroups).find((g) => g.value === value)?.stats;
                return stats === undefined ? [] : [{ side, stats }];
              }).map(({ side, stats }, i) => (
                  <tr key={`${value}${side}`} className={`${i === 0 ? "[&>td]:border-t [&>td]:border-panel-border" : ""} ${dimmed(stats)}`}>
                    <td className="py-0.5 text-left">{i === 0 ? value : ""}</td>
                    <td className="text-left" style={{ color: side === "CE" ? UP : DOWN }}>{side}</td>
                    <StatCells stats={stats} />
                  </tr>
              )))}
            </tbody>
          </table>
        );
      })}
    </div>
  );
}

function LevelTable({ title, levels, chosen, none }: { readonly title: string; readonly levels: readonly LevelResult[]; readonly chosen: number | undefined; readonly none: string }) {
  const best = levels.reduce((b, l) => (l.stats.avgReturn > b.stats.avgReturn ? l : b), levels[0]!);
  return (
    <table className="data-table text-right text-[11px]">
      <thead className="text-muted-foreground"><tr><th className="py-1 text-left font-medium">{title}</th>{STAT_HEADERS}</tr></thead>
      <tbody>
        {levels.map((l) => (
          <tr key={String(l.level)} className={`${l.level === chosen ? "bg-[#2962ff]/15" : ""} ${dimmed(l.stats)}`}>
            <td className="py-0.5 text-left">{l.level === undefined ? none : `${l.level}%`}{l === best && <span className="ml-1 text-warn">★ best here</span>}</td>
            <StatCells stats={l.stats} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The same days replayed with each target and each stop, to see which exit actually paid. */
export function ExitStudy({ report, targetPct, stopPct }: { readonly report: SideReport; readonly targetPct: number | undefined; readonly stopPct: number | undefined }) {
  return (
    <div className="space-y-2">
      <h3 className="font-semibold" style={{ color: report.side === "CE" ? UP : DOWN }}>{SIDE_NAME[report.side]}</h3>
      <LevelTable title="Take profit at" levels={report.targets} chosen={targetPct} none="No target (hold to time exit)" />
      <LevelTable title="Stop loss at" levels={report.stops} chosen={stopPct} none="No stop" />
    </div>
  );
}

export function TradeList({ trades }: { readonly trades: readonly LabTrade[] }) {
  return (
    <table className="data-table text-right text-[11px]">
      <thead className="text-muted-foreground">
        <tr><th className="py-1 text-left font-medium">Date</th><th className="text-left font-medium">Contract</th><th className="font-medium">Entry</th><th className="font-medium">Exit</th><th className="font-medium">Return</th><th className="text-left font-medium">Why it exited</th><th className="font-medium">Best</th><th className="font-medium">Worst</th><th className="font-medium">Peak after</th></tr>
      </thead>
      <tbody>
        {[...trades].reverse().map((t) => (
          <tr key={`${t.date}${t.side}`}>
            <td className="py-0.5 text-left">{t.date}</td>
            <td className="text-left" style={{ color: t.side === "CE" ? UP : DOWN }}>{t.strike} {t.side}</td>
            <td>{clock(t.entryTime)} @ {t.entryPrice.toFixed(1)}</td>
            <td>{clock(t.exitTime)} @ {t.exitPrice.toFixed(1)}</td>
            <td style={{ color: tone(t.returnPct) }}>{signed(t.returnPct)}%</td>
            <td className="text-left text-muted-foreground">{t.exitReason}</td>
            <td className="text-muted-foreground">{signed(t.mfePct)}%</td>
            <td className="text-muted-foreground">{signed(t.maePct)}%</td>
            <td>{minutes(t.minutesToPeak)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
