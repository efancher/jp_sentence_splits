import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addMinutesToTodaySession,
  addSentencesToBook,
  createBook,
  ensureStudyItem,
  getBookReadyToPickUp,
  getDb,
  setBookSentenceStatus,
  updateSettings,
} from '../src/db/repository';
import type { Sentence, VocabularySuggestion } from '../src/domain/types';
import { createId } from '../src/lib/ids';

const T = '2026-11-07T00:00:00.000Z';

function sentenceOf(id: string, words: string[]): Sentence {
  let at = 0;
  const vocabularySuggestions: VocabularySuggestion[] = words.map((word, i) => {
    const token = {
      id: `${id}-t${i}`, surface: word, start: at, end: at + word.length, expression: word, reading: word,
      pos: '名詞/普通名詞', source: 'morphology' as const, selectedByDefault: true,
    };
    at += word.length;
    return token;
  });
  return {
    id, normalizedKey: id, japanese: words.join(''), readingOnly: '', inlineReading: '', translation: `tr ${id}`,
    targetVocabulary: [], vocabularySuggestions, sourceReferences: [], conflicts: [], firstOccurrenceIndex: 0,
    importBatchIds: [], createdAt: T, updatedAt: T,
  };
}

async function lessonSteps() {
  const session = await addMinutesToTodaySession(60);
  return session.steps.filter((step) => step.targetKind === 'sentence_learning');
}

async function lessonOrder(): Promise<string[]> {
  return (await lessonSteps()).map((step) => step.sentenceId!);
}

/** One finished sentence (so 猫 and 犬 are known) then three new ones, in reading order hard -> i+1 -> all-known. */
async function seed(): Promise<void> {
  const book = await createBook({ title: 'i+1 Book' });
  const rows = [
    sentenceOf('done', ['猫', '犬']),
    sentenceOf('hard', ['雨', '傘', '風', '雲']),
    sentenceOf('i1', ['猫', '空']),
    sentenceOf('easy', ['猫', '犬']),
  ];
  await getDb().sentences.bulkPut(rows);
  await addSentencesToBook(book.id, rows.map((row) => row.id));
  await setBookSentenceStatus(book.id, 'done', 'complete');
}

