import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { getDb, setSentenceComprehensionCheck, setSentenceParticleChecks } from '../src/db/repository';
import { trackLocalMutation } from '../src/sync/track';

vi.mock('../src/sync/track', () => ({
  trackLocalMutation: vi.fn().mockResolvedValue(undefined),
}));

const CHECKS = [{ chunk: 'ゴミ箱に', particle: 'に', question: 'q', options: ['a', 'b', 'c', 'd'], correctIndex: 1 }];

describe('authored checks are queued for sync', () => {
  beforeEach(async () => {
    await resetDbForTests();
    vi.mocked(trackLocalMutation).mockClear();
  });

  it('queues the analysis row when particle checks are saved (new and existing rows)', async () => {
    await setSentenceParticleChecks('s1', CHECKS);
    await setSentenceParticleChecks('s1', []);
    const calls = vi.mocked(trackLocalMutation).mock.calls.map(([c]) => c);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ entity: 'analyses', recordId: 's1', operation: 'upsert' });
    expect((calls[0]!.payload as { particleChecks: unknown }).particleChecks).toEqual(CHECKS);
    expect((await getDb().analyses.get('s1'))?.particleChecks).toEqual([]);
  });

  it('queues the analysis row when a comprehension check is cleared', async () => {
    await setSentenceComprehensionCheck('s2', undefined);
    expect(vi.mocked(trackLocalMutation)).toHaveBeenCalledWith(expect.objectContaining({ entity: 'analyses', recordId: 's2' }));
  });
});
