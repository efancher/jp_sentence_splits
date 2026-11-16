import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addSentencesToBook,
  createBook,
  getDb,
  getStuckSentenceSnapshot,
  logSentenceLearningEvent,
  setBookSuspended,
} from '../src/db/repository';
import type { Sentence, VocabularySuggestion } from '../src/domain/types';
import { createId } from '../src/lib/ids';
import { SHADOW_POOL_BOOK_LIMIT } from '../src/lib/sessionPlannerConfig';
import { buildStuckSummary, listeningToolBlock, stuckReasons, type StuckSentenceFacts } from '../src/lib/stuckSentences';

type Piece = [surface: string, pos: string, reading: string];
const HOBBIES: Piece[] = [
  ['私', '代名詞', 'ワタシ'],
  ['は', '助詞/係助詞', 'ハ'],
  ['趣味', '名詞/普通名詞/一般', 'シュミ'],
  ['が', '助詞/格助詞', 'ガ'],
  ['多い', '形容詞/一般', 'オオイ'],
  ['です', '助動詞', 'デス'],
  ['。', '補助記号/句点', ''],
];
const SHORT: Piece[] = [
  ['猫', '名詞/普通名詞/一般', 'ネコ'],
  ['。', '補助記号/句点', ''],
];

function makeSentence(pieces: Piece[] | null, overrides: Partial<Sentence> = {}): Sentence {
  let cursor = 0;
  const source = pieces ?? HOBBIES;
  const vocabularySuggestions: VocabularySuggestion[] = pieces
    ? pieces.map(([surface, pos, reading], i) => {
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
      })
    : [];
  const timestamp = new Date().toISOString();
  const id = overrides.id ?? createId('sent');
  return {
    id,
    normalizedKey: id,
    japanese: source.map((p) => p[0]).join(''),
    readingOnly: '',
    inlineReading: '',
    translation: 't',
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

describe('stuckReasons / listeningToolBlock', () => {
  const base: StuckSentenceFacts = { sentenceId: 's', bookId: 'b', hasAudio: true, listeningToolFits: true, inShadowPool: true };

  it('reports nothing for a sentence every step can use', () => {
    expect(stuckReasons(base)).toEqual([]);
  });

  it('counts shelved and audio-less sentences only there', () => {
    expect(stuckReasons({ ...base, bookId: undefined, hasAudio: false, inShadowPool: false })).toEqual(['held_back']);
    expect(stuckReasons({ ...base, hasAudio: false, listeningToolFits: false, inShadowPool: false })).toEqual(['no_audio']);
  });

  it('names the listening block and the shadowing pool separately', () => {
    expect(
      stuckReasons({ ...base, listeningToolFits: false, sentence: makeSentence(null), inShadowPool: false }),
    ).toEqual(['no_word_analysis', 'outside_shadow_pool']);
    expect(stuckReasons({ ...base, listeningToolFits: false, sentence: makeSentence(SHORT) })).toEqual(['no_phrase_split']);
  });

  it('tells a missing analysis from a phrase count the tools reject', () => {
    expect(listeningToolBlock(makeSentence(HOBBIES))).toBeNull();
    expect(listeningToolBlock(makeSentence(null))).toBe('no_word_analysis');
    expect(listeningToolBlock(makeSentence(SHORT))).toBe('no_phrase_split');
  });

  it('summarises every reason in a fixed order, with a few examples each', () => {
    const facts = ['a', 'b', 'c', 'd'].map((sentenceId) => ({ ...base, sentenceId, hasAudio: false }));
    const summary = buildStuckSummary(facts, 2);
    expect(summary.metCount).toBe(4);
    expect(summary.rows.map((row) => row.reason)).toEqual([
      'held_back',
      'no_audio',
      'no_word_analysis',
      'no_phrase_split',
      'outside_shadow_pool',
    ]);
    expect(summary.rows[1]).toEqual({ reason: 'no_audio', count: 4, examples: ['a', 'b'] });
  });
});

describe('getStuckSentenceSnapshot', () => {
  beforeEach(() => {
    resetDbForTests(`stuck-${createId('db')}`);
  });

  const T0 = Date.parse('2026-11-01T00:00:00Z');

  async function book(title: string, openedDaysAgo: number) {
    const created = await createBook({ title });
    await getDb().books.update(created.id, { lastOpenedAt: new Date(T0 - openedDaysAgo * 86_400_000).toISOString() });
    return created;
  }

  async function met(bookId: string, sentence: Sentence, withAudio: boolean) {
    await getDb().sentences.put(sentence);
    await addSentencesToBook(bookId, [sentence.id]);
    await logSentenceLearningEvent({ visitId: createId('v'), bookId, sentenceId: sentence.id, action: 'walkthrough_completed' });
    if (withAudio) {
      await getDb().sentenceAudio.put({
        id: `audio-${sentence.id}`,
        sentenceId: sentence.id,
        sourceId: 'src',
        sourceSentenceId: sentence.id,
        sourceTitle: 'src',
        mimeType: 'audio/mpeg',
        durationMs: 3000,
        startMs: 0,
        endMs: 3000,
        blob: new Blob(['x']),
        importedAt: new Date(T0).toISOString(),
      });
    }
  }

  const count = (snapshot: Awaited<ReturnType<typeof getStuckSentenceSnapshot>>, reason: string) =>
    snapshot.rows.find((row) => row.reason === reason)?.count;

  it('reports nothing before any sentence is met', async () => {
    const b = await book('Fresh', 0);
    const sentence = makeSentence(HOBBIES);
    await getDb().sentences.put(sentence);
    await addSentencesToBook(b.id, [sentence.id]);
    expect(await getStuckSentenceSnapshot()).toEqual({ metCount: 0, rows: [] });
  });

  it('classifies met sentences against the current step requirements, with linked examples', async () => {
    const current = await book('Current', 0);
    const ready = makeSentence(HOBBIES);
    const silent = makeSentence(HOBBIES);
    const unanalysed = makeSentence(null);
    const short = makeSentence(SHORT);
    await met(current.id, ready, true);
    await met(current.id, silent, false);
    await met(current.id, unanalysed, true);
    await met(current.id, short, true);

    const shelved = await book('Shelved', 1);
    const shelvedSentence = makeSentence(HOBBIES);
    await met(shelved.id, shelvedSentence, true);
    await setBookSuspended(shelved.id, true);

    // Current plus these fill the shadowing pool, so the older book falls outside it.
    for (let i = 1; i < SHADOW_POOL_BOOK_LIMIT; i += 1) await met((await book(`Recent ${i}`, i)).id, makeSentence(HOBBIES), true);
    const old = await book('Old', 30);
    const oldSentence = makeSentence(HOBBIES);
    await met(old.id, oldSentence, true);

    const snapshot = await getStuckSentenceSnapshot();
    expect(snapshot.metCount).toBe(5 + SHADOW_POOL_BOOK_LIMIT);
    expect(count(snapshot, 'held_back')).toBe(1);
    expect(count(snapshot, 'no_audio')).toBe(1);
    expect(count(snapshot, 'no_word_analysis')).toBe(1);
    expect(count(snapshot, 'no_phrase_split')).toBe(1);
    const outside = snapshot.rows.find((row) => row.reason === 'outside_shadow_pool')!;
    expect(outside.count).toBe(1);
    expect(outside.examples.map((e) => e.sentenceId)).toEqual([oldSentence.id]);
    const heldBack = snapshot.rows.find((row) => row.reason === 'held_back')!;
    expect(heldBack.examples).toEqual([{ sentenceId: shelvedSentence.id, bookId: undefined, preview: shelvedSentence.japanese.slice(0, 24) }]);
    const noAudio = snapshot.rows.find((row) => row.reason === 'no_audio')!;
    expect(noAudio.examples[0]).toMatchObject({ sentenceId: silent.id, bookId: current.id });
    const everyExample = snapshot.rows.flatMap((row) => row.examples.map((e) => e.sentenceId));
    expect(everyExample).not.toContain(ready.id);
  });
});
