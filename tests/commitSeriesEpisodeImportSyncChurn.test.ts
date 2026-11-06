import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { commitSeriesEpisodeImport, getDb } from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { buildShadowingPreview, type ShadowingSentenceInput } from '../src/lib/shadowingImport';

/**
 * 2026-11-06: importing a dozen Slow Japanese episodes out of date order left
 * 2000+ book_sentences pushes on a phone, because every commit queued every
 * membership row of the book twice (once per reorder) even when most rows ended
 * where they started. A stalled push cycle then surfaced as "Transaction
 * aborted" / "Fetch is aborted" on random rows.
 */
const tracked = vi.hoisted(() => ({ ids: [] as string[] }));

vi.mock('../src/sync/track', () => ({
  trackLocalMutation: async (item: { entity: string; recordId: string }) => {
    if (item.entity === 'book_sentences') tracked.ids.push(item.recordId);
  },
}));

const MANIFEST = {
  format: 'japanese-shadowing-package',
  version: 2 as const,
  createdAt: '2026-09-13T00:00:00Z',
  generator: { name: 'test', version: '1' },
};

function preview(sourceId: string, title: string, japanese: string[]) {
  const sentences: ShadowingSentenceInput[] = japanese.map((text, index) => ({
    id: `${sourceId}-${index}`,
    japanese: text,
    startMs: 0,
    endMs: 1000,
    tags: [],
    transcriptStatus: 'verified',
  }));
  return buildShadowingPreview({ id: sourceId, type: 'other', title }, MANIFEST, sentences, [], []);
}

function episode(n: number, date: string) {
  return commitSeriesEpisodeImport({
    seriesId: 'podcast-series-churn',
    seriesTitle: 'Churn Podcast',
    episodeTitle: `Episode ${n}`,
    sourceId: `https://example.com/ep-${n}.mp3`,
    sourceDate: date,
    preview: preview(`ep-${n}`, `Episode ${n}`, [`エピソード${n}の一文目です。`, `エピソード${n}の二文目です。`]),
  });
}

describe('series episode import sync churn', () => {
  beforeEach(() => {
    resetDbForTests(`series-churn-${createId('db')}`);
    tracked.ids.length = 0;
  });

  it('importing the newest episode queues only its own rows, not the whole book', async () => {
    await episode(1, '2026-09-01T00:00:00Z');
    await episode(2, '2026-09-02T00:00:00Z');
    await episode(3, '2026-09-03T00:00:00Z');
    tracked.ids.length = 0;

    const added = await episode(4, '2026-09-04T00:00:00Z');
    const rows = await getDb().bookSentences.where('bookId').equals(added.bookId).toArray();
    const ownRows = new Set(rows.filter((row) => row.chapterId === added.chapterId).map((row) => row.id));

    expect(ownRows.size).toBe(2);
    expect(new Set(tracked.ids)).toEqual(ownRows);
  });

  it('an episode that lands mid-book queues the rows it shifts, once each, and leaves earlier ones alone', async () => {
    const first = await episode(1, '2026-09-01T00:00:00Z');
    await episode(3, '2026-09-03T00:00:00Z');
    await episode(4, '2026-09-04T00:00:00Z');
    tracked.ids.length = 0;

    await episode(2, '2026-09-02T00:00:00Z');

    const rows = await getDb().bookSentences.where('bookId').equals(first.bookId).toArray();
    const firstEpisodeRows = rows.filter((row) => row.chapterId === first.chapterId).map((row) => row.id);
    // 2 new rows + 4 shifted rows from episodes 3 and 4; episode 1 is untouched
    expect(new Set(tracked.ids).size).toBe(6);
    for (const id of firstEpisodeRows) expect(tracked.ids).not.toContain(id);
    // every queued row's position in Dexie is final (no stale mid-reorder state)
    expect(rows.map((row) => row.position).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
