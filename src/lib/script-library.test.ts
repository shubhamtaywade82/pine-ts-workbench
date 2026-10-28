import { describe, expect, test } from "bun:test";
import { toEditorOverlays } from "./editor-output";
import {
  createScript, currentCode, deleteScript, describeCode, fetchRemoteScripts, markOpened,
  recentlyUsed, renameScript, saveVersion, toggleFavorite, uniqueName, updateSettings,
  type ScriptLibrary,
} from "./script-library";

const RSI = `indicator("RSI", ({ close, plot }) => { plot(ta.rsi(close, 14)); });`;
const SMA_STRATEGY = `defineStrategy("SMA Cross", {}, ({ strategy }) => {});`;

const withScript = (code: string, id = "a", now = 1): ScriptLibrary => createScript([], { code, id, now });

describe("script library", () => {
  test("should read kind and title from the script's declaration", () => {
    expect(describeCode(RSI)).toEqual({ kind: "indicator", title: "RSI" });
    expect(describeCode(SMA_STRATEGY)).toEqual({ kind: "strategy", title: "SMA Cross" });
    expect(describeCode("export function strategy() {}").kind).toBe("strategy");
  });

  test("should name a new script after its title, numbering duplicates", () => {
    const library = createScript(withScript(RSI), { code: RSI, id: "b", now: 2 });
    expect(library.map((s) => s.name)).toEqual(["RSI", "RSI 1"]);
    expect(uniqueName(library, "RSI")).toBe("RSI 2");
  });

  test("should append a version only when the code changed", () => {
    let library = withScript(RSI);
    library = saveVersion(library, "a", RSI, 2);
    expect(library[0]!.versions).toHaveLength(1);
    library = saveVersion(library, "a", SMA_STRATEGY, 3);
    expect(library[0]!.versions).toHaveLength(2);
    expect(currentCode(library[0]!)).toBe(SMA_STRATEGY);
    expect(library[0]!.kind).toBe("strategy");
  });

  test("should keep names unique on rename and ignore blank names", () => {
    let library = createScript(withScript(RSI), { code: SMA_STRATEGY, id: "b", now: 2 });
    library = renameScript(library, "b", "RSI");
    expect(library[1]!.name).toBe("RSI 1");
    expect(renameScript(library, "b", "  ")).toBe(library);
  });

  test("should list the most recently opened scripts first", () => {
    let library = createScript(withScript(RSI, "a", 1), { code: SMA_STRATEGY, id: "b", now: 2 });
    library = markOpened(library, "a", 3);
    expect(recentlyUsed(library).map((s) => s.id)).toEqual(["a", "b"]);
  });

  test("should store settings on the script", () => {
    const settings = { inputs: { Length: 21 }, properties: { initial_capital: 5000 }, plotStyles: {} };
    expect(updateSettings(withScript(RSI), "a", settings)[0]!.settings).toEqual(settings);
  });

  test("should toggle favourites and delete scripts", () => {
    const library = toggleFavorite(withScript(RSI), "a");
    expect(library[0]!.isFavorite).toBe(true);
    expect(deleteScript(library, "a")).toEqual([]);
  });

  test("should handle remote script fetch cleanly", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, scripts: [] }))) as never;
      const remote = await fetchRemoteScripts();
      expect(Array.isArray(remote)).toBe(true);
      expect(remote).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("toEditorOverlays assigns the active script name to indicatorName", () => {
    const bars = [{ time: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100, isClosed: true }];
    const plots = [
      { id: "ST Bull", color: "#00c4ff", kind: "line" },
      { id: "ST Bear", color: "#ff3d3d", kind: "line" },
    ];
    const results = { "ST Bull": [1.5], "ST Bear": [NaN] };
    const overlays = toEditorOverlays(results, plots, bars, "SMC Confluence Engine v7.1 1");
    expect(overlays).toHaveLength(2);
    expect(overlays[0]!.indicatorName).toBe("SMC Confluence Engine v7.1 1");
    expect(overlays[1]!.indicatorName).toBe("SMC Confluence Engine v7.1 1");
  });
});
