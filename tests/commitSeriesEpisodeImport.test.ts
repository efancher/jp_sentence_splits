import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  commitSeriesEpisodeImport,
  commitShadowingPackageImport,
  getDb,
  getSeriesImportedSourceIds,
} from '../src/db/repository';
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
  url?: string,
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
    { id: sourceId, type: 'other', title, url },
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
      sourceId: 'https://example.com/ep-1.mp3',
      sourceDate: '2026-09-01T00:00:00Z',
      preview: episodePreview('ep-1', 'Episode 1', ['今日は晴れです。']),
    });
    const second = await commitSeriesEpisodeImport({
      seriesId: 'podcast-series-abc',
      seriesTitle: 'Example Podcast',
      episodeTitle: 'Episode 2',
      sourceId: 'https://example.com/ep-2.mp3',
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
      sourceId: 'https://example.com/ep-5.mp3',
      sourceDate: '2026-09-05T00:00:00Z',
      preview: episodePreview('ep-5', 'Episode 5', ['5番目のエピソードです。']),
    });
    await commitSeriesEpisodeImport({
      seriesId: 'podcast-series-xyz',
      seriesTitle: 'Another Podcast',
      episodeTitle: 'Episode 3',
      sourceId: 'https://example.com/ep-3.mp3',
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
      sourceId: 'https://example.com/a-1.mp3',
      sourceDate: '2026-09-01T00:00:00Z',
      preview: episodePreview('a-1', 'A1', ['Aの文です。']),
    });
    const b = await commitSeriesEpisodeImport({
      seriesId: 'podcast-series-b',
      seriesTitle: 'Podcast B',
      episodeTitle: 'B1',
      sourceId: 'https://example.com/b-1.mp3',
      sourceDate: '2026-09-01T00:00:00Z',
      preview: episodePreview('b-1', 'B1', ['Bの文です。']),
    });
    expect(a.bookId).not.toBe(b.bookId);
  });

  it('keeps a later episode in its own declared order even when it reuses an earlier episode\'s boilerplate line', async () => {
    // "また明日ね。" (a sign-off line) appears at the *end* of episode 1, so
    // it's reused as the same deduped Sentence row with a
    // `firstOccurrenceIndex` anchored to episode 1's numbering. Episode 2
    // reuses that exact line at the *start* — its own true position for
    // this episode — which must not be scrambled by the stale index
    // (36a6195-adjacent bug found via ReaderPage 2026-09-26).
    const first = await commitSeriesEpisodeImport({
      seriesId: 'podcast-series-reuse',
      seriesTitle: 'Reuse Podcast',
      episodeTitle: 'Episode 1',
      sourceId: 'https://example.com/reuse-ep-1.mp3',
      sourceDate: '2026-09-01T00:00:00Z',
      preview: episodePreview('reuse-ep-1', 'Episode 1', [
        '文A1です。',
        '文A2です。',
        'また明日ね。',
      ]),
    });
    const second = await commitSeriesEpisodeImport({
      seriesId: 'podcast-series-reuse',
      seriesTitle: 'Reuse Podcast',
      episodeTitle: 'Episode 2',
      sourceId: 'https://example.com/reuse-ep-2.mp3',
      sourceDate: '2026-09-02T00:00:00Z',
      preview: episodePreview('reuse-ep-2', 'Episode 2', [
        'また明日ね。',
        '文B1です。',
        '文B2です。',
      ]),
    });

    const db = getDb();
    const memberships = (
      await db.bookSentences.where('bookId').equals(second.bookId).sortBy('position')
    ).filter((m) => m.chapterId === second.chapterId);
    const sentences = await db.sentences.bulkGet(memberships.map((m) => m.sentenceId));
    expect(sentences.map((s) => s?.japanese)).toEqual([
      'また明日ね。',
      '文B1です。',
      '文B2です。',
    ]);

    // Separate, pre-existing quirk (not this fix's concern): a book only
    // ever holds one BookSentence membership per deduped Sentence, so a
    // line reused verbatim across episodes ends up "belonging" to whichever
    // episode most recently reimported it — episode 1 is left with just its
    // other two sentences, in their own still-correct relative order.
    const firstMemberships = (
      await db.bookSentences.where('bookId').equals(first.bookId).sortBy('position')
    ).filter((m) => m.chapterId === first.chapterId);
    const firstSentences = await db.sentences.bulkGet(
      firstMemberships.map((m) => m.sentenceId),
    );
    expect(firstSentences.map((s) => s?.japanese)).toEqual(['文A1です。', '文A2です。']);
  });

  it('re-importing the same episode updates its own chapter rather than duplicating it', async () => {
    const first = await commitSeriesEpisodeImport({
      seriesId: 'podcast-series-dup',
      seriesTitle: 'Dup Podcast',
      episodeTitle: 'Episode 1',
      sourceId: 'https://example.com/ep-dup.mp3',
      sourceDate: '2026-09-01T00:00:00Z',
      preview: episodePreview('ep-dup', 'Episode 1', ['一つ目の文です。']),
    });
    const second = await commitSeriesEpisodeImport({
      seriesId: 'podcast-series-dup',
      seriesTitle: 'Dup Podcast',
      episodeTitle: 'Episode 1',
      sourceId: 'https://example.com/ep-dup.mp3',
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

describe('getSeriesImportedSourceIds', () => {
  beforeEach(() => {
    resetDbForTests(`series-import-${createId('db')}`);
  });

  it('returns an empty set for a series with no book yet', async () => {
    const ids = await getSeriesImportedSourceIds('podcast-series-none');
    expect(ids.size).toBe(0);
  });

  it('lists every imported episode/article source id, not just the latest', async () => {
    await commitSeriesEpisodeImport({
      seriesId: 'podcast-series-lookup',
      seriesTitle: 'Lookup Podcast',
      episodeTitle: 'Episode 1',
      sourceId: 'https://example.com/ep-1.mp3',
      sourceDate: '2026-09-01T00:00:00Z',
      preview: episodePreview('ep-1', 'Episode 1', ['一つ目の文です。']),
    });
    await commitSeriesEpisodeImport({
      seriesId: 'podcast-series-lookup',
      seriesTitle: 'Lookup Podcast',
      episodeTitle: 'Episode 2',
      sourceId: 'https://example.com/ep-2.mp3',
      sourceDate: '2026-09-02T00:00:00Z',
      preview: episodePreview('ep-2', 'Episode 2', ['二つ目の文です。']),
    });

    const ids = await getSeriesImportedSourceIds('podcast-series-lookup');
    expect(ids).toEqual(
      new Set(['https://example.com/ep-1.mp3', 'https://example.com/ep-2.mp3']),
    );
    // A different series' episodes never leak in.
    expect(await getSeriesImportedSourceIds('podcast-series-other')).toEqual(new Set());
  });

  it('still flags an episode imported before commitSeriesEpisodeImport existed, via its standalone book sourceUrl', async () => {
    // Pre-01fa81a (2026-09-13) behavior: every podcast episode got its own
    // one-off book instead of a chapter in a shared series book.
    await commitShadowingPackageImport(
      episodePreview(
        'legacy-ep',
        'Legacy Episode',
        ['昔のエピソードです。'],
        'https://example.com/legacy-ep.mp3',
      ),
    );

    const ids = await getSeriesImportedSourceIds('podcast-series-legacy');
    expect(ids.has('https://example.com/legacy-ep.mp3')).toBe(true);
  });
});
