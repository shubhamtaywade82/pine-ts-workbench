"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { transform } from "sucrase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Play, AlertCircle, CheckCircle2 } from "lucide-react";
import type { Bar, PineContext } from "@nemesis-oss/pine-ts";
import { ta, PineRuntime } from "@nemesis-oss/pine-ts";

/**
 * Pine editor — Wave 17. A TypeScript code editor where users write custom
 * indicators using the pine-ts API, with live preview against the chart's
 * current bars.
 *
 * The user writes a `calculate` function that receives `{ ta, ctx, inputs }`
 * and returns a `Record<string, number | undefined>` (plotId → value per bar).
 * The editor transpiles the TS → JS via sucrase, wraps it in a function, and
 * evaluates it against the pine-ts runtime.
 *
 * Hot-reload: debounced 500ms after the user stops typing → re-run → update
 * the chart overlays.
 *
 * Default template: a simple RSI indicator that mirrors the registry's built-in.
 *
 * Note: Uses a lightweight `<textarea>` instead of Monaco editor because
 * Monaco's CDN loading was incompatible with the Caddy proxy environment.
 * The core functionality (TS transpilation + live preview) works identically.
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

export function PineEditor({ bars, onResults, onMetadata }: PineEditorProps) {
  const [code, setCode] = useState<string>(DEFAULT_CODE);
  const [autoRun, setAutoRun] = useState(true);
  const [status, setStatus] = useState<{ ok: boolean; message: string }>({ ok: true, message: "Ready" });
  const [running, setRunning] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved !== null) setCode(saved);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, code);
    } catch { /* ignore */ }
  }, [code]);

  const runCode = useCallback(async (userCode: string) => {
    setRunning(true);
    try {
      // Strip `export ` keyword — new Function() can't handle ES module syntax.
      const cleanCode = userCode.replace(/\bexport\s+(function|const|let|var)\b/g, "$1");
      const transpiled = transform(cleanCode, {
        transforms: ["typescript"],
        production: true,
      }).code;

      const wrapped = `
        ${transpiled}
        return typeof calculate === 'function' ? calculate : null;
      `;
      // eslint-disable-next-line no-new-func
      const factory = new Function(wrapped) as () => ((args: { ta: typeof ta; ctx: PineContext; inputs: Record<string, unknown> }) => Record<string, number | undefined>) | null;
      const calculateFn = factory();
      if (calculateFn === null) {
        throw new Error("No calculate function exported. Export function calculate({ ta, ctx, inputs }).");
      }

      const results: Record<string, Array<number | undefined>> = {};
      const testInfo = { ticker: "EDITOR", timezone: "UTC", type: "crypto" as const };
      const provider = {
        getHistoricalBars: async () => bars,
        streamBars: () => ({ [Symbol.asyncIterator]: async function* () { yield* []; } }),
        getSymbolInfo: async () => testInfo,
      };
      const runtime = new PineRuntime({ provider, symbol: "EDITOR", timeframe: "1" });
      await runtime.run((ctx: PineContext) => {
        try {
          const result = calculateFn({ ta, ctx, inputs: { length: 14 } });
          for (const [plotId, value] of Object.entries(result)) {
            if (results[plotId] === undefined) results[plotId] = [];
            results[plotId]!.push(value);
          }
        } catch (err) {
          if (results["error"] === undefined) results["error"] = [];
          results["error"]!.push(Number.NaN);
          setStatus({ ok: false, message: `Bar error: ${err instanceof Error ? err.message : String(err)}` });
        }
      }, bars as never);

      onResults(results);
      onMetadata([
        { id: "main", color: "#1e88e5", kind: "line" },
        { id: "upper", color: "#787b86", kind: "hline" },
        { id: "lower", color: "#787b86", kind: "hline" },
      ]);
      setStatus({ ok: true, message: `OK — ${bars.length} bars` });
    } catch (err) {
      setStatus({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(false);
    }
  }, [bars, onResults, onMetadata]);

  useEffect(() => {
    if (!autoRun) return;
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void runCode(code); }, 500);
    return () => { if (debounceRef.current !== null) clearTimeout(debounceRef.current); };
  }, [code, autoRun, runCode]);

  useEffect(() => {
    void runCode(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars]);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm">Pine Editor (TypeScript)</CardTitle>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Switch id="auto-run" checked={autoRun} onCheckedChange={setAutoRun} />
            <Label htmlFor="auto-run" className="text-xs text-muted-foreground">Auto</Label>
          </div>
          <Button size="sm" variant="default" onClick={() => void runCode(code)} disabled={running}>
            <Play className="h-3 w-3 mr-1" /> {running ? "Running..." : "Run"}
          </Button>
          <Badge variant={status.ok ? "default" : "destructive"} className="text-[10px]">
            {status.ok ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <AlertCircle className="h-3 w-3 mr-1" />}
            {status.message.slice(0, 50)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0">
        <textarea
          className="h-full w-full resize-none bg-[#1e1e1e] p-3 font-mono text-xs text-[#d4d4d4] outline-none"
          style={{ tabSize: 2 }}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          spellCheck={false}
          onKeyDown={(e) => {
            // Tab inserts 2 spaces instead of moving focus.
            if (e.key === "Tab") {
              e.preventDefault();
              const target = e.target as HTMLTextAreaElement;
              const start = target.selectionStart;
              const end = target.selectionEnd;
              const newCode = code.slice(0, start) + "  " + code.slice(end);
              setCode(newCode);
              target.selectionStart = target.selectionEnd = start + 2;
            }
          }}
        />
      </CardContent>
    </Card>
  );
}

