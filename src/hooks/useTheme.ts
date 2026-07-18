import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { DEFAULT_SETTINGS, readSettings } from '../db/database';
import { updateSettings } from '../db/repository';
import type { ThemePreference } from '../domain/types';

export function useTheme() {
  const settings = useLiveQuery(() => readSettings(), []);

  useEffect(() => {
    const theme = settings?.theme ?? DEFAULT_SETTINGS.theme;
    const root = document.documentElement;
    if (theme === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
  }, [settings?.theme]);

  return {
    theme: (settings?.theme ?? DEFAULT_SETTINGS.theme) as ThemePreference,
    setTheme: (theme: ThemePreference) => updateSettings({ theme }),
  };
}
