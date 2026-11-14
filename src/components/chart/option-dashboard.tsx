import type { ReactNode } from "react";
import type { ChainState, Reading } from "@/hooks/use-option-chain";
import type { Flow, Level, Signal } from "@/lib/option-analytics";
import type { ChainSummary } from "@/lib/option-chain";
import type { LongOptionFilter, VixReading } from "@/lib/option-filter";
import { compactQuantity } from "@/components/chart/dom-ladder-layout";

const UP = "var(--up)";
const DOWN = "var(--down)";
const FLAT = "var(--foreground)";
const TONE: Record<"bullish" | "bearish" | "neutral", string> = { bullish: UP, bearish: DOWN, neutral: FLAT };

const num = (value: number | undefined, digits = 1): string => (value === undefined ? "–" : value.toFixed(digits));
const signed = (value: number, digits = 1): string => `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
const clock = (at: number): string => new Date(at).toLocaleTimeString("en-GB", { hour12: false });

function Card({ title, children, hint }: { readonly title: string; readonly children: ReactNode; readonly hint?: string }) {
  return (
    <section className="data-card">
      <h3 className="data-card-title" title={hint}>{title}{hint && <span className="cursor-help font-normal text-muted-foreground">ⓘ</span>}</h3>
      {children}
    </section>
  );
}

function Stat({ label, value, hint, colour }: { readonly label: string; readonly value: string; readonly hint?: string; readonly colour?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2" title={hint}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums" style={{ color: colour }}>{value}</span>
    </div>
  );
}

const SIDE_TONE: Record<LongOptionFilter["side"], string> = { CE: UP, PE: DOWN, NONE: FLAT };
const FACTOR_MARK: Record<"calls" | "puts" | "context", string> = { calls: "▲", puts: "▼", context: "•" };

/** Which long option side the evidence supports, with every input and blocker listed. */
function FilterCard({ filter }: { readonly filter: LongOptionFilter }) {
  const tone = SIDE_TONE[filter.side];
  return (
    <section className="data-card border-l-4 md:col-span-2 xl:col-span-3" style={{ borderLeftColor: tone, background: `color-mix(in oklab, ${tone} 7%, var(--panel))` }}>
      <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
        <div className="shrink-0">
          <h3 className="text-muted-foreground" title="Built for buying options only. It reads positioning, trend and premium cost; it cannot see the next move or your risk.">If buying options</h3>
          <div className="text-lg font-semibold" style={{ color: tone }}>{filter.label}</div>
          <div className="text-muted-foreground tabular-nums">evidence {filter.points > 0 ? "+" : ""}{filter.points} (calls + / puts −)</div>
        </div>
        <ul className="min-w-0 flex-1 space-y-0.5">
          {filter.blockers.map((b) => <li key={b} className="font-medium text-warn">✗ {b}</li>)}
          {filter.factors.map((f) => (
            <li key={f.text} className="text-foreground/85"><span style={{ color: f.leans === "calls" ? UP : f.leans === "puts" ? DOWN : undefined }}>{FACTOR_MARK[f.leans]}</span> {f.text}</li>
          ))}
        </ul>
      </div>
      <p className="mt-2 border-t border-panel-border pt-1.5 text-[10px] text-muted-foreground">A rule-based read, not advice or a forecast. ▲ favours calls, ▼ favours puts, • is context. Any blocker (✗) overrides a direction.</p>
    </section>
  );
}

function BiasCard({ summary }: { readonly summary: ChainSummary }) {
  const { score, label, reasons } = summary.analytics.bias;
  const colour = TONE[label === "Bullish" ? "bullish" : label === "Bearish" ? "bearish" : "neutral"];
  return (
    <Card title="Positioning bias" hint="Read from open interest. An indicator of how the chain is positioned, not a forecast.">
      <div className="flex items-baseline justify-between">
        <span className="text-base font-semibold" style={{ color: colour }}>{label}</span>
        <span className="text-muted-foreground">{signed(score, 0)} / 100</span>
      </div>
      <div className="relative my-1.5 h-1.5 rounded bg-muted">
        <div className="absolute inset-y-0 w-px bg-muted-foreground/60" style={{ left: "50%" }} />
        <div className="absolute inset-y-0 rounded" style={{ background: colour, left: `${score < 0 ? 50 + score / 2 : 50}%`, width: `${Math.abs(score) / 2}%` }} />
      </div>
      <ul className="space-y-0.5 text-muted-foreground">
        {reasons.length === 0 ? <li>No strong lean in OI.</li> : reasons.map((reason) => <li key={reason}>• {reason}</li>)}
      </ul>
    </Card>
  );
}

function LevelRow({ level, tone, isTop }: { readonly level: Level; readonly tone: string; readonly isTop: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_4rem_4rem_4rem] items-baseline gap-2 rounded px-1 tabular-nums odd:bg-foreground/[0.03]">
      <span className={isTop ? "font-semibold" : ""}><span style={{ color: tone }}>{isTop ? "★" : "●"}</span> {level.strike}</span>
      <span className="text-right text-muted-foreground">{signed(level.distancePct, 2)}%</span>
      <span className="text-right">{compactQuantity(level.oi)}</span>
      <span className="text-right" style={{ color: level.oiChange >= 0 ? UP : DOWN }}>{level.oiChange === 0 ? "–" : `${level.oiChange > 0 ? "+" : ""}${compactQuantity(level.oiChange)}`}</span>
    </div>
  );
}

function LevelsCard({ summary }: { readonly summary: ChainSummary }) {
  const { resistances, supports, gammaFlip } = summary.analytics;
  const byPrice = (levels: readonly Level[]): Level[] => [...levels].sort((a, b) => b.strike - a.strike);
  return (
    <Card title="Levels from OI" hint="★ is the strongest wall: the strike holding the most open interest on that side. Columns: strike, distance from spot, OI, OI change today.">
      <div className="space-y-px">
        <div className="grid grid-cols-[1fr_4rem_4rem_4rem] gap-2 px-1 pb-0.5 text-right text-muted-foreground"><span className="text-left"><span className="text-down">●</span> resistance · <span className="text-up">●</span> support</span><span>from spot</span><span>OI</span><span>Δ today</span></div>
        {byPrice(resistances).map((l) => <LevelRow key={l.strike} level={l} tone={DOWN} isTop={l === resistances[0]} />)}
        <div className="my-1 flex items-center justify-between rounded bg-[#2962ff]/15 px-1 py-0.5 font-semibold tabular-nums"><span>Spot</span><span>{num(summary.spot, 2)}</span></div>
        {byPrice(supports).map((l) => <LevelRow key={l.strike} level={l} tone={UP} isTop={l === supports[0]} />)}
      </div>
      <div className="mt-2 space-y-0.5 border-t border-panel-border pt-1.5">
        <Stat label="Max pain" value={String(summary.maxPain)} hint="Expiry price where option writers pay out least" />
        <Stat label="Gamma flip" value={gammaFlip === undefined ? "–" : String(gammaFlip)} hint="Approximate: where cumulative call-minus-put gamma changes sign. Above it moves tend to be damped, below it amplified." />
      </div>
    </Card>
  );
}

function FlowRow({ flow }: { readonly flow: Flow }) {
  return (
    <div className="grid grid-cols-[1fr_4rem_4rem] items-baseline gap-2 rounded px-1 tabular-nums odd:bg-foreground/[0.03]" title={flow.kind}>
      <span><span style={{ color: TONE[flow.lean] }}>{flow.lean === "bullish" ? "▲" : flow.lean === "bearish" ? "▼" : "•"}</span> {flow.label}</span>
      <span className="text-right">{flow.strike}</span>
      <span className="text-right" style={{ color: flow.oiChange >= 0 ? UP : DOWN }}>{flow.oiChange > 0 ? "+" : ""}{compactQuantity(flow.oiChange)}</span>
    </div>
  );
}

function FlowCard({ summary }: { readonly summary: ChainSummary }) {
  const { flows, pcrOiChange, pcrVolume } = summary.analytics;
  return (
    <Card title="Where OI is moving" hint="Biggest open-interest changes today, read with the contract's price move: call writing and put buying lean down, put writing and call buying lean up.">
      <div className="space-y-px">
        {flows.length > 0 && <div className="grid grid-cols-[1fr_4rem_4rem] gap-2 px-1 pb-0.5 text-right text-muted-foreground"><span className="text-left"><span className="text-up">▲</span> leans up · <span className="text-down">▼</span> down</span><span>strike</span><span>Δ OI</span></div>}
        {flows.length === 0 ? <p className="text-muted-foreground">No OI change yet today.</p> : flows.map((f) => <FlowRow key={`${f.side}${f.strike}`} flow={f} />)}
      </div>
      <div className="mt-2 space-y-0.5 border-t border-panel-border pt-1.5">
        <Stat label="PCR (OI)" value={num(summary.analytics.pcrOi, 2)} hint="Put OI ÷ call OI" />
        <Stat label="PCR (volume)" value={num(pcrVolume, 2)} hint="Put volume ÷ call volume traded today" />
        <Stat label="Fresh OI, puts ÷ calls" value={pcrOiChange === undefined ? "all puts" : num(pcrOiChange, 2)} hint="OI added today: above 1 means fresh positioning favours puts" />
      </div>
    </Card>
  );
}

function VolatilityCard({ summary, vix }: { readonly summary: ChainSummary; readonly vix: VixReading | undefined }) {
  const a = summary.analytics;
  const range = a.oneSigmaMove === undefined ? "–" : `${(summary.spot - a.oneSigmaMove).toFixed(0)} – ${(summary.spot + a.oneSigmaMove).toFixed(0)}`;
  return (
    <Card title="Volatility and expected range">
      <div className="space-y-0.5">
        <Stat label="Days to expiry" value={num(a.daysToExpiry, 1)} />
        <Stat label="India VIX" value={vix === undefined ? "–" : `${vix.level.toFixed(1)} (${signed(vix.changePct)}%)`} hint="The market's expected 30-day volatility of NIFTY" colour={vix === undefined ? undefined : vix.changePct > 0 ? DOWN : UP} />
        <Stat label="VIX, 1-year percentile" value={vix === undefined ? "–" : `${vix.percentile.toFixed(0)}th`} hint="Share of the last year's closes at or below today's. High means premiums are rich for buyers." />
        <Stat label="ATM IV" value={summary.atmIv === undefined ? "–" : `${summary.atmIv.toFixed(1)}%`} />
        <Stat label="IV skew" value={a.ivSkew === undefined ? "–" : signed(a.ivSkew)} hint="Put IV minus call IV, 3% out each way. Positive: the downside is priced dearer than the upside." colour={a.ivSkew === undefined ? undefined : a.ivSkew > 0 ? DOWN : UP} />
        <Stat label="ATM straddle" value={summary.straddle === undefined ? "–" : `${summary.straddle.toFixed(1)} (${num(summary.expectedMovePct, 2)}%)`} hint="Call + put at the money: the move the market is paying for" />
        <Stat label="Breakevens" value={a.lowerBreakeven === undefined ? "–" : `${a.lowerBreakeven.toFixed(0)} / ${a.upperBreakeven?.toFixed(0)}`} hint="ATM strike ± straddle premium" />
        <Stat label="1σ range to expiry" value={range} hint="Spot ± one standard deviation implied by ATM IV" />
        <Stat label="Straddle decay / day" value={num(a.straddleThetaPerDay, 1)} hint="What the ATM straddle loses to time each day, at current theta" />
      </div>
    </Card>
  );
}

function Spark({ values, colour }: { readonly values: readonly number[]; readonly colour: string }) {
  if (values.length < 2) return <span className="text-muted-foreground">collecting…</span>;
  const low = Math.min(...values);
  const span = Math.max(...values) - low || 1;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${18 - ((v - low) / span) * 16}`).join(" ");
  return <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="h-5 w-full"><polyline points={points} fill="none" stroke={colour} strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>;
}

