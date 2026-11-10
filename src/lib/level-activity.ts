const MAX_BUCKETS = 240;
const MAX_EVENTS = 4_000;

export interface ActivityLevel {
  readonly key: number;
  readonly quantity: number;
  readonly priceFrom?: number;
}

export interface ActivityTrade {
  readonly quantity: number;
  readonly aggressor: "buy" | "sell";
  /** Local receive timestamp (ms) so prints share the book observation clock. */
  readonly time: number;
}

export interface LevelFlow {
  bought: number;
  sold: number;
  pulled: number;
  added: number;
}

interface SideQty { bid: number; ask: number }

/** One unmatched print, stamped so it can never explain a decrease after the window. */
interface PendingTrade { at: number; side: "buy" | "sell"; quantity: number }

interface FlowEvent {
  at: number;
  key: number;
  bought: number;
  sold: number;
  pulled: number;
  added: number;
}

const finiteQty = (quantity: number): boolean => Number.isFinite(quantity) && quantity > 0;

const sideChange = (previous: number, next: number, traded: number): { pulled: number; added: number } => {
  const decrease = Math.max(0, previous - next);
  return { pulled: Math.max(0, decrease - traded), added: Math.max(0, next - previous) };
};

const readSide = (rows: Map<number, SideQty>, key: number): SideQty =>
  rows.get(key) ?? { bid: 0, ask: 0 };

const writeQty = (rows: Map<number, SideQty>, key: number, side: "bid" | "ask", quantity: number): void => {
  if (!Number.isFinite(key) || !Number.isFinite(quantity) || quantity < 0) return;
  const row = rows.get(key) ?? { bid: 0, ask: 0 };
  row[side] += quantity;
  rows.set(key, row);
};

const bookQuantities = (bids: readonly ActivityLevel[], asks: readonly ActivityLevel[]): Map<number, SideQty> => {
  const rows = new Map<number, SideQty>();
  for (const level of bids) writeQty(rows, level.key, "bid", level.quantity);
  for (const level of asks) writeQty(rows, level.key, "ask", level.quantity);
  return rows;
};

/** Sell prints hit bids; buy prints hit asks. The other side left without a trade. */
const consume = (
  entries: readonly PendingTrade[],
  side: "buy" | "sell",
  demand: number,
): { applied: number; left: PendingTrade[] } => {
  let applied = 0;
  const left: PendingTrade[] = [];
  for (const entry of entries) {
    if (entry.side !== side || applied >= demand) left.push(entry);
    else {
      const used = Math.min(demand - applied, entry.quantity);
      applied += used;
      if (entry.quantity > used) left.push({ at: entry.at, side: entry.side, quantity: entry.quantity - used });
    }
  }
  return { applied, left };
};

const deltaOf = (previous: SideQty, next: SideQty, pending: readonly PendingTrade[]): {
  pulled: number;
  added: number;
  left: readonly PendingTrade[];
} => {
  const sells = consume(pending, "sell", Math.max(0, previous.bid - next.bid));
  const buys = consume(sells.left, "buy", Math.max(0, previous.ask - next.ask));
  const bid = sideChange(previous.bid, next.bid, sells.applied);
  const ask = sideChange(previous.ask, next.ask, buys.applied);
  return { pulled: bid.pulled + ask.pulled, added: bid.added + ask.added, left: buys.left };
};

const keysOf = (previous: Map<number, SideQty>, next: Map<number, SideQty>): Set<number> => {
  const keys = new Set(previous.keys());
  for (const key of next.keys()) keys.add(key);
  return keys;
};

const blank = (): LevelFlow => ({ bought: 0, sold: 0, pulled: 0, added: 0 });

const addEvent = (flow: LevelFlow, event: FlowEvent): void => {
  flow.bought += event.bought;
  flow.sold += event.sold;
  flow.pulled += event.pulled;
  flow.added += event.added;
};

