"use client";

import type { ReactNode } from "react";
import { Bookmark, Code2, Gauge } from "lucide-react";

export type RightPanel = "watchlist" | "editor" | "technicals";

const ITEMS: readonly { id: RightPanel; label: string; icon: ReactNode }[] = [
  { id: "watchlist", label: "Watchlist", icon: <Bookmark className="h-5 w-5" /> },
  { id: "editor", label: "Pine Editor", icon: <Code2 className="h-5 w-5" /> },
  { id: "technicals", label: "Technicals", icon: <Gauge className="h-5 w-5" /> },
];

/** TradingView's right icon strip: each icon opens its panel; clicking the open one closes it. */
export function RightSidebar({ active, isOpen, onSelect }: {
  active: RightPanel;
  isOpen: boolean;
  onSelect: (panel: RightPanel) => void;
}) {
  return (
    <nav className="flex w-11 shrink-0 flex-col items-center gap-1 border-l border-border bg-card py-2">
      {ITEMS.map((item) => {
        const isActive = isOpen && active === item.id;
        return (
          <button key={item.id} type="button" title={item.label} aria-pressed={isActive} onClick={() => onSelect(item.id)}
            className={`rounded-md p-2 ${isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}>
            {item.icon}
          </button>
        );
      })}
    </nav>
  );
}
