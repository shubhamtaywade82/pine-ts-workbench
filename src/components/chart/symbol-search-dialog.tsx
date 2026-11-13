"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Clock, Search, Star, X } from "lucide-react";
import {
  findSymbol,
  fuzzySearchSymbols,
  loadFavoriteSymbols,
  loadRecentSymbols,
  rememberSymbol,
  SYMBOL_CATALOG,
  toggleFavoriteSymbol,
  type SymbolCategory,
  type SymbolOption,
} from "@/lib/symbol-catalog";
import { rememberRemoteSymbol, searchRemoteSymbols, type RemoteSearch } from "@/lib/remote-symbols";

const SEARCH_DEBOUNCE_MS = 250;
const NO_REMOTE: RemoteSearch = { symbols: [], warnings: [] };

/** Same instrument under two tickers (the catalog's "NSE:NIFTY50" and Dhan's "NSE:NIFTY 50") counts once. */
const instrumentKey = (s: SymbolOption): string =>
  s.provider === "dhan" ? `dhan:${s.dhanSegment}:${s.dhanSecurityId}` : s.ticker;

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
  { id: "derivative", label: "Options & futures" },
];

/**
 * Symbol search — fuzzy-ranked results with starred favorites and a recents
 * row, like TradingView's search. Enter picks the top result; stars persist.
 */
