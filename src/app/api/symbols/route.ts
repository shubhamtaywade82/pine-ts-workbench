import { NextRequest, NextResponse } from "next/server";
import { searchAllSymbols } from "@/lib/symbol-sources";
import type { SymbolCategory } from "@/lib/symbol-catalog";

// Server-side only: Dhan's token and the provider market lists stay off the browser.
export const dynamic = "force-dynamic";

const CATEGORIES: readonly SymbolCategory[] = ["all", "crypto", "index", "stock", "derivative"];

/** GET /api/symbols?q=reliance&category=all → { ok, symbols, warnings } across Binance, CoinDCX and Dhan. */
export async function GET(req: NextRequest) {
  const query = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const category = (req.nextUrl.searchParams.get("category") ?? "all") as SymbolCategory;
  if (!CATEGORIES.includes(category)) return NextResponse.json({ ok: false, error: `unknown category ${category}` }, { status: 400 });
  if (query === "") return NextResponse.json({ ok: true, symbols: [], warnings: [] });
  return NextResponse.json({ ok: true, ...(await searchAllSymbols(query, category)) }, { headers: { "Cache-Control": "no-store" } });
}
