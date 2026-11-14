import { NextRequest, NextResponse } from "next/server";
import { contractLotSize, isContract } from "@/lib/dhan-options";

export const dynamic = "force-dynamic";

/** GET /api/options/lot?segment=NSE_FNO&securityId=45392 → { ok, lotSize }; lotSize is null when Dhan does not list it. */
export async function GET(req: NextRequest) {
  const segment = req.nextUrl.searchParams.get("segment") ?? "";
  const securityId = req.nextUrl.searchParams.get("securityId") ?? "";
  if (!isContract(segment, securityId)) return NextResponse.json({ ok: false, error: "unknown contract" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, lotSize: (await contractLotSize(segment, securityId)) ?? null });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
