import { useElementWidth } from "@/hooks/use-element-width";
import type { DayStats, Group, ProfilePoint, RollingRow } from "@/lib/rolling-options";

const UP = "var(--up)";
const DOWN = "var(--down)";
const BLUE = "#2962ff";
const AMBER = "var(--warn)";
const MUTED = "var(--muted-foreground)";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const signed = (value: number, digits = 1): string => `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
const ratioColour = (ratio: number): string => (ratio > 1 ? UP : DOWN);
const changeColour = (value: number): string => (value >= 0 ? UP : DOWN);

export interface Series { readonly label: string; readonly colour: string; readonly values: readonly number[]; readonly isDashed?: boolean }

/** A plain multi-line SVG chart over shared x positions, each series scaled on its own axis when `independent`. */
export function LineChart({ series, labels, height = 160, independent = false, zeroLine = false }: {
  readonly series: readonly Series[]; readonly labels: readonly string[]; readonly height?: number; readonly independent?: boolean; readonly zeroLine?: boolean;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>(640);
  const pad = 22;
  const count = Math.max(...series.map((s) => s.values.length), 2);
  const all = series.flatMap((s) => s.values);
  const bounds = (values: readonly number[]): [number, number] => {
    const low = Math.min(...values, zeroLine ? 0 : Number.POSITIVE_INFINITY);
    const high = Math.max(...values, zeroLine ? 0 : Number.NEGATIVE_INFINITY);
    return high === low ? [low - 1, high + 1] : [low, high];
  };
  const shared = bounds(all);
  const x = (i: number): number => pad + (i / (count - 1)) * (width - 2 * pad);
  const y = (v: number, [low, high]: [number, number]): number => pad + ((high - v) / (high - low)) * (height - 2 * pad);
  const tickEvery = Math.max(1, Math.ceil(labels.length / Math.max(4, Math.floor(width / 110))));
  return (
    <div ref={ref}>
      <div className="mb-1 flex flex-wrap gap-3 text-[10px]">
        {series.map((s) => <span key={s.label} style={{ color: s.colour }}>━ {s.label}{s.values.length > 0 ? ` · ${s.values[s.values.length - 1]!.toFixed(2)} at the end` : ""}</span>)}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block" role="img" aria-label={series.map((s) => s.label).join(", ")}>
        {zeroLine && <line x1={pad} x2={width - pad} y1={y(0, shared)} y2={y(0, shared)} stroke={MUTED} strokeWidth="1" />}
        {series.map((s) => {
          const range = independent ? bounds(s.values) : shared;
          const d = s.values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v, range).toFixed(1)}`).join(" ");
          return <path key={s.label} d={d} fill="none" stroke={s.colour} strokeWidth="1.5" strokeDasharray={s.isDashed ? "4 3" : undefined} />;
        })}
        {labels.map((label, i) => (i % tickEvery === 0 ? <text key={i} x={x(i)} y={height - 6} fontSize="9" fill={MUTED} textAnchor="middle">{label}</text> : null))}
      </svg>
    </div>
  );
}

