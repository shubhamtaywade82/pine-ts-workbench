import { describe, expect, test } from "bun:test";
import {
  createScript, currentCode, deleteScript, describeCode, markOpened, recentlyUsed, renameScript,
  saveVersion, toggleFavorite, uniqueName, updateSettings, type ScriptLibrary,
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
});
