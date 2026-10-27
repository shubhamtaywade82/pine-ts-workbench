import { createLiveRunner, type LiveRunner, type ScriptRun } from "@/lib/indicator-runner";
import { ScriptCompileError } from "@/lib/script-loader";
import type { WorkerReply, WorkerRequest } from "@/lib/script-worker";

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
export const createScriptRunner = (): ScriptRunner => {
  if (typeof Worker === "undefined") return { run: createLiveRunner(), dispose: () => undefined };
  const slot = nextSlot++;
  return {
    run: (userCode, bars, inputs = {}) => new Promise<ScriptRun>((resolve, reject) => {
      const id = nextRunId++;
      pendingRuns.set(id, { resolve, reject });
      getScriptWorker().postMessage({ type: "run", id, slot, code: userCode, bars, inputs } satisfies WorkerRequest);
    }),
    dispose: () => scriptWorker?.postMessage({ type: "dispose", slot } satisfies WorkerRequest),
  };
};