function TrendCard({ history }: { readonly history: readonly Reading[] }) {
  const series: readonly (readonly [string, readonly number[], string])[] = [
    ["Spot", history.map((r) => r.spot), FLAT],
    ["PCR", history.map((r) => r.pcr), UP],
    ["Straddle", history.flatMap((r) => (r.straddle === undefined ? [] : [r.straddle])), "#2962ff"],
    ["Bias", history.map((r) => r.bias), "var(--warn)"],
  ];
  return (
    <Card title="This session" hint="One point per refresh while this panel is open">
      <div className="space-y-1.5">
        {series.map(([label, values, colour]) => (
          <div key={label} className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-muted-foreground">{label}</span>
            <div className="min-w-0 flex-1"><Spark values={values} colour={colour} /></div>
            <span className="w-14 shrink-0 text-right">{values.length === 0 ? "–" : num(values[values.length - 1], label === "Bias" ? 0 : 2)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SignalsCard({ signals }: { readonly signals: readonly Signal[] }) {
  return (
    <Card title="Signals" hint="What changed between refreshes while this panel has been open">
      {signals.length === 0 ? (
        <p className="text-muted-foreground">Watching: nothing has changed yet.</p>
      ) : (
        <ul className="max-h-[220px] space-y-1 overflow-auto">
          {signals.map((s, i) => (
            <li key={`${s.at}-${i}`} className="flex gap-2">
              <span className="shrink-0 text-muted-foreground">{clock(s.at)}</span>
              <span style={{ color: TONE[s.tone] }}>{s.text}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The chain read the way an options desk would: what the positioning says, where the levels are, and what is changing. */
export function OptionDashboard({ summary, state, vix, filter }: { readonly summary: ChainSummary; readonly state: ChainState; readonly vix: VixReading | undefined; readonly filter: LongOptionFilter | undefined }) {
  return (
    <div className="grid grid-cols-1 gap-2.5 p-2.5 md:grid-cols-2 xl:grid-cols-3">
      {filter && <FilterCard filter={filter} />}
      <BiasCard summary={summary} />
      <LevelsCard summary={summary} />
      <FlowCard summary={summary} />
      <VolatilityCard summary={summary} vix={vix} />
      <TrendCard history={state.history} />
      <SignalsCard signals={state.signals} />
    </div>
  );
}
