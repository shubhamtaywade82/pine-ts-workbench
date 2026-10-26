import { transform } from "sucrase";
import {
  defineStrategy, indicator, math, smc, ta, type IndicatorScript, type StrategyScript,
} from "@nemesis-oss/pine-ts";

/**
 * Compiles user-written editor code. Two forms are accepted:
 *
 * - concise (default): `indicator("RSI", ({ close, plot }) => ...)` or
 *   `defineStrategy("X", { ... }, ({ close, strategy }) => ...)`. The
 *   `@nemesis-oss/pine-ts` import is optional — `indicator`, `defineStrategy`,
 *   `ta`, `math` and `smc` are injected.
 * - legacy: a top-level `calculate` / `strategy` function (pre-existing saved scripts).
 */

export interface CodePosition { readonly line: number; readonly column: number; readonly message: string }

export class ScriptCompileError extends Error {
  constructor(message: string, readonly position: CodePosition | null) { super(message); }
}

export type LoadedScript<TLegacy> =
  | { readonly kind: "indicator"; readonly script: IndicatorScript }
  | { readonly kind: "strategy"; readonly script: StrategyScript }
  | { readonly kind: "legacy"; readonly fn: TLegacy };

// Blanked rather than deleted so sucrase error line numbers still match the editor.
const PINE_IMPORT = /^\s*import\s[\s\S]*?from\s*["']@nemesis-oss\/pine-ts["'];?/gm;
const blank = (text: string) => text.replace(/[^\n]/g, "");

export const loadScript = <TLegacy>(userCode: string, legacyName: "calculate" | "strategy"): LoadedScript<TLegacy> => {
  // `export` is stripped because new Function() can't evaluate ES module syntax.
  const cleanCode = userCode
    .replace(PINE_IMPORT, blank)
    .replace(/\bexport\s+default\s+/g, "")
    .replace(/\bexport\s+(function|const|let|var)\b/g, "$1");
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

  const created: Array<IndicatorScript | StrategyScript> = [];
  const captureIndicator = (...args: unknown[]) => {
    const script = (indicator as (...a: unknown[]) => IndicatorScript)(...args);
    created.push(script);
    return script;
  };
  const captureStrategy = (...args: unknown[]) => {
    const script = (defineStrategy as (...a: unknown[]) => StrategyScript)(...args);
    created.push(script);
    return script;
  };
  const factory = new Function(
    "indicator", "defineStrategy", "ta", "math", "smc",
    `${transpiled}\nreturn typeof ${legacyName} === 'function' ? ${legacyName} : null;`,
  ) as (...injected: unknown[]) => TLegacy | null;
  const legacy = factory(captureIndicator, captureStrategy, ta, math, smc);

  if (created.length > 1) {
    throw new ScriptCompileError(`Define exactly one script; found ${created.length}.`, null);
  }
  const [script] = created;
  if (script?.kind === "indicator") return { kind: "indicator", script };
  if (script?.kind === "strategy") return { kind: "strategy", script };
  if (legacy !== null) return { kind: "legacy", fn: legacy };
  throw new ScriptCompileError(
    legacyName === "calculate"
      ? 'No indicator found. Write indicator("Name", ({ close, plot }) => { ... }).'
      : 'No strategy found. Write defineStrategy("Name", { ... }, ({ close, strategy }) => { ... }).',
    null,
  );
};
