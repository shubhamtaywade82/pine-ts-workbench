"use client";

import Link from "next/link";
import { marginCurrencySymbol, pairPriceSymbol, type CoindcxPosition } from "@/lib/coindcx-client";

/** Badge in chart cell header linking to CoinDCX dashboard. */
export function CoindcxPositionBadge({ positions }: { readonly positions: readonly CoindcxPosition[] }) {
  if (positions.length === 0) return null;
  return (
    <>
      {positions.map((pos) => {
        const isLong = pos.side === "LONG";
        const sign = pos.unrealizedPnl >= 0 ? "+" : "-";
        const priceSym = pairPriceSymbol(pos.pair);
        const mrgSym = marginCurrencySymbol(pos.marginCurrency);
        return (
          <Link
            key={pos.id}
            href="/coindcx"
            title={`CoinDCX ${pos.side}: ${pos.size} @ ${priceSym}${pos.entryPrice.toLocaleString()}. Click for CoinDCX portfolio.`}
            className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold transition-opacity hover:opacity-80 ${
              isLong ? "border-[#089981]/50 bg-[#089981]/15 text-[#089981]" : "border-[#f23645]/50 bg-[#f23645]/15 text-[#f23645]"
            }`}
          >
            <span>CoinDCX {pos.side} {pos.size}</span>
            <span className="opacity-75">@ {priceSym}{pos.entryPrice.toLocaleString()}</span>
            <span className={pos.unrealizedPnl >= 0 ? "text-[#089981]" : "text-[#f23645]"}>
              {sign}{mrgSym}{Math.abs(pos.unrealizedPnl).toFixed(1)}
            </span>
          </Link>
        );
      })}
    </>
  );
}
