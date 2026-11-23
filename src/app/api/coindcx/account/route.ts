import { NextRequest, NextResponse } from "next/server";
import { fetchCoindcxBalances, fetchCoindcxUserInfo } from "@/lib/coindcx-client";

export const dynamic = "force-dynamic";

/** Extracts API credentials from request headers or environment. */
function getCredentials(req: NextRequest) {
  const apiKey = req.headers.get("x-coindcx-apikey") || process.env.COINDCX_API_KEY || "";
  const apiSecret = req.headers.get("x-coindcx-secret") || process.env.COINDCX_API_SECRET || "";
  return { apiKey: apiKey.trim(), apiSecret: apiSecret.trim() };
}

/** GET /api/coindcx/account → { ok, balances, userInfo }. */
export async function GET(req: NextRequest) {
  const { apiKey, apiSecret } = getCredentials(req);
  if (!apiKey || !apiSecret) {
    return NextResponse.json({ ok: false, error: "Missing CoinDCX API credentials" }, { status: 400 });
  }

  try {
    const [balances, userInfo] = await Promise.all([
      fetchCoindcxBalances(apiKey, apiSecret),
      fetchCoindcxUserInfo(apiKey, apiSecret).catch(() => ({ coindcxId: "coindcx-user" })),
    ]);
    return NextResponse.json({ ok: true, balances, userInfo }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}

/** Disallows order placement or mutations. */
export async function POST() {
  return NextResponse.json({ ok: false, error: "Order placement is disabled (read-only mode)" }, { status: 403 });
}
