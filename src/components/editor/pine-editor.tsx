"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Settings, Sparkles, X } from "lucide-react";
import type { Bar, InputConfig, InputsBag, ScriptDrawings } from "@nemesis-oss/pine-ts";
import { Button } from "@/components/ui/button";
import { CodeEditor, type CodeError } from "@/components/editor/code-editor";
import { OpenScriptDialog, ScriptMenu } from "@/components/editor/script-menu";
import { AiScriptDialog } from "@/components/editor/ai-script-dialog";
import { ScriptCompileError } from "@/lib/script-loader";
import type { PlotSpec } from "@/lib/indicator-runner";
import { createScriptRunner } from "@/lib/script-worker-client";
import { describeCode } from "@/lib/script-library";
import { DEFAULT_STRATEGY, loadStrategyCode } from "@/lib/strategy-runner";
import type { ScriptLibraryState, ScriptTemplates } from "@/hooks/use-script-library";
import { EditorMoreMenu, useEditorPrefs } from "@/components/editor/editor-more-menu";

/**
 * TradingView-style Pine Editor panel. One editor for indicators and
 * strategies: an indicator previews on the active chart, a strategy runs in
 * the Strategy Tester. Scripts live in the "My scripts" library.
 */

export interface PineEditorProps {
  readonly bars: readonly Bar[];
  /** An indicator run: plot values per bar (aligned with `bars`), plot specs, drawings and declared inputs. */
  readonly onResults: (run: IndicatorRun) => void;
  /** Strategy code to backtest (the Strategy Tester shows results and errors). */
  readonly onStrategyCode: (code: string) => void;
  /** "Add to chart" / Ctrl+Enter: puts the script back on the chart if it was removed from the legend. */
  readonly onAddToChart?: () => void;
  readonly onClose?: () => void;
  /** The script library, owned by the page so the Indicators dialog shares it. */
  readonly scripts: ScriptLibraryState;
  /** Opens the script's settings dialog (Inputs, Properties, Style, Visibility). */
  readonly onOpenSettings: () => void;
}

const DEFAULT_INDICATOR = `// Custom indicator — runs once per bar, like Pine Script.
// In scope: close, open, high, low, volume, hl2, hlc3, ohlc4, input, plot,
// hline, draw, ta.*, math.*, smc.*, and ctx (the full Pine context).

indicator("RSI", ({ close, input, plot, hline }) => {
  const length = input.int(14, "Length", { min: 1 });
  plot(ta.rsi(close, length), "RSI");
  hline(70, "Upper");
  hline(30, "Lower");
});
`;

export const SCRIPT_TEMPLATES: ScriptTemplates = { indicator: DEFAULT_INDICATOR, strategy: DEFAULT_STRATEGY };

// Where the editor kept its single indicator script before the library existed.
const LEGACY_INDICATOR_KEY = "pine-ts-workbench-editor-code";

/** The pre-library scripts, so the first library load keeps the user's work. */
export const legacyScripts = (): string[] => {
  let indicator: string | null = null;
  try { indicator = window.localStorage.getItem(LEGACY_INDICATOR_KEY); } catch { /* storage blocked */ }
  const isOldTemplate = indicator === null || indicator.includes("export function calculate({ ta, ctx, inputs }");
  return [isOldTemplate ? DEFAULT_INDICATOR : indicator!, loadStrategyCode()];
};

export interface IndicatorRun {
  readonly results: Record<string, Array<number | undefined>>;
  readonly plots: PlotSpec[];
  readonly drawings: ScriptDrawings;
  readonly alerts?: readonly { readonly message: string; readonly barIndex?: number; readonly barTime?: number }[];
  readonly isOverlay: boolean;
  readonly inputs: readonly InputConfig[];
}

const AUTO_RUN_DEBOUNCE_MS = 500;
const MAX_CONSOLE_LINES = 50;

interface ConsoleLine { readonly time: string; readonly text: string; readonly isError: boolean }

