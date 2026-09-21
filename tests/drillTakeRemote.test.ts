import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  client: null as unknown,
}));
vi.mock('../src/sync/supabaseClient', () => ({
  getSupabase: () => fake.client,
  isSupabaseConfigured: () => true,
}));

import type { PitchAnalysisPayload } from '../src/lib/pitch';
import {
  baseMimeType,
  buildDrillTakeRow,
  compactPitch,
  DRILL_GRADER_VERSION,
  drillTakeStoragePath,
  saveDrillTakeLabels,
  uploadDrillTake,
} from '../src/sync/drillTakeRemote';

const pitch: PitchAnalysisPayload = {
  frames: [
    { timeSeconds: 0.123456, hz: 143.2789, voiced: true, confidence: 0.98765, relativeSemitones: 1.23456 },
    { timeSeconds: 0.133456, hz: null, voiced: false, confidence: 0.1, relativeSemitones: null },
  ],
  medianHz: 143.2789,
  voicedRatio: 0.5000001,
  durationSeconds: 1.23456,
};

const input = {
  id: 'take_1',
  mode: 'word' as const,
  transcript: 'ともだち',
  focusTriggered: false,
  audio: { blob: new Blob(['x'], { type: 'audio/webm;codecs=opus' }), mimeType: 'audio/webm;codecs=opus', durationMs: 1234.6 },
  alignment: { durationSeconds: 1.2, words: [] },
  pitch,
  targets: [{ surfaceForm: 'ともだち', reading: 'ともだち', pitchAccentPositions: [0], contextSentenceId: 's1' }],
  results: [{ surfaceForm: 'ともだち', measured: true, mismatch: false }],
};

function makeClient(overrides: { uploadError?: string; upsertError?: string; noSession?: boolean } = {}) {
  const calls = { upload: [] as unknown[][], upsert: [] as unknown[], update: [] as unknown[], eq: [] as unknown[][] };
  fake.client = {
    auth: { getSession: async () => ({ data: { session: overrides.noSession ? null : { user: { id: 'owner-1' } } } }) },
    storage: {
      from: (bucket: string) => ({
        upload: async (...args: unknown[]) => {
          calls.upload.push([bucket, ...args]);
          return { error: overrides.uploadError ? { message: overrides.uploadError } : null };
        },
      }),
    },
    from: (table: string) => ({
      upsert: async (row: unknown) => {
        calls.upsert.push({ table, row });
        return { error: overrides.upsertError ? { message: overrides.upsertError } : null };
      },
      update: (patch: unknown) => {
        calls.update.push({ table, patch });
        return { eq: async (...args: unknown[]) => (calls.eq.push(args), { error: null }) };
      },
    }),
  };
  return calls;
}

describe('drill take storage', () => {
  beforeEach(() => {
    fake.client = null;
  });

  it('normalises the recorder mime type and builds an owner-scoped path', () => {
    expect(baseMimeType('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(drillTakeStoragePath('u1', 't1', 'audio/webm;codecs=opus')).toBe('u1/t1.webm');
    expect(drillTakeStoragePath('u1', 't1', 'audio/mp4')).toBe('u1/t1.m4a');
  });

  it('rounds the pitch payload to what the DSP can claim and keeps nulls', () => {
    const compact = compactPitch(pitch);
    expect(compact.frames[0]).toEqual({ timeSeconds: 0.123, hz: 143.3, voiced: true, confidence: 0.99, relativeSemitones: 1.23 });
    expect(compact.frames[1]).toMatchObject({ hz: null, relativeSemitones: null });
    expect(compact.medianHz).toBe(143.3);
  });

  it('builds the row with the grader version and a whole-ms duration', () => {
    const row = buildDrillTakeRow({ ...input, ownerId: 'owner-1' }, 'owner-1/take_1.webm');
    expect(row).toMatchObject({
      id: 'take_1',
      owner_id: 'owner-1',
      mode: 'word',
      audio_path: 'owner-1/take_1.webm',
      mime_type: 'audio/webm',
      duration_ms: 1235,
      grader: DRILL_GRADER_VERSION,
    });
  });

  it('uploads the audio, then the row', async () => {
    const calls = makeClient();
    expect(await uploadDrillTake(input)).toBe(true);
    expect(calls.upload[0]!.slice(0, 2)).toEqual(['drill-takes', 'owner-1/take_1.webm']);
    expect(calls.upload[0]![3]).toMatchObject({ contentType: 'audio/webm', upsert: true });
    expect(calls.upsert).toHaveLength(1);
    expect((calls.upsert[0] as { table: string }).table).toBe('pitch_drill_takes');
  });

  it('still keeps the row (audio_path null) when only the audio upload fails', async () => {
    const calls = makeClient({ uploadError: 'too big' });
    expect(await uploadDrillTake(input)).toBe(true);
    expect((calls.upsert[0] as { row: { audio_path: unknown } }).row.audio_path).toBeNull();
  });

  it('reports false, and never throws, when the row fails, when signed out, or with no client', async () => {
    makeClient({ upsertError: 'boom' });
    expect(await uploadDrillTake(input)).toBe(false);
    makeClient({ noSession: true });
    expect(await uploadDrillTake(input)).toBe(false);
    fake.client = null;
    expect(await uploadDrillTake(input)).toBe(false);
    expect(await saveDrillTakeLabels('take_1', { ともだち: 'right' })).toBe(false);
  });

  it('saves labels onto the take row', async () => {
    const calls = makeClient();
    expect(await saveDrillTakeLabels('take_1', { ともだち: 'off' })).toBe(true);
    expect(calls.update[0]).toEqual({ table: 'pitch_drill_takes', patch: { labels: { ともだち: 'off' } } });
    expect(calls.eq[0]).toEqual(['id', 'take_1']);
  });
});
