"use client";

import { useEffect, useState } from "react";
import { BookOpen, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Pine Editor preferences, kept per browser like TradingView's editor settings. */
export interface EditorPrefs {
  readonly autoRun: boolean;
  readonly aiGhostText: boolean;
  readonly fontSize: number;
  readonly wordWrap: boolean;
  readonly showConsole: boolean;
}

const DEFAULT_PREFS: EditorPrefs = { autoRun: true, aiGhostText: true, fontSize: 13, wordWrap: false, showConsole: true };
const STORAGE_KEY = "pine-ts-workbench-editor-prefs";
const FONT_SIZES = [11, 12, 13, 14, 16, 18];
const DOCS_URL = "https://github.com/shubhamtaywade82/pine-ts#readme";

/** Editor preferences loaded after mount (localStorage isn't available during SSR) and saved on change. */
export function useEditorPrefs(): readonly [EditorPrefs, (patch: Partial<EditorPrefs>) => void] {
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw !== null) setPrefs({ ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<EditorPrefs>) });
    } catch {
      // Storage blocked or corrupt: the defaults apply.
    }
  }, []);
  const update = (patch: Partial<EditorPrefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* session-only */ }
      return next;
    });
  };
  return [prefs, update];
}

/** TradingView's Pine Editor "…" menu: editor settings and help. */
export function EditorMoreMenu({ prefs, onChange }: { prefs: EditorPrefs; onChange: (patch: Partial<EditorPrefs>) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" title="More" className="rounded border border-border p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-[11px] uppercase text-muted-foreground">Editor settings</DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked={prefs.autoRun} onCheckedChange={(autoRun) => onChange({ autoRun })}>
          Auto-update on edit
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={prefs.aiGhostText} onCheckedChange={(aiGhostText) => onChange({ aiGhostText })}>
          AI inline suggestions (Tab)
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={prefs.wordWrap} onCheckedChange={(wordWrap) => onChange({ wordWrap })}>
          Word wrap
        </DropdownMenuCheckboxItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Font size: {prefs.fontSize}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={String(prefs.fontSize)} onValueChange={(v) => onChange({ fontSize: Number(v) })}>
              {FONT_SIZES.map((size) => <DropdownMenuRadioItem key={size} value={String(size)}>{size}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11px] uppercase text-muted-foreground">Developer tools</DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked={prefs.showConsole} onCheckedChange={(showConsole) => onChange({ showConsole })}>
          Pine logs (console)
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => window.open(DOCS_URL, "_blank", "noopener,noreferrer")}>
          <BookOpen className="h-4 w-4" /> pine-ts documentation
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
