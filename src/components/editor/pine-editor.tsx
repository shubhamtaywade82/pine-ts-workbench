"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { transform } from "sucrase";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Plus, Save } from "lucide-react";
import type { Bar, PineContext } from "@nemesis-oss/pine-ts";
import { ta, PineRuntime } from "@nemesis-oss/pine-ts";
import { CodeEditor, type CodeError } from "@/components/editor/code-editor";

/**
 * Pine editor — a TradingView-style editor where users write custom
 * indicators in TypeScript against the pine-ts API, previewed live on the
 * active chart's bars.
 *
 * The user writes a `calculate` function that receives `{ ta, ctx, inputs }`
 * and returns a `Record<string, number | undefined>` (plotId → value per bar).
 * The code is transpiled with sucrase and evaluated bar-by-bar in PineRuntime.
 *
 * Uses CodeMirror (bundled locally) rather than Monaco, whose CDN loader was
 * incompatible with the Caddy proxy environment.
 */

export interface PineEditorProps {
  readonly bars: readonly Bar[];
  readonly onResults: (results: Record<string, Array<number | undefined>>) => void;
  readonly onMetadata: (plots: { id: string; color: string; kind: string }[]) => void;
}

const DEFAULT_CODE = `// Custom indicator — write TypeScript using the pine-ts API.
// The calculate function receives { ta, ctx, inputs } and returns
// a map of plotId -> value (number or undefined for na).
//
// Available: ta.* (all 67 pine-ts TA built-ins), ctx.* (bar context:
// close, open, high, low, volume, hl2, hlc3, ohlc4, barstate, etc.)

export function calculate({ ta, ctx, inputs }: {
  ta: typeof import("@nemesis-oss/pine-ts").ta,
  ctx: import("@nemesis-oss/pine-ts").PineContext,
  inputs: Record<string, unknown>,
}): Record<string, number | undefined> {
  const length = (inputs.length as number) ?? 14;
  const rsi = ta.rsi(ctx.close, length).at(0);
  return {
    main: rsi,
    upper: 70,
    lower: 30,
  };
}
`;

const STORAGE_KEY = "pine-ts-workbench-editor-code";
const AUTO_RUN_DEBOUNCE_MS = 500;
const MAX_CONSOLE_LINES = 50;
// TradingView's default plot colours, assigned in plot order.
const PLOT_COLORS = ["#2962ff", "#ff9800", "#e040fb", "#089981", "#f23645", "#00bcd4"];
const LEVEL_COLOR = "#787b86";

type CalculateFn = (args: { ta: typeof ta; ctx: PineContext; inputs: Record<string, unknown> }) =>
  Record<string, number | undefined>;

interface ConsoleLine { readonly time: string; readonly text: string; readonly isError: boolean }

class ScriptCompileError extends Error {
  constructor(message: string, readonly position: CodeError | null) { super(message); }
}

/** Transpiles the user's TS and returns its `calculate` function. */
const compileCalculate = (userCode: string): CalculateFn => {
  // `export` is stripped because new Function() can't evaluate ES module syntax.
  const cleanCode = userCode.replace(/\bexport\s+(function|const|let|var)\b/g, "$1");
  let transpiled: string;
  try {
    transpiled = transform(cleanCode, { transforms: ["typescript"], production: true }).code;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Sucrase reports "(line:column)" with a 0-based column.
    const match = /\((\d+):(\d+)\)/.exec(message);
    const position = match ? { line: Number(match[1]), column: Number(match[2]) + 1, message } : null;
    throw new ScriptCompileError(message, position);
  }
  const factory = new Function(`${transpiled}\nreturn typeof calculate === 'function' ? calculate : null;`) as
    () => CalculateFn | null;
  const calculateFn = factory();
  if (calculateFn === null) {
    throw new ScriptCompileError("No calculate function exported. Export function calculate({ ta, ctx, inputs }).", null);
  }
  return calculateFn;
};

/** Runs `calculateFn` on every bar; collects plot values and the first per-bar error. */
const runOnBars = async (calculateFn: CalculateFn, bars: readonly Bar[]) => {
  const results: Record<string, Array<number | undefined>> = {};
  let firstBarError: string | null = null;
  const provider = {
    getHistoricalBars: async () => bars,
    streamBars: () => ({ [Symbol.asyncIterator]: async function* () { yield* []; } }),
    getSymbolInfo: async () => ({ ticker: "EDITOR", timezone: "UTC", type: "crypto" as const }),
  };
  const runtime = new PineRuntime({ provider, symbol: "EDITOR", timeframe: "1" });
  let barIndex = 0;
  await runtime.run((ctx: PineContext) => {
    try {
      for (const [plotId, value] of Object.entries(calculateFn({ ta, ctx, inputs: { length: 14 } }))) {
        (results[plotId] ??= [])[barIndex] = value;
      }
    } catch (err) {
      firstBarError ??= `Bar ${barIndex}: ${err instanceof Error ? err.message : String(err)}`;
    }
    barIndex++;
  }, bars as never);
  return { results, firstBarError };
};

