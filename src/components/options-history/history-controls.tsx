"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { autoInterval, hasWeeklyOptions, maxWidth, type HistorySettings, type IntervalChoice, type RangePreset } from "@/lib/history-settings";
import { INDEX_UNDERLYINGS, type Underlying } from "@/lib/option-underlyings";
import { searchRemoteSymbols } from "@/lib/remote-symbols";
import type { SymbolOption } from "@/lib/symbol-catalog";

const SEARCH_DEBOUNCE_MS = 250;

const stockUnderlying = (symbol: SymbolOption): Underlying | undefined => {
  const id = Number(symbol.dhanSecurityId);
  return symbol.dhanSegment === "NSE_EQ" && Number.isInteger(id)
    ? { name: symbol.ticker.replace(/^NSE:/, ""), securityId: id, segment: "NSE_FNO", instrument: "OPTSTK", expiryFlag: "MONTH" }
    : undefined;
};

/** One box for every underlying: the indices show on focus, NSE stocks with options appear as you type. */
function UnderlyingPicker({ value, onPick }: { readonly value: Underlying; readonly onPick: (u: Underlying) => void }) {
  const [text, setText] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [stocks, setStocks] = useState<readonly Underlying[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const query = text.trim().toUpperCase();
  const indices = INDEX_UNDERLYINGS.filter((u) => query === "" || u.name.includes(query));

  useEffect(() => {
    if (query.length < 2) { setStocks([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchRemoteSymbols(query, "stock", controller.signal).then((r) => setStocks(r.symbols.flatMap((s) => stockUnderlying(s) ?? []).slice(0, 8)));
    }, SEARCH_DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  useEffect(() => {
    const close = (e: MouseEvent): void => { if (!box.current?.contains(e.target as Node)) setIsOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (u: Underlying): void => { onPick(u); setText(""); setIsOpen(false); };
  const options = [...indices.map((u) => ({ u, kind: "Index" })), ...stocks.map((u) => ({ u, kind: "Stock" }))];
  return (
    <div ref={box} className="relative">
      <input
        value={isOpen ? text : value.name}
        onFocus={() => setIsOpen(true)}
        onChange={(e) => { setText(e.target.value); setIsOpen(true); }}
        onKeyDown={(e) => { if (e.key === "Enter" && options[0]) pick(options[0].u); if (e.key === "Escape") setIsOpen(false); }}
        placeholder="Index or stock…"
        className="w-44 rounded border border-border bg-popover px-2 py-1 font-semibold text-foreground"
        aria-label="Underlying"
      />
      {isOpen && options.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-72 w-64 overflow-auto rounded border border-border bg-popover shadow-lg">
          {options.map(({ u, kind }) => (
            <li key={`${kind}${u.securityId}`}>
              <button type="button" onClick={() => pick(u)} className={`flex w-full justify-between px-2 py-1 text-left hover:bg-muted ${u.securityId === value.securityId ? "text-[#2962ff]" : ""}`}>
                <span>{u.name}</span><span className="text-[10px] text-muted-foreground">{kind}{kind === "Index" && hasWeeklyOptions(u) ? " · weekly" : ""}</span>
              </button>
            </li>
          ))}
          {query.length >= 2 && stocks.length === 0 && <li className="px-2 py-1 text-[10px] text-muted-foreground">Searching stocks…</li>}
        </ul>
      )}
    </div>
  );
}

/** A row of mutually exclusive choices. */
function Segmented<T extends string | number>({ value, options, onChange, label }: {
  readonly value: T; readonly options: readonly (readonly [T, string, string?])[]; readonly onChange: (v: T) => void; readonly label: string;
}) {
  return (
    <div className="flex overflow-hidden rounded border border-border" role="radiogroup" aria-label={label}>
      {options.map(([v, text, hint]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={v === value} title={hint} onClick={() => onChange(v)}
          className={`px-2 py-1 ${v === value ? "bg-[#2962ff] text-white" : "text-muted-foreground hover:text-foreground"}`}>{text}</button>
      ))}
    </div>
  );
}

const RANGES: readonly (readonly [RangePreset, string])[] = [["1W", "1W"], ["2W", "2W"], ["1M", "1M"], ["custom", "Custom"]];

/** Every choice the page needs, each limited to what is valid for the chosen instrument; changes apply at once. */
export function HistoryControls({ settings, today, onChange, status }: {
  readonly settings: HistorySettings; readonly today: string; readonly onChange: (next: Partial<HistorySettings>) => void;
  readonly status: { readonly loading: boolean; readonly error: string | null; readonly onRetry: () => void };
}) {
  const widths = Array.from({ length: maxWidth(settings) + 1 }, (_, n) => n);
  const auto = autoInterval(settings.from, settings.to);
  return (
    <section className="flex flex-wrap items-center gap-2 rounded border border-border bg-popover/30 p-2">
      <UnderlyingPicker value={settings.underlying} onPick={(underlying) => onChange({ underlying, expiryFlag: underlying.expiryFlag })} />
      {hasWeeklyOptions(settings.underlying)
        ? <Segmented label="Expiry cycle" value={settings.expiryFlag} onChange={(expiryFlag) => onChange({ expiryFlag })} options={[["WEEK", "Weekly"], ["MONTH", "Monthly"]]} />
        : <span className="text-muted-foreground" title="This underlying only lists monthly options">Monthly</span>}
      <Segmented label="Which expiry" value={settings.expiryCode} onChange={(expiryCode) => onChange({ expiryCode })}
        options={[[1, "Near", "The expiry nearest each day"], [2, "Next", "The one after"], [3, "Far", "The third"]]} />
      <select value={settings.width} onChange={(e) => onChange({ width: Number(e.target.value) })} className="rounded border border-border bg-popover px-2 py-1" aria-label="Strikes" title="Straddle: call and put at the money. Strangle ±n: call n strikes above, put n strikes below.">
        {widths.map((n) => <option key={n} value={n}>{n === 0 ? "ATM straddle" : `Strangle ±${n}`}</option>)}
      </select>
      <Segmented label="Range" value={settings.range} onChange={(range) => onChange({ range })} options={RANGES} />
      {settings.range === "custom" && (
        <>
          <input type="date" value={settings.from} max={settings.to} onChange={(e) => onChange({ from: e.target.value })} className="rounded border border-border bg-popover px-2 py-1" aria-label="From" />
          <span className="text-muted-foreground">to</span>
          <input type="date" value={settings.to} max={today} onChange={(e) => onChange({ to: e.target.value })} className="rounded border border-border bg-popover px-2 py-1" aria-label="To" />
        </>
      )}
      <select value={settings.interval} onChange={(e) => onChange({ interval: e.target.value as IntervalChoice })} className="rounded border border-border bg-popover px-2 py-1" aria-label="Interval" title="Auto picks finer bars for shorter ranges. One-minute bars are limited to 7 days.">
        <option value="auto">Auto ({auto}m)</option>
        {(["1", "5", "15", "25", "60"] as const).map((i) => <option key={i} value={i}>{i}m</option>)}
      </select>
      <span className="ml-auto flex items-center gap-2" aria-live="polite">
        {status.loading && <Loader2 className="h-4 w-4 animate-spin text-[#2962ff]" aria-label="Loading" />}
        {status.error !== null && !status.loading && <button type="button" onClick={status.onRetry} className="text-[11px] text-down underline" title={status.error}>Retry</button>}
      </span>
    </section>
  );
}