function useConsole() {
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const log = useCallback((text: string, isError: boolean) => {
    const time = new Date().toLocaleTimeString("en-GB");
    setLines((prev) => {
      // Stream ticks re-run the script constantly; repeat messages only refresh the timestamp.
      const next = prev.at(-1)?.text === text ? prev.slice(0, -1) : prev;
      return [...next, { time, text, isError }].slice(-MAX_CONSOLE_LINES);
    });
  }, []);
  return { lines, log };
}

export function PineEditor({ bars, onResults, onStrategyCode, onAddToChart, onClose, scripts, onOpenSettings }: PineEditorProps) {
  const [prefs, setPrefs] = useEditorPrefs();
  const { autoRun, aiGhostText } = prefs;
  const [error, setError] = useState<CodeError | null>(null);
  const [isOpenDialogOpen, setIsOpenDialogOpen] = useState(false);
  const [isAiDialogOpen, setIsAiDialogOpen] = useState(false);
  const [aiErrorToFix, setAiErrorToFix] = useState<string | null>(null);
  const { lines, log } = useConsole();
  const runCode = useScriptRunner({ bars, inputs: scripts.settings.inputs, onResults, onStrategyCode, log, setError });
  useAutoRun(scripts.draft, bars, autoRun, runCode);
  // New input values from the settings dialog apply at once, like TradingView's Ok.
  // Via refs: runCode changes whenever the page re-renders, the inputs only on Ok.
  const latest = useRef({ draft: scripts.draft, runCode });
  useEffect(() => { latest.current = { draft: scripts.draft, runCode }; }, [scripts.draft, runCode]);
  useEffect(() => {
    if (latest.current.draft !== "") void latest.current.runCode(latest.current.draft);
  }, [scripts.settings.inputs]);

  const onSaved = (ok: boolean) => log(ok ? "Script saved." : "Could not save: browser storage is unavailable.", !ok);
  const addToChart = () => { onAddToChart?.(); void runCode(scripts.draft); };
  const onFixWithAi = (msg: string) => { setAiErrorToFix(msg); setIsAiDialogOpen(true); };
  return (
    <div className="flex h-full flex-col bg-[#131722]">
      <div className="flex h-9 shrink-0 items-center justify-between px-3 text-sm text-[#d1d4dc]">
        <span>Pine Editor</span>
        {onClose !== undefined && <button type="button" title="Close" onClick={onClose}><X className="h-4 w-4" /></button>}
      </div>
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-2">
        <ScriptMenu scripts={scripts} onSaved={onSaved} onOpenScripts={() => setIsOpenDialogOpen(true)} />
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1 border-indigo-500/40 text-indigo-300 hover:bg-indigo-950/40"
            onClick={() => { setAiErrorToFix(error?.message ?? null); setIsAiDialogOpen(true); }}
            title="Pine Script AI Copilot & Self-Healing Agent"
          >
            <Sparkles className="h-3.5 w-3.5 text-indigo-400" /> AI
          </Button>
          <button type="button" title="Settings" onClick={onOpenSettings} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <Settings className="h-4 w-4" />
          </button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addToChart} title="Add to chart (Ctrl+Enter)">
            <Plus className="mr-1 h-3.5 w-3.5" /> Add to chart
          </Button>
          <EditorMoreMenu prefs={prefs} onChange={setPrefs} />
        </div>
      </div>
      <div
        className="min-h-0 flex-1 overflow-hidden"
        // Capture phase: CodeMirror binds Mod-Enter to "insert blank line" otherwise.
        onKeyDownCapture={(e) => {
          if (!(e.ctrlKey || e.metaKey)) return;
          if (e.key === "s") { e.preventDefault(); onSaved(scripts.save()); }
          if (e.key === "o") { e.preventDefault(); setIsOpenDialogOpen(true); }
          if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); addToChart(); }
        }}
      >
        <CodeEditor
          value={scripts.draft} onChange={scripts.setDraft} error={error}
          aiGhostText={aiGhostText} fontSize={prefs.fontSize} wordWrap={prefs.wordWrap}
        />
      </div>
      {prefs.showConsole && <EditorConsole lines={lines} barCount={bars.length} onFixError={onFixWithAi} />}
      <OpenScriptDialog open={isOpenDialogOpen} onClose={() => setIsOpenDialogOpen(false)} scripts={scripts} />
      <AiScriptDialog
        isOpen={isAiDialogOpen}
        onClose={() => setIsAiDialogOpen(false)}
        currentCode={scripts.draft}
        currentError={aiErrorToFix}
        onApplyCode={(code) => { scripts.setDraft(code); void runCode(code); }}
      />
    </div>
  );
}

