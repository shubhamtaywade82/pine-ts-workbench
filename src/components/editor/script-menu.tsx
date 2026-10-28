"use client";

import { useState } from "react";
import { ChevronDown, Copy, FolderOpen, History, Pencil, Plus, Save, Star, Trash2, ChartLine, FlaskConical } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { recentlyUsed, type SavedScript } from "@/lib/script-library";
import type { ScriptLibraryState } from "@/hooks/use-script-library";
import { SMC_CONFLUENCE_ENGINE, SMC_CONFLUENCE_STRATEGY } from "@/lib/scripts/smc-confluence-engine";

type Modal = "rename" | "copy" | "history" | null;

const formatSavedAt = (time: number) =>
  new Date(time).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

const KindIcon = ({ script }: { script: SavedScript }) =>
  script.kind === "strategy" ? <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" /> : <ChartLine className="h-3.5 w-3.5 text-muted-foreground" />;

/** TradingView's script-name dropdown: save, copy, rename, history, create, recent, open. */
export function ScriptMenu({ scripts, onSaved, onOpenScripts }: {
  scripts: ScriptLibraryState;
  onSaved: (ok: boolean) => void;
  onOpenScripts: () => void;
}) {
  const [modal, setModal] = useState<Modal>(null);
  const { active, isDirty } = scripts;
  const close = () => setModal(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="flex min-w-[96px] items-center gap-1.5 rounded px-2 py-1 text-sm font-semibold hover:bg-muted">
            <span className="truncate">{active?.name ?? "Untitled script"}</span>
            {isDirty && <span className="text-muted-foreground" title="Unsaved changes">•</span>}
            <ChevronDown className="h-4 w-4 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuItem disabled={!isDirty} onSelect={() => onSaved(scripts.save())}>
            <Save className="h-4 w-4" /> Save script <DropdownMenuShortcut>Ctrl+S</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setModal("copy")}><Copy className="h-4 w-4" /> Make a copy…</DropdownMenuItem>
          <DropdownMenuItem disabled={active === undefined} onSelect={() => setModal("rename")}><Pencil className="h-4 w-4" /> Rename…</DropdownMenuItem>
          <DropdownMenuItem disabled={active === undefined} onSelect={() => setModal("history")}><History className="h-4 w-4" /> Version history…</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><Plus className="h-4 w-4" /> Create new</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onSelect={() => scripts.createNew("indicator")}>Indicator</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => scripts.createNew("strategy")}>Strategy</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => scripts.createNew("indicator", SMC_CONFLUENCE_ENGINE)}>SMC Confluence Engine v7.1</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => scripts.createNew("strategy", SMC_CONFLUENCE_STRATEGY)}>SMC Confluence Strategy v7.1</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[11px] uppercase text-muted-foreground">Recently used</DropdownMenuLabel>
          {recentlyUsed(scripts.library).map((script) => (
            <DropdownMenuItem key={script.id} onSelect={() => scripts.open(script.id)} className={script.id === active?.id ? "bg-muted" : ""}>
              <span className="truncate">{script.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onOpenScripts}>
            <FolderOpen className="h-4 w-4" /> Open script… <DropdownMenuShortcut>Ctrl+O</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NameDialog
        open={modal === "rename" || modal === "copy"} onClose={close}
        title={modal === "copy" ? "Make a copy" : "Rename script"}
        initial={modal === "copy" ? `${active?.name ?? "Untitled script"} copy` : (active?.name ?? "")}
        onSubmit={(name) => (modal === "copy" ? scripts.copy(name) : scripts.rename(name))}
      />
      <VersionHistoryDialog open={modal === "history"} onClose={close} scripts={scripts} />
    </>
  );
}

/** "Open my script": searchable list with favourite stars, version and date, delete. */
export function OpenScriptDialog({ open, onClose, scripts }: { open: boolean; onClose: () => void; scripts: ScriptLibraryState }) {
  const [query, setQuery] = useState("");
  const shown = scripts.library
    .filter((s) => s.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite) || b.openedAt - a.openedAt);
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="flex max-h-[80vh] sm:max-w-md flex-col gap-3">
        <DialogTitle>Open my script</DialogTitle>
        <DialogDescription className="sr-only">
          Search and open saved scripts from your personal Pine Script library.
        </DialogDescription>
        <Input placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {shown.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No scripts.</p>}
          {shown.map((script) => (
            <div key={script.id} className="group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
              <button type="button" title="Favorite" onClick={() => scripts.toggleFavorite(script.id)}>
                <Star className={`h-4 w-4 ${script.isFavorite ? "fill-[#ff9800] text-[#ff9800]" : "text-muted-foreground"}`} />
              </button>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { scripts.open(script.id); onClose(); }}>
                <div className="flex items-center gap-1.5 text-sm"><span className="truncate">{script.name}</span><KindIcon script={script} /></div>
                <div className="text-xs text-muted-foreground">
                  Version: {script.versions.length}.0 ({formatSavedAt(script.versions.at(-1)?.savedAt ?? 0)})
                </div>
              </button>
              <button type="button" title="Delete" className="invisible group-hover:visible" onClick={() => scripts.remove(script.id)}>
                <Trash2 className="h-4 w-4 text-muted-foreground hover:text-[#f23645]" />
              </button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NameDialog({ open, onClose, title, initial, onSubmit }: {
  open: boolean; onClose: () => void; title: string; initial: string; onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  const submit = () => { if (name.trim() !== "") { onSubmit(name); onClose(); } };
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (isOpen) setName(initial); else onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="sr-only">
          Enter a name to save or duplicate this script.
        </DialogDescription>
        <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} autoFocus />
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={name.trim() === ""}>Ok</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VersionHistoryDialog({ open, onClose, scripts }: { open: boolean; onClose: () => void; scripts: ScriptLibraryState }) {
  const versions = scripts.active?.versions ?? [];
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="flex max-h-[80vh] sm:max-w-md flex-col gap-3">
        <DialogTitle>Version history</DialogTitle>
        <DialogDescription className="sr-only">
          Browse and restore saved version revisions for this script.
        </DialogDescription>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {versions.map((version, i) => ({ version, number: i + 1 })).reverse().map(({ version, number }) => (
            <div key={number} className="flex items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-muted">
              <span>Version {number}.0 <span className="ml-2 text-xs text-muted-foreground">{formatSavedAt(version.savedAt)}</span></span>
              <Button variant="ghost" size="sm" onClick={() => { scripts.restoreVersion(version.code); onClose(); }}>Open in editor</Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
