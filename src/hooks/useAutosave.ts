import { useEffect, useRef, useState } from 'react';

import { AUTOSAVE_DEBOUNCE_MS } from '../appConfig';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'failed';

export function useAutosave<T>(
  value: T,
  save: (value: T) => Promise<void>,
  options?: { debounceMs?: number; enabled?: boolean },
): { saveState: SaveState; saveNow: () => Promise<void> } {
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const latest = useRef(value);
  const saveRef = useRef(save);
  const timer = useRef<number | null>(null);
  const enabled = options?.enabled ?? true;
  const debounceMs = options?.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;

  latest.current = value;
  saveRef.current = save;

  const saveNow = async () => {
    if (!enabled) return;
    setSaveState('saving');
    try {
      await saveRef.current(latest.current);
      setSaveState('saved');
    } catch {
      setSaveState('failed');
    }
  };

  useEffect(() => {
    if (!enabled) return;
    setSaveState('dirty');
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void saveNow();
    }, debounceMs);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
    // Intentionally depend on value identity/serialization via JSON.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(value), enabled, debounceMs]);

  return { saveState, saveNow };
}
