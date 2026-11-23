import { describe, expect, it } from "bun:test";
import {
  DEFAULT_COINDCX_SETTINGS,
  hasCoindcxCredentials,
  normalizeCoindcxSettings,
  loadCoindcxSettings,
  saveCoindcxSettings,
  clearCoindcxSettings,
} from "./coindcx-settings";

describe("coindcx-settings", () => {
  const createMockStorage = () => {
    const store = new Map<string, string>();
    return {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    };
  };

  it("loads default settings when nothing is stored", () => {
    const s = loadCoindcxSettings(createMockStorage());
    expect(s.apiKey).toBe("");
    expect(s.apiSecret).toBe("");
    expect(s.autoRefresh).toBe(true);
    expect(hasCoindcxCredentials(s)).toBe(false);
  });

  it("normalizes malformed settings gracefully", () => {
    expect(normalizeCoindcxSettings(null)).toEqual(DEFAULT_COINDCX_SETTINGS);
    expect(normalizeCoindcxSettings("nonsense")).toEqual(DEFAULT_COINDCX_SETTINGS);
    const partial = normalizeCoindcxSettings({ apiKey: "  abc  ", refreshIntervalSec: 1 });
    expect(partial.apiKey).toBe("abc");
    expect(partial.refreshIntervalSec).toBe(DEFAULT_COINDCX_SETTINGS.refreshIntervalSec);
  });

  it("saves and loads settings round-trip", () => {
    const mockStorage = createMockStorage();
    saveCoindcxSettings(
      {
        apiKey: "my-key-abc",
        apiSecret: "my-secret-xyz",
        autoRefresh: false,
        refreshIntervalSec: 15,
      },
      mockStorage,
    );
    const loaded = loadCoindcxSettings(mockStorage);
    expect(loaded.apiKey).toBe("my-key-abc");
    expect(loaded.apiSecret).toBe("my-secret-xyz");
    expect(loaded.autoRefresh).toBe(false);
    expect(loaded.refreshIntervalSec).toBe(15);
    expect(hasCoindcxCredentials(loaded)).toBe(true);
  });

  it("clears credentials on clearCoindcxSettings", () => {
    const mockStorage = createMockStorage();
    saveCoindcxSettings(
      {
        apiKey: "my-key-abc",
        apiSecret: "my-secret-xyz",
        autoRefresh: true,
        refreshIntervalSec: 10,
      },
      mockStorage,
    );
    clearCoindcxSettings(mockStorage);
    const loaded = loadCoindcxSettings(mockStorage);
    expect(loaded.apiKey).toBe("");
    expect(loaded.apiSecret).toBe("");
    expect(hasCoindcxCredentials(loaded)).toBe(false);
  });
});
