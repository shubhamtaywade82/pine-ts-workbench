import { describe, expect, test } from "bun:test";
import React from "react";
import type { Bar } from "@nemesis-oss/pine-ts";
import type { Technicals } from "@/lib/technicals";
import { useTechnicals } from "./use-technicals";

function renderTestHook<T>(hook: () => T) {
  let stateIndex = 0;
  const states: unknown[] = [];
  const effects: Array<() => void | (() => void)> = [];
  const cleanups: Array<() => void> = [];
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
    useEffect(effect: () => void | (() => void)) { effects.push(effect); },
    useRef<V>(initial: V) { return { current: initial }; },
  };

  function run() {
    stateIndex = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    const prev = internals.H;
    internals.H = dispatcher;
    try {
      result = hook();
    } finally {
      internals.H = prev;
    }
    const currentEffects = [...effects];
    effects.length = 0;
    for (const eff of currentEffects) {
      const cleanup = eff();
      if (typeof cleanup === "function") cleanups.push(cleanup);
    }
  }

  run();
  return {
    get current() { return result; },
    unmount() { for (const cl of cleanups) cl(); },
  };
}

const mockTechnicals: Technicals = {
  oscillators: [],
  movingAverages: [],
  pivots: { CLASSIC: [], FIBONACCI: [], CAMARILLA: [], WOODIE: [], DE_MARK: [] },
  oscillatorScore: 0.5,
  movingAverageScore: 0.8,
  summaryScore: 0.65,
};

describe("useTechnicals", () => {
  test("should load technicals successfully", async () => {
    let fetched = false;
    const hook = renderTestHook(() =>
      useTechnicals("BTCUSDT", "1h", {
        refreshMs: 0,
        fetchBars: async () => {
          fetched = true;
          return [{ time: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }] as Bar[];
        },
        compute: async () => mockTechnicals,
      }),
    );

    expect(hook.current.isLoading).toBe(true);
    // Allow async microtasks in the effect to resolve.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fetched).toBe(true);
    expect(hook.current.technicals).toEqual(mockTechnicals);
    expect(hook.current.error).toBeNull();
    expect(hook.current.isLoading).toBe(false);
  });

  test("should record error when fetching bars fails", async () => {
    const hook = renderTestHook(() =>
      useTechnicals("BTCUSDT", "1h", {
        refreshMs: 0,
        fetchBars: async () => { throw new Error("Network timeout"); },
        compute: async () => mockTechnicals,
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(hook.current.technicals).toBeNull();
    expect(hook.current.error).toBe("Network timeout");
    expect(hook.current.isLoading).toBe(false);
  });

  test("should reload when reload() is called", async () => {
    let callCount = 0;
    const hook = renderTestHook(() =>
      useTechnicals("BTCUSDT", "15m", {
        refreshMs: 0,
        fetchBars: async () => {
          callCount++;
          return [] as Bar[];
        },
        compute: async () => mockTechnicals,
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(callCount).toBe(1);

    hook.current.reload();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(callCount).toBe(2);
  });
});
