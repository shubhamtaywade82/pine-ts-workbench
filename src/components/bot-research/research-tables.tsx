import { ONE_DAY_SHARE } from "@/lib/lab-stats";
import type { Cell } from "@/lib/bot-analysis";

const UP = "var(--up)";
const DOWN = "var(--down)";
const VERDICT_TONE: Record<Cell["verdict"], string> = { Positive: UP, Negative: DOWN, Unclear: "var(--warn)", "Too few trades": "var(--muted-foreground)" };
const tone = (value: number): string => (value > 0 ? UP : value < 0 ? DOWN : "var(--foreground)");
const signed = (value: number, digits = 2): string => {
  const text = value.toFixed(digits);
  return Number(text) === 0 ? (0).toFixed(digits) : `${value > 0 ? "+" : ""}${text}`;
};
/** The bot's own verdict strings, toned like the lab's verdicts. */
function BotVerdict({ verdict }: { readonly verdict: string | undefined }) {
  if (verdict === undefined) return <span className="text-muted-foreground">—</span>;
  const colour = verdict === "EDGE_SUPPORTED" ? UP : verdict === "NO_TRADE" ? DOWN : "var(--warn)";
  return <span className="tone-pill" style={{ color: colour }}>{verdict.replaceAll("_", " ").toLowerCase()}</span>;
}

const inr = (value: number): string => `${value < 0 ? "−" : ""}₹${Math.abs(Math.round(value)).toLocaleString("en-IN")}`;

const evidence = (c: Cell, comparisons: number): string => [
  c.meanRCi === undefined ? "Too few trades for an interval." : `Mean R range: ${signed(c.meanRCi.low)} to ${signed(c.meanRCi.high)} (widened for ${comparisons} rows compared).`,
  `Win rate ${c.winRate.toFixed(0)}% (95% range ${c.winRateCi.low.toFixed(0)}–${c.winRateCi.high.toFixed(0)}%).`,
  c.bestDayShare === undefined ? "" : `Best single day carried ${(c.bestDayShare * 100).toFixed(0)}% of the gains.`,
].filter(Boolean).join(" ");

/** One dimension's groups with their verdicts; the interval behind each verdict is on hover. */
export function CellTable({ cells }: { readonly cells: readonly Cell[] }) {
  return (
    <table className="data-table text-right">
      <thead className="text-muted-foreground">
        <tr>
          <th className="text-left font-medium">Group</th>
          <th className="text-left font-medium" title="Positive or Negative only when the mean-R range clears zero with at least 8 trades; the range widens with the number of rows, so more slicing needs more evidence">Read</th>
          <th className="font-medium">Trades</th><th className="font-medium">Days</th><th className="font-medium">Won</th>
          <th className="font-medium" title="Average result per unit of risk taken">Mean R</th><th className="font-medium">Total R</th><th className="font-medium">Net P&amp;L</th>
        </tr>
      </thead>
      <tbody>
        {cells.map((c) => (
          // Groups too small to judge are dimmed, and the total row is set apart, so the eye lands on rows that can carry a verdict.
          <tr key={c.key} className={`${c.verdict === "Too few trades" ? "opacity-55" : ""} ${c.key === "All trades" ? "font-semibold [&>td]:border-b [&>td]:border-panel-border" : ""}`}>
            <td className="text-left">{c.key}</td>
            <td className="text-left">
              <span className="tone-pill" style={{ color: VERDICT_TONE[c.verdict] }} title={evidence(c, cells.length)}>
                {c.verdict}{c.verdict === "Positive" && (c.bestDayShare ?? 0) > ONE_DAY_SHARE ? " (one day)" : ""}
              </span>
            </td>
            <td>{c.trades}</td><td>{c.days}</td>
            <td>{c.winRate.toFixed(0)}%</td>
            <td style={{ color: tone(c.meanR) }}>{signed(c.meanR)}</td>
            <td style={{ color: tone(c.totalR) }}>{signed(c.totalR, 1)}</td>
            <td style={{ color: tone(c.totalPnlInr) }}>{inr(c.totalPnlInr)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface Experiment {
  readonly seq: number; readonly created: string; readonly strategy: string; readonly underlying: string; readonly range?: string;
  readonly type: string; readonly holdout: string; readonly cells: number; readonly variants: number;
  readonly result?: { readonly cells_passed?: number; readonly verdict_at_0_25_percent_half_spread?: string; readonly verdict_at_one_percent_half_spread?: string; readonly note?: string };
}

/** The bot's own research ledger: what was tested, how many ways, and whether it survived costs. */
export function LedgerTable({ experiments }: { readonly experiments: readonly Experiment[] }) {
  return (
    <table className="data-table text-left">
      <thead className="text-muted-foreground">
        <tr><th className="font-medium">#</th><th className="font-medium">Tested</th><th className="font-medium">Kind</th><th className="font-medium" title="Contexts sliced × parameter variants tried: the more tried, the more a lucky pass is expected">Cells × variants</th><th className="font-medium">Passed</th><th className="font-medium">At 0.25% spread</th><th className="font-medium">At 1% spread</th><th className="font-medium">Note</th></tr>
      </thead>
      <tbody>
        {experiments.map((e) => (
          <tr key={e.seq} className="align-top">
            <td>{e.seq}</td><td>{e.strategy} · {e.underlying}{e.range ? ` · ${e.range}` : ""}</td>
            <td>{e.type}{e.holdout === "NotHoldout" ? "" : ` · ${e.holdout}`}</td><td>{e.cells} × {e.variants}</td>
            <td>{e.result?.cells_passed ?? "—"}</td>
            <td><BotVerdict verdict={e.result?.verdict_at_0_25_percent_half_spread} /></td>
            <td><BotVerdict verdict={e.result?.verdict_at_one_percent_half_spread} /></td>
            <td className="text-muted-foreground">{e.result?.note ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface Run { readonly ts: string; readonly data: string; readonly costs?: { readonly halfSpreadPct?: number }; readonly trades: number; readonly meanR: number; readonly verdict: string }

/** Time Machine replays as the bot logged them. */
export function RunsTable({ runs }: { readonly runs: readonly Run[] }) {
  return (
    <table className="data-table text-right">
      <thead className="text-muted-foreground"><tr><th className="text-left font-medium">When</th><th className="text-left font-medium">Data</th><th className="font-medium">Half spread</th><th className="font-medium">Trades</th><th className="font-medium">Mean R</th><th className="text-left font-medium">Verdict</th></tr></thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.ts}>
            <td className="text-left">{r.ts.slice(0, 16).replace("T", " ")}</td><td className="text-left">{r.data.split("/").at(-1)}</td>
            <td>{r.costs?.halfSpreadPct ?? "—"}%</td><td>{r.trades}</td>
            <td style={{ color: tone(r.meanR) }}>{signed(r.meanR, 3)}</td><td className="text-left"><BotVerdict verdict={r.verdict} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