/** Rolling per-bucket prints and resting size that left without a matching trade. */
export class LevelActivity {
  private previous = new Map<number, SideQty>();
  private pending = new Map<number, PendingTrade[]>();
  private events: FlowEvent[] = [];
  private seenBook = false;

  public constructor(private readonly windowMs = 60_000) {}

  public reset(): void {
    this.previous.clear();
    this.pending.clear();
    this.events = [];
    this.seenBook = false;
  }

  public observeTrade(trade: ActivityTrade, bucketKey: number): void {
    if (!finiteQty(trade.quantity) || !Number.isFinite(bucketKey) || !Number.isFinite(trade.time)) return;
    const entries = this.pending.get(bucketKey) ?? [];
    entries.push({ at: trade.time, side: trade.aggressor, quantity: trade.quantity });
    this.pending.set(bucketKey, entries);
    this.events.push({
      at: trade.time,
      key: bucketKey,
      bought: trade.aggressor === "buy" ? trade.quantity : 0,
      sold: trade.aggressor === "sell" ? trade.quantity : 0,
      pulled: 0,
      added: 0,
    });
    this.prune(trade.time);
  }

  public observeBook(at: number, bids: readonly ActivityLevel[], asks: readonly ActivityLevel[]): void {
    if (!Number.isFinite(at)) return;
    const next = bookQuantities(bids, asks);
    if (this.seenBook) this.recordDelta(at, next);
    else this.pending.clear();
    this.previous = next;
    this.seenBook = true;
    this.prune(at);
  }

  public levels(at: number): ReadonlyMap<number, LevelFlow> {
    const cutoff = at - this.windowMs;
    const totals = new Map<number, LevelFlow>();
    for (const event of this.events) {
      if (event.at < cutoff) continue;
      const flow = totals.get(event.key) ?? blank();
      addEvent(flow, event);
      totals.set(event.key, flow);
    }
    return totals;
  }

  private recordDelta(at: number, next: Map<number, SideQty>): void {
    for (const key of keysOf(this.previous, next)) {
      const previous = readSide(this.previous, key);
      const current = readSide(next, key);
      const fresh = (entry: PendingTrade): boolean => entry.at >= at - this.windowMs;
      // A print older than the window arrived late; it must never explain this decrease.
      const freshPending = (this.pending.get(key) ?? []).filter(fresh);
      const delta = deltaOf(previous, current, freshPending);
      if (delta.pulled > 0 || delta.added > 0) {
        this.events.push({ at, key, bought: 0, sold: 0, pulled: delta.pulled, added: delta.added });
      }
      this.retainPending(key, delta.left);
    }
  }

  private retainPending(key: number, left: readonly PendingTrade[]): void {
    if (left.length === 0) this.pending.delete(key);
    else this.pending.set(key, [...left]);
  }

  private prune(at: number): void {
    const cutoff = at - this.windowMs;
    this.events = this.events.filter((event) => event.at >= cutoff);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    this.expirePending(cutoff);
    this.capBuckets();
  }

  private expirePending(cutoff: number): void {
    for (const [key, entries] of this.pending) {
      if (entries.every((entry) => entry.at < cutoff)) this.pending.delete(key);
      else this.pending.set(key, entries.filter((entry) => entry.at >= cutoff));
    }
  }

  private capBuckets(): void {
    const lastSeen = new Map<number, number>();
    for (const event of this.events) {
      const prior = lastSeen.get(event.key);
      if (prior === undefined || event.at >= prior) lastSeen.set(event.key, event.at);
    }
    if (lastSeen.size <= MAX_BUCKETS) return;
    const oldest = [...lastSeen.entries()].sort((left, right) => left[1] - right[1]);
    const drop = new Set(oldest.slice(0, lastSeen.size - MAX_BUCKETS).map(([key]) => key));
    this.events = this.events.filter((event) => !drop.has(event.key));
    for (const key of drop) this.pending.delete(key);
  }
}
