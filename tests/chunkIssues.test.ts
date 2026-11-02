import { beforeEach, describe, expect, it } from 'vitest';

import { getDb, resetDbForTests } from '../src/db/database';
import type { Sentence } from '../src/domain/types';
import {
  applyReadingFlagChoice,
  listChunkIssueReports,
  listOpenMeaningCheckIssues,
  reportChunkIssues,
  settleChunkIssueReports,
} from '../src/db/repository';
import { chunkIssueKey } from '../src/lib/chunkIssues';
import { createId } from '../src/lib/ids';

describe('chunkIssueKey', () => {
  it('ignores the trailing explanation and spacing', () => {
    const a = chunkIssueKey({ source: 'particle_checks', sentenceId: 's1', note: 'に | ついて → について (keep together)' });
    const b = chunkIssueKey({ source: 'particle_checks', sentenceId: 's2', note: 'に |  ついて → について (fixed expression)' });
    expect(a).toBe(b);
  });

  it('scopes meaning-check issues to their sentence', () => {
    const a = chunkIssueKey({ source: 'meaning_checks', sentenceId: 's1', note: 'garbled' });
    const b = chunkIssueKey({ source: 'meaning_checks', sentenceId: 's2', note: 'garbled' });
    expect(a).not.toBe(b);
  });
});

describe('reportChunkIssues dismissal', () => {
  beforeEach(() => {
    resetDbForTests(`chunk-issues-${createId('db')}`);
  });

  it('files, dedupes, and skips patterns dismissed as not an issue', async () => {
    const chunks = ['気に', 'なる'];
    const note = 'に | なる → になる (x)';
    expect(await reportChunkIssues('particle_checks', [{ sentenceId: 's1', chunks, note }, { sentenceId: 's1', chunks, note }])).toBe(1);
    const [report] = await listChunkIssueReports();
    await settleChunkIssueReports([report!.id], 'dismissed');
    expect(
      await reportChunkIssues('particle_checks', [{ sentenceId: 's9', chunks: ['y'], note: 'に | なる → になる (different reason)' }]),
    ).toBe(0);
    expect(await reportChunkIssues('particle_checks', [{ sentenceId: 's9', chunks: ['y'], note: 'も | ちろん → もちろん' }])).toBe(1);
  });

  it('applies the assistant reading to the sentence when the learner picks it', async () => {
    const sentenceId = createId('sent');
    await getDb().sentences.put({
      id: sentenceId,
      japanese: '体全体が温まる',
      inlineReading: '体[たい]全体[ぜんたい]が温[あたた]まる',
      readingOnly: 'たいぜんたいがあたたまる',
    } as Sentence);
    await reportChunkIssues('meaning_checks', [
      { sentenceId, chunks: [], note: 'Reading check — 体: furigana たい, assistant からだ' },
    ]);
    const [issue] = await listOpenMeaningCheckIssues(sentenceId);
    expect(await applyReadingFlagChoice(issue!.id)).toBe(true);
    const updated = await getDb().sentences.get(sentenceId);
    expect(updated?.inlineReading).toBe('体[からだ]全体[ぜんたい]が温[あたた]まる');
    expect(updated?.readingOnly).toBe('からだぜんたいがあたたまる');
    expect(await listOpenMeaningCheckIssues(sentenceId)).toEqual([]);
  });

  it('refiles a resolved pattern if it recurs', async () => {
    const issue = { sentenceId: 's1', chunks: ['a'], note: 'と | き → とき' };
    await reportChunkIssues('particle_checks', [issue]);
    const [report] = await listChunkIssueReports();
    await settleChunkIssueReports([report!.id], 'resolved');
    expect(await reportChunkIssues('particle_checks', [issue])).toBe(1);
  });
});
