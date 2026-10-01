import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { getDb, getEpisodeFocus } from '../src/db/repository';
import type { Book, FsrsState, StudyItem } from '../src/domain/types';
import { buildEpisodeFocus, isUnderdeterminedDiscourse } from '../src/lib/episodeFocus';

const word = (id: string, expression: string, partOfSpeech = '名詞') => ({
  id, expression, reading: expression, meaning: `meaning of ${expression}`, partOfSpeech,
});
const vlink = (sentenceId: string, vocabularyItemId: string, surfaceForm?: string) => ({ sentenceId, vocabularyItemId, surfaceForm });

describe('buildEpisodeFocus', () => {
  const sentenceIds = ['s1', 's2', 's3', 's4'];

  it('ranks recurrence across distinct sentences and drops single-occurrence words', () => {
    const result = buildEpisodeFocus({
      sentenceIds,
      vocabularyItems: [word('a', '図書館'), word('b', '本'), word('c', '希少')],
      vocabularyLinks: [
        vlink('s1', 'a'), vlink('s2', 'a'), vlink('s3', 'a'),
        vlink('s1', 'b'), vlink('s4', 'b'),
        vlink('s2', 'c'),
        vlink('s9', 'b'), // not in this episode
      ],
      grammarLinks: [], grammarPatterns: [],
    });
    expect(result.focus.map((target) => target.id)).toEqual(['a', 'b']);
    expect(result.focus[0]!.sentenceIds).toEqual(['s1', 's2', 's3']);
    expect(result.focus[1]!.sentenceIds).toEqual(['s1', 's4']);
  });

  it('counts repeats inside one sentence once', () => {
    const result = buildEpisodeFocus({
      sentenceIds, vocabularyItems: [word('a', '本')],
      vocabularyLinks: [vlink('s1', 'a'), vlink('s1', 'a')], grammarLinks: [], grammarPatterns: [],
    });
    expect(result.focus).toEqual([]);
  });

  it('keeps short kana discourse expressions as gloss-only instead of recall targets', () => {
    const filler = word('f', 'ええと', '感動詞/フィラー');
    expect(isUnderdeterminedDiscourse(filler)).toBe(true);
    expect(isUnderdeterminedDiscourse(word('n', '接続', '名詞'))).toBe(false);
    const result = buildEpisodeFocus({
      sentenceIds, vocabularyItems: [filler],
      vocabularyLinks: [vlink('s1', 'f'), vlink('s2', 'f'), vlink('s3', 'f'), vlink('s4', 'f')],
      grammarLinks: [], grammarPatterns: [],
    });
    expect(result.focus).toEqual([]);
    expect(result.glossOnly).toMatchObject([{ id: 'f', label: 'ええと' }]);
  });

  it('prefers a recurring construction over an equally frequent word, and skips retained items', () => {
    const result = buildEpisodeFocus({
      sentenceIds,
      vocabularyItems: [word('a', '図書館'), word('k', '読む', '動詞')],
      vocabularyLinks: [vlink('s1', 'a'), vlink('s2', 'a'), vlink('s1', 'k'), vlink('s2', 'k'), vlink('s3', 'k')],
      grammarPatterns: [{ id: 'g', canonicalName: '〜わけがない', shortMeaning: 'no way that' }],
      grammarLinks: [{ sentenceId: 's1', grammarPatternId: 'g' }, { sentenceId: 's2', grammarPatternId: 'g' }],
      knownVocabularyItemIds: new Set(['k']),
    });
    expect(result.focus.map((target) => `${target.kind}:${target.id}`)).toEqual(['grammar:g', 'vocabulary:a']);
  });

  it('bounds the focus set and notes distinct forms', () => {
    const items = Array.from({ length: 10 }, (_, i) => word(`w${i}`, `語${i}`));
    const result = buildEpisodeFocus({
      sentenceIds, vocabularyItems: items,
      vocabularyLinks: items.flatMap((item, i) => [vlink('s1', item.id, `形${i}`), vlink('s2', item.id, `別${i}`)]),
      grammarLinks: [], grammarPatterns: [], maxFocus: 3,
    });
    expect(result.focus).toHaveLength(3);
    expect(result.focus[0]!.reasons).toContain('Seen in 2 different forms');
  });
});

describe('getEpisodeFocus', () => {
  beforeEach(() => resetDbForTests(`episode-focus-${crypto.randomUUID()}`));
  const now = '2026-09-30T00:00:00.000Z';
  const fsrs = (state: FsrsState['state'], stability: number): FsrsState => ({
    due: now, stability, difficulty: 5, elapsedDays: 0, scheduledDays: 0, learningSteps: 0, reps: 3, lapses: 0, state,
  });

  it('scopes to the chapter, excludes retained words, and writes nothing', async () => {
    const db = getDb();
    const book: Book = {
      id: 'b', title: 'B', archived: false, createdAt: now, updatedAt: now, collapsedChapterIds: [],
      chapters: [{ id: 'c1', title: 'One', position: 0 }, { id: 'c2', title: 'Two', position: 1 }],
    };
    await db.books.add(book);
    await db.bookSentences.bulkAdd(['s1', 's2', 's3'].map((sentenceId, position) => ({
      id: `b:${sentenceId}`, bookId: 'b', sentenceId, position, chapterId: sentenceId === 's3' ? 'c2' : 'c1', status: 'unstarted' as const, addedAt: now,
    })));
    await db.vocabularyItems.bulkAdd([
      { id: 'a', expression: '図書館', reading: 'としょかん', meaning: 'library', createdAt: now, updatedAt: now },
      { id: 'k', expression: '読む', reading: 'よむ', meaning: 'read', createdAt: now, updatedAt: now },
    ]);
    const link = (id: string, sentenceId: string, vocabularyItemId: string) => ({ id, sentenceId, vocabularyItemId, createdAt: now, updatedAt: now });
    await db.sentenceVocabulary.bulkAdd([
      link('1', 's1', 'a'), link('2', 's2', 'a'), link('3', 's3', 'a'),
      link('4', 's1', 'k'), link('5', 's2', 'k'),
    ]);
    const study: StudyItem = { id: 'si', subjectType: 'vocabularyItem', subjectId: 'k', activityType: 'reading_retrieval', fsrsState: fsrs('review', 60), createdAt: now, updatedAt: now };
    await db.studyItems.add(study);

    const chapter = await getEpisodeFocus('b', 'c1');
    expect(chapter.sentenceCount).toBe(2);
    expect(chapter.focus.map((target) => target.id)).toEqual(['a']);
    expect(chapter.focus[0]!.sentenceIds).toEqual(['s1', 's2']);
    expect((await getEpisodeFocus('b', 'c2')).focus).toEqual([]);
    expect(await db.studyItems.count()).toBe(1);
    expect(await db.reviews.count()).toBe(0);
  });
});
