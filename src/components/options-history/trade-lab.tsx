"use client";

import { useEffect, useMemo, useState } from "react";
import type { BookRow } from "@/lib/held-options";
import type { HistorySettings } from "@/lib/history-settings";
import { dateWindows, trackedOffsets } from "@/lib/rolling-request";
import { runLab, vixPercentileByDay, type LabRules } from "@/lib/trade-lab";
import type { EntryMode } from "@/lib/lab-entries";
import { ConditionTables, ExitStudy, SideSummary, TradeList } from "@/components/options-history/lab-tables";

const at = (hour: number, minute: number): number => hour * 60 + minute - (9 * 60 + 15);
const ENTRY_TIMES: readonly (readonly [number, string])[] = [[at(9, 20), "09:20"], [at(9, 30), "09:30"], [at(9, 45), "09:45"], [at(10, 0), "10:00"], [at(10, 30), "10:30"], [at(11, 0), "11:00"], [at(13, 0), "13:00"], [at(14, 0), "14:00"]];
const EXIT_TIMES: readonly (readonly [number, string])[] = [[at(12, 0), "12:00"], [at(14, 0), "14:00"], [at(15, 0), "15:00"], [at(15, 15), "15:15"], [at(15, 25), "15:25"]];
const TARGETS: readonly (number | undefined)[] = [undefined, 20, 30, 50, 100];
const STOPS: readonly (number | undefined)[] = [undefined, 20, 30, 50];

// Windows already read this visit, by request, so changing a rule never refetches.
const windowCache = new Map<string, Promise<BookRow[]>>();
const fetchWindow = (params: URLSearchParams): Promise<BookRow[]> => {
  const key = params.toString();
  let known = windowCache.get(key);
  if (known === undefined) {
    known = fetch(`/api/options/held?${params}`).then((r) => r.json() as Promise<{ ok: boolean; rows?: BookRow[]; error?: string }>)
      .then((b) => { if (!b.ok) throw new Error(b.error ?? "failed"); return b.rows ?? []; });
    known.catch(() => windowCache.delete(key));
    windowCache.set(key, known);
  }
  return known;
};

function Pick<T extends number | string | undefined>({ label, value, options, onChange }: { readonly label: string; readonly value: T; readonly options: readonly (readonly [T, string])[]; readonly onChange: (v: T) => void }) {
  return (
    <label className="flex items-center gap-1 text-muted-foreground">{label}
      <select value={String(value)} onChange={(e) => onChange(options.find(([v]) => String(v) === e.target.value)![0])} className="rounded border border-border bg-popover px-1.5 py-1 text-foreground">
        {options.map(([v, text]) => <option key={String(v)} value={String(v)}>{text}</option>)}
      </select>
    </label>
  );
}

/** Buys the ATM call and put every day under the chosen rules, follows each contract, and groups the results. */
// India VIX daily closes (Dhan IDX_I 21): about two years, so lab days a year back still have a year behind them.
let vixDays: Promise<Map<string, number>> | undefined;
const fetchVixPercentiles = (): Promise<Map<string, number>> =>
  (vixDays ??= fetch("/api/dhan/bars?segment=IDX_I&securityId=21&interval=1d&limit=500")
    .then((r) => r.json() as Promise<{ ok: boolean; bars?: { time: number; close: number }[] }>)
    .then((b) => vixPercentileByDay(b.ok ? b.bars ?? [] : []))
    .catch(() => { vixDays = undefined; return new Map<string, number>(); }));

const ENTRY_MODES: readonly (readonly [EntryMode, string])[] = [["time", "both sides at a fixed time"], ["orb", "on the 15-min range breakout"], ["orb-twap", "on the breakout, average price following"]];

