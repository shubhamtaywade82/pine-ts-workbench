"use client";

import { useMemo, useState, type ReactNode } from "react";
import { BarChart3, ChartLine, FlaskConical, Search, Star, User } from "lucide-react";
import { registry } from "@nemesis-oss/pine-ts";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { ScriptLibraryState } from "@/hooks/use-script-library";
import type { ScriptKind } from "@/lib/script-library";

/** One row of the catalog: a pine-ts built-in or a saved script. */
interface CatalogEntry {
  readonly key: string;
  readonly name: string;
  readonly kind: ScriptKind;
  readonly source: "builtin" | "script";
  readonly isFavorite: boolean;
  readonly detail: string;
}

type Section = "favorites" | "scripts" | "technicals";
type KindFilter = "all" | ScriptKind;

const FAVORITE_BUILTINS_KEY = "pine-ts-workbench-favorite-indicators";

const loadFavoriteBuiltins = (): Set<string> => {
  try { return new Set(JSON.parse(window.localStorage.getItem(FAVORITE_BUILTINS_KEY) ?? "[]") as string[]); } catch { return new Set(); }
};

const saveFavoriteBuiltins = (ids: Set<string>): void => {
  try { window.localStorage.setItem(FAVORITE_BUILTINS_KEY, JSON.stringify([...ids])); } catch { /* storage blocked */ }
};

/** TradingView's "Indicators, metrics, and strategies" dialog. */
export function IndicatorsDialog({ open, onOpenChange, scripts, onAddBuiltin, onAddScript, onOpenScript }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scripts: ScriptLibraryState;
  onAddBuiltin: (indicatorId: string) => void;
  onAddScript: (scriptId: string) => void;
  /** Strategies open in the Pine Editor, whose run feeds the Strategy Tester. */
  onOpenScript: (scriptId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [section, setSection] = useState<Section>("technicals");
  const [kind, setKind] = useState<KindFilter>("all");
  const [favoriteBuiltins, setFavoriteBuiltins] = useState(loadFavoriteBuiltins);
  const entries = useCatalog(scripts, favoriteBuiltins);
  const needle = query.trim().toLowerCase();
  const shown = entries.filter((e) =>
    (section === "favorites" ? e.isFavorite : section === "scripts" ? e.source === "script" : e.source === "builtin")
    && (kind === "all" || e.kind === kind)
    && e.name.toLowerCase().includes(needle));

  const toggleFavorite = (entry: CatalogEntry) => {
    if (entry.source === "script") { scripts.toggleFavorite(entry.key); return; }
    const next = new Set(favoriteBuiltins);
    if (!next.delete(entry.key)) next.add(entry.key);
    setFavoriteBuiltins(next);
    saveFavoriteBuiltins(next);
  };
  const choose = (entry: CatalogEntry) => {
    if (entry.source === "builtin") onAddBuiltin(entry.key);
    else if (entry.kind === "indicator") onAddScript(entry.key);
    else onOpenScript(entry.key);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[70vh] flex-col gap-3 sm:max-w-3xl">
        <DialogTitle>Indicators, metrics, and strategies</DialogTitle>
        <label className="flex items-center gap-2 rounded-md border border-border px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input autoFocus placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} className="h-9 flex-1 bg-transparent text-sm outline-none" />
        </label>
        <div className="flex min-h-0 flex-1 gap-4">
          <SectionNav section={section} onChange={setSection} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <KindPills kind={kind} onChange={setKind} />
            <div className="min-h-0 flex-1 overflow-y-auto">
              {shown.map((entry) => <CatalogRow key={`${entry.source}:${entry.key}`} entry={entry} onChoose={choose} onToggleFavorite={toggleFavorite} />)}
              {shown.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Nothing here yet.</p>}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function useCatalog(scripts: ScriptLibraryState, favoriteBuiltins: Set<string>): CatalogEntry[] {
  const builtins = useMemo(() => registry.list(), []);
  return [
    ...scripts.library.map((s): CatalogEntry => ({
      key: s.id, name: s.name, kind: s.kind, source: "script", isFavorite: s.isFavorite, detail: `v${s.versions.length}`,
    })),
    ...builtins.map((m): CatalogEntry => ({
      key: m.id, name: m.name, kind: "indicator", source: "builtin", isFavorite: favoriteBuiltins.has(m.id), detail: m.overlay ? "on chart" : m.category,
    })),
  ];
}

const SECTIONS: readonly { id: Section; label: string; group: string; icon: ReactNode }[] = [
  { id: "favorites", label: "Favorites", group: "Personal", icon: <Star className="h-4 w-4" /> },
  { id: "scripts", label: "My scripts", group: "Personal", icon: <User className="h-4 w-4" /> },
  { id: "technicals", label: "Technicals", group: "Built-in", icon: <BarChart3 className="h-4 w-4" /> },
];

function SectionNav({ section, onChange }: { section: Section; onChange: (section: Section) => void }) {
  return (
    <nav className="flex w-44 shrink-0 flex-col gap-0.5">
      {SECTIONS.map((s, i) => (
        <div key={s.id}>
          {s.group !== SECTIONS[i - 1]?.group && <p className="px-3 pt-2 pb-1 text-[11px] uppercase text-muted-foreground">{s.group}</p>}
          <button type="button" onClick={() => onChange(s.id)}
            className={`flex w-full items-center gap-2 rounded px-3 py-2 text-sm ${section === s.id ? "bg-muted font-semibold" : "hover:bg-muted/60"}`}>
            {s.icon}{s.label}
          </button>
        </div>
      ))}
    </nav>
  );
}

function KindPills({ kind, onChange }: { kind: KindFilter; onChange: (kind: KindFilter) => void }) {
  const options: readonly (readonly [KindFilter, string])[] = [["all", "All"], ["indicator", "Indicators"], ["strategy", "Strategies"]];
  return (
    <div className="flex gap-1.5">
      {options.map(([key, label]) => (
        <button key={key} type="button" onClick={() => onChange(key)}
          className={`rounded-full px-3 py-1 text-sm ${kind === key ? "bg-foreground text-background" : "bg-muted hover:bg-muted/70"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

function CatalogRow({ entry, onChoose, onToggleFavorite }: {
  entry: CatalogEntry;
  onChoose: (entry: CatalogEntry) => void;
  onToggleFavorite: (entry: CatalogEntry) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
      <button type="button" title={entry.isFavorite ? "Remove from favorites" : "Add to favorites"} onClick={() => onToggleFavorite(entry)}>
        <Star className={`h-4 w-4 ${entry.isFavorite ? "fill-[#ff9800] text-[#ff9800]" : "text-muted-foreground"}`} />
      </button>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm" onClick={() => onChoose(entry)}>
        <span className="truncate">{entry.name}</span>
        {entry.kind === "strategy" ? <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" /> : <ChartLine className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      <span className="text-xs text-muted-foreground">{entry.detail}</span>
    </div>
  );
}
