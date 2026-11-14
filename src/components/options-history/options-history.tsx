"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { byWeekday, dayStats, groupByDay, groupOf, intradayProfile, IST_OFFSET_MS, type RollingRow } from "@/lib/rolling-options";
import { loadWorkspace } from "@/lib/saved-layouts";
import { spotSegmentOf, type Underlying } from "@/lib/option-underlyings";
import { effectiveInterval, fromQuery, normalize, toQuery, type HistorySettings } from "@/lib/history-settings";
import { HistoryControls } from "@/components/options-history/history-controls";
import { TradeLab } from "@/components/options-history/trade-lab";
import { byDaysToExpiry, ivReaction, ivVsRealized, measureSensitivity, realizedVolatility, type DailyBar } from "@/lib/option-behavior";
import { DteTable, SensitivityCards, UnderlyingChart, VolatilityFacts } from "@/components/options-history/behavior-charts";
import { DayDetail, DayTable, ProfileChart, SummaryCards, WeekdayTable } from "@/components/options-history/history-charts";

const istDate = (ms: number): string => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
/** Wait for a burst of changes to settle before loading, so clicking through options costs one request. */
const LOAD_DEBOUNCE_MS = 350;

/** A year of daily bars is enough for the realized-volatility line and the context around the loaded range. */
const UNDERLYING_DAYS = 260;
type Tab = "overview" | "volatility" | "sensitivity" | "lab" | "days";
const TABS: readonly (readonly [Tab, string])[] = [
  ["overview", "Overview"], ["volatility", "Underlying & volatility"], ["sensitivity", "Sensitivity & expiry cycle"], ["lab", "Long CE/PE lab"], ["days", "Days"],
];
// The underlying's history does not depend on the date range, so it is fetched once per instrument per visit.
const dailyCache = new Map<string, Promise<DailyBar[]>>();
const fetchDaily = (u: Underlying): Promise<DailyBar[]> => {
  const params = new URLSearchParams({ segment: spotSegmentOf(u), securityId: String(u.securityId), interval: "1d", limit: String(UNDERLYING_DAYS) });
  const key = params.toString();
  let known = dailyCache.get(key);
  if (known === undefined) {
    known = fetch(`/api/dhan/bars?${params}`).then((r) => r.json() as Promise<{ ok: boolean; bars?: DailyBar[] }>).then((b) => (b.ok ? b.bars ?? [] : []))
      .catch(() => { dailyCache.delete(key); return []; });
    dailyCache.set(key, known);
  }
  return known;
};