export function SummaryCards({ group, expiryDays }: { readonly group: Group; readonly expiryDays: number }) {
  const cards: readonly (readonly [string, string, string, string?])[] = [
    ["Ordinary days", `${group.days}${expiryDays > 0 ? ` (+${expiryDays} expiry)` : ""}`, "Days these figures cover. Expiry days are counted apart: their collapse to zero would swamp the averages"],
    ["Moved more than priced", `${group.movedMoreShare.toFixed(0)}%`, "Share of days whose open-to-close move beat the 1σ daily move the opening ATM IV priced: the days that suited buyers"],
    ["Avg realized ÷ implied", group.avgMoveRatio.toFixed(2), "Average of each day's actual move over its priced move. Below 1, options were dear for buyers on average", ratioColour(group.avgMoveRatio)],
    ["Avg straddle change, open→close", `${signed(group.avgPremiumChangePct)}%`, "How the at-the-money straddle's price changed through the day, on average: mostly time decay"],
    ["Avg opening ATM IV", `${group.avgIvOpen.toFixed(1)}%`, "Implied volatility at the open, averaged over the days"],
  ];
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
      {cards.map(([label, value, hint, colour]) => (
        <div key={label} className="rounded-md border border-panel-border bg-background/50 p-2" title={hint}>
          <div className="text-muted-foreground">{label}</div>
          <div className="text-lg font-semibold tabular-nums" style={{ color: colour }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

export function WeekdayTable({ groups, expiry }: { readonly groups: readonly (Group & { readonly weekday: number })[]; readonly expiry: Group }) {
  return (
    <table className="data-table text-right text-[11px]">
      <thead className="text-muted-foreground">
        <tr><th className="py-1 text-left font-medium">Weekday</th><th className="font-medium">Days</th><th className="font-medium">Moved more</th><th className="font-medium">Realized ÷ implied</th><th className="font-medium">Straddle open→close</th><th className="font-medium">Opening IV</th></tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <tr key={g.weekday}>
            <td className="py-1 text-left">{WEEKDAYS[g.weekday]}</td>
            <td>{g.days}</td>
            <td>{g.movedMoreShare.toFixed(0)}%</td>
            <td className="font-medium" style={{ color: ratioColour(g.avgMoveRatio) }}>{g.avgMoveRatio.toFixed(2)}</td>
            <td>{signed(g.avgPremiumChangePct)}%</td>
            <td>{g.avgIvOpen.toFixed(1)}%</td>
          </tr>
        ))}
        {expiry.days > 0 && (
          <tr className="text-muted-foreground" title="Days the tracked contract expired: premium falls to what it is worth in the money, and IV to zero">
            <td className="py-1 text-left"><span className="tone-pill text-warn">Expiry days</span></td>
            <td>{expiry.days}</td>
            <td>{expiry.movedMoreShare.toFixed(0)}%</td>
            <td>{expiry.avgMoveRatio.toFixed(2)}</td>
            <td>{signed(expiry.avgPremiumChangePct)}%</td>
            <td>{expiry.avgIvOpen.toFixed(1)}%</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

const clock = (minute: number): string => {
  const total = 9 * 60 + 15 + minute;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

export function ProfileChart({ profile }: { readonly profile: readonly ProfilePoint[] }) {
  return (
    <LineChart
      labels={profile.map((p) => clock(p.minute))}
      independent
      series={[
        { label: "Straddle vs open (%)", colour: AMBER, values: profile.map((p) => p.premiumPct) },
        { label: "Spot distance from open (%)", colour: BLUE, values: profile.map((p) => p.spotMovePct) },
      ]}
    />
  );
}

export function DayTable({ days, selected, onSelect }: { readonly days: readonly DayStats[]; readonly selected: string | undefined; readonly onSelect: (date: string) => void }) {
  return (
    <table className="data-table text-right text-[11px]">
      <thead className="text-muted-foreground">
        <tr>
          <th className="py-1 text-left font-medium">Date</th><th className="font-medium">Spot open→close</th><th className="font-medium">Range</th>
          <th className="font-medium">Implied 1σ</th><th className="font-medium">Realized ÷ implied</th><th className="font-medium">Straddle open→close</th><th className="font-medium">IV open→close</th>
        </tr>
      </thead>
      <tbody>
        {[...days].reverse().map((d) => (
          <tr key={d.date} onClick={() => onSelect(d.date)} className={`cursor-pointer hover:bg-muted/40 ${selected === d.date ? "bg-[#2962ff]/15" : ""}`}>
            <td className="py-1 text-left">{d.date} {WEEKDAYS[d.weekday]}{d.isExpiryDay && <span className="ml-1 rounded bg-warn/15 px-1 text-warn">expiry</span>}</td>
            <td style={{ color: changeColour(d.spotClose - d.spotOpen) }}>{d.spotOpen.toFixed(0)} → {d.spotClose.toFixed(0)}</td>
            <td>{(d.spotHigh - d.spotLow).toFixed(0)}</td>
            <td>{d.impliedMove.toFixed(0)}</td>
            <td style={{ color: ratioColour(d.moveRatio) }}>{d.moveRatio.toFixed(2)}</td>
            <td style={{ color: changeColour(d.premiumChangePct) }}>{d.premiumOpen.toFixed(1)} → {d.premiumClose.toFixed(1)} ({signed(d.premiumChangePct)}%)</td>
            <td>{d.ivOpen.toFixed(1)} → {d.ivClose.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const time = (ms: number): string => new Date(ms + 19_800_000).toISOString().slice(11, 16);

/** One day bar by bar: spot, each side's premium and their sum, IV, and where the rolling strike changed. */
export function DayDetail({ rows }: { readonly rows: readonly RollingRow[] }) {
  const labels = rows.map((r) => time(r.time));
  const rolls = rows.filter((r, i) => i > 0 && r.ce.strike !== rows[i - 1]!.ce.strike).length;
  return (
    <div className="space-y-3">
      <LineChart labels={labels} independent series={[
        { label: "Spot", colour: "var(--foreground)", values: rows.map((r) => r.spot) },
        { label: "Call + put", colour: AMBER, values: rows.map((r) => r.ce.close + r.pe.close) },
      ]} />
      <LineChart labels={labels} series={[
        { label: "Call premium", colour: UP, values: rows.map((r) => r.ce.close) },
        { label: "Put premium", colour: DOWN, values: rows.map((r) => r.pe.close) },
      ]} />
      <LineChart labels={labels} series={[
        { label: "Call IV", colour: UP, values: rows.map((r) => r.ce.iv), isDashed: true },
        { label: "Put IV", colour: DOWN, values: rows.map((r) => r.pe.iv), isDashed: true },
      ]} />
      <p className="text-[10px] text-muted-foreground">
        The strike rolled {rolls} time{rolls === 1 ? "" : "s"} this day to stay at the money ({rows[0]?.ce.strike} at the open, {rows.at(-1)?.ce.strike} at the close), so premiums jump where it did.
        The top chart puts spot and the straddle on their own scales.
      </p>
    </div>
  );
}
