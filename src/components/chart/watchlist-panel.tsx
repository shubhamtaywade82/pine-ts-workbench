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

export interface WatchlistPanelProps {
  readonly currentSymbol: string;
  readonly onSelectSymbol: (symbol: SymbolOption) => void;
  readonly onClose?: () => void;
}

export function WatchlistPanel({
  currentSymbol,
  onSelectSymbol,
  onClose,
}: WatchlistPanelProps) {
  const [watchedTickers, setWatchedTickers] = useState<readonly string[]>(() => loadWatchlist());
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const removeTicker = (ticker: string) => {
    const next = watchedTickers.filter((t) => t !== ticker);
    setWatchedTickers(next);
    saveWatchlist(next);
  };

  const addSymbol = (symbol: SymbolOption) => {
    if (!watchedTickers.includes(symbol.ticker)) {
      const next = [...watchedTickers, symbol.ticker];
      setWatchedTickers(next);
      saveWatchlist(next);
    }
    onSelectSymbol(symbol);
  };

  const watchedItems = watchedTickers
    .map((ticker) => findSymbol(ticker))
    .filter((s): s is SymbolOption => s !== undefined);

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

      <div className="flex-1 overflow-y-auto p-1 [scrollbar-width:thin]">
        {watchedItems.map((item) => {
          const isActive = currentSymbol === item.ticker || currentSymbol === item.binanceSymbol;
          return (
            <div
              key={item.ticker}
              className={`group flex cursor-pointer items-center justify-between rounded px-2.5 py-2 transition-colors ${
                isActive ? "bg-muted" : "hover:bg-muted/50"
              }`}
              onClick={() => onSelectSymbol(item)}
            >
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-white">{item.ticker}</span>
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
                <span className="text-[10px] text-[#787b86]">{item.displayName}</span>
              </div>

              <button
                type="button"
                title={`Remove ${item.ticker} from watchlist`}
                onClick={(e) => {
                  e.stopPropagation();
                  removeTicker(item.ticker);
                }}
                className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-[#f23645]"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
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
