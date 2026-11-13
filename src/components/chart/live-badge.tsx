import type { FeedHealth, LiveStatus } from "@/hooks/use-live-bars";

const LIVE_BADGE: Record<LiveStatus, { label: string; dotClass: string }> = {
  loading: { label: "Loading", dotClass: "bg-[#787b86]" },
  live: { label: "Live", dotClass: "bg-[#089981] animate-pulse" },
  reconnecting: { label: "Reconnecting…", dotClass: "bg-[#ff9800]" },
};

const MARKET_CLOSED_BADGE = { label: "Market closed", dotClass: "bg-[#787b86]" };

/** Provider-health badge: connection state + tick age + data-quality warnings, or "Market closed" when trading has stopped. */
export function LiveBadge({ status, health, interval, symbol, isMarketClosed }: {
  readonly status: LiveStatus;
  readonly health: FeedHealth;
  readonly interval: string;
  readonly symbol: string;
  readonly isMarketClosed: boolean;
}) {
  const asOf = health.lastBarTime !== undefined ? new Date(health.lastBarTime).toLocaleTimeString() : "—";
  // A closed market is not a stale feed: nothing is expected to tick.
  if (isMarketClosed && status === "live") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground" title={`${symbol} ${interval}: market closed, last bar ${asOf}`}>
        <span className={`inline-block h-2 w-2 rounded-full ${MARKET_CLOSED_BADGE.dotClass}`} />
        {MARKET_CLOSED_BADGE.label}
      </span>
    );
  }
  const { label, dotClass } = LIVE_BADGE[status];
  const warnings: string[] = [];
  if (health.isStale) warnings.push(`stale feed — last tick ${Math.round((health.lastTickAgeMs ?? 0) / 1000)}s ago`);
  if (health.gapCount > 0) warnings.push(`${health.gapCount} missing-bar gap${health.gapCount > 1 ? "s" : ""} in history`);
  const title = warnings.length > 0
    ? `${symbol} ${interval}: ${warnings.join("; ")} (last bar ${asOf})`
    : `${symbol} ${interval}: connected, last bar ${asOf}`;
  const warnClass = warnings.length > 0 ? "text-[#ff9800]" : "text-muted-foreground";
  return (
    <span
      className={`flex items-center gap-1 text-[10px] ${warnClass} ${health.isStale ? "animate-pulse" : ""}`}
      title={title}
    >
      <span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} />
      {warnings.length > 0 ? "⚠ " : ""}{label}
      {health.lastTickAgeMs !== undefined && status === "live" && !health.isStale && (
        <span className="hidden text-[9px] opacity-60 sm:inline">+{Math.max(0, Math.round(health.lastTickAgeMs / 1000))}s</span>
      )}
    </span>
  );
}