describe('walkthrough supply: i+1 ordering (settings.iPlusOneOrdering)', () => {
  beforeEach(() => {
    resetDbForTests(`i-plus-one-${createId('db')}`);
  });

  it('keeps reading order while the setting is off', async () => {
    await seed();
    expect(await lessonOrder()).toEqual(['hard', 'i1', 'easy']);
  });

  it('offers the almost-known sentence first when on, without dropping anything', async () => {
    await seed();
    await updateSettings({ iPlusOneOrdering: true });
    expect(await lessonOrder()).toEqual(['i1', 'easy', 'hard']);
  });

  it('does nothing in sequential study mode, which keeps its strict episode order', async () => {
    await seed();
    await updateSettings({ iPlusOneOrdering: true, sequentialStudyMode: true });
    expect(await lessonOrder()).toEqual(['hard', 'i1', 'easy']);
  });

  it('says which words are new on the lesson step', async () => {
    await seed();
    await updateSettings({ iPlusOneOrdering: true });
    const steps = await lessonSteps();
    expect(steps.find((step) => step.sentenceId === 'i1')?.reason).toContain('new here: 空');
    expect(steps.find((step) => step.sentenceId === 'easy')?.reason).not.toContain('new here');
  });

  it('ranks sentences across books, keeping each book in its own order', async () => {
    const first = await createBook({ title: 'First' });
    const second = await createBook({ title: 'Second' });
    const rows = [
      sentenceOf('done', ['猫', '犬']),
      sentenceOf('a-hard', ['雨', '傘', '風', '雲']),
      sentenceOf('a-i1', ['猫', '空']),
      sentenceOf('b-i1', ['犬', '海']),
    ];
    await getDb().sentences.bulkPut(rows);
    await addSentencesToBook(first.id, ['done', 'a-hard', 'a-i1']);
    await addSentencesToBook(second.id, ['b-i1']);
    await setBookSentenceStatus(first.id, 'done', 'complete');
    await updateSettings({ iPlusOneOrdering: true });
    const order = await lessonOrder();
    // Both i+1 sentences come before the harder one, even though First is listed before Second.
    expect(order.indexOf('b-i1')).toBeLessThan(order.indexOf('a-hard'));
    expect(order.indexOf('a-i1')).toBeLessThan(order.indexOf('a-hard'));
  });

  async function seedStretch(): Promise<void> {
    const book = await createBook({ title: 'Stretch' });
    const ready = Array.from({ length: 5 }, (_, i) => sentenceOf(`r${i}`, ['猫', `新${i}`]));
    const rows = [sentenceOf('done', ['猫']), sentenceOf('hard', ['雨', '傘', '風', '雲']), ...ready];
    await getDb().sentences.bulkPut(rows);
    await addSentencesToBook(book.id, rows.map((row) => row.id));
    await setBookSentenceStatus(book.id, 'done', 'complete');
  }

  it('draws a harder sentence every fifth slot by default', async () => {
    await seedStretch();
    await updateSettings({ iPlusOneOrdering: true });
    expect((await lessonOrder()).indexOf('hard')).toBe(4);
  });

  it('can turn the stretch sentences off', async () => {
    await seedStretch();
    await updateSettings({ iPlusOneOrdering: true, iPlusOneStretchEvery: 0 });
    expect((await lessonOrder()).indexOf('hard')).toBe(5);
  });

  it('counts a word with a reviewed reading card as known', async () => {
    await seed();
    await updateSettings({ iPlusOneOrdering: true });
    // 'hard' has four unknowns; with 雨 and 傘 reviewed it has two and becomes i+1.
    const rain = { id: 'v-rain', expression: '雨', reading: '雨', meaning: 'rain', createdAt: T, updatedAt: T };
    const umbrella = { id: 'v-umbrella', expression: '傘', reading: '傘', meaning: 'umbrella', createdAt: T, updatedAt: T };
    await getDb().vocabularyItems.bulkPut([rain, umbrella]);
    for (const item of [rain, umbrella]) {
      const card = await ensureStudyItem('vocabularyItem', item.id, 'reading_retrieval');
      await getDb().studyItems.update(card.id, { fsrsState: { ...card.fsrsState, state: 'review', reps: 3 } });
    }
    expect(await lessonOrder()).toEqual(['i1', 'hard', 'easy']);
  });

  it('leans toward the book whose episode has many started sentences when everything else is equal', async () => {
    // Created last so it is also the most recently opened and would win on every other tie-break.
    const warm = await createBook({ title: 'Warm' });
    const quiet = await createBook({ title: 'Quiet' });
    const rows = [
      sentenceOf('d1', ['猫', '犬']),
      sentenceOf('d2', ['猫', '犬']),
      sentenceOf('d3', ['猫', '犬']),
      sentenceOf('quiet-next', ['猫', '空']),
      sentenceOf('warm-next', ['猫', '海']),
    ];
    await getDb().sentences.bulkPut(rows);
    await addSentencesToBook(quiet.id, ['quiet-next']);
    await addSentencesToBook(warm.id, ['d1', 'd2', 'd3', 'warm-next']);
    await setBookSentenceStatus(warm.id, 'd1', 'complete');
    await setBookSentenceStatus(warm.id, 'd2', 'complete');
    await setBookSentenceStatus(warm.id, 'd3', 'complete');
    await updateSettings({ iPlusOneOrdering: true });
    expect(await lessonOrder()).toEqual(['warm-next', 'quiet-next']);
  });

  it("lists a book's sentences within two new pieces, with what is new", async () => {
    const book = await createBook({ title: 'Ready Book' });
    const rows = [
      sentenceOf('done', ['猫', '犬']),
      sentenceOf('hard', ['雨', '傘', '風', '雲']),
      sentenceOf('i1', ['猫', '空']),
      sentenceOf('easy', ['猫', '犬']),
    ];
    await getDb().sentences.bulkPut(rows);
    await addSentencesToBook(book.id, rows.map((row) => row.id));
    await setBookSentenceStatus(book.id, 'done', 'complete');
    const ready = await getBookReadyToPickUp(book.id);
    expect(ready.total).toBe(2);
    expect(ready.items.map((item) => [item.sentenceId, item.newPieces])).toEqual([
      ['i1', ['空']],
      ['easy', []],
    ]);
  });

  it('counts unmet curated grammar patterns as unknowns, and names them as new here', async () => {
    const book = await createBook({ title: 'Grammar Book' });
    const rows = [
      sentenceOf('done', ['猫', '犬']),
      sentenceOf('done2', ['猫', '犬']),
      sentenceOf('x', ['猫', '空']),
      sentenceOf('y', ['猫', '雲']),
      sentenceOf('z', ['猫', '犬']),
    ];
    await getDb().sentences.bulkPut(rows);
    await addSentencesToBook(book.id, rows.map((row) => row.id));
    await setBookSentenceStatus(book.id, 'done', 'complete');
    await setBookSentenceStatus(book.id, 'done2', 'complete');
    // Curated entries: てみる (met: two introduced sentences carry it), たことがある and ておく (new in 'x').
    const pattern = (id: string, canonicalName: string) => ({
      id, canonicalName, normalizedKey: canonicalName, aliases: [], shortMeaning: '', provenance: 'manual' as const,
      createdAt: T, updatedAt: T,
    });
    await getDb().grammarPatterns.bulkPut([
      pattern('p-temiru', '〜てみる'),
      pattern('p-takoto', '〜たことがある'),
      pattern('p-teoku', '〜ておく'),
    ]);
    const link = (sentenceId: string, grammarPatternId: string) => ({
      id: `${sentenceId}-${grammarPatternId}`, sentenceId, grammarPatternId, confirmedByLearner: false,
      source: 'ai_suggested' as const, createdAt: T, updatedAt: T,
    });
    await getDb().sentenceGrammar.bulkPut([
      link('done', 'p-temiru'),
      link('done2', 'p-temiru'),
      link('x', 'p-temiru'),
      link('x', 'p-takoto'),
      link('x', 'p-teoku'),
    ]);
    await updateSettings({ iPlusOneOrdering: true });
    // 'x' has one new word but two new patterns: three unknowns, so it waits behind the i+1 sentence 'y'.
    const steps = await lessonSteps();
    expect(steps.map((step) => step.sentenceId)).toEqual(['y', 'z', 'x']);
    const reason = steps.find((step) => step.sentenceId === 'x')?.reason ?? '';
    expect(reason).toContain('〜たことがある');
    expect(reason).toContain('空');
    expect(reason).not.toContain('〜てみる');
  });
});
