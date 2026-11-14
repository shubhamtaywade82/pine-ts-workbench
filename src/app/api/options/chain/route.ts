import { NextRequest, NextResponse } from "next/server";
import { isExpiry, isOptionUnderlying, optionChainSummary } from "@/lib/dhan-options";

export const dynamic = "force-dynamic";

/** GET /api/options/chain?segment=IDX_I&securityId=13&expiry=2026-11-17 → { ok, summary }. Cached: Dhan allows one call per 3 s. */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const segment = searchParams.get("segment") ?? "";
  const securityId = searchParams.get("securityId") ?? "";
  const expiry = searchParams.get("expiry") ?? "";
  if (!isOptionUnderlying(segment, securityId) || !isExpiry(expiry)) {
    return NextResponse.json({ ok: false, error: "unknown underlying or expiry" }, { status: 400 });
  }
  try {
    const { summary, asOf } = await optionChainSummary(segment, securityId, expiry);
    return NextResponse.json({ ok: true, summary: summary ?? null, asOf }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
