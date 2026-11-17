import type { AppSettings } from '../../domain/types';
import { nowIso } from '../../lib/normalize';
import {
  extractSyncedSettings,
  SETTINGS_RECORD_ID,
  syncedSettingsEqual,
} from '../../lib/settingsSync';
import { notifySync } from '../syncNotify';
import { ensureSettings, getDb } from '../database';

// ---------------------------------------------------------------------------
// Settings writes: the only place AppSettings is mutated. Stamps the
// last-write-wins clock and queues the synced study-value slice (see
// src/lib/settingsSync.ts) whenever that slice actually changes, so per-device
// fields (quiet mode, theme, TTS, …) never generate sync traffic.
// ---------------------------------------------------------------------------

export async function updateSettings(
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  const db = getDb();
  const current = await ensureSettings(db);
  const next: AppSettings = { ...current, ...patch, id: 'settings', updatedAt: nowIso() };
  await db.settings.put(next);
  if (!syncedSettingsEqual(extractSyncedSettings(current), extractSyncedSettings(next))) {
    notifySync('settings', SETTINGS_RECORD_ID, extractSyncedSettings(next));
  }
  return next;
}
