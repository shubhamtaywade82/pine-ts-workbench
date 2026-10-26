import { describe, expect, test } from "bun:test";
import React from "react";
import type { Bar } from "@nemesis-oss/pine-ts";
import type { Technicals } from "@/lib/technicals";
import { useTechnicals } from "./use-technicals";

function renderTestHook<T>(hook: () => T) {
  let stateIndex = 0;
  let effectIndex = 0;
  let refIndex = 0;
  const states: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  let pendingEffects: Array<() => void | (() => void)> = [];
  const cleanups: Array<() => void> = [];
  const effectDepsMap = new Map<number, unknown[]>();
  let isRendering = false;
  let isRerunning = false;
  let result!: T;

  const areDepsEqual = (prev?: unknown[], next?: unknown[]) => {
    if (!prev || !next || prev.length !== next.length) return false;
    return prev.every((p, i) => Object.is(p, next[i]));
  };

  const dispatcher = {
    useState<S>(initial: S | (() => S)) {
      const idx = stateIndex++;
      if (states[idx] === undefined) states[idx] = typeof initial === "function" ? (initial as () => S)() : initial;
      const setState = (val: S | ((prev: S) => S)) => {
        states[idx] = typeof val === "function" ? (val as (prev: S) => S)(states[idx] as S) : val;
        scheduleRun();
      };
      return [states[idx] as S, setState];
    },
    useCallback<F>(fn: F) { return fn; },
    useEffect(effect: () => void | (() => void), deps?: unknown[]) {
      const idx = effectIndex++;
      const prevDeps = effectDepsMap.get(idx);
      if (!areDepsEqual(prevDeps, deps)) {
        effectDepsMap.set(idx, deps ? [...deps] : []);
        pendingEffects.push(effect);
      }
    },
    useRef<V>(initial: V) {
      const idx = refIndex++;
      if (refs[idx] === undefined) refs[idx] = { current: initial };
      return refs[idx] as { current: V };
    },
  };

  function scheduleRun() {
    if (isRendering || isRerunning) return;
    run();
  }

  function run() {
    isRendering = true;
    stateIndex = 0;
    effectIndex = 0;
    refIndex = 0;
    const internals = (React as unknown as { __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { H: typeof dispatcher } }).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    const prev = internals.H;
    internals.H = dispatcher;
    try {
      result = hook();
    } finally {
      internals.H = prev;
      isRendering = false;
    }

    const effectsToRun = pendingEffects;
    pendingEffects = [];
    isRerunning = true;
    try {
      for (const eff of effectsToRun) {
        const cleanup = eff();
        if (typeof cleanup === "function") cleanups.push(cleanup);
      }
    } finally {
      isRerunning = false;
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
    await new Promise((resolve) => setTimeout(resolve, 20));

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

    await new Promise((resolve) => setTimeout(resolve, 20));
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

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(callCount).toBe(1);

    hook.current.reload();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(callCount).toBe(2);
  });
});
