import { describe, expect, it } from "bun:test";
import React from "react";
import { useBarReplay } from "./use-bar-replay";

function renderTestHook<T>(hook: () => T) {
  let stateIndex = 0;
  const states: unknown[] = [];
  let result!: T;

  const dispatcher = {
    useState<S>(initial: S | (() => S)) {
      const idx = stateIndex++;
      if (states[idx] === undefined) states[idx] = typeof initial === "function" ? (initial as () => S)() : initial;
      const setState = (val: S | ((prev: S) => S)) => {
        states[idx] = typeof val === "function" ? (val as (prev: S) => S)(states[idx] as S) : val;
        run();
      };
      return [states[idx] as S, setState];
    },
    useCallback<F>(fn: F) { return fn; },
    useEffect() { /* timer tested separately in bar-replay.test */ },
    useRef<V>(initial: V) { return { current: initial }; },
    useMemo<V>(fn: () => V) { return fn(); },
  };

  const run = () => {
    stateIndex = 0;
    const internals = (React as unknown as { __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { H: typeof dispatcher } })
      .__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    const prev = internals.H;
    internals.H = dispatcher;
    try {
      result = hook();
    } finally {
      internals.H = prev;
    }
  };

  run();
  return {
    get result() { return result; },
  };
}

describe("useBarReplay hook", () => {
  it("initializes in live mode", () => {
    const hook = renderTestHook(() => useBarReplay(100));
    expect(hook.result.isReplay).toBe(false);
    expect(hook.result.isPlaying).toBe(false);
    expect(hook.result.replayIndex).toBe(100);
  });

  it("starts replay jumped back and steps forward", () => {
    const hook = renderTestHook(() => useBarReplay(100));
    hook.result.startReplay(40);
    expect(hook.result.isReplay).toBe(true);
    expect(hook.result.replayIndex).toBe(40);

    hook.result.stepForward();
    expect(hook.result.replayIndex).toBe(41);

    hook.result.stopReplay();
    expect(hook.result.isReplay).toBe(false);
    expect(hook.result.replayIndex).toBe(100);
  });
});