/** Runs the code by kind: indicators on the bars here, strategies handed to the Strategy Tester. */
function useScriptRunner({ bars, inputs, onResults, onStrategyCode, log, setError }: {
  bars: readonly Bar[];
  inputs: InputsBag;
  onResults: PineEditorProps["onResults"];
  onStrategyCode: PineEditorProps["onStrategyCode"];
  log: (text: string, isError: boolean) => void;
  setError: (error: CodeError | null) => void;
}) {
  const [runner] = useState(createScriptRunner);
  useEffect(() => runner.dispose, [runner]);
  return useCallback(async (code: string) => {
    if (describeCode(code).kind === "strategy") {
      onStrategyCode(code);
      setError(null);
      log("Strategy sent to the Strategy Tester.", false);
      return;
    }
    try {
      const { firstBarError, ...run } = await runner.run(code, bars, inputs);
      onResults(run);
      setError(null);
      log(firstBarError ?? "Compiled successfully. Script added to chart.", firstBarError !== null);
    } catch (err) {
      setError(err instanceof ScriptCompileError ? err.position : null);
      log(err instanceof Error ? err.message : String(err), true);
    }
  }, [bars, inputs, onResults, onStrategyCode, log, setError, runner]);
}

/**
 * Typing is debounced; a new bar re-runs at once, or a debounce would starve
 * the live update. Refs give both effects the latest code and runner.
 */
function useAutoRun(code: string, bars: readonly Bar[], autoRun: boolean, runCode: (code: string) => Promise<void>) {
  const codeRef = useRef(code);
  const runRef = useRef(runCode);
  useEffect(() => { codeRef.current = code; runRef.current = runCode; }, [code, runCode]);
  useEffect(() => {
    if (!autoRun || code === "") return;
    const timer = setTimeout(() => { void runRef.current(codeRef.current); }, AUTO_RUN_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [code, autoRun]);
  useEffect(() => {
    if (codeRef.current !== "") void runRef.current(codeRef.current);
  }, [bars]);
}

function EditorConsole({ lines, barCount, onFixError }: {
  lines: readonly ConsoleLine[];
  barCount: number;
  onFixError?: (error: string) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [lines]);
  return (
    <div className="flex h-24 shrink-0 flex-col border-t border-border font-mono text-[11px]">
      <div className="flex h-6 shrink-0 items-center justify-between px-3 font-sans text-[11px] text-[#787b86]">
        <span>Console</span>
        <span>{barCount} bars</span>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-1">
        {lines.map((line, i) => (
          <div key={i} className={`flex items-center justify-between ${line.isError ? "text-[#f23645]" : "text-[#b2b5be]"}`}>
            <div>
              <span className="mr-2 text-[#50535e]">{line.time}</span>{line.text}
            </div>
            {line.isError && onFixError && (
              <button
                type="button"
                onClick={() => onFixError(line.text)}
                className="inline-flex items-center gap-1 rounded bg-indigo-900/40 px-1.5 py-0.5 text-[10px] text-indigo-300 hover:bg-indigo-800/60"
                title="Self-heal error with AI"
              >
                <Sparkles className="h-2.5 w-2.5" /> Fix with AI
              </button>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