/** One plot per returned key; a key that is the same number on every bar is a level (hline). */
const derivePlots = (results: Record<string, Array<number | undefined>>) =>
  Object.entries(results).map(([id, values], i) => {
    const defined = values.filter((v): v is number => v !== undefined && !Number.isNaN(v));
    const isLevel = defined.length > 0 && defined.every((v) => v === defined[0]);
    return { id, color: isLevel ? LEVEL_COLOR : PLOT_COLORS[i % PLOT_COLORS.length]!, kind: isLevel ? "hline" : "line" };
  });

const loadSavedCode = (): string | null => {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // Storage blocked (private mode) — fall back to the default script.
  }
};

const saveCode = (code: string): boolean => {
  try {
    window.localStorage.setItem(STORAGE_KEY, code);
    return true;
  } catch {
    return false;
  }
};

export function PineEditor({ bars, onResults, onMetadata }: PineEditorProps) {
  const [code, setCode] = useState<string>(DEFAULT_CODE);
  const [savedCode, setSavedCode] = useState<string>(DEFAULT_CODE);
  const [autoRun, setAutoRun] = useState(true);
  const [error, setError] = useState<CodeError | null>(null);
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const saved = loadSavedCode();
    if (saved !== null) { setCode(saved); setSavedCode(saved); }
  }, []);

  const log = useCallback((text: string, isError: boolean) => {
    const time = new Date().toLocaleTimeString("en-GB");
    setConsoleLines((prev) => {
      // Stream ticks re-run the script constantly; repeat messages only refresh the timestamp.
      const isRepeat = prev[prev.length - 1]?.text === text;
      const next = isRepeat ? prev.slice(0, -1) : prev;
      return [...next, { time, text, isError }].slice(-MAX_CONSOLE_LINES);
    });
  }, []);

  const runCode = useCallback(async (userCode: string) => {
    try {
      const { results, firstBarError } = await runOnBars(compileCalculate(userCode), bars);
      onResults(results);
      onMetadata(derivePlots(results));
      setError(null);
      if (firstBarError !== null) log(firstBarError, true);
      else log("Compiled successfully. Script added to chart.", false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(err instanceof ScriptCompileError ? err.position : null);
      log(message, true);
    }
  }, [bars, onResults, onMetadata, log]);

  // Typing is debounced; new bars (stream ticks every ~100ms) re-run at once, or a
  // debounce would starve the live update. Refs give the bars effect the latest code
  // and callbacks without re-running whenever the parent passes new inline handlers.
  const codeRef = useRef(code);
  const runCodeRef = useRef(runCode);
  useEffect(() => { codeRef.current = code; runCodeRef.current = runCode; }, [code, runCode]);

  useEffect(() => {
    if (!autoRun) return;
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void runCode(code); }, AUTO_RUN_DEBOUNCE_MS);
    return () => { if (debounceRef.current !== null) clearTimeout(debounceRef.current); };
  }, [code, autoRun]);

  useEffect(() => {
    void runCodeRef.current(codeRef.current);
  }, [bars]);

  const onSave = () => {
    if (saveCode(code)) { setSavedCode(code); log("Script saved.", false); }
    else log("Could not save: browser storage is unavailable.", true);
  };

  return (
    <div className="flex h-full flex-col bg-[#131722]">
      <EditorToolbar
        isDirty={code !== savedCode} autoRun={autoRun} onAutoRunChange={setAutoRun}
        onSave={onSave} onAddToChart={() => void runCode(code)}
      />
      <div
        className="min-h-0 flex-1 overflow-hidden"
        // Capture phase: CodeMirror binds Mod-Enter to "insert blank line" otherwise.
        onKeyDownCapture={(e) => {
          if (!(e.ctrlKey || e.metaKey)) return;
          if (e.key === "s") { e.preventDefault(); onSave(); }
          if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); void runCode(code); }
        }}
      >
        <CodeEditor value={code} onChange={setCode} error={error} />
      </div>
      <EditorConsole lines={consoleLines} barCount={bars.length} />
    </div>
  );
}

function EditorToolbar({ isDirty, autoRun, onAutoRunChange, onSave, onAddToChart }: {
  isDirty: boolean;
  autoRun: boolean;
  onAutoRunChange: (value: boolean) => void;
  onSave: () => void;
  onAddToChart: () => void;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
      <span className="text-xs font-semibold text-[#d1d4dc]">
        Custom indicator{isDirty && <span className="ml-1 text-[#787b86]" title="Unsaved changes">•</span>}
      </span>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5">
          <Switch id="auto-run" checked={autoRun} onCheckedChange={onAutoRunChange} />
          <Label htmlFor="auto-run" className="text-xs text-muted-foreground">Auto-update</Label>
        </div>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onSave} title="Save (Ctrl+S)">
          <Save className="mr-1 h-3.5 w-3.5" /> Save
        </Button>
        <Button size="sm" className="h-7 text-xs" onClick={onAddToChart} title="Add to chart (Ctrl+Enter)">
          <Plus className="mr-1 h-3.5 w-3.5" /> Add to chart
        </Button>
      </div>
    </div>
  );
}

function EditorConsole({ lines, barCount }: { lines: readonly ConsoleLine[]; barCount: number }) {
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
          <div key={i} className={line.isError ? "text-[#f23645]" : "text-[#b2b5be]"}>
            <span className="mr-2 text-[#50535e]">{line.time}</span>{line.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
