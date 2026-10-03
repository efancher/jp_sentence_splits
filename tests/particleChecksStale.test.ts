import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { getDb } from '../src/db/repository';
import { findParticleCheckCandidates } from '../src/lib/particleChecks';

const check = (chunk: string) => [{ chunk, particle: 'に', question: 'q', options: ['a', 'b', 'c', 'd'], correctIndex: 0 }];

describe('findParticleCheckCandidates stale mode', () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it('lists only sentences whose checks name a chunk the current chunking no longer produces', async () => {
    const db = getDb();
    const rows = [
      { id: 'old', chunk: 'に' },
      { id: 'ok', chunk: '家族について' },
    ];
    for (const [position, row] of rows.entries()) {
      await db.sentences.put({ id: row.id, japanese: '家族について話します。' } as never);
      await db.bookSentences.put({ id: `bs-${row.id}`, bookId: 'b1', sentenceId: row.id, position, chapterId: 'c1' } as never);
      await db.analyses.put({ sentenceId: row.id, particleChecks: check(row.chunk) } as never);
    }
    const stale = await findParticleCheckCandidates('b1', { stale: true });
    expect(stale.map((item) => item.sentenceId)).toEqual(['old']);
    expect(stale[0]!.replacing).toBe(true);
    expect(await findParticleCheckCandidates('b1')).toEqual([]);
  });
});
