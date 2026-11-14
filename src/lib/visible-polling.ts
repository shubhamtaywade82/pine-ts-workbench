/**
 * Polling that costs nothing when nothing is happening: the delay doubles (up to a cap) while answers stop
 * changing, resets the moment one does, and stops entirely while the tab is hidden. Becoming visible again
 * refreshes at once, so a returning user never sees old data.
 */

export interface VisibilityLike {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface TimerLike {
  readonly set: (callback: () => void, ms: number) => unknown;
  readonly clear: (handle: unknown) => void;
}

export interface PollingOptions {
  /** Fetches once. Resolves true when the answer differs from the last one; a rejection counts as unchanged. */
  readonly run: () => Promise<boolean>;
  readonly baseMs: number;
  readonly maxMs: number;
  readonly visibility?: VisibilityLike;
  readonly timers?: TimerLike;
}

const BROWSER_TIMERS: TimerLike = { set: (callback, ms) => setTimeout(callback, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };

/** Starts polling now; returns the function that stops it. */
export const startPolling = (options: PollingOptions): (() => void) => {
  const { run, baseMs, maxMs } = options;
  const visibility = options.visibility ?? (typeof document === "undefined" ? undefined : document);
  const timers = options.timers ?? BROWSER_TIMERS;
  let handle: unknown;
  let delay = baseMs;
  let isStopped = false;
  let isRunning = false;

  const schedule = (): void => {
    if (isStopped || isRunning || visibility?.hidden === true) return;
    handle = timers.set(() => void tick(), delay);
  };

  const tick = async (): Promise<void> => {
    if (isStopped || isRunning) return;
    isRunning = true;
    const changed = await run().catch(() => false);
    isRunning = false;
    delay = changed ? baseMs : Math.min(delay * 2, maxMs);
    schedule();
  };

  const onVisibilityChange = (): void => {
    timers.clear(handle);
    if (visibility?.hidden === true) return;
    delay = baseMs;
    void tick();
  };

  visibility?.addEventListener("visibilitychange", onVisibilityChange);
  void tick();
  return () => {
    isStopped = true;
    timers.clear(handle);
    visibility?.removeEventListener("visibilitychange", onVisibilityChange);
  };
};
