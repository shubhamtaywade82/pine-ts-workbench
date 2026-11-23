import { NextRequest, NextResponse } from "next/server";
import { fetchCoindcxPositions } from "@/lib/coindcx-client";

export const dynamic = "force-dynamic";

function getCredentials(req: NextRequest) {
  const apiKey = req.headers.get("x-coindcx-apikey") || process.env.COINDCX_API_KEY || "";
  const apiSecret = req.headers.get("x-coindcx-secret") || process.env.COINDCX_API_SECRET || "";
  return { apiKey: apiKey.trim(), apiSecret: apiSecret.trim() };
}

/** GET /api/coindcx/positions → { ok, positions }. */
export async function GET(req: NextRequest) {
  const { apiKey, apiSecret } = getCredentials(req);
  if (!apiKey || !apiSecret) {
    return NextResponse.json({ ok: false, error: "Missing CoinDCX API credentials" }, { status: 400 });
  }

  try {
    const positions = await fetchCoindcxPositions(apiKey, apiSecret);
    return NextResponse.json({ ok: true, positions }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}

/** Disallows order placement or mutations. */
export async function POST() {
  return NextResponse.json({ ok: false, error: "Order placement is disabled (read-only mode)" }, { status: 403 });
}
