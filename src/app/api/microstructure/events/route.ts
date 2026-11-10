import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseEventQuery, type EventQuery, type MarketEventKind } from "@/lib/market-recorder";

const MAX_EVENTS = 20_000;
const MAX_RANGE_MS = 10 * 60 * 1000;
const VALID_KINDS = new Set<MarketEventKind>(["depth", "trade", "gap"]);

const isEventKind = (value: string): value is MarketEventKind =>
  VALID_KINDS.has(value as MarketEventKind);

const parseKindFilter = (value: string | null): { valid: true; kind?: MarketEventKind } | { valid: false } => {
  if (value === null || value.trim() === "") return { valid: true };
  if (isEventKind(value)) return { valid: true, kind: value };
  return { valid: false };
};

const eventJson = (row: {
  id: number;
  symbol: string;
  kind: string;
  seq: bigint;
  exchangeTime: number | null;
  receivedAt: number;
  payload: string;
  schemaVersion: number;
}) => ({
  id: row.id,
  symbol: row.symbol,
  kind: row.kind,
  seq: Number(row.seq),
  exchangeTime: row.exchangeTime,
  receivedAt: row.receivedAt,
  payload: row.payload,
  schemaVersion: row.schemaVersion,
});

const loadEvents = async (query: EventQuery, kind?: MarketEventKind) => {
  const where = {
    symbol: query.symbol,
    receivedAt: { gte: query.from, lte: query.to },
    ...(kind !== undefined ? { kind } : {}),
  };
  const rows = await db.marketEvent.findMany({
    where,
    orderBy: { receivedAt: "asc" },
    take: MAX_EVENTS + 1,
  });
  const hasMore = rows.length > MAX_EVENTS;
  return { ok: true as const, hasMore, events: rows.slice(0, MAX_EVENTS).map(eventJson) };
};

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const query = parseEventQuery(params.get("symbol"), params.get("from"), params.get("to"));
  if (query === undefined) {
    return NextResponse.json({ ok: false, error: "Expected symbol, from, and to (ms)" }, { status: 400 });
  }
  if (query.to - query.from > MAX_RANGE_MS) {
    return NextResponse.json({ ok: false, error: "Range cannot exceed 10 minutes" }, { status: 400 });
  }
  const kindFilter = parseKindFilter(params.get("kind"));
  if (!kindFilter.valid) {
    return NextResponse.json({ ok: false, error: "Invalid kind: expected 'depth', 'trade', or 'gap'" }, { status: 400 });
  }
  try {
    return NextResponse.json(await loadEvents(query, kindFilter.kind));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, error: "Failed to load events", events: [] }, { status: 500 });
  }
}
