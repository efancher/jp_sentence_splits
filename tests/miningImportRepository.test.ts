import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  beginMiningImport,
  getDb,
  getMiningImportForJob,
  getMiningImportForSource,
  getSeriesImportedSourceIds,
  miningImportId,
  updateMiningImportForJob,
} from '../src/db/repository';
import { canonicalSourceId, createId } from '../src/lib/ids';
import { miningImportToRemote, remoteToMiningImport } from '../src/sync/mappers';

const EPISODE_URL = 'https://cdn.example.com/staging/2023-9-9/86e5d4fc.mp3';
const WRAPPED_URL = `https://anchor.fm/s/6ad2a4a0/podcast/play/1/${encodeURIComponent(EPISODE_URL)}`;

describe('mining import tracking', () => {
  beforeEach(() => {
    resetDbForTests(`mining-import-${createId('db')}`);
  });

  it('keeps the destination so a resumed job can be committed into its series', async () => {
    await beginMiningImport({
      sourceId: EPISODE_URL,
      sourceType: 'podcast',
      title: 'Episode #64',
      jobId: 'job-1',
      seriesId: 'podcast-series-abc',
      seriesTitle: 'Slow Japanese',
      seriesUrl: 'https://feeds.example.com/slow',
      targetBookId: 'book_1',
      sourceDate: '2023-09-09T00:00:00.000Z',
    });

    // A reloaded page only has the job id.
    const record = await getMiningImportForJob('job-1');
    expect(record).toMatchObject({
      status: 'mining',
      seriesId: 'podcast-series-abc',
      seriesTitle: 'Slow Japanese',
      seriesUrl: 'https://feeds.example.com/slow',
      targetBookId: 'book_1',
      sourceDate: '2023-09-09T00:00:00.000Z',
    });
  });

  it('is one row per episode however the source url is spelled', async () => {
    expect(miningImportId(WRAPPED_URL)).toBe(miningImportId(EPISODE_URL));
    await beginMiningImport({ sourceId: EPISODE_URL, sourceType: 'podcast', title: 'A', jobId: 'job-1' });
    await beginMiningImport({ sourceId: WRAPPED_URL, sourceType: 'podcast', title: 'A', jobId: 'job-2' });

    expect(await getDb().miningImports.count()).toBe(1);
    expect((await getMiningImportForSource(EPISODE_URL))?.jobId).toBe('job-2');
    expect(await getMiningImportForJob('job-1')).toBeUndefined();
  });

  it('records progress, and a re-import resets the previous outcome but keeps createdAt', async () => {
    const first = await beginMiningImport({ sourceId: EPISODE_URL, sourceType: 'podcast', title: 'A', jobId: 'job-1' });
    await updateMiningImportForJob('job-1', { status: 'failed', error: 'boom' });
    expect(await getMiningImportForJob('job-1')).toMatchObject({ status: 'failed', error: 'boom' });

    await updateMiningImportForJob('job-1', {
      status: 'committed',
      bookId: 'book_1',
      chapterId: 'chapter_1',
      sentenceCount: 24,
      committedAt: '2026-10-26T00:00:00.000Z',
    });
    const committed = await getMiningImportForJob('job-1');
    expect(committed).toMatchObject({ status: 'committed', bookId: 'book_1', sentenceCount: 24 });
    expect(committed?.error).toBeUndefined();

    await beginMiningImport({ sourceId: EPISODE_URL, sourceType: 'podcast', title: 'A', jobId: 'job-2' });
    const again = await getMiningImportForSource(EPISODE_URL);
    expect(again).toMatchObject({ status: 'mining', jobId: 'job-2', createdAt: first.createdAt });
    expect(again?.bookId).toBeUndefined();
    expect(again?.sentenceCount).toBeUndefined();
  });

  it('ignores updates for a job that was never recorded', async () => {
    expect(await updateMiningImportForJob('unknown', { status: 'ready' })).toBeUndefined();
    expect(await getDb().miningImports.count()).toBe(0);
  });

  it('marks committed episodes as imported even when the book is gone from this device', async () => {
    await beginMiningImport({ sourceId: EPISODE_URL, sourceType: 'podcast', title: 'A', jobId: 'job-1' });
    expect((await getSeriesImportedSourceIds('podcast-series-abc')).has(canonicalSourceId(EPISODE_URL))).toBe(false);

    await updateMiningImportForJob('job-1', { status: 'committed' });
    expect((await getSeriesImportedSourceIds('podcast-series-abc')).has(canonicalSourceId(EPISODE_URL))).toBe(true);
  });

  it('round-trips through the sync mappers', async () => {
    const record = await beginMiningImport({
      sourceId: EPISODE_URL,
      sourceType: 'youtube',
      title: 'A',
      jobId: 'job-1',
      seriesUrl: 'https://feeds.example.com/slow',
    });
    const remote = miningImportToRemote(record, 'owner-1', 1) as unknown as Record<string, unknown>;
    expect(remote).toMatchObject({ source_id: record.sourceId, job_id: 'job-1', book_id: null, deleted_at: null });
    expect(remoteToMiningImport(remote)).toEqual(record);
  });
});
