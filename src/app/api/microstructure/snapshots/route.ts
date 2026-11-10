import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseSnapshotQuery } from "@/lib/market-recorder";

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
      snapshot: row === null ? null : {
        id: row.id,
        symbol: row.symbol,
        capturedAt: row.capturedAt,
        lastUpdateId: Number(row.lastUpdateId),
        bids: row.bids,
        asks: row.asks,
        coverage: row.coverage,
      },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err), snapshot: null }, { status: 500 });
  }
}
