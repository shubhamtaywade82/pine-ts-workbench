"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookOpen, Copy, Keyboard, Package, Terminal } from "lucide-react";

/**
 * In-app docs (P0 onboarding/DX): the "Docs" dialog with four tabs —
 * Examples gallery (copy-paste starters), API reference for the ta and input
 * namespaces, the Pine → TypeScript migration cheat sheet, and the hotkey list.
 */

type DocsTab = "examples" | "api" | "migration" | "hotkeys";

export function DocsDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-2 text-sm"
        onClick={() => setOpen(true)}
        title="Docs, examples & shortcuts"
      >
        <BookOpen className="mr-1 h-4 w-4" /> Docs
      </Button>
      <DocsDialogInner open={open} onOpenChange={setOpen} />
    </>
  );
}

function DocsDialogInner({ open, onOpenChange }: { readonly open: boolean; readonly onOpenChange: (v: boolean) => void }) {
  const [tab, setTab] = useState<DocsTab>("examples");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border px-5 pt-5 pb-2">
          <DialogTitle className="text-lg">Docs & Examples</DialogTitle>
          <DialogDescription>
            Everything you need to write pine-ts scripts: starters, the ta.* API, the Pine migration map, and hotkeys.
          </DialogDescription>
          <div className="flex gap-2 pt-2">
            <TabButton active={tab === "examples"} onClick={() => setTab("examples")}><Package className="mr-1 h-3.5 w-3.5" /> Examples</TabButton>
            <TabButton active={tab === "api"} onClick={() => setTab("api")}><Terminal className="mr-1 h-3.5 w-3.5" /> ta.* API</TabButton>
            <TabButton active={tab === "migration"} onClick={() => setTab("migration")}>Pine → TS</TabButton>
            <TabButton active={tab === "hotkeys"} onClick={() => setTab("hotkeys")}><Keyboard className="mr-1 h-3.5 w-3.5" /> Hotkeys</TabButton>
          </div>
        </DialogHeader>
        <div className="min-h-[300px] flex-1 overflow-y-auto px-5 py-4">
          {tab === "examples" && <ExamplesTab />}
          {tab === "api" && <ApiTab />}
          {tab === "migration" && <MigrationTab />}
          {tab === "hotkeys" && <HotkeysTab />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TabButton({ active, onClick, children }: { readonly active: boolean; readonly onClick: () => void; readonly children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Examples gallery
// ---------------------------------------------------------------------------

interface Example {
  readonly title: string;
  readonly tag: "indicator" | "strategy" | "advanced";
  readonly blurb: string;
  readonly code: string;
}

const EXAMPLES: readonly Example[] = [
  {
    title: "SMA Crossover Strategy",
    tag: "strategy",
    blurb: "Long when price crosses above the SMA, flat when it crosses back below.",
    code: `defineStrategy("SMA Crossover", {
  initial_capital: 10_000,
  default_qty_value: 0.001,
  commission_type: "percent",
  commission_value: 0.1,
}, ({ close, input, strategy }) => {
  const len = input.int(20, "Length", { min: 1 });
  const sma = ta.sma(close, len);
  strategy.entry("long", "long", { when: ta.crossover(close, sma) });
  strategy.close("long", { when: ta.crossunder(close, sma) });
});`,
  },
  {
    title: "RSI Overbought/Oversold",
    tag: "indicator",
    blurb: "Classic RSI with overbought/oversold bands and an alert on crossing 70.",
    code: `indicator("RSI with alert", { overlay: false });

const len = input.int(14, "Length", { min: 1 });
const r = ta.rsi(close, len);

plot(r, { title: "RSI", color: "#2962ff" });
hline(70, { title: "Overbought", color: "#f23645" });
hline(30, { title: "Oversold", color: "#089981" });

alert(ta.crossover(r, 70), "RSI entered overbought");`,
  },
  {
    title: "Bollinger Band Squeeze Breakout",
    tag: "strategy",
    blurb: "Enter when bandwidth is at a 100-bar low and price breaks the upper band.",
    code: `defineStrategy("BB Squeeze Breakout", {}, ({ close, input, strategy }) => {
  const len = input.int(20, "Length");
  const mult = input.float(2.0, "Multiplier");
  const bands = ta.bb(close, len, mult);
  const width = (bands.upper - bands.lower) / bands.middle;
  const squeeze = width <= ta.lowest(width, 100);
  strategy.entry("long", "long", { when: squeeze && close > bands.upper });
  strategy.close("long", { when: close < bands.middle });
});`,
  },
  {
    title: "Multi-Timeframe Trend Filter",
    tag: "advanced",
    blurb: "Only go long on the 5m when the 4h trend is up — via request.security.",
    code: `indicator("MTF Trend Filter", { overlay: true });

// TradingView parity: 40 request.*() call sites per script.
const h4Close = request.security(syminfo.ticker, "240", close);
const h4Sma = ta.sma(h4Close, 50);
const trendUp = h4Close > h4Sma;

const localSma = ta.sma(close, 50);
plot(trendUp ? localSma : undefined, { title: "Uptrend SMA", color: "#089981", style: "line" });`,
  },
  {
    title: "Volume Spike Detector",
    tag: "indicator",
    blurb: "Highlights bars where volume exceeds 2× its 20-bar average.",
    code: `indicator("Volume Spike", { overlay: true });

const avg = ta.sma(volume, 20);
const spike = volume > avg * 2;

bgcolor(spike ? "rgba(255,152,0,0.15)" : undefined, { title: "Spike" });
plot(spike ? high * 1.001 : undefined, { title: "Spike mark", style: "circles", color: "#ff9800" });`,
  },
  {
    title: "Trailing Stop Strategy",
    tag: "strategy",
    blurb: "Ratchet a stop under the highest high since entry; exit when it's hit.",
    code: `defineStrategy("Trailing Stop", {}, ({ high, close, input, strategy }) => {
  const trailPct = input.float(3.0, "Trail %", { min: 0.1 }) / 100;
  const peakSinceEntry = ta.highest(high, barssince(strategy.position_size === 0) + 1);
  const stop = peakSinceEntry * (1 - trailPct);

  strategy.entry("long", "long", { when: ta.crossover(close, ta.sma(close, 20)) });
  strategy.exit("trail", "long", { stop });
});`,
  },
];

function ExamplesTab() {
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (copied === null) return;
    const t = setTimeout(() => setCopied(null), 1_500);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = (title: string, code: string) => {
    void navigator.clipboard.writeText(code);
    setCopied(title);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Start from a working script — copy one into the TypeScript Editor and edit from there.
      </p>
      {EXAMPLES.map((ex) => (
        <div key={ex.title} className="rounded border border-border/60 p-3">
          <div className="mb-1 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{ex.title}</span>
              <Badge variant={ex.tag === "strategy" ? "default" : ex.tag === "advanced" ? "outline" : "secondary"} className="text-[9px] uppercase">
                {ex.tag}
              </Badge>
            </div>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => copy(ex.title, ex.code)}>
              <Copy className="mr-1 h-3 w-3" /> {copied === ex.title ? "Copied!" : "Copy"}
            </Button>
          </div>
          <p className="mb-2 text-xs text-muted-foreground">{ex.blurb}</p>
          <pre className="overflow-x-auto rounded bg-muted/60 p-2 text-[11px] leading-relaxed"><code>{ex.code}</code></pre>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// API reference (the essential surface)
// ---------------------------------------------------------------------------

const API_SECTIONS: readonly { readonly title: string; readonly rows: readonly [string, string][] }[] = [
  {
    title: "ta.* — moving averages",
    rows: [
      ["ta.sma(src, len)", "Simple moving average"],
      ["ta.ema(src, len)", "Exponential moving average"],
      ["ta.wma / ta.hma / ta.rma", "Weighted, Hull, and running MA"],
      ["ta.sma(src, len, offset)", "SMA shifted by `offset` bars"],
    ],
  },
  {
    title: "ta.* — momentum & oscillators",
    rows: [
      ["ta.rsi(src, len)", "Relative Strength Index"],
      ["ta.macd(src, fast, slow, sig)", "MACD line, signal, histogram"],
      ["ta.stoch / ta.cci / ta.mfi", "Stochastic, CCI, Money Flow"],
      ["ta.atr(len)", "Average True Range"],
      ["ta.bb(src, len, mult)", "Bollinger Bands (upper/middle/lower)"],
      ["ta.supertrend(factor, atrLen)", "Supertrend with flips"],
    ],
  },
  {
    title: "ta.* — series operations",
    rows: [
      ["ta.crossover(a, b) / ta.crossunder(a, b)", "Cross detection (returns bool)"],
      ["ta.highest(src, len) / ta.lowest(src, len)", "Rolling extremes"],
      ["ta.change(src) / ta.mom(src, len)", "Bar-to-bar change / momentum"],
      ["ta.vwap / ta.obv", "Volume-weighted price / on-balance volume"],
      ["ta.correlation(a, b, len)", "Pearson correlation"],
    ],
  },
  {
    title: "input.* — script inputs",
    rows: [
      ["input.int(def, title, { min, max })", "Integer input (renders a number field)"],
      ["input.float(def, title, { min, max, step })", "Float input"],
      ["input.bool(def, title)", "Checkbox"],
      ["input.string(def, title, options)", "Dropdown"],
      ["input.source(def, title)", "OHLCV source picker"],
      ["input.color / input.timeframe / input.symbol", "Color, TF, symbol inputs"],
    ],
  },
  {
    title: "Plots & visuals",
    rows: [
      ["plot(src, { title, color, style })", "line | stepline | histogram | columns | area | circles | crosses"],
      ["hline(price, { color, style })", "Horizontal level"],
      ["fill(plotA, plotB, color)", "Fill between plots"],
      ["bgcolor(color) / barcolor(color)", "Bar background / candle color"],
      ["plotshape(cond, { style, text })", "Marks on the chart"],
    ],
  },
  {
    title: "Strategy & context",
    rows: [
      ["strategy.entry(id, dir, { when, qty })", "Open / reverse a position"],
      ["strategy.exit(id, from, { stop, limit })", "Attach exit orders"],
      ["strategy.close(id, { when })", "Close the entry"],
      ["request.security(sym, tf, expr)", "Higher-timeframe data (40-call quota)"],
      ["alert(cond, message)", "Fire a script alert"],
      ["syminfo.ticker / time / bar_index", "Built-in context"],
    ],
  },
];

function ApiTab() {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        The essential surface — hover any symbol in the editor for the same docs inline. 67 ta.* functions ship bit-for-bit verified against Pine v6 vectors.
      </p>
      {API_SECTIONS.map((section) => (
        <div key={section.title}>
          <h4 className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{section.title}</h4>
          <div className="flex flex-col gap-1">
            {section.rows.map(([sig, desc]) => (
              <div key={sig} className="grid grid-cols-[minmax(0,55%)_1fr] gap-2 rounded px-1 py-0.5 text-xs odd:bg-muted/40">
                <code className="font-mono text-[11px]">{sig}</code>
                <span className="text-muted-foreground">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pine → TypeScript migration cheat sheet
// ---------------------------------------------------------------------------

const MIGRATION_ROWS: readonly [string, string, string][] = [
  ["//@version=6\nindicator(\"X\")", "indicator(\"X\")", "No version pragma — one language version, always."],
  ["plot(close)", "plot(close)", "Identical — close is a provided series."],
  ["len = input.int(20)", "const len = input.int(20, \"Length\")", "Inputs take a title; the inputs panel is auto-generated."],
  ["ta.crossover(a, b)", "ta.crossover(a, b)", "Same name, same semantics."],
  ["strategy.entry(\"L\", \"long\")", "strategy.entry(\"L\", \"long\", { when: cond })", "When-conditional entries; optional qty."],
  ["if (cond)\n  strategy.close(\"L\")", "strategy.close(\"L\", { when: cond })", "Declarative — no imperative blocks needed."],
  ["request.security(sym, \"D\", close)", "request.security(sym, \"D\", close)", "Same call; 40-call-site quota like TradingView."],
  ["var float x = na", "let x: number | undefined;", "Plain TS state — no var/varip keywords."],
  ["array.push(arr, v)", "arr.push(v)", "Native JS arrays; full ta.* power on top."],
  ["alertcondition(cond)", "alert(cond, \"msg\")", "Alert() fires through the workbench alert engine."],
  ["label.new(...)", "label.new(...)", "Drawing objects work; they render through the visual event stream."],
];

function MigrationTab() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        pine-ts is Pine v6-compatible TypeScript: same functions, same semantics, real types. This is the whole migration.
      </p>
      <div className="grid grid-cols-[1fr_1fr] gap-x-3 gap-y-1 text-xs">
        <span className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Pine v6</span>
        <span className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">pine-ts</span>
        {MIGRATION_ROWS.map(([pine, ts]) => (
          <div key={pine} className="col-span-2 grid grid-cols-2 gap-x-3 gap-y-1 rounded px-1 py-1 odd:bg-muted/40">
            <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-muted-foreground"><code>{pine}</code></pre>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed"><code>{ts}</code></pre>
          </div>
        ))}
      </div>
      <div className="rounded border border-blue-500/30 bg-blue-500/10 p-2 text-xs text-muted-foreground">
        The runtime enforces the Pine execution model — series semantics, historical/realtime rollback, repaint protection —
        so a ported script backtests, alerts, and trades on the same numbers you had on TradingView.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hotkeys
// ---------------------------------------------------------------------------

const HOTKEYS: readonly { readonly keys: string; readonly action: string }[] = [
  { keys: "/", action: "Open symbol search" },
  { keys: "1-9", action: "Switch interval (1s 1m 3m 5m 15m 30h 1h 2h 4h)" },
  { keys: "Alt + ← / →", action: "Bar replay: step backward / forward" },
  { keys: "Space", action: "Bar replay: play / pause" },
  { keys: "+ / -", action: "Bar replay: faster / slower" },
  { keys: "Ctrl/Cmd + Enter", action: "Editor: run the script now" },
  { keys: "Ctrl/Cmd + S", action: "Editor: save script to library" },
  { keys: "Esc", action: "Close dialogs / deselect drawing tool" },
  { keys: "T", action: "Trendline drawing tool" },
  { keys: "H", action: "Horizontal line tool" },
  { keys: "F", action: "Fibonacci retracement" },
  { keys: "R", action: "Rectangle" },
  { keys: "M", action: "Measure tool" },
  { keys: "Shift + Click", action: "Add to watchlist (in symbol search)" },
];

function HotkeysTab() {
  return (
    <div className="flex flex-col gap-2">
      <p className="pb-1 text-sm text-muted-foreground">Shortcuts while the chart has focus.</p>
      {HOTKEYS.map((h) => (
        <div key={h.keys} className="flex items-center justify-between rounded border border-border/50 px-3 py-1.5 text-xs">
          <span className="text-muted-foreground">{h.action}</span>
          <kbd className="rounded bg-muted px-2 py-0.5 font-mono text-[10px] font-semibold">{h.keys}</kbd>
        </div>
      ))}
      <p className="pt-2 text-[11px] text-muted-foreground">
        Drawing-tool hotkeys activate the tool once; Esc or clicking the arrow cursor deactivates it.
      </p>
    </div>
  );
}
