import { useElementWidth } from "@/hooks/use-element-width";
import type { DailyBar, DteGroup, IvReaction, IvVsRealized, Sensitivity, SensitivityReport } from "@/lib/option-behavior";

/** NSE trades 09:15–15:30. */
const SESSION_HOURS = 6.25;
const UP = "var(--up)";
const DOWN = "var(--down)";
const BLUE = "#2962ff";
const AMBER = "var(--warn)";
const MUTED = "var(--muted-foreground)";

const signed = (value: number, digits = 2): string => `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
const istDate = (time: number): string => new Date(time + 19_800_000).toISOString().slice(0, 10);

/**
 * The underlying's daily candles over the year, with its 20-day realized volatility and, on the days loaded, the
 * ATM IV options charged: where the amber dots sit above the blue line, options cost more than the market moved.
 */
export function UnderlyingChart({ bars, rv, iv, from, to }: {
  readonly bars: readonly DailyBar[]; readonly rv: ReadonlyMap<string, number>; readonly iv: IvVsRealized; readonly from: string; readonly to: string;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>(720);
  const priceHeight = 280;
  const volHeight = 120;
  const pad = 24;
  if (bars.length < 2) return <div ref={ref}><p className="text-muted-foreground">No daily history for the underlying.</p></div>;
  const low = Math.min(...bars.map((b) => b.low));
  const high = Math.max(...bars.map((b) => b.high));
  const step = (width - 2 * pad) / bars.length;
  const x = (i: number): number => pad + i * step + step / 2;
  const y = (price: number): number => pad + ((high - price) / (high - low)) * (priceHeight - 2 * pad);
  const vols = [...rv.values(), ...iv.points.map((p) => p.iv)];
  const volTop = Math.max(...vols, 1) * 1.1;
  const vy = (v: number): number => 6 + ((volTop - v) / volTop) * (volHeight - 18);
  const rvPath = bars.map((b, i) => { const v = rv.get(istDate(b.time)); return v === undefined ? "" : `${x(i).toFixed(1)},${vy(v).toFixed(1)}`; }).filter(Boolean).join(" L");
  const ivByDate = new Map(iv.points.map((p) => [p.date, p.iv]));
  const loadedStart = bars.findIndex((b) => istDate(b.time) >= from);
  const loadedEnd = bars.findLastIndex((b) => istDate(b.time) <= to);
  const months = bars.flatMap((b, i) => (i > 0 && istDate(b.time).slice(5, 7) !== istDate(bars[i - 1]!.time).slice(5, 7) ? [[i, istDate(b.time).slice(0, 7)] as const] : []));
  return (
    <div ref={ref}>
      <svg viewBox={`0 0 ${width} ${priceHeight}`} width={width} height={priceHeight} className="block" role="img" aria-label="Underlying daily candles over the last year">
        {loadedStart >= 0 && loadedEnd >= loadedStart && <rect x={x(loadedStart) - step / 2} y={0} width={(loadedEnd - loadedStart + 1) * step} height={priceHeight} fill="rgba(41,98,255,0.10)"><title>The range loaded below</title></rect>}
        {bars.map((b, i) => {
          const colour = b.close >= b.open ? UP : DOWN;
          return (
            <g key={b.time}>
              <line x1={x(i)} x2={x(i)} y1={y(b.high)} y2={y(b.low)} stroke={colour} strokeWidth="1" />
              <rect x={x(i) - Math.max(step * 0.35, 0.5)} y={y(Math.max(b.open, b.close))} width={Math.max(step * 0.7, 1)} height={Math.max(Math.abs(y(b.open) - y(b.close)), 0.8)} fill={colour} />
            </g>
          );
        })}
        <text x={2} y={y(high) + 4} fontSize="9" fill={MUTED}>{high.toFixed(0)}</text>
        <text x={2} y={y(low)} fontSize="9" fill={MUTED}>{low.toFixed(0)}</text>
        {months.map(([i, label]) => <text key={label} x={x(i)} y={priceHeight - 4} fontSize="9" fill={MUTED}>{label}</text>)}
      </svg>
      <svg viewBox={`0 0 ${width} ${volHeight}`} width={width} height={volHeight} className="block" role="img" aria-label="Realized volatility and ATM implied volatility">
        {rvPath && <path d={`M${rvPath}`} fill="none" stroke={BLUE} strokeWidth="1.5" />}
        {bars.map((b, i) => { const v = ivByDate.get(istDate(b.time)); return v === undefined ? null : <circle key={b.time} cx={x(i)} cy={vy(v)} r="2.5" fill={AMBER}><title>{istDate(b.time)} ATM IV {v.toFixed(1)}%</title></circle>; })}
        <text x={pad} y={12} fontSize="9" fill={BLUE}>20-day realized volatility</text>
        <text x={pad + 150} y={12} fontSize="9" fill={AMBER}>● opening ATM IV, days loaded</text>
        <text x={width - pad} y={12} fontSize="9" fill={MUTED} textAnchor="end">{volTop.toFixed(0)}%</text>
      </svg>
    </div>
  );
}

export function VolatilityFacts({ iv, reaction }: { readonly iv: IvVsRealized; readonly reaction: IvReaction }) {
  const dearer = iv.averageSpread > 0;
  return (
    <div className="grid gap-2 md:grid-cols-2">
      <div className="rounded-md border border-panel-border bg-background/50 p-2">
        <div className="text-muted-foreground">IV minus realized volatility</div>
        <div className="text-lg font-semibold" style={{ color: dearer ? DOWN : UP }}>{iv.points.length === 0 ? "–" : `${signed(iv.averageSpread, 1)} pts`}</div>
        <p className="text-muted-foreground">{iv.points.length === 0 ? "No ordinary days to compare." : dearer
          ? "Options charged more volatility than the market delivered over the past 20 days: a headwind for buyers, as moves must beat that premium."
          : "Options charged less volatility than the market had been delivering: buyers paid less than recent moves would suggest."}</p>
      </div>
      <div className="rounded-md border border-panel-border bg-background/50 p-2">
        <div className="text-muted-foreground">How IV reacted to the market</div>
        <div className="flex gap-4 text-lg font-semibold">
          <span style={{ color: UP }} title={`${reaction.upDays} up days`}>Up days {signed(reaction.ivChangeOnUpDays, 1)}</span>
          <span style={{ color: DOWN }} title={`${reaction.downDays} down days`}>Down days {signed(reaction.ivChangeOnDownDays, 1)}</span>
        </div>
        <p className="text-muted-foreground">
          Average change in ATM IV from open to close, in points. Correlation with the day&apos;s move: {reaction.correlation.toFixed(2)}
          {reaction.correlation < -0.3 ? ", so IV tended to rise as the market fell: puts bought into a fall gained from IV too, calls bought into a rally lost some." : reaction.correlation > 0.3 ? ", so IV tended to rise with the market." : ", no clear link in this range."}
        </p>
      </div>
    </div>
  );
}

function SensitivityCard({ label, s, colour }: { readonly label: string; readonly s: Sensitivity; readonly colour: string }) {
  return (
    <div className="rounded-md border border-panel-border bg-background/50 p-2" title={`${s.samples} bar pairs on one contract; the underlying explains ${(s.fit * 100).toFixed(0)}% of the premium's moves`}>
      <div className="font-medium" style={{ color: colour }}>{label}</div>
      <div className="mt-1 flex items-baseline justify-between"><span className="text-muted-foreground">Per 1% move up</span><span className="text-lg font-semibold" style={{ color: s.perOnePercent >= 0 ? UP : DOWN }}>{signed(s.perOnePercent)}</span></div>
      <div className="flex items-baseline justify-between"><span className="text-muted-foreground">Per hour, market flat</span><span className="font-semibold" style={{ color: s.perHour >= 0 ? UP : DOWN }}>{signed(s.perHour)}</span></div>
      <div className="flex items-baseline justify-between text-[10px] text-muted-foreground"><span>Fit</span><span>{(s.fit * 100).toFixed(0)}% · {s.samples} bars</span></div>
    </div>
  );
}

