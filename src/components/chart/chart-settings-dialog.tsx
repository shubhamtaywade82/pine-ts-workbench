"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CandlestickChart, Rows3, MoveVertical, Paintbrush, TrendingUp } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DEFAULT_CHART_SETTINGS, type ChartSettings, type DepthWallStyle, type ScaleMode } from "@/lib/chart-settings";
import { CANDLE_THEMES, CANDLE_TYPES, findCandleTheme, type CandleThemeId, type CandleType } from "@/lib/candle-themes";
import { WALL_WINDOW_LIMITS_PCT } from "@/lib/depth-walls";

type Tab = "symbol" | "statusLine" | "scales" | "canvas" | "trading";

const TABS: readonly { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "symbol", label: "Symbol", icon: <CandlestickChart className="h-4 w-4" /> },
  { id: "statusLine", label: "Status line", icon: <Rows3 className="h-4 w-4" /> },
  { id: "scales", label: "Scales and lines", icon: <MoveVertical className="h-4 w-4" /> },
  { id: "canvas", label: "Canvas", icon: <Paintbrush className="h-4 w-4" /> },
  { id: "trading", label: "Trading", icon: <TrendingUp className="h-4 w-4" /> },
];

/** TradingView's chart Settings dialog. Edits a draft; Ok applies it, Cancel discards it. */
export function ChartSettingsDialog({ open, settings, quoteAsset, onOpenChange, onApply }: {
  open: boolean; settings: ChartSettings; quoteAsset: string;
  onOpenChange: (open: boolean) => void; onApply: (settings: ChartSettings) => void;
}) {
  const [tab, setTab] = useState<Tab>("symbol");
  const [draft, setDraft] = useState(settings);
  useEffect(() => { if (open) setDraft(settings); }, [open, settings]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogTitle className="px-6 pt-5 pb-3 text-lg">Settings</DialogTitle>
        <DialogDescription className="sr-only">Customize chart settings, scales, canvas, and trading.</DialogDescription>
        <div className="flex min-h-0 flex-1">
          <nav className="flex w-48 shrink-0 flex-col gap-0.5 px-3">
            {TABS.map((t) => (
              <button key={t.id} type="button" onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 rounded px-3 py-2 text-sm ${tab === t.id ? "bg-muted font-semibold" : "hover:bg-muted/60"}`}>
                {t.icon}{t.label}
              </button>
            ))}
          </nav>
          <div className="min-h-[360px] flex-1 overflow-y-auto px-6 pb-4">
            {tab === "symbol" && <SymbolTab draft={draft} onChange={setDraft} />}
            {tab === "statusLine" && <StatusLineTab draft={draft} onChange={setDraft} />}
            {tab === "scales" && <ScalesTab draft={draft} onChange={setDraft} />}
            {tab === "canvas" && <CanvasTab draft={draft} onChange={setDraft} />}
            {tab === "trading" && <TradingTab draft={draft} onChange={setDraft} quoteAsset={quoteAsset} />}
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border px-6 py-3">
          <Button variant="outline" size="sm" onClick={() => setDraft(DEFAULT_CHART_SETTINGS)}>Defaults</Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={() => { onApply(draft); onOpenChange(false); }}>Ok</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface TabProps {
  readonly draft: ChartSettings;
  readonly onChange: (settings: ChartSettings) => void;
}

/** Patch helper: `patch("candles", { upColor })` returns a new settings object. */
const patcher = ({ draft, onChange }: TabProps) =>
  <K extends keyof ChartSettings>(section: K, values: Partial<ChartSettings[K]>) =>
    onChange({ ...draft, [section]: { ...draft[section], ...values } });

function SymbolTab(props: TabProps) {
  const { candles } = props.draft;
  const patch = patcher(props);
  const onThemeChange = (id: CandleThemeId) => {
    const t = findCandleTheme(id);
    if (t) {
      patch("candles", {
        theme: id, upColor: t.upColor, downColor: t.downColor,
        borderUpColor: t.upColor, borderDownColor: t.downColor,
        wickUpColor: t.upColor, wickDownColor: t.downColor,
      });
    } else {
      patch("candles", { theme: "custom" });
    }
  };
  return (
    <Group title="Candles">
      <Row label="Type">
        <select value={candles.type} onChange={(e) => patch("candles", { type: e.target.value as CandleType })}
          className="h-8 rounded border border-border bg-background px-2 text-xs">
          {CANDLE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </Row>
      <Row label="Theme">
        <select value={candles.theme} onChange={(e) => onThemeChange(e.target.value as CandleThemeId)}
          className="h-8 rounded border border-border bg-background px-2 text-xs">
          {CANDLE_THEMES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          <option value="custom">Custom</option>
        </select>
      </Row>
      <CandlePartRow label="Body" checked={candles.showBody} onCheck={(showBody) => patch("candles", { showBody })}
        upColor={candles.upColor} onUpChange={(upColor) => patch("candles", { upColor, theme: "custom" })}
        downColor={candles.downColor} onDownChange={(downColor) => patch("candles", { downColor, theme: "custom" })} />
      <CandlePartRow label="Borders" checked={candles.showBorders} onCheck={(showBorders) => patch("candles", { showBorders })}
        upColor={candles.borderUpColor} onUpChange={(borderUpColor) => patch("candles", { borderUpColor, theme: "custom" })}
        downColor={candles.borderDownColor} onDownChange={(borderDownColor) => patch("candles", { borderDownColor, theme: "custom" })} />
      <CandlePartRow label="Wick" checked={candles.showWick} onCheck={(showWick) => patch("candles", { showWick })}
        upColor={candles.wickUpColor} onUpChange={(wickUpColor) => patch("candles", { wickUpColor, theme: "custom" })}
        downColor={candles.wickDownColor} onDownChange={(wickDownColor) => patch("candles", { wickDownColor, theme: "custom" })} />
    </Group>
  );
}

function StatusLineTab(props: TabProps) {
  const { statusLine } = props.draft;
  const patch = patcher(props);
  return (
    <>
      <Group title="Instrument">
        <Check label="Title" checked={statusLine.showTitle} onChange={(showTitle) => patch("statusLine", { showTitle })} />
        <Check label="Chart values" checked={statusLine.showOhlc} onChange={(showOhlc) => patch("statusLine", { showOhlc })} />
      </Group>
      <Group title="Indicators">
        <Check label="Titles" checked={statusLine.showIndicatorTitles} onChange={(showIndicatorTitles) => patch("statusLine", { showIndicatorTitles })} />
        <Check label="Values" checked={statusLine.showIndicatorValues} onChange={(showIndicatorValues) => patch("statusLine", { showIndicatorValues })} />
      </Group>
    </>
  );
}

const MODES: readonly (readonly [ScaleMode, string])[] = [["regular", "Regular"], ["percent", "Percent"], ["indexed", "Indexed to 100"], ["logarithmic", "Logarithmic"]];

function ScalesTab(props: TabProps) {
  const { scales, trading } = props.draft;
  const patch = patcher(props);
  return (
    <Group title="Price scale">
      <Row label="Scale mode">
        <select className="h-8 rounded border border-border bg-background px-2 text-sm" value={scales.mode} onChange={(e) => patch("scales", { mode: e.target.value as ScaleMode })}>
          {MODES.map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}
        </select>
      </Row>
      <Row label="Scales placement">
        <select className="h-8 rounded border border-border bg-background px-2 text-sm" value={scales.placement} onChange={(e) => patch("scales", { placement: e.target.value as ChartSettings["scales"]["placement"] })}>
          <option value="right">Right</option><option value="left">Left</option>
        </select>
      </Row>
      <Check label="Auto (fits data to screen)" checked={scales.autoScale} onChange={(autoScale) => patch("scales", { autoScale })} />
      <Check label="Invert scale" checked={scales.invert} onChange={(invert) => patch("scales", { invert })} />
      <Check label="Last price line" checked={scales.showLastPriceLine} onChange={(showLastPriceLine) => patch("scales", { showLastPriceLine })} />
      <Check label="Bid and ask lines" checked={trading.showBidAskLines} onChange={(showBidAskLines) => patch("trading", { showBidAskLines })} />
    </Group>
  );
}

function CanvasTab(props: TabProps) {
  const { canvas } = props.draft;
  const patch = patcher(props);
  return (
    <>
      <Group title="Chart basic styles">
        <Row label="Background"><ColorInput value={canvas.background} onChange={(background) => patch("canvas", { background })} /></Row>
        <Check label="Vertical grid lines" checked={canvas.showVertGrid} onChange={(showVertGrid) => patch("canvas", { showVertGrid })} />
        <Check label="Horizontal grid lines" checked={canvas.showHorzGrid} onChange={(showHorzGrid) => patch("canvas", { showHorzGrid })} />
        <Row label="Grid color"><ColorInput value={canvas.gridColor} onChange={(gridColor) => patch("canvas", { gridColor })} /></Row>
        <Row label="Crosshair"><ColorInput value={canvas.crosshairColor} onChange={(crosshairColor) => patch("canvas", { crosshairColor })} /></Row>
      </Group>
      <Group title="Scales">
        <Row label="Text">
          <ColorInput value={canvas.textColor} onChange={(textColor) => patch("canvas", { textColor })} />
          <NumberInput value={canvas.fontSize} min={8} max={20} onChange={(fontSize) => patch("canvas", { fontSize })} />
        </Row>
      </Group>
      <Group title="Margins">
        <Row label="Top"><NumberInput value={canvas.marginTopPercent} min={0} max={45} unit="%" onChange={(marginTopPercent) => patch("canvas", { marginTopPercent })} /></Row>
        <Row label="Bottom"><NumberInput value={canvas.marginBottomPercent} min={0} max={45} unit="%" onChange={(marginBottomPercent) => patch("canvas", { marginBottomPercent })} /></Row>
        <Row label="Right"><NumberInput value={canvas.rightOffsetBars} min={0} max={200} unit="bars" onChange={(rightOffsetBars) => patch("canvas", { rightOffsetBars })} /></Row>
      </Group>
    </>
  );
}

function TradingTab(props: TabProps & { readonly quoteAsset: string }) {
  const { trading } = props.draft;
  const patch = patcher(props);
  const { wallWindowPct, minWallNotional } = trading;
  return (
    <>
      <Group title="Appearance">
        <Check label="Execution marks (strategy entries and exits)" checked={trading.showExecutionMarks} onChange={(showExecutionMarks) => patch("trading", { showExecutionMarks })} />
        <Check label="Execution labels" checked={trading.showExecutionLabels} onChange={(showExecutionLabels) => patch("trading", { showExecutionLabels })} />
        <Check label="Bid and ask lines" checked={trading.showBidAskLines} onChange={(showBidAskLines) => patch("trading", { showBidAskLines })} />
      </Group>
      <Group title="Order book walls">
        <Check label="Show the largest resting bid and ask" checked={trading.showOrderBookWalls} onChange={(showOrderBookWalls) => patch("trading", { showOrderBookWalls })} />
        <Row label="Display style">
          <select value={trading.depthWallStyle} onChange={(e) => patch("trading", { depthWallStyle: e.target.value as DepthWallStyle })}
            className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground focus:outline-none">
            <option value="shelf">Horizontal Shelf & Ray</option>
            <option value="dom">Right-Margin DOM Shelf</option>
            <option value="bracket">Micro-DOM Bracket</option>
            <option value="bubbles">Floating Bubbles</option>
          </select>
        </Row>
        <Row label="Search window (±)">
          <ValidatedNumber value={wallWindowPct} min={WALL_WINDOW_LIMITS_PCT.min} max={WALL_WINDOW_LIMITS_PCT.max} unit="%" onChange={(next) => patch("trading", { wallWindowPct: next })} />
        </Row>
        <Row label="Minimum wall size">
          <ValidatedNumber value={minWallNotional} min={0} max={1_000_000_000} unit={props.quoteAsset} onChange={(next) => patch("trading", { minWallNotional: next })} />
        </Row>
        <p className="text-xs text-muted-foreground">
          Walls are the largest level inside the window. Each is labelled with the window actually searched:
          snapshot coverage can narrow it. Minimum size is in each chart&apos;s quote currency.
        </p>
      </Group>
    </>
  );
}

const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="flex flex-col gap-3 py-3">
    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
    {children}
  </div>
);

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid grid-cols-[160px_1fr] items-center gap-3 text-sm">
    <span>{label}</span><div className="flex items-center gap-2">{children}</div>
  </div>
);

const Check = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <label className="flex items-center gap-2 text-sm">
    <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />{label}
  </label>
);

const CandlePartRow = ({
  label, checked, onCheck, upColor, onUpChange, downColor, onDownChange,
}: {
  label: string; checked: boolean; onCheck: (v: boolean) => void;
  upColor: string; onUpChange: (v: string) => void; downColor: string; onDownChange: (v: string) => void;
}) => (
  <div className="grid grid-cols-[160px_1fr] items-center gap-3 text-sm">
    <label className="flex items-center gap-2">
      <Checkbox checked={checked} onCheckedChange={(v) => onCheck(v === true)} />{label}
    </label>
    <div className="flex items-center gap-2">
      <ColorInput value={upColor} onChange={onUpChange} />
      <ColorInput value={downColor} onChange={onDownChange} />
    </div>
  </div>
);

const ColorInput = ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
  <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
    className="h-8 w-8 cursor-pointer rounded border border-border bg-transparent p-0.5" />
);

/**
 * Number field that validates as you type. An invalid entry is flagged and not
 * applied; leaving the field restores the last valid value.
 */
function ValidatedNumber({ value, min, max, unit, onChange }: { value: number; min: number; max: number; unit: string; onChange: (value: number) => void }) {
  const [text, setText] = useState(String(value));
  const [isValid, setIsValid] = useState(true);
  useEffect(() => { setText((c) => (Number(c) === value ? c : String(value))); setIsValid(true); }, [value]);
  const onType = (raw: string) => {
    setText(raw);
    const p = raw.trim() === "" ? Number.NaN : Number(raw);
    const valid = Number.isFinite(p) && p >= min && p <= max;
    setIsValid(valid);
    if (valid) onChange(p);
  };
  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center gap-2">
        <input type="number" step="any" value={text} aria-invalid={!isValid}
          onChange={(e) => onType(e.target.value)} onBlur={() => { setText(String(value)); setIsValid(true); }}
          className={`h-8 w-24 rounded border bg-background px-2 text-sm ${isValid ? "border-border" : "border-red-500"}`} />
        <span className="text-sm text-muted-foreground">{unit}</span>
      </span>
      {!isValid && <span className="text-xs text-red-500">Enter a number from {min} to {max}</span>}
    </span>
  );
}

const NumberInput = ({ value, min, max, unit, onChange }: { value: number; min: number; max: number; unit?: string; onChange: (value: number) => void }) => (
  <span className="flex items-center gap-2">
    <input type="number" value={value} min={min} max={max}
      onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n))); }}
      className="h-8 w-20 rounded border border-border bg-background px-2 text-sm" />
    {unit !== undefined && <span className="text-sm text-muted-foreground">{unit}</span>}
  </span>
);
