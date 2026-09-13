import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { commitSeriesEpisodeImport, getDb } from '../src/db/repository';
import { createId } from '../src/lib/ids';
import {
  buildShadowingPreview,
  type ShadowingImportPreview,
  type ShadowingSentenceInput,
} from '../src/lib/shadowingImport';

const MANIFEST = {
  format: 'japanese-shadowing-package',
  version: 2 as const,
  createdAt: '2026-09-13T00:00:00Z',
  generator: { name: 'test', version: '1' },
};

function episodePreview(
  sourceId: string,
  title: string,
  japanese: string[],
): ShadowingImportPreview {
  const sentences: ShadowingSentenceInput[] = japanese.map((text, index) => ({
    id: `${sourceId}-${index}`,
    japanese: text,
    startMs: 0,
    endMs: 1000,
    tags: [],
    transcriptStatus: 'verified',
  }));
  return buildShadowingPreview(
    { id: sourceId, type: 'other', title },
    MANIFEST,
    sentences,
    [],
    [],
  );
}

describe('commitSeriesEpisodeImport', () => {
  beforeEach(() => {
    resetDbForTests(`series-import-${createId('db')}`);
  });

  it('puts two different episodes of the same series into one shared book, each as its own chapter', async () => {
    const first = await commitSeriesEpisodeImport({
      seriesId: 'podcast-series-abc',
      seriesTitle: 'Example Podcast',
      episodeTitle: 'Episode 1',
      sourceDate: '2026-09-01T00:00:00Z',
      preview: episodePreview('ep-1', 'Episode 1', ['今日は晴れです。']),
    });
    const second = await commitSeriesEpisodeImport({
      seriesId: 'podcast-series-abc',
      seriesTitle: 'Example Podcast',
      episodeTitle: 'Episode 2',
      sourceDate: '2026-09-02T00:00:00Z',
      preview: episodePreview('ep-2', 'Episode 2', ['明日も晴れるでしょう。']),
    });

    expect(second.bookId).toBe(first.bookId);
    expect(second.chapterId).not.toBe(first.chapterId);

    const db = getDb();
    const book = await db.books.get(first.bookId);
    expect(book?.title).toBe('Example Podcast');
    expect(book?.sourceKey).toBe('shadowing:podcast-series-abc');
    expect(book?.chapters.map((c) => c.title)).toEqual(['Episode 1', 'Episode 2']);

    const memberships = await db.bookSentences
      .where('bookId')
      .equals(first.bookId)
      .sortBy('position');
    const sentences = await db.sentences.bulkGet(memberships.map((m) => m.sentenceId));
    expect(sentences.map((s) => s?.japanese)).toEqual([
      '今日は晴れです。',
      '明日も晴れるでしょう。',
    ]);
  });

  it('keeps chapters chronological by sourceDate even when imported out of order', async () => {
    const later = await commitSeriesEpisodeImport({
      seriesId: 'podcast-series-xyz',
      seriesTitle: 'Another Podcast',
      episodeTitle: 'Episode 5',
      sourceDate: '2026-09-05T00:00:00Z',
      preview: episodePreview('ep-5', 'Episode 5', ['5番目のエピソードです。']),
    });
    await commitSeriesEpisodeImport({
      seriesId: 'podcast-series-xyz',
      seriesTitle: 'Another Podcast',
      episodeTitle: 'Episode 3',
      sourceDate: '2026-09-03T00:00:00Z',
      preview: episodePreview('ep-3', 'Episode 3', ['3番目のエピソードです。']),
    });

    const db = getDb();
    const book = await db.books.get(later.bookId);
    // Imported 5 then 3, but the book reads 3 before 5 — chronological, not
    // import-click order.
    expect(book?.chapters.map((c) => c.title)).toEqual(['Episode 3', 'Episode 5']);
    expect(book?.chapters.map((c) => c.position)).toEqual([0, 1]);

    const memberships = await db.bookSentences
      .where('bookId')
      .equals(later.bookId)
      .sortBy('position');
    const sentences = await db.sentences.bulkGet(memberships.map((m) => m.sentenceId));
    expect(sentences.map((s) => s?.japanese)).toEqual([
      '3番目のエピソードです。',
      '5番目のエピソードです。',
    ]);
  });

  it('keeps two different series in two separate books', async () => {
    const a = await commitSeriesEpisodeImport({
      seriesId: 'podcast-series-a',
      seriesTitle: 'Podcast A',
      episodeTitle: 'A1',
      sourceDate: '2026-09-01T00:00:00Z',
      preview: episodePreview('a-1', 'A1', ['Aの文です。']),
    });
    const b = await commitSeriesEpisodeImport({
      seriesId: 'podcast-series-b',
      seriesTitle: 'Podcast B',
      episodeTitle: 'B1',
      sourceDate: '2026-09-01T00:00:00Z',
      preview: episodePreview('b-1', 'B1', ['Bの文です。']),
    });
    expect(a.bookId).not.toBe(b.bookId);
  });

  it('re-importing the same episode updates its own chapter rather than duplicating it', async () => {
    const first = await commitSeriesEpisodeImport({
      seriesId: 'podcast-series-dup',
      seriesTitle: 'Dup Podcast',
      episodeTitle: 'Episode 1',
      sourceDate: '2026-09-01T00:00:00Z',
      preview: episodePreview('ep-dup', 'Episode 1', ['一つ目の文です。']),
    });
    const second = await commitSeriesEpisodeImport({
      seriesId: 'podcast-series-dup',
      seriesTitle: 'Dup Podcast',
      episodeTitle: 'Episode 1',
      sourceDate: '2026-09-01T00:00:00Z',
      preview: episodePreview('ep-dup', 'Episode 1', [
        '一つ目の文です。',
        '二つ目の文です。',
      ]),
    });
    expect(second.bookId).toBe(first.bookId);
    expect(second.chapterId).toBe(first.chapterId);

    const db = getDb();
    const book = await db.books.get(first.bookId);
    expect(book?.chapters).toHaveLength(1);
  });
});
