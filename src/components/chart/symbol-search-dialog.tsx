"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, X } from "lucide-react";
import {
  searchSymbols,
  type SymbolCategory,
  type SymbolOption,
} from "@/lib/symbol-catalog";

export interface SymbolSearchDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (symbol: SymbolOption) => void;
  readonly currentSymbol?: string;
}

const CATEGORIES: readonly { readonly id: SymbolCategory; readonly label: string }[] = [
  { id: "all", label: "All" },
  { id: "crypto", label: "Crypto" },
  { id: "index", label: "Indices" },
  { id: "stock", label: "Stocks" },
];

export function SymbolSearchDialog({
  open,
  onOpenChange,
  onSelect,
  currentSymbol,
}: SymbolSearchDialogProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SymbolCategory>("all");

  const results = useMemo(() => searchSymbols(query, category), [query, category]);

  const handleSelect = (symbol: SymbolOption) => {
    onSelect(symbol);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 border-[#2a2e39] bg-[#1e222d] p-0 text-white shadow-2xl">
        <DialogHeader className="border-b border-[#2a2e39] p-3 pb-2">
          <DialogTitle className="text-sm font-semibold text-white">Symbol Search</DialogTitle>
          <DialogDescription className="sr-only">
            Search for trading pairs, crypto, and equity symbols across supported markets.
          </DialogDescription>
          <div className="relative mt-2">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[#787b86]" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search symbol, name or exchange…"
              className="h-9 border-[#2a2e39] bg-[#131722] pl-8 pr-8 text-xs text-white placeholder:text-[#787b86] focus-visible:ring-1 focus-visible:ring-[#2962ff]"
              autoFocus
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2.5 top-2.5 text-[#787b86] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex gap-1 pt-2">
            {CATEGORIES.map(({ id, label }) => {
              const isActive = category === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setCategory(id)}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                    isActive
                      ? "bg-[#2962ff] text-white"
                      : "bg-[#131722] text-[#b2b5be] hover:bg-[#2a2e39] hover:text-white"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </DialogHeader>

        <div className="max-h-80 overflow-y-auto p-1 [scrollbar-width:thin]">
          {results.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#787b86]">No symbols found for &quot;{query}&quot;</div>
          ) : (
            results.map((item) => {
              const isSelected = currentSymbol === item.ticker || currentSymbol === item.binanceSymbol;
              return (
                <button
                  key={item.ticker}
                  type="button"
                  onClick={() => handleSelect(item)}
                  className={`flex w-full items-center justify-between rounded px-3 py-2 text-left transition-colors ${
                    isSelected ? "bg-[#2a2e39]" : "hover:bg-[#131722]"
                  }`}
                >
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-white">{item.ticker}</span>
                      <Badge
                        variant="secondary"
                        className={`px-1.5 py-0 text-[9px] uppercase ${
                          item.exchange === "BINANCE"
                            ? "bg-amber-500/15 text-amber-400"
                            : "bg-blue-500/15 text-blue-400"
                        }`}
                      >
                        {item.exchange}
                      </Badge>
                    </div>
                    <span className="text-[11px] text-[#787b86]">{item.displayName}</span>
                  </div>

                  <span className="text-[10px] capitalize text-[#787b86]">{item.category}</span>
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
