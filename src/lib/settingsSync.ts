import type { AppSettings } from '../domain/types';

/**
 * The slice of `AppSettings` that follows the learner across signed-in
 * devices, synced as the one-row `settings` entity (src/sync/engine.ts).
 * Everything not listed here stays deliberately local to each device:
 * `theme` (screen/light preferences differ per device), `tts` (the voices
 * exist per platform), `lastOpenedBookId` (per-device "where you left off"),
 * `quietMode` (situational — "where you are right now") and `shadowingNote`.
 * `updatedAt` rides along for last-write-wins bookkeeping.
 */
export const SYNCED_SETTINGS_KEYS = [
  'hideSatoriEnglishInitially',
  'showReadingsInitially',
  'defaultImportDestination',
  'textDisplayMode',
  'newCardsPerSessionLimit',
  'dailyNewAudioCardQuota',
  'dailyNewSentenceCardQuota',
  'graduationMinScheduledDays',
  'dailyBudgetMinutes',
  'sessionAllocation',
  'pitchAccentPaused',
  'sentenceCardsPaused',
  'sentenceShadowingPaused',
  'freshTryRequests',
  'shadowRequests',
  'shadowSnoozes',
  'sequentialStudyMode',
  'iPlusOneOrdering',
  'iPlusOneStretchEvery',
  'iPlusOneStrict',
  'autoMeaningChoices',
  'sequentialUnlockOverrides',
  'recentPodcastFeedUrls',
  'recentNhkEasyFeedUrls',
  'updatedAt',
] as const;

export type SyncedSettingsKey = (typeof SYNCED_SETTINGS_KEYS)[number];

/** The synced payload shape: only the keys above, absent when unset locally. */
export type SyncedSettings = Partial<Pick<AppSettings, SyncedSettingsKey>>;

/** The row a device pushes/pulls — keyed 'settings', one row per owner. */
export const SETTINGS_RECORD_ID = 'settings';

export function extractSyncedSettings(settings: AppSettings): SyncedSettings {
  const synced: SyncedSettings = {};
  for (const key of SYNCED_SETTINGS_KEYS) {
    const value = settings[key];
    if (value !== undefined) (synced as Record<string, unknown>)[key] = value;
  }
  return synced;
}

/**
 * Merge a remote payload onto the local row: synced keys win, device-local
 * keys are untouched. Unknown keys in the payload (from a newer build) are
 * ignored rather than smuggled into local settings.
 */
export function mergeSyncedSettings(
  current: AppSettings,
  remote: Partial<SyncedSettings>,
): AppSettings {
  const allowed = new Set<string>(SYNCED_SETTINGS_KEYS);
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(remote)) {
    if (allowed.has(key)) patch[key] = value;
  }
  return { ...current, ...patch, id: 'settings' };
}

/**
 * Whether two settings rows carry the same synced study values. `updatedAt`
 * is excluded: it stamps every local write (including per-device ones like a
 * theme change), so comparing it would make device-only edits enqueue a
 * pointless whole-payload push. The push still carries it for LWW ordering.
 */
export function syncedSettingsEqual(a: SyncedSettings, b: SyncedSettings): boolean {
  const norm = (s: SyncedSettings) => {
    const { updatedAt: _ignored, ...rest } = s;
    return JSON.stringify(Object.fromEntries(Object.entries(rest).sort(([k1], [k2]) => k1.localeCompare(k2))));
  };
  return norm(a) === norm(b);
}
