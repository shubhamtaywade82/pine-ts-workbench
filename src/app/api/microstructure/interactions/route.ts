import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseInteractionQuery, type InteractionQuery } from "@/lib/market-recorder";

const MAX_ROWS = 5_000;

const interactionJson = (row: {
  id: number;
  wallId: string;
  symbol: string;
  side: string;
  levelPrice: number;
  detectedAt: number;
  startAt: number;
  resolvedAt: number | null;
  outcome: string;
  mfePct: number | null;
  maePct: number | null;
  classifierVersion: string;
}) => ({
  id: row.id,
  wallId: row.wallId,
  symbol: row.symbol,
  side: row.side,
  levelPrice: row.levelPrice,
  detectedAt: row.detectedAt,
  startAt: row.startAt,
  resolvedAt: row.resolvedAt,
  outcome: row.outcome,
  mfePct: row.mfePct,
  maePct: row.maePct,
  classifierVersion: row.classifierVersion,
});

const loadInteractions = async (query: InteractionQuery) => {
  const rows = await db.liquidityInteraction.findMany({
    where: {
      symbol: query.symbol,
      startAt: { gte: query.from, lte: query.to },
      ...(query.side === "all" ? {} : { side: query.side }),
    },
    orderBy: { startAt: "desc" },
    take: MAX_ROWS + 1,
  });
  const hasMore = rows.length > MAX_ROWS;
  return { ok: true as const, hasMore, interactions: rows.slice(0, MAX_ROWS).reverse().map(interactionJson) };
};

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const query = parseInteractionQuery(params.get("symbol"), params.get("from"), params.get("to"), params.get("side"));
  if (query === undefined) {
    return NextResponse.json(
      { ok: false, error: "Expected symbol, from, and to (ms); side is all, bid, or ask" },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await loadInteractions(query));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, error: "Failed to load interactions", interactions: [] }, { status: 500 });
  }
}
