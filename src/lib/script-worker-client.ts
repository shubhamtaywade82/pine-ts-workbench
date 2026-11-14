import { createLiveRunner, type LiveRunner, type ScriptRun } from "@/lib/indicator-runner";
import { createHtfLoader, type HtfSource } from "@/lib/htf-bars";
import { ScriptCompileError } from "@/lib/script-loader";
import type { WorkerReply, WorkerRequest } from "@/lib/script-worker";

/**
 * Script execution timeout — TradingView Ultimate's computation limit is
 * 100 s per script run (Basic 20 s, mid tiers 40 s). A wedged script
 * (infinite loop, pathological input) is cut off with a clear error
 * instead of hanging the worker forever.
 */
export const SCRIPT_TIMEOUT_MS = 100_000;

const timeoutError = (ms: number): Error =>
  new Error(`Script execution timed out after ${Math.round(ms / 1000)}s (TradingView Ultimate's limit is 100s). Check for infinite loops or unbounded while loops in the script.`);

// Kept apart from indicator-runner: the worker bundles that module, and must not contain `new Worker(...)` itself.
/** A script slot's runner plus the release of its live run when the slot goes away. */
export interface ScriptRunner {
  readonly run: LiveRunner;
  readonly dispose: () => void;
}

type PendingRun = { resolve: (run: ScriptRun) => void; reject: (error: Error) => void };
let scriptWorker: Worker | undefined;
const pendingRuns = new Map<number, PendingRun>();
let nextRunId = 0;
let nextSlot = 0;

const getScriptWorker = (): Worker => {
  if (scriptWorker !== undefined) return scriptWorker;
  const worker = new Worker(new URL("./script-worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
    const pending = pendingRuns.get(data.id);
    pendingRuns.delete(data.id);
    if (data.ok) pending?.resolve(data.run);
    else pending?.reject(new ScriptCompileError(data.message, data.position));
  };
  // A crashed worker loses every live run: fail what's in flight and start fresh on the next run.
  worker.onerror = (event) => {
    for (const pending of pendingRuns.values()) pending.reject(new Error(`Script worker crashed: ${event.message}`));
    pendingRuns.clear();
    scriptWorker = undefined;
  };
  return (scriptWorker = worker);
};

/**
 * A live runner on the script Web Worker, so heavy scripts never stall chart
 * animation. Where Workers don't exist (server render, tests) it runs in-thread.
 */
export const createScriptRunner = (source?: HtfSource): ScriptRunner => {
  if (typeof Worker === "undefined") {
    // In-thread fallback (server render, tests): race the run against the
    // same timeout budget the worker enforces.
    const inThread = createLiveRunner(source ? createHtfLoader(source) : undefined);
    return {
      run: (userCode, bars, inputs = {}) => Promise.race([
        inThread(userCode, bars, inputs),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(timeoutError(SCRIPT_TIMEOUT_MS)), SCRIPT_TIMEOUT_MS).unref?.();
        }),
      ]),
      dispose: () => undefined,
    };
  }
  const slot = nextSlot++;
  return {
    run: (userCode, bars, inputs = {}) => new Promise<ScriptRun>((resolve, reject) => {
      const id = nextRunId++;
      // The timeout is enforced here on the main thread: a wedged worker
      // cannot time itself out. On timeout the pending run rejects; the
      // worker may later reply for this id, which is then ignored.
      const timer = setTimeout(() => {
        const pending = pendingRuns.get(id);
        pendingRuns.delete(id);
        pending?.reject(timeoutError(SCRIPT_TIMEOUT_MS));
      }, SCRIPT_TIMEOUT_MS);
      pendingRuns.set(id, {
        resolve: (run) => { clearTimeout(timer); resolve(run); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      getScriptWorker().postMessage({ type: "run", id, slot, code: userCode, bars, inputs, source } satisfies WorkerRequest);
    }),
    dispose: () => scriptWorker?.postMessage({ type: "dispose", slot } satisfies WorkerRequest),
  };
};