export function TradeLab({ settings }: { readonly settings: HistorySettings }) {
  const [rules, setRules] = useState<LabRules>({ entryMinute: at(9, 30), exitMinute: at(15, 15), targetPct: undefined, stopPct: 30 });
  const [rows, setRows] = useState<readonly BookRow[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0, error: null as string | null });
  const [showTrades, setShowTrades] = useState(false);
  const [vixPercentiles, setVixPercentiles] = useState<ReadonlyMap<string, number>>(new Map());
  useEffect(() => { void fetchVixPercentiles().then(setVixPercentiles); }, []);
  const { underlying: u, expiryFlag, expiryCode, from, to } = settings;
  const base = useMemo(() => new URLSearchParams({ segment: u.segment, securityId: String(u.securityId), instrument: u.instrument, expiryFlag, expiryCode: String(expiryCode) }).toString(), [u, expiryFlag, expiryCode]);

  useEffect(() => {
    const windows = dateWindows(from, to);
    let cancelled = false;
    setRows([]);
    setProgress({ done: 0, total: windows.length, error: null });
    void (async () => {
      const collected: BookRow[] = [];
      for (const [i, w] of windows.entries()) {
        try {
          const params = new URLSearchParams(base);
          params.set("from", w.from);
          params.set("to", w.to);
          collected.push(...await fetchWindow(params));
        } catch (err) {
          if (!cancelled) setProgress((p) => ({ ...p, error: err instanceof Error ? err.message : String(err) }));
          return;
        }
        if (cancelled) return;
        setRows([...collected]);
        setProgress((p) => ({ ...p, done: i + 1 }));
      }
    })();
    return () => { cancelled = true; };
  }, [base, from, to]);

  const lab = useMemo(() => (rows.length === 0 ? undefined : runLab(rows, rules, { vixPercentiles })), [rows, rules, vixPercentiles]);
  const isLoading = progress.done < progress.total && progress.error === null;
  const reach = trackedOffsets({ instrument: u.instrument, expiryCode });

  return (
    <div className="space-y-3">
      <section className="flex flex-wrap items-center gap-3 rounded border border-border bg-popover/30 p-2">
        <span className="font-semibold">Buy ATM</span>
        <Pick label="" value={rules.entry ?? "time"} options={ENTRY_MODES} onChange={(entry) => setRules((r) => ({ ...r, entry }))} />
        {(rules.entry ?? "time") === "time" && <Pick label="at" value={rules.entryMinute} options={ENTRY_TIMES} onChange={(entryMinute) => setRules((r) => ({ ...r, entryMinute }))} />}
        <Pick label="Target" value={rules.targetPct} options={TARGETS.map((t) => [t, t === undefined ? "none" : `+${t}%`] as const)} onChange={(targetPct) => setRules((r) => ({ ...r, targetPct }))} />
        <Pick label="Stop" value={rules.stopPct} options={STOPS.map((s) => [s, s === undefined ? "none" : `−${s}%`] as const)} onChange={(stopPct) => setRules((r) => ({ ...r, stopPct }))} />
        <Pick label="Exit by" value={rules.exitMinute} options={EXIT_TIMES} onChange={(exitMinute) => setRules((r) => ({ ...r, exitMinute }))} />
        <div className="ml-auto flex min-w-48 items-center gap-2">
          {progress.total > 0 && (isLoading || progress.error) && (
            <div className="h-1.5 flex-1 overflow-hidden rounded bg-muted" role="progressbar" aria-valuenow={progress.done} aria-valuemax={progress.total} title={`${progress.done} of ${progress.total} date windows`}>
              <div className="h-full bg-[#2962ff] transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
          )}
          {progress.error && <span className="text-[11px] text-down" title={progress.error}>Failed</span>}
        </div>
      </section>

      {!lab && isLoading && <p className="text-muted-foreground">Fetching ±{reach} strikes around the money for each day so every bought contract can be followed. The first time takes about 10 s per two days; after that it is instant.</p>}
      {lab && (
        <>
          <div className="grid gap-3 xl:grid-cols-2"><SideSummary report={lab.ce} /><SideSummary report={lab.pe} /></div>
          <section className="space-y-2 data-card">
            <h2 className="data-card-title">Known at entry <span className="font-normal text-muted-foreground">: what could have been checked before buying</span></h2>
            <ConditionTables ce={lab.ce} pe={lab.pe} kind="entry" />
          </section>
          <section className="space-y-2 data-card">
            <h2 className="data-card-title">Known after the day <span className="font-normal text-muted-foreground">: how long options fared in each kind of day</span></h2>
            <ConditionTables ce={lab.ce} pe={lab.pe} kind="after" />
          </section>
          <section className="data-card">
            <h2 className="data-card-title">Exit study <span className="font-normal text-muted-foreground">: the same entries replayed with each target and stop</span></h2>
            <div className="grid gap-4 xl:grid-cols-2"><ExitStudy report={lab.ce} targetPct={rules.targetPct} stopPct={rules.stopPct} /><ExitStudy report={lab.pe} targetPct={rules.targetPct} stopPct={rules.stopPct} /></div>
          </section>
          <section className="data-card">
            <button type="button" onClick={() => setShowTrades((v) => !v)} className="font-semibold hover:underline">{showTrades ? "▾" : "▸"} Every trade ({lab.ce.trades.length + lab.pe.trades.length})</button>
            {showTrades && <div className="mt-2 grid gap-4 xl:grid-cols-2"><TradeList trades={lab.ce.trades} /><TradeList trades={lab.pe.trades} /></div>}
          </section>
          <p className="text-[10px] text-muted-foreground">
            {lab.days} days{isLoading ? " so far" : ""}. {(rules.entry ?? "time") === "time" ? "Each day buys the at-the-money call and put at the entry time" : "Each day buys at most one side: the at-the-money call or put on the bar after the first close beyond the 09:15–09:30 range, until 14:00"} and follows that exact contract (±{reach} strikes are fetched; a contract that drifts beyond them exits at its last price, &quot;lost track&quot;).
            Stops are checked on bar lows before targets on bar highs, so a bar that touched both counts as stopped. Returns are net of 0.25% slippage each way, as in the trading bot&apos;s paper venue; brokerage and taxes are not included.
            A verdict is Positive or Negative only when the 95% range of the average return clears zero over at least 8 trades; anything else is Unclear or Too few trades. Every row here is one of many tried, so even a Positive one is a lead to test in the bot&apos;s replay, not an edge. Not advice.
          </p>
        </>
      )}
    </div>
  );
}
