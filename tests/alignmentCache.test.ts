import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AlignmentResult } from '../src/domain/types';

const alignAudio = vi.fn<() => Promise<AlignmentResult | null>>();
vi.mock('../src/lib/analysisApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/analysisApi')>()),
  alignAudio: (...args: unknown[]) => (alignAudio as (...a: unknown[]) => unknown)(...args),
}));

const fetchRemoteAlignment = vi.fn<() => Promise<AlignmentResult | undefined>>();
const uploadRemoteAlignment = vi.fn<() => Promise<void>>();
vi.mock('../src/sync/alignmentRemote', () => ({
  fetchRemoteAlignment: (...a: unknown[]) =>
    (fetchRemoteAlignment as (...x: unknown[]) => unknown)(...a),
  uploadRemoteAlignment: (...a: unknown[]) =>
    (uploadRemoteAlignment as (...x: unknown[]) => unknown)(...a),
}));

import { loadOrComputeAlignment } from '../src/lib/alignmentCache';

const result = (tag: string): AlignmentResult => ({
  durationSeconds: 1,
  words: [{ start: 0, end: 1, text: tag, phones: [] }],
});

const blob = new Blob(['clip']);

beforeEach(() => {
  alignAudio.mockReset();
  fetchRemoteAlignment.mockReset();
  uploadRemoteAlignment.mockReset().mockResolvedValue();
});

describe('loadOrComputeAlignment tiers', () => {
  it('returns the local cache without touching remote or the service', async () => {
    const get = vi.fn().mockResolvedValue(result('local'));
    const save = vi.fn();
    const out = await loadOrComputeAlignment('a1', blob, 'こんにちは', get, save);
    expect(out?.words[0]?.text).toBe('local');
    expect(fetchRemoteAlignment).not.toHaveBeenCalled();
    expect(alignAudio).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('falls back to the synced table and caches it locally, no service call', async () => {
    const get = vi.fn().mockResolvedValue(undefined);
    const save = vi.fn().mockResolvedValue(undefined);
    fetchRemoteAlignment.mockResolvedValue(result('remote'));
    const out = await loadOrComputeAlignment('a2', blob, 'こんにちは', get, save);
    expect(out?.words[0]?.text).toBe('remote');
    expect(save).toHaveBeenCalledWith('a2', expect.objectContaining({ durationSeconds: 1 }));
    expect(alignAudio).not.toHaveBeenCalled();
  });

  it('computes via the service, caches locally, and pushes to the synced table', async () => {
    const get = vi.fn().mockResolvedValue(undefined);
    const save = vi.fn().mockResolvedValue(undefined);
    fetchRemoteAlignment.mockResolvedValue(undefined);
    alignAudio.mockResolvedValue(result('service'));
    const out = await loadOrComputeAlignment('a3', blob, 'こんにちは', get, save);
    expect(out?.words[0]?.text).toBe('service');
    expect(save).toHaveBeenCalledWith('a3', expect.objectContaining({ durationSeconds: 1 }));
    await vi.waitFor(() => expect(uploadRemoteAlignment).toHaveBeenCalledWith('a3', expect.anything()));
  });

  it('returns undefined when every tier misses', async () => {
    const get = vi.fn().mockResolvedValue(undefined);
    const save = vi.fn();
    fetchRemoteAlignment.mockResolvedValue(undefined);
    alignAudio.mockResolvedValue(null);
    expect(await loadOrComputeAlignment('a4', blob, 'x', get, save)).toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  });
});
