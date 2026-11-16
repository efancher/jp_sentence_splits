import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addSentencesToBook,
  confirmSentenceVocabulary,
  createBook,
  ensureStudyItem,
  findReadingCheckCandidates,
  getDb,
  getSessionPlannerInput,
  logSentenceLearningEvent,
  recordReview,
  saveAttempt,
  setBookSentenceStatus,
  setBookSuspended,
} from '../src/db/repository';
import type { Sentence, VocabularySuggestion } from '../src/domain/types';
import { createId } from '../src/lib/ids';
import { readingCheckTargetKey } from '../src/lib/readingMissSteps';
import { readingFeedbackTargetKey } from '../src/lib/wordEvidence';

const DAY = 86_400_000;

/** 私は趣味が多いです。 with morphology readings, so a reading check can show the 趣味 phrase. */
function makeSentence(overrides: Partial<Sentence> = {}): Sentence {
  const pieces: [string, string, string][] = [
    ['私', '代名詞', 'ワタシ'],
    ['は', '助詞/係助詞', 'ハ'],
    ['趣味', '名詞/普通名詞/一般', 'シュミ'],
    ['が', '助詞/格助詞', 'ガ'],
    ['多い', '形容詞/一般', 'オオイ'],
    ['です', '助動詞', 'デス'],
    ['。', '補助記号/句点', ''],
  ];
  let cursor = 0;
  const vocabularySuggestions: VocabularySuggestion[] = pieces.map(([surface, pos, reading], i) => {
    const token: VocabularySuggestion = {
      id: `t${i}`,
      surface,
      start: cursor,
      end: cursor + surface.length,
      expression: surface,
      reading,
      pos,
      source: 'morphology',
      selectedByDefault: false,
    };
    cursor += surface.length;
    return token;
  });
  const timestamp = new Date().toISOString();
  const id = overrides.id ?? createId('sent');
  return {
    id,
    normalizedKey: id,
    japanese: pieces.map((p) => p[0]).join(''),
    readingOnly: '',
    inlineReading: '',
    translation: 'I have many hobbies.',
    targetVocabulary: [],
    vocabularySuggestions,
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

async function seedBook(title: string, count: number, extra: { sourceKey?: string } = {}) {
  const book = await createBook({ title });
  if (extra.sourceKey) await getDb().books.update(book.id, { sourceKey: extra.sourceKey });
  const sentences = Array.from({ length: count }, () => makeSentence());
  await getDb().sentences.bulkPut(sentences);
  await addSentencesToBook(book.id, sentences.map((s) => s.id));
  return { book, sentences };
}

beforeEach(() => {
  resetDbForTests(`planner-candidates-${createId('db')}`);
});

describe('findReadingCheckCandidates', () => {
  async function missReading(bookId: string, sentenceId: string, at: Date, outcome: 'needed_help' | 'got_it' = 'needed_help') {
    await logSentenceLearningEvent({
      visitId: createId('sl_visit'),
      bookId,
      sentenceId,
      action: 'target_practice',
      outcome,
      target: { kind: 'vocabulary', key: readingFeedbackTargetKey(`w-${sentenceId}`), label: '趣味' },
      timestamp: at.toISOString(),
    });
  }

  it('offers a reading check for a word missed in the reader, with the word in the reason', async () => {
    const now = new Date();
    const { book, sentences } = await seedBook('Reader', 2);
    await missReading(book.id, sentences[0]!.id, new Date(now.getTime() - 3_600_000));
    const found = await findReadingCheckCandidates(5, new Set(), now);
    expect(found).toEqual([
      expect.objectContaining({ bookId: book.id, sentenceId: sentences[0]!.id, tool: 'reading', reason: expect.stringContaining('趣味') }),
    ]);
  });

  it('skips excluded, suspended-book, gone and already-checked sentences, and honours the limit', async () => {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 3_600_000);
    const { book, sentences } = await seedBook('Reader', 3);
    const shelved = await seedBook('Shelved', 1);
    await setBookSuspended(shelved.book.id, true);
    for (const s of sentences) await missReading(book.id, s.id, hourAgo);
    await missReading(shelved.book.id, shelved.sentences[0]!.id, hourAgo);

    expect(await findReadingCheckCandidates(1, new Set(), now)).toHaveLength(1);
    const excluded = await findReadingCheckCandidates(5, new Set([sentences[0]!.id]), now);
    expect(excluded.map((c) => c.sentenceId).sort()).toEqual([sentences[1]!.id, sentences[2]!.id].sort());

    // A finished check after the miss covers it; a deleted sentence row is skipped.
    await logSentenceLearningEvent({
      visitId: createId('sl_visit'),
      bookId: book.id,
      sentenceId: sentences[1]!.id,
      action: 'target_practice',
      outcome: 'got_it',
      target: { kind: 'expression', key: readingCheckTargetKey(sentences[1]!.id), label: 'phrase' },
      timestamp: now.toISOString(),
    });
    await getDb().sentences.delete(sentences[2]!.id);
    const remaining = await findReadingCheckCandidates(5, new Set(), now);
    expect(remaining.map((c) => c.sentenceId)).toEqual([sentences[0]!.id]);
  });

  it('returns nothing without recent misses, or once the word was read correctly since', async () => {
    const now = new Date();
    const { book, sentences } = await seedBook('Reader', 1);
    expect(await findReadingCheckCandidates(5, new Set(), now)).toEqual([]);
    await missReading(book.id, sentences[0]!.id, new Date(now.getTime() - 2 * 3_600_000));
    await missReading(book.id, sentences[0]!.id, new Date(now.getTime() - 3_600_000), 'got_it');
    expect(await findReadingCheckCandidates(5, new Set(), now)).toEqual([]);
  });

  it('is what the planner puts first among listening-tool candidates', async () => {
    const now = new Date();
    const { book, sentences } = await seedBook('Reader', 1);
    await missReading(book.id, sentences[0]!.id, new Date(now.getTime() - 3_600_000));
    const input = await getSessionPlannerInput(30, now);
    expect(input.listeningToolCandidates?.[0]).toMatchObject({ sentenceId: sentences[0]!.id, tool: 'reading' });
  });
});

describe('review priority inputs for due sentence cards', () => {
  async function due(sentenceId: string, now: Date) {
    const item = await ensureStudyItem('sentence', sentenceId, 'reading_in_context');
    await getDb().studyItems.update(item.id, { fsrsState: { ...item.fsrsState, due: new Date(now.getTime() - DAY).toISOString() } });
    return item;
  }

  it('counts distinct sources across the books a sentence appears in', async () => {
    const now = new Date();
    const a = await seedBook('Series A', 1, { sourceKey: 'source-a' });
    const b = await createBook({ title: 'Copy of A' });
    await getDb().books.update(b.id, { sourceKey: 'source-a' });
    const c = await createBook({ title: 'Anthology' });
    const sentence = a.sentences[0]!;
    const item = await due(sentence.id, now);

    let input = (await getSessionPlannerInput(30, now)).retainDue.find((d) => d.studyItemId === item.id)!;
    expect(input).toMatchObject({ distinctSourceCount: 1, distinctSentenceCount: 1, mode: 'review', subjectType: 'sentence' });

    await addSentencesToBook(b.id, [sentence.id]); // same source key: still one source
    await addSentencesToBook(c.id, [sentence.id]); // no source key: the book id counts
    input = (await getSessionPlannerInput(30, now)).retainDue.find((d) => d.studyItemId === item.id)!;
    expect(input.distinctSourceCount).toBe(2);
  });

  it('counts "again" ratings among the last seven reviews and measures days since the last natural encounter', async () => {
    const now = new Date();
    const { sentences } = await seedBook('Book', 1);
    const item = await due(sentences[0]!.id, now);
    const ratings = ['again', 'again', 'good', 'good', 'good', 'good', 'good', 'again', 'good'] as const;
    for (const [i, rating] of ratings.entries()) {
      await recordReview({
        studyItemId: item.id,
        rating,
        now: new Date(now.getTime() - (20 - i) * DAY),
        source: i === 2 ? 'natural_encounter' : undefined,
      });
    }
    // recordReview reschedules; put the card back in the due pool.
    const stored = (await getDb().studyItems.get(item.id))!;
    await getDb().studyItems.update(item.id, { fsrsState: { ...stored.fsrsState, due: new Date(now.getTime() - DAY).toISOString() } });

    const input = [...(await getSessionPlannerInput(30, now)).retainDue].find((d) => d.studyItemId === item.id)!;
    // Newest seven: indexes 2..8 → one "again" (index 7).
    expect(input.recentReviewCount).toBe(7);
    expect(input.recentAgainCount).toBe(1);
    expect(input.daysSinceLastEncounter).toBeCloseTo(18, 5);
    expect(input.crossActivityMissBoost).toBe(false);
  });

  it('reports no natural encounter as null', async () => {
    const now = new Date();
    const { sentences } = await seedBook('Book', 1);
    const item = await due(sentences[0]!.id, now);
    const input = (await getSessionPlannerInput(30, now)).retainDue.find((d) => d.studyItemId === item.id)!;
    expect(input).toMatchObject({ recentReviewCount: 0, recentAgainCount: 0, daysSinceLastEncounter: null });
  });
});

describe('shadowing candidate order', () => {
  it('a stale "missed twice" cloze card from the retired word cards does not pull a sentence ahead', async () => {
    const { book, sentences } = await seedBook('Shadow', 2);
    const db = getDb();
    for (const sentence of sentences) {
      await setBookSentenceStatus(book.id, sentence.id, 'in_progress');
      await confirmSentenceVocabulary(sentence.id, []);
      await db.sentenceAudio.add({
        id: `audio-${sentence.id}`,
        sentenceId: sentence.id,
        sourceId: 'source-1',
        sourceSentenceId: `src-${sentence.id}`,
        sourceTitle: 'Test Source',
        mimeType: 'audio/mp3',
        durationMs: 3000,
        startMs: 0,
        endMs: 3000,
        blob: new Blob(['fake audio bytes'], { type: 'audio/mp3' }),
        importedAt: new Date().toISOString(),
      });
    }
    const [fresh, practised] = sentences as [Sentence, Sentence];
    // `practised` was shadowed before (not today), so fewest-attempts puts `fresh` first.
    const attempt = await saveAttempt({ sentenceId: practised.id, blob: new Blob(['x']), mimeType: 'audio/webm', durationMs: 100 });
    await db.attempts.update(attempt.id, { createdAt: new Date(Date.now() - 3 * DAY).toISOString() });
    // A cloze card missed twice in its last reviews, pointing at `practised`. No cloze review can clear it any more.
    const cloze = await ensureStudyItem('vocabularyItem', 'vocab-1', 'cloze');
    for (const days of [10, 9]) {
      await recordReview({ studyItemId: cloze.id, rating: 'again', contextSentenceId: practised.id, now: new Date(Date.now() - days * DAY) });
    }

    const candidates = (await getSessionPlannerInput(60)).shadowCandidates;
    expect(candidates.map((c) => c.sentenceId)).toEqual([fresh.id, practised.id]);
    expect(candidates.every((c) => !c.reason.startsWith('Missed in review'))).toBe(true);
  });
});
