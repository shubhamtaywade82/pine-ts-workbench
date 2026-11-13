import { NextRequest, NextResponse } from "next/server";
import { fetchCoindcxBars, isCoindcxInterval, isCoindcxPair } from "@/lib/coindcx-bars";

export const dynamic = "force-dynamic";

const MAX_BARS = 1000;

/** GET /api/coindcx/candles?pair=B-BTC_USDT&interval=5m&limit=500 → { ok, bars }. A proxy: CoinDCX sends no CORS headers. */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const pair = searchParams.get("pair") ?? "";
  const interval = searchParams.get("interval") ?? "";
  const limit = Math.min(Number(searchParams.get("limit") ?? 500) || 500, MAX_BARS);

  if (!isCoindcxPair(pair)) return NextResponse.json({ ok: false, error: "unknown CoinDCX pair" }, { status: 400 });
  if (!isCoindcxInterval(interval)) return NextResponse.json({ ok: false, error: `CoinDCX has no ${interval} candles` }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, bars: await fetchCoindcxBars(pair, interval, limit) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
