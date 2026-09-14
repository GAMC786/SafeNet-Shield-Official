import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

function readStoredValue<T>(key: string, initialValue: T): T {
  if (typeof window === "undefined") return initialValue;

  try {
    const stored = window.localStorage.getItem(key);
    return stored === null ? initialValue : (JSON.parse(stored) as T);
  } catch {
    return initialValue;
  }
}

export function usePersistentState<T>(
  key: string,
  initialValue: T | (() => T),
): [T, Dispatch<SetStateAction<T>>, () => void] {
  const resolveInitialValue = useCallback(
    () => (typeof initialValue === "function" ? (initialValue as () => T)() : initialValue),
    [initialValue],
  );
  const [value, setValue] = useState<T>(() => readStoredValue(key, resolveInitialValue()));

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Persistence is best effort; the form remains usable if storage is unavailable.
    }
  }, [key, value]);

  const clear = useCallback(() => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore unavailable storage while allowing the caller to reset its in-memory state.
    }
    setValue(resolveInitialValue());
  }, [key, resolveInitialValue]);

  return [value, setValue, clear];
}