/** Expired option history for buyers: did days move more than their options priced, and how premium behaved. */
export function OptionsHistory({ query }: { readonly query: Readonly<Record<string, string | undefined>> }) {
  const today = istDate(Date.now());
  const [settings, setSettings] = useState<HistorySettings>(() => fromQuery(query, today));
  const [rows, setRows] = useState<readonly RollingRow[]>([]);
  const [status, setStatus] = useState<{ readonly loading: boolean; readonly error: string | null; readonly loaded: string | null }>({ loading: false, error: null, loaded: null });
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("overview");
  const [daily, setDaily] = useState<readonly DailyBar[]>([]);
  const [loadedRange, setLoadedRange] = useState<{ from: string; to: string }>({ from: settings.from, to: settings.to });
  const [retries, setRetries] = useState(0);
  const update = (next: Partial<HistorySettings>): void => setSettings((prev) => normalize({ ...prev, ...next }, today));
  const interval = effectiveInterval(settings);
  const { underlying: u, expiryFlag, expiryCode, width, from, to } = settings;
  const request = new URLSearchParams({ segment: u.segment, securityId: String(u.securityId), instrument: u.instrument, expiryFlag, expiryCode: String(expiryCode), width: String(width), interval, from, to }).toString();

  // Any change loads by itself, once the clicks settle; the previous request is dropped, and the URL follows.
  useEffect(() => {
    window.history.replaceState(null, "", `?${toQuery(settings)}`);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setStatus((prev) => ({ ...prev, loading: true, error: null }));
      void fetchDaily(u).then((bars) => { if (!controller.signal.aborted) setDaily(bars); });
      void fetch(`/api/options/rolling?${request}`, { signal: controller.signal })
        .then((res) => res.json() as Promise<{ ok: boolean; rows?: RollingRow[]; error?: string }>)
        .then((body) => {
          if (!body.ok) { setStatus({ loading: false, error: body.error ?? "failed", loaded: null }); return; }
          setRows(body.rows ?? []);
          setSelected(undefined);
          setLoadedRange({ from, to });
          setStatus({ loading: false, error: null, loaded: `${u.name} ${expiryFlag === "WEEK" ? "weekly" : "monthly"} · ${["", "near", "next", "far"][expiryCode]} expiry · ${width === 0 ? "ATM straddle" : `strangle ±${width}`} · ${interval}m` });
        })
        .catch((err: unknown) => { if (!controller.signal.aborted) setStatus({ loading: false, error: err instanceof Error ? err.message : String(err), loaded: null }); });
    }, LOAD_DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [request, retries]);

  // Same theme as the charts, which keep it in the saved workspace; dark when nothing is saved.
  useEffect(() => { document.documentElement.classList.toggle("dark", (loadWorkspace()?.theme ?? "dark") === "dark"); }, []);

  const days = useMemo(() => dayStats(rows), [rows]);
  const group = useMemo(() => groupOf(days.filter((d) => !d.isExpiryDay)), [days]);
  const expiryGroup = useMemo(() => groupOf(days.filter((d) => d.isExpiryDay)), [days]);
  const weekdays = useMemo(() => byWeekday(days), [days]);
  const profile = useMemo(() => intradayProfile(rows), [rows]);
  const expiryDates = useMemo(() => new Set(days.filter((d) => d.isExpiryDay).map((d) => d.date)), [days]);
  const rv = useMemo(() => realizedVolatility(daily), [daily]);
  const ivRv = useMemo(() => ivVsRealized(days, rv), [days, rv]);
  const reaction = useMemo(() => ivReaction(days), [days]);
  const sensitivity = useMemo(() => measureSensitivity(rows, expiryDates), [rows, expiryDates]);
  const cycle = useMemo(() => byDaysToExpiry(days), [days]);
  const selectedDate = selected ?? days.at(-1)?.date;
  const dayRows = useMemo(() => groupByDay(rows).find((d) => d[0] !== undefined && istDate(d[0].time) === selectedDate) ?? [], [rows, selectedDate]);
  const { underlying } = settings;

  return (
    <div className="min-h-screen bg-background p-4 text-[12px] text-foreground">
      <div className="w-full space-y-4">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold">Expired options history</h1>
            <p className="text-muted-foreground">How at-the-money options behaved on past days: did the market move more than they priced, and how fast did premium decay.</p>
          </div>
          <span className="flex gap-4">
            <Link href="/bot-research" className="text-[#2962ff] hover:underline">Bot research ↗</Link>
            <Link href="/" className="text-[#2962ff] hover:underline">← Back to charts</Link>
          </span>
        </header>

        <HistoryControls settings={settings} today={today} onChange={update} status={{ loading: status.loading, error: status.error, onRetry: () => setRetries((n) => n + 1) }} />

        {status.error && <p className="rounded border border-down p-2 text-down">{status.error}</p>}
        {status.loaded && <p className="text-muted-foreground">{status.loaded} · {days.length} day{days.length === 1 ? "" : "s"}, {rows.length} bars</p>}
        {!status.loading && status.loaded && days.length === 0 && <p className="text-muted-foreground">No data for this range. It may be holidays, or this expiry did not trade.</p>}

        {days.length > 0 && (
          <>
            <SummaryCards group={group} expiryDays={expiryGroup.days} />
            <nav className="flex flex-wrap gap-1 border-b border-border">
              {TABS.map(([id, label]) => (
                <button key={id} type="button" onClick={() => setTab(id)} className={`-mb-px border-b-2 px-3 py-1.5 ${tab === id ? "border-[#2962ff] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{label}</button>
              ))}
            </nav>
            {tab === "overview" && (
              <div className="grid gap-4 xl:grid-cols-2">
                <section className="data-card"><h2 className="data-card-title">By weekday</h2><WeekdayTable groups={weekdays} expiry={expiryGroup} /></section>
                <section className="data-card"><h2 className="data-card-title">Average session</h2><ProfileChart profile={profile} /><p className="text-[10px] text-muted-foreground">Ordinary days only, each line on its own scale. Where the straddle line is lowest is when premium was cheapest against the open, on average.</p></section>
              </div>
            )}
            {tab === "volatility" && (
              <section className="space-y-3 data-card">
                <h2 className="data-card-title">{underlying.name}: the last year <span className="font-normal text-muted-foreground">(shaded: the range loaded)</span></h2>
                <UnderlyingChart bars={daily} rv={rv} iv={ivRv} from={loadedRange.from} to={loadedRange.to} />
                <VolatilityFacts iv={ivRv} reaction={reaction} />
              </section>
            )}
            {tab === "sensitivity" && (
              <div className="grid gap-4 xl:grid-cols-2">
            <section className="data-card"><h2 className="data-card-title">How ATM premiums actually moved</h2><SensitivityCards report={sensitivity} /></section>
              <section className="data-card">
                <h2 className="data-card-title">Through the expiry cycle</h2>
                <DteTable groups={cycle} />
                <p className="mt-1 text-[10px] text-muted-foreground">Trading days to the next expiry found in the data. Load a range spanning several expiries for steadier averages; a week or two gives one or two samples per row.</p>
              </section>
              </div>
            )}
            {tab === "lab" && <TradeLab settings={settings} />}
            {tab === "days" && (
              <div className="grid items-start gap-4 xl:grid-cols-2">
                <section className="data-card"><h2 className="data-card-title">Days <span className="font-normal text-muted-foreground">(click one for its detail)</span></h2><DayTable days={days} selected={selectedDate} onSelect={setSelected} /></section>
                {dayRows.length > 0 && <section className="data-card"><h2 className="data-card-title">{selectedDate}</h2><DayDetail rows={dayRows} /></section>}
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">
              Data is Dhan&apos;s rolling series: at each bar it follows whichever strike was at the money, so it describes the market, not one contract held.
              &quot;Moved more than priced&quot; compares the open-to-close move with the 1σ daily move from the opening ATM IV (IV ÷ √252). A guide to how options behaved, not advice and not a backtest of any trade.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
