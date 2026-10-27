/// <reference lib="webworker" />
import type { Bar, InputsBag } from "@nemesis-oss/pine-ts";
import { createLiveRunner, type LiveRunner, type ScriptRun } from "./indicator-runner";
import { ScriptCompileError, type CodePosition } from "./script-loader";

import { fetchHtfBars, type BinanceSymbol } from "./public-binance-feed";

/**
 * Runs Pine Editor and saved scripts off the main thread, so a heavy indicator
 * never stalls chart animation. Each slot (the editor, a script on a chart)
 * keeps its own live run, so ticks still execute only the forming bar.
 */

export type WorkerRequest =
  | { readonly type: "run"; readonly id: number; readonly slot: number; readonly code: string; readonly bars: readonly Bar[]; readonly inputs: InputsBag; readonly symbol?: string }
  | { readonly type: "dispose"; readonly slot: number };

export type WorkerReply =
  | { readonly id: number; readonly ok: true; readonly run: ScriptRun }
  | { readonly id: number; readonly ok: false; readonly message: string; readonly position: CodePosition | null };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const runners = new Map<number, LiveRunner>();

const reply = (message: WorkerReply): void => scope.postMessage(message);

scope.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  if (data.type === "dispose") {
    runners.delete(data.slot);
    return;
  }
  let run = runners.get(data.slot);
  if (run === undefined) {
    const symbol = (data.symbol ?? "BTCUSDT") as BinanceSymbol;
    runners.set(data.slot, (run = createLiveRunner((tf) => fetchHtfBars(tf, symbol))));
  }
  try {
    reply({ id: data.id, ok: true, run: await run(data.code, data.bars, data.inputs) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    reply({ id: data.id, ok: false, message, position: err instanceof ScriptCompileError ? err.position : null });
  }
};
