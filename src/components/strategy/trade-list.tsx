"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isLong, tradeReturnPercent, tradesCsv, type ReportTrade } from "@/lib/backtest-report";
import { formatDateTime, formatMoney, formatPercent, pnlClass } from "@/components/strategy/report-format";

/** TradingView's "List of trades": newest first, each trade an exit row over an entry row. */
export function TradeList({ trades, quoteCurrency }: { trades: readonly ReportTrade[]; quoteCurrency: string }) {
  const numbered = trades.map((trade, i) => ({ trade, number: i + 1 })).reverse();
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between px-4 py-2">
        <h3 className="text-base font-semibold">List of trades</h3>
        <Button variant="outline" size="sm" className="h-8 w-8 p-0" title="Download CSV" onClick={() => downloadCsv(trades)}>
          <Download className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-4 py-2 text-left font-normal">Trade number ↓</th>
              <th className="px-2 text-left font-normal">Type</th>
              <th className="px-2 text-left font-normal">Date and time</th>
              <th className="px-2 text-right font-normal">Price</th>
              <th className="px-2 text-right font-normal">Size</th>
              <th className="px-2 text-right font-normal">Net PnL</th>
              <th className="px-4 text-right font-normal">Return</th>
            </tr>
          </thead>
          <tbody>
            {numbered.map(({ trade, number }) => (
              <TradeRows key={number} trade={trade} number={number} quoteCurrency={quoteCurrency} />
            ))}
          </tbody>
        </table>
        {trades.length === 0 && <p className="p-6 text-center text-xs text-muted-foreground">No closed trades.</p>}
      </div>
    </div>
  );
}

function TradeRows({ trade, number, quoteCurrency }: { trade: ReportTrade; number: number; quoteCurrency: string }) {
  const long = isLong(trade);
  const merged = "align-middle border-b border-border";
  return (
    <>
      <tr className="hover:bg-muted/40">
        <td rowSpan={2} className={`px-4 ${merged}`}>
          {number} <span className={long ? "text-[#2962ff]" : "text-[#f23645]"}>{long ? "Long" : "Short"}</span>
        </td>
        <td className="border-b border-border/50 px-2 py-2">Exit</td>
        <td className="border-b border-border/50 px-2">{formatDateTime(trade.exitTime)}</td>
        <td className="border-b border-border/50 px-2 text-right">{trade.exitPrice.toFixed(2)} <Unit text={quoteCurrency} /></td>
        <td rowSpan={2} className={`px-2 text-right ${merged}`}>
          {trade.qty}
          <div className="text-xs">{(trade.qty * trade.entryPrice).toFixed(2)} <Unit text={quoteCurrency} /></div>
        </td>
        <td rowSpan={2} className={`px-2 text-right ${merged} ${pnlClass(trade.profit)}`}>{formatMoney(trade.profit, quoteCurrency)}</td>
        <td rowSpan={2} className={`px-4 text-right ${merged} ${pnlClass(trade.profit)}`}>{formatPercent(tradeReturnPercent(trade))}</td>
      </tr>
      <tr className="hover:bg-muted/40">
        <td className="border-b border-border px-2 py-2">Entry</td>
        <td className="border-b border-border px-2">{formatDateTime(trade.entryTime)}</td>
        <td className="border-b border-border px-2 text-right">{trade.entryPrice.toFixed(2)} <Unit text={quoteCurrency} /></td>
      </tr>
    </>
  );
}

function Unit({ text }: { text: string }) {
  return <span className="text-[10px] text-muted-foreground">{text}</span>;
}

const downloadCsv = (trades: readonly ReportTrade[]) => {
  const url = URL.createObjectURL(new Blob([tradesCsv(trades)], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "list-of-trades.csv";
  link.click();
  URL.revokeObjectURL(url);
};
