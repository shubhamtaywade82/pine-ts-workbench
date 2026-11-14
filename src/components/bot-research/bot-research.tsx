"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { breakdown, cellOf, cumulativeR, DIMENSIONS, parseReplayCsv, type BotTrade } from "@/lib/bot-analysis";
import { loadWorkspace } from "@/lib/saved-layouts";
import { LineChart } from "@/components/options-history/history-charts";
import { CellTable, LedgerTable, RunsTable, type Experiment, type Run } from "@/components/bot-research/research-tables";

interface Research { readonly trades: readonly BotTrade[]; readonly experiments: readonly Experiment[]; readonly runs: readonly Run[] }
type Source = { readonly kind: "paper" } | { readonly kind: "replay"; readonly name: string; readonly trades: readonly BotTrade[] };

/** What the options-trading-agent's trades say worked, judged with the same honesty rules as the lab. */
export function BotResearch() {
  const [research, setResearch] = useState<Research | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<Source>({ kind: "paper" });
  const [dimension, setDimension] = useState(DIMENSIONS[0]![0]);

  useEffect(() => {
    void fetch("/api/bot/research").then((r) => r.json() as Promise<{ ok: boolean; error?: string } & Partial<Research>>)
      .then((body) => (body.ok ? setResearch({ trades: body.trades ?? [], experiments: body.experiments ?? [], runs: body.runs ?? [] }) : setError(body.error ?? "failed")))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);
  useEffect(() => { document.documentElement.classList.toggle("dark", (loadWorkspace()?.theme ?? "dark") === "dark"); }, []);

  const trades = source.kind === "replay" ? source.trades : research?.trades ?? [];
  const keyOf = DIMENSIONS.find(([name]) => name === dimension)![1];
  const cells = useMemo(() => breakdown(trades, keyOf), [trades, keyOf]);
  const overall = useMemo(() => cellOf("All trades", trades), [trades]);
  const curve = useMemo(() => cumulativeR(trades), [trades]);

  const loadCsv = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    const underlying = /BANKNIFTY|SENSEX|NIFTY/.exec(file.name)?.[0] ?? "?";
    setSource({ kind: "replay", name: file.name, trades: parseReplayCsv(await file.text(), underlying) });
  };

  return (
    <div className="min-h-screen bg-background p-4 text-[12px] text-foreground">
      <div className="w-full space-y-4">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold">Bot research: what works</h1>
            <p className="text-muted-foreground">The options-trading-agent&apos;s trades split by strategy and context, with a verdict only where the evidence clears zero.</p>
          </div>
          <Link href="/" className="text-[#2962ff] hover:underline">← Back to charts</Link>
        </header>
        {error && <p className="rounded border border-down p-2 text-down">{error}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setSource({ kind: "paper" })} className={`rounded border px-2 py-1 ${source.kind === "paper" ? "border-[#2962ff]" : "border-border text-muted-foreground"}`}>Paper trades (journal)</button>
          <label className={`cursor-pointer rounded border px-2 py-1 ${source.kind === "replay" ? "border-[#2962ff]" : "border-border text-muted-foreground"}`}>
            {source.kind === "replay" ? `Replay: ${source.name}` : "Load a Time Machine trades CSV…"}
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void loadCsv(e.target.files?.[0])} />
          </label>
          <select value={dimension} onChange={(e) => setDimension(e.target.value)} className="rounded border border-border bg-background px-2 py-1">
            {DIMENSIONS.map(([name]) => <option key={name}>{name}</option>)}
          </select>
        </div>

        {trades.length === 0 ? <p className="text-muted-foreground">{research === null && error === null ? "Loading…" : "No trades in this source."}</p> : (
          <div className="grid items-start gap-4 xl:grid-cols-2">
            <section className="data-card"><h2 className="data-card-title">By {dimension.toLowerCase()}</h2><CellTable cells={[overall, ...cells]} /></section>
            <section className="data-card"><h2 className="data-card-title">Cumulative R, trade by trade</h2><LineChart series={[{ label: "Total R", colour: "#2962ff", values: curve }]} labels={trades.map((t) => t.date)} zeroLine /></section>
          </div>
        )}

        {research !== null && research.experiments.length > 0 && <section className="data-card"><h2 className="data-card-title">Research ledger</h2><LedgerTable experiments={research.experiments} /></section>}
        {research !== null && research.runs.length > 0 && <section className="data-card"><h2 className="data-card-title">Replay runs</h2><RunsTable runs={research.runs} /></section>}

        <p className="text-[10px] text-muted-foreground">
          R is each trade&apos;s result over the risk it was sized for. Paper trades are few, so most groups read Unclear; that is the honest answer, not a fault.
          Replay CSV: <code>npm run timemachine -- run --data … --config config.paper.yml --trades out.csv</code> in the bot repo. A replay has no days-to-expiry column, so that split reads Unknown.
        </p>
      </div>
    </div>
  );
}
