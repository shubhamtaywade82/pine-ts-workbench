/**
 * CoinDCX client-side settings management.
 * Stored in browser localStorage only; secrets are never stored on the server.
 */

const STORAGE_KEY = "pine-ts-workbench-coindcx-settings";
export const SETTINGS_CHANGE_EVENT = "coindcx-settings-changed";

export interface CoindcxSettings {
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly autoRefresh: boolean;
  readonly refreshIntervalSec: number;
}

export const DEFAULT_COINDCX_SETTINGS: CoindcxSettings = {
  apiKey: "",
  apiSecret: "",
  autoRefresh: true,
  refreshIntervalSec: 10,
};

/** Checks if valid credentials are configured. */
export function hasCoindcxCredentials(settings: CoindcxSettings): boolean {
  return settings.apiKey.trim().length > 0 && settings.apiSecret.trim().length > 0;
}

/** Normalizes any raw settings input safely against defaults. */
export function normalizeCoindcxSettings(raw: unknown): CoindcxSettings {
  if (typeof raw !== "object" || raw === null) return DEFAULT_COINDCX_SETTINGS;
  const s = raw as Record<string, unknown>;
  const interval = Number(s.refreshIntervalSec);
  return {
    apiKey: typeof s.apiKey === "string" ? s.apiKey.trim() : "",
    apiSecret: typeof s.apiSecret === "string" ? s.apiSecret.trim() : "",
    autoRefresh: typeof s.autoRefresh === "boolean" ? s.autoRefresh : DEFAULT_COINDCX_SETTINGS.autoRefresh,
    refreshIntervalSec: Number.isFinite(interval) && interval >= 3 ? interval : DEFAULT_COINDCX_SETTINGS.refreshIntervalSec,
  };
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const getStorage = (override?: StorageLike): StorageLike | undefined => {
  if (override) return override;
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  return undefined;
};

/** Reads settings from storage. */
export function loadCoindcxSettings(storageOverride?: StorageLike): CoindcxSettings {
  const storage = getStorage(storageOverride);
  if (!storage) return DEFAULT_COINDCX_SETTINGS;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_COINDCX_SETTINGS;
    return normalizeCoindcxSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_COINDCX_SETTINGS;
  }
}

/** Persists settings to storage and dispatches change notification event. */
export function saveCoindcxSettings(settings: CoindcxSettings, storageOverride?: StorageLike): void {
  const storage = getStorage(storageOverride);
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(settings));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));
    }
  } catch {
    // Quota or private mode fallback
  }
}

/** Clears stored credentials. */
export function clearCoindcxSettings(storageOverride?: StorageLike): void {
  const storage = getStorage(storageOverride);
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));
    }
  } catch {
    // Quota or private mode fallback
  }
}
