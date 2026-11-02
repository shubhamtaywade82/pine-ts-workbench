"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  findSymbol,
  loadWatchlist,
  saveWatchlist,
  type SymbolOption,
} from "@/lib/symbol-catalog";
import { SymbolSearchDialog } from "./symbol-search-dialog";
import { compactVolume, useWatchQuotes, type WatchQuote } from "@/lib/watchlist-quotes";

export interface WatchlistPanelProps {
  readonly currentSymbol: string;
  readonly onSelectSymbol: (symbol: SymbolOption) => void;
  readonly onClose?: () => void;
}

/**
 * Watchlist panel — TradingView-style columns: symbol, last price, 24h
 * change %, 24h volume. Rows drag-reorder; the order persists. Quotes come
 * from Binance's public ticker stream (crypto only; NSE rows show no quote).
 */

const pctClass = (value: number): string =>
  value > 0 ? "text-[#089981]" : value < 0 ? "text-[#f23645]" : "text-muted-foreground";

const fmtPrice = (value: number): string =>
  value >= 100 ? value.toFixed(2) : value >= 1 ? value.toFixed(3) : value.toPrecision(4);

export function WatchlistPanel({
  currentSymbol,
  onSelectSymbol,
  onClose,
}: WatchlistPanelProps) {
  const [watchedTickers, setWatchedTickers] = useState<readonly string[]>(() => loadWatchlist());
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const { quotes } = useWatchQuotes(
    watchedTickers.map((t) => t.replace("NSE:", "")).filter((t) => !t.startsWith("NSE")),
  );

  const persist = (next: readonly string[]) => {
    setWatchedTickers(next);
    saveWatchlist(next);
  };

  const removeTicker = (ticker: string) => {
    persist(watchedTickers.filter((t) => t !== ticker));
  };

  const addSymbol = (symbol: SymbolOption) => {
    if (!watchedTickers.includes(symbol.ticker)) persist([...watchedTickers, symbol.ticker]);
    onSelectSymbol(symbol);
  };

  /** Drag-to-reorder: drop the dragged row at the target index. */
  const dropOn = (targetIndex: number) => {
    if (dragIndex === null || dragIndex === targetIndex) return;
    const next = [...watchedTickers];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(targetIndex, 0, moved!);
    persist(next);
    setDragIndex(null);
  };

  const watchedItems = watchedTickers
    .map((ticker) => ({ ticker, symbol: findSymbol(ticker) }))
    .filter((s): s is { ticker: string; symbol: SymbolOption } => s.symbol !== undefined);

  return (
    <div className="flex h-full flex-col bg-background text-white">
      <div className="flex items-center justify-between border-b border-border p-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#b2b5be]">Watchlist</span>
          <span className="rounded bg-muted px-1.5 py-0.2 text-[10px] text-muted-foreground">
            {watchedItems.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Add symbol to watchlist"
            onClick={() => setIsSearchOpen(true)}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-white"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          {onClose && (
            <button
              type="button"
              title="Close watchlist"
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Column header */}
      <div className="grid grid-cols-[1fr_70px_55px_55px] gap-1 border-b border-border px-2.5 py-1 text-[10px] uppercase tracking-wide text-[#787b86]">
        <span>Symbol</span>
        <span className="text-right">Last</span>
        <span className="text-right">Chg%</span>
        <span className="text-right">Vol</span>
      </div>

      <div className="flex-1 overflow-y-auto p-1 [scrollbar-width:thin]">
        {watchedItems.map(({ ticker, symbol: item }, index) => {
          const isActive = currentSymbol === item.ticker || currentSymbol === item.binanceSymbol;
          const quote: WatchQuote | undefined = quotes.get(item.binanceSymbol);
          return (
            <div
              key={ticker}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dropOn(index)}
              onDragEnd={() => setDragIndex(null)}
              className={`grid cursor-pointer grid-cols-[1fr_70px_55px_55px] items-center gap-1 rounded px-2.5 py-2 transition-colors ${
                isActive ? "bg-muted" : dragIndex === index ? "opacity-40" : "hover:bg-muted/50"
              }`}
              onClick={() => onSelectSymbol(item)}
              title="Drag to reorder"
            >
              <div className="flex min-w-0 flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-semibold text-white">{ticker}</span>
                  <Badge
                    variant="secondary"
                    className={`px-1 py-0 text-[8px] uppercase ${
                      item.exchange === "BINANCE"
                        ? "bg-amber-500/15 text-amber-400"
                        : "bg-blue-500/15 text-blue-400"
                    }`}
                  >
                    {item.exchange}
                  </Badge>
                </div>
                <span className="truncate text-[10px] text-[#787b86]">{item.displayName}</span>
              </div>

              <span className="text-right font-mono text-xs tabular-nums">
                {quote ? fmtPrice(quote.lastPrice) : "—"}
              </span>
              <span className={`text-right font-mono text-xs tabular-nums ${quote ? pctClass(quote.priceChangePercent) : "text-muted-foreground"}`}>
                {quote ? `${quote.priceChangePercent > 0 ? "+" : ""}${quote.priceChangePercent.toFixed(2)}%` : "—"}
              </span>
              <span className="text-right font-mono text-[10px] tabular-nums text-[#787b86]">
                {quote ? compactVolume(quote.volume) : "—"}
              </span>

              <button
                type="button"
                title={`Remove ${ticker} from watchlist`}
                onClick={(e) => {
                  e.stopPropagation();
                  removeTicker(ticker);
                }}
                className="invisible col-span-4 -mt-1 self-end text-right group-hover:visible"
              >
                <X className="ml-auto h-3 w-3 hover:text-[#f23645]" />
              </button>
            </div>
          );
        })}
        {watchedItems.length === 0 && (
          <p className="px-2.5 py-4 text-xs text-muted-foreground">
            Watchlist is empty — click + to add symbols.
          </p>
        )}
      </div>

      <SymbolSearchDialog
        open={isSearchOpen}
        onOpenChange={setIsSearchOpen}
        onSelect={addSymbol}
        currentSymbol={currentSymbol}
      />
    </div>
  );
}