export function SensitivityCards({ report }: { readonly report: SensitivityReport }) {
  const hoursToLoseOnePercentMove = report.call.perHour < 0 ? Math.abs(report.call.perOnePercent / report.call.perHour) : undefined;
  return (
    <div className="space-y-2">
      <div className="grid gap-2 md:grid-cols-3">
        <SensitivityCard label="ATM call" s={report.call} colour={UP} />
        <SensitivityCard label="ATM put" s={report.put} colour={DOWN} />
        <SensitivityCard label="Straddle (call + put)" s={report.straddle} colour={AMBER} />
      </div>
      <p className="text-muted-foreground">
        Measured from the bars themselves, not a pricing model: each premium change is split into the part that followed the underlying and the part that
        happened anyway (time decay). {hoursToLoseOnePercentMove !== undefined && <>At these rates, holding an ATM call for about <strong className="text-foreground">{hoursToLoseOnePercentMove.toFixed(1)} market hours</strong> (≈{(hoursToLoseOnePercentMove / SESSION_HOURS).toFixed(1)} sessions) costs as much as a 1% favourable move earns.</>}
        {" "}Expiry days are left out; the straddle&apos;s own sensitivity is near zero because its call and put offset.
      </p>
    </div>
  );
}

const dteLabel = (dte: number): string => (dte === 0 ? "Expiry day" : `${dte} day${dte === 1 ? "" : "s"} before`);

export function DteTable({ groups }: { readonly groups: readonly DteGroup[] }) {
  if (groups.length === 0) return <p className="text-muted-foreground">No expiry day in this range, so days cannot be placed in the cycle. Load a range that includes an expiry.</p>;
  return (
    <table className="data-table text-right text-[11px]">
      <thead className="text-muted-foreground">
        <tr><th className="py-1 text-left font-medium">Days to expiry</th><th className="font-medium">Days</th><th className="font-medium" title="Opening straddle as a share of spot: the move needed to break even">Straddle ÷ spot</th><th className="font-medium">Straddle open→close</th><th className="font-medium">Opening IV</th><th className="font-medium">Realized ÷ implied</th></tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <tr key={g.dte}>
            <td className="py-1 text-left">{dteLabel(g.dte)}</td>
            <td>{g.days}</td>
            <td>{g.straddlePct.toFixed(2)}%</td>
            <td>{signed(g.premiumChangePct, 1)}%</td>
            <td>{g.ivOpen.toFixed(1)}%</td>
            <td className="font-medium" style={{ color: g.moveRatio > 1 ? UP : DOWN }}>{g.moveRatio.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
