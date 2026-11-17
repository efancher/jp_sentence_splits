import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDb, resetDbForTests } from '../db/database';
import { DEFAULT_SETTINGS } from '../db/database';
import { updateSettings } from '../db/repo/settingsWrites';
import {
  extractSyncedSettings,
  mergeSyncedSettings,
  SYNCED_SETTINGS_KEYS,
} from '../lib/settingsSync';
import { toRemoteRow } from './mappers';
import { applyRemoteUpsert } from './engine';

const trackLocalMutation = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('./track', () => ({
  trackLocalMutation,
  trackLocalMutationsInTransaction: vi.fn(async () => {}),
  requestSyncAfterCommit: vi.fn(),
}));

describe('settings sync subset', () => {
  it('extracts study values and settings-embedded learning data, not device fields', () => {
    const synced = extractSyncedSettings({
      ...DEFAULT_SETTINGS,
      id: 'settings',
      theme: 'dark',
      quietMode: true,
      lastOpenedBookId: 'book_1',
      shadowingNote: 'remember to breathe',
      tts: { enabled: true, rate: 1, voiceName: 'Samantha' } as never,
      sequentialStudyMode: true,
      iPlusOneStrict: false,
      shadowSnoozes: { sent_1: '2026-11-17T00:00:00.000Z' },
      updatedAt: '2026-11-17T00:00:00.000Z',
    });
    expect(synced.sequentialStudyMode).toBe(true);
    expect(synced.iPlusOneStrict).toBe(false);
    expect(synced.shadowSnoozes).toEqual({ sent_1: '2026-11-17T00:00:00.000Z' });
    expect(synced.updatedAt).toBe('2026-11-17T00:00:00.000Z');
    for (const deviceKey of ['theme', 'tts', 'quietMode', 'lastOpenedBookId', 'shadowingNote', 'id']) {
      expect(synced).not.toHaveProperty(deviceKey);
    }
    expect(Object.keys(synced).every((k) => (SYNCED_SETTINGS_KEYS as readonly string[]).includes(k))).toBe(true);
  });

  it('merge applies synced keys, keeps device fields, ignores unknown keys', () => {
    const current = { ...DEFAULT_SETTINGS, id: 'settings', theme: 'dark' } as const;
    const merged = mergeSyncedSettings(current, {
      iPlusOneOrdering: false,
      quietMode: true,
      theme: 'light',
      some_future_field: 'x',
    } as never);
    expect(merged.iPlusOneOrdering).toBe(false);
    expect(merged.theme).toBe('dark');
    expect(merged.quietMode).not.toBe(true);
    expect(merged).not.toHaveProperty('some_future_field');
  });

  it('push row is the single owner-scoped settings record', () => {
    const row = toRemoteRow(
      'settings',
      extractSyncedSettings({ ...DEFAULT_SETTINGS, id: 'settings', updatedAt: '2026-11-17T00:00:00.000Z' }),
      'user_1',
      3,
    );
    expect(row.id).toBe('settings');
    expect(row.owner_id).toBe('user_1');
    expect(row.version).toBe(3);
    expect(row.updated_at).toBe('2026-11-17T00:00:00.000Z');
    expect((row.data as Record<string, unknown>).theme).toBeUndefined();
  });
});

describe('updateSettings sync enqueue', () => {
  beforeEach(() => {
    resetDbForTests(`settings-sync-${Math.random().toString(36).slice(2)}`);
    trackLocalMutation.mockClear();
  });

  it('queues the synced slice when a study value changes', async () => {
    await updateSettings({ sequentialStudyMode: true });
    expect(trackLocalMutation).toHaveBeenCalledTimes(1);
    const call = (trackLocalMutation.mock.calls[0] as unknown as [Record<string, unknown>])[0] as {
      entity: string;
      recordId: string;
      payload: Record<string, unknown>;
    };
    expect(call.entity).toBe('settings');
    expect(call.recordId).toBe('settings');
    expect(call.payload.sequentialStudyMode).toBe(true);
    expect(call.payload.theme).toBeUndefined();
  });

  it('stays quiet for per-device-only changes', async () => {
    await updateSettings({ quietMode: true, theme: 'dark' });
    expect(trackLocalMutation).not.toHaveBeenCalled();
    const row = await getDb().settings.get('settings');
    expect(row?.quietMode).toBe(true);
    expect(row?.updatedAt).toBeTruthy();
  });
});

describe('applyRemoteUpsert settings', () => {
  beforeEach(() => {
    resetDbForTests(`settings-apply-${Math.random().toString(36).slice(2)}`);
  });

  it('merges a remote payload onto the local row without clobbering device fields', async () => {
    await updateSettings({ theme: 'dark', quietMode: true });
    trackLocalMutation.mockClear();
    await applyRemoteUpsert(
      'settings',
      {
        id: 'settings',
        data: { iPlusOneStrict: false, dailyBudgetMinutes: 30, updatedAt: '2026-11-17T01:00:00.000Z' },
        updated_at: '2026-11-17T01:00:00.000Z',
        version: 5,
      },
      5,
    );
    const row = await getDb().settings.get('settings');
    expect(row?.iPlusOneStrict).toBe(false);
    expect(row?.dailyBudgetMinutes).toBe(30);
    expect(row?.theme).toBe('dark');
    expect(row?.quietMode).toBe(true);
    // Applying a remote row must not bounce a new queue entry (no notifySync path).
    expect(trackLocalMutation).not.toHaveBeenCalled();
  });
});
