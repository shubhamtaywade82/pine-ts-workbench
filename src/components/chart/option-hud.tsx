import type { ChainSummary } from "@/lib/option-chain";
import { hudReason, type LongOptionFilter, type VixReading } from "@/lib/option-filter";

const TONE: Record<LongOptionFilter["side"], string> = { CE: "var(--up)", PE: "var(--down)", NONE: "var(--warn)" };

interface HudProps {
  readonly filter: LongOptionFilter;
  readonly summary: ChainSummary;
  readonly vix: VixReading | undefined;
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
  readonly onOpenPanel: () => void;
  readonly onTurnOff: () => void;
}

/** A small card in the chart's top-right corner: which long option side the evidence supports, and why. */
export function OptionHud({ filter, summary, vix, isExpanded, onToggle, onOpenPanel, onTurnOff }: HudProps) {
  const tone = TONE[filter.side];
  const { bias, resistances, supports } = summary.analytics;
  const reason = hudReason(filter);
  return (
    <div
      className="pointer-events-auto absolute right-16 top-8 z-10 w-56 rounded border bg-background/90 px-2 py-1.5 text-[10px] tabular-nums shadow-lg backdrop-blur-sm"
      style={{ borderColor: tone }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 text-left"
        title={isExpanded ? "Shrink to the verdict" : "Show the reason and key figures"}
        aria-expanded={isExpanded}
      >
        <span className="text-[13px] font-semibold" style={{ color: tone }}>{filter.label}</span>
        <span className="text-muted-foreground">{isExpanded ? "▴" : "▾"}</span>
      </button>
      {isExpanded && (
        <div className="mt-1 space-y-0.5 text-muted-foreground">
          {reason && <p className="line-clamp-2 text-foreground">{reason}</p>}
          <div className="flex justify-between"><span>Bias</span><span className="text-foreground">{bias.label} {bias.score > 0 ? "+" : ""}{bias.score}</span></div>
          <div className="flex justify-between"><span>PCR</span><span className="text-foreground">{summary.analytics.pcrOi.toFixed(2)}</span></div>
          {vix && <div className="flex justify-between"><span>VIX</span><span className="text-foreground">{vix.level.toFixed(1)} · {vix.percentile.toFixed(0)}th pct</span></div>}
          <div className="flex justify-between"><span>Walls</span><span className="text-foreground">{supports[0]?.strike ?? "–"} / {resistances[0]?.strike ?? "–"}</span></div>
          <div className="flex justify-between pt-0.5">
            <button type="button" onClick={onOpenPanel} className="text-[#2962ff] hover:underline">Open dashboard</button>
            <button type="button" onClick={onTurnOff} className="hover:text-foreground hover:underline" title="Remove the lines and this card from every chart. Turn it back on from the Options panel.">Turn overlay off</button>
          </div>
          <p className="border-t border-border pt-0.5 text-[9px]">Rule-based read, not advice.</p>
        </div>
      )}
    </div>
  );
}
