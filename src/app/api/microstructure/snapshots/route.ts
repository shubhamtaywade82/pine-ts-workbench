import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { snapshotFromRow } from "@/lib/book-replay";
import { parseSnapshotQuery } from "@/lib/market-recorder";

const formatSnapshot = (row: Parameters<typeof snapshotFromRow>[0]) => {
  const parsed = snapshotFromRow(row);
  return {
    id: row.id,
    symbol: row.symbol,
    capturedAt: row.capturedAt,
    lastUpdateId: parsed.lastUpdateId,
    bids: parsed.bids,
    asks: parsed.asks,
    coverage: {
      bidFloor: parsed.coverage.bidFloor,
      askCeiling: Number.isFinite(parsed.coverage.askCeiling) ? parsed.coverage.askCeiling : null,
    },
  };
};

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const query = parseSnapshotQuery(params.get("symbol"), params.get("at"));
  if (query === undefined) {
    return NextResponse.json({ ok: false, error: "Expected symbol and at (ms)" }, { status: 400 });
  }
  try {
    const row = await db.bookSnapshot.findFirst({
      where: { symbol: query.symbol, capturedAt: { lte: query.at } },
      orderBy: { capturedAt: "desc" },
    });
    return NextResponse.json({
      ok: true,
      snapshot: row === null ? null : formatSnapshot(row),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, error: "Failed to load snapshot", snapshot: null }, { status: 500 });
  }
}
