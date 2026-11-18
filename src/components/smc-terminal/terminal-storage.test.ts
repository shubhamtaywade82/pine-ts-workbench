import { beforeEach, describe, expect, it } from "bun:test";
import { loadTerminalState, saveTerminalState, type PersistedTerminal } from "./terminal-storage";
import type { TerminalParams } from "./terminal-types";

const store = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  },
};

const defaults: PersistedTerminal = {
  params: { zoom: 96, grid: true, gridAlpha: 0.3, theme: "ion" } as TerminalParams,
  tf: 5, isSoundOn: true, isLiveFeed: true,
};

describe("terminal storage", () => {
  beforeEach(() => store.clear());

  it("returns defaults when nothing is saved", () => {
    expect(loadTerminalState(defaults)).toEqual(defaults);
  });

  it("restores what the user changed", () => {
    saveTerminalState({ ...defaults, params: { ...defaults.params, grid: false, zoom: 140 }, tf: 15, isSoundOn: false });
    const restored = loadTerminalState(defaults);
    expect(restored.params).toMatchObject({ grid: false, zoom: 140 });
    expect(restored).toMatchObject({ tf: 15, isSoundOn: false, isLiveFeed: true });
  });

  it("ignores wrong-typed values, unknown timeframes and corrupt JSON", () => {
    store.set("smc-terminal:v1", JSON.stringify({ params: { grid: "yes", zoom: 80 }, tf: 7 }));
    const restored = loadTerminalState(defaults);
    expect(restored.params).toMatchObject({ grid: true, zoom: 80 });
    expect(restored.tf).toBe(5);
    store.set("smc-terminal:v1", "{not json");
    expect(loadTerminalState(defaults)).toEqual(defaults);
  });
});
