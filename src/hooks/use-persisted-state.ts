"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const KEY_PREFIX = "pine-ts-workbench-ui:";

/**
 * useState that survives reloads and restarts via localStorage. The stored value
 * is applied after mount (the page is prerendered, so reading storage during
 * render would mismatch hydration). Blocked or corrupt storage falls back to `initial`.
 */
export function usePersistedState<T>(key: string, initial: T): [T, (next: T | ((previous: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);
  const storageKey = KEY_PREFIX + key;
  const valueRef = useRef(value);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw !== null) {
        valueRef.current = JSON.parse(raw) as T;
        setValue(valueRef.current);
      }
    } catch { /* blocked or corrupt: keep the default */ }
  }, [storageKey]);

  const update = useCallback((next: T | ((previous: T) => T)) => {
    const resolved = typeof next === "function" ? (next as (previous: T) => T)(valueRef.current) : next;
    valueRef.current = resolved;
    setValue(resolved);
    try { window.localStorage.setItem(storageKey, JSON.stringify(resolved)); } catch { /* session-only */ }
  }, [storageKey]);

  return [value, update];
}