export function SymbolSearchDialog({
  open,
  onOpenChange,
  onSelect,
  currentSymbol,
}: SymbolSearchDialogProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SymbolCategory>("all");
  const [favorites, setFavorites] = useState<readonly string[]>([]);
  const [recents, setRecents] = useState<readonly string[]>([]);

  // localStorage isn't available during SSR; load once the dialog can render.
  useEffect(() => {
    setFavorites(loadFavoriteSymbols());
    setRecents(loadRecentSymbols());
  }, []);

  const [remote, setRemote] = useState<RemoteSearch>(NO_REMOTE);
  const [isSearching, setIsSearching] = useState(false);

  // Every instrument Binance, CoinDCX and Dhan list is searchable, not only the built-in few.
  useEffect(() => {
    if (query.trim() === "") { setRemote(NO_REMOTE); setIsSearching(false); return; }
    const controller = new AbortController();
    setIsSearching(true);
    const timer = setTimeout(() => {
      void searchRemoteSymbols(query.trim(), category, controller.signal).then((found) => {
        if (controller.signal.aborted) return;
        setRemote(found);
        setIsSearching(false);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, category]);

  const results = useMemo(() => {
    const local = fuzzySearchSymbols(query, category, favorites);
    const seen = new Set(local.map(instrumentKey));
    // Built-in matches are fuzzy-ranked; searched ones keep the server's order, which knows the
    // popular quote currencies (a client re-rank by ticker length would put DOGEU above DOGEUSDT).
    return [...local, ...remote.symbols.filter((s) => !seen.has(instrumentKey(s)))];
  }, [query, category, favorites, remote]);

  const favoriteSymbols = useMemo(
    () => favorites.map(findSymbol).filter((s): s is SymbolOption => s !== undefined),
    [favorites],
  );
  const recentSymbols = useMemo(
    () => recents.map(findSymbol).filter((s): s is SymbolOption => s !== undefined),
    [recents],
  );

  const handleSelect = (symbol: SymbolOption) => {
    if (!SYMBOL_CATALOG.some((s) => s.ticker === symbol.ticker)) rememberRemoteSymbol(symbol);
    setRecents(rememberSymbol(symbol.ticker));
    onSelect(symbol);
    onOpenChange(false);
  };

  const star = (e: React.SyntheticEvent, ticker: string) => {
    e.stopPropagation();
    e.preventDefault();
    setFavorites(toggleFavoriteSymbol(ticker));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 border-border bg-popover p-0 text-white shadow-2xl">
        <DialogHeader className="border-b border-border p-3 pb-2">
          <DialogTitle className="text-sm font-semibold text-white">Symbol Search</DialogTitle>
          <DialogDescription className="sr-only">
            Search for trading pairs, crypto, and equity symbols across supported markets.
          </DialogDescription>
          <div className="relative mt-2">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[#787b86]" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && results.length > 0) handleSelect(results[0]!);
              }}
              placeholder="Search symbol, name or exchange…  (fuzzy: btu → BTCUSDT)"
              className="h-9 border-border bg-background pl-8 pr-8 text-xs text-white placeholder:text-[#787b86] focus-visible:ring-1 focus-visible:ring-[#2962ff]"
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
                      : "bg-background text-muted-foreground hover:bg-muted hover:text-white"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </DialogHeader>

        <div className="max-h-80 overflow-y-auto p-1 [scrollbar-width:thin]">
          {/* Favorites — pinned above everything when the query is empty. */}
          {query === "" && favoriteSymbols.length > 0 && (
            <Section title="Favorites">
              {favoriteSymbols.map((item) => (
                <Row key={`fav-${item.ticker}`} item={item} currentSymbol={currentSymbol} isFavorite onSelect={handleSelect} onStar={star} />
              ))}
            </Section>
          )}

          {/* Recents — below favorites, above ranked results. */}
          {query === "" && recentSymbols.length > 0 && (
            <Section title="Recent">
              {recentSymbols.map((item) => (
                <Row key={`rec-${item.ticker}`} item={item} currentSymbol={currentSymbol} isFavorite={favorites.includes(item.ticker)} onSelect={handleSelect} onStar={star} icon={<Clock className="h-3 w-3 text-[#787b86]" />} />
              ))}
            </Section>
          )}

          {remote.warnings.length > 0 && (
            <p className="px-3 pt-2 text-[10px] text-[#ff9800]">{remote.warnings.join(" · ")}</p>
          )}
          {results.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#787b86]">
              {isSearching ? "Searching Binance, CoinDCX and Dhan…" : `No symbols found for "${query}"`}
            </div>
          ) : (
            <Section title={query === "" ? "All symbols" : isSearching ? "Results · searching…" : "Results"}>
              {results.map((item) => (
                <Row key={item.ticker} item={item} currentSymbol={currentSymbol} isFavorite={favorites.includes(item.ticker)} onSelect={handleSelect} onStar={star} />
              ))}
            </Section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const EXCHANGE_BADGE: Record<SymbolOption["exchange"], string> = {
  BINANCE: "bg-amber-500/15 text-amber-400",
  COINDCX: "bg-purple-500/15 text-purple-400",
  NSE: "bg-blue-500/15 text-blue-400",
  BSE: "bg-blue-500/15 text-blue-400",
  MCX: "bg-emerald-500/15 text-emerald-400",
};

function Section({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <div className="pb-1">
      <p className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[#787b86]">{title}</p>
      {children}
    </div>
  );
}

function Row({
  item, currentSymbol, isFavorite, onSelect, onStar, icon,
}: {
  readonly item: SymbolOption;
  readonly currentSymbol?: string;
  readonly isFavorite: boolean;
  readonly onSelect: (symbol: SymbolOption) => void;
  readonly onStar: (e: React.SyntheticEvent, ticker: string) => void;
  readonly icon?: React.ReactNode;
}) {
  const isSelected = currentSymbol === item.ticker || currentSymbol === item.binanceSymbol;
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={`group flex w-full items-center justify-between rounded px-3 py-2 text-left transition-colors ${
        isSelected ? "bg-muted" : "hover:bg-background"
      }`}
    >
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-semibold text-xs text-white">{item.ticker}</span>
          <Badge
            variant="secondary"
            className={`px-1.5 py-0 text-[9px] uppercase ${EXCHANGE_BADGE[item.exchange]}`}
          >
            {item.exchange}
          </Badge>
        </div>
        <span className="truncate text-[11px] text-[#787b86]">{item.displayName}</span>
      </div>

      <span
        role="button"
        tabIndex={0}
        title={isFavorite ? "Remove from favorites" : "Add to favorites"}
        onClick={(e) => onStar(e, item.ticker)}
        onKeyDown={(e) => { if (e.key === "Enter") onStar(e, item.ticker); }}
        className={`ml-2 shrink-0 cursor-pointer rounded p-1 transition-opacity ${
          isFavorite ? "text-[#f7b731] opacity-100" : "text-[#787b86] opacity-0 group-hover:opacity-100 hover:text-[#f7b731]"
        }`}
      >
        <Star className={`h-3.5 w-3.5 ${isFavorite ? "fill-current" : ""}`} />
      </span>
    </button>
  );
}
