import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { addMinutesToTodaySession, addSentencesToBook, createBook, getDb, updateSettings } from '../src/db/repository';
import type { Sentence, VocabularySuggestion } from '../src/domain/types';
import { createId } from '../src/lib/ids';

const T = '2026-10-17T00:00:00.000Z';
const N = '名詞/普通名詞';
const CASE = '助詞/格助詞';
// 親鳥がひなに巣を作りました。 — has a Sentence Growth plan
const NEST: [string, string][] = [
  ['親', N], ['鳥', N], ['が', CASE], ['ひな', N], ['に', CASE], ['巣', N], ['を', CASE],
  ['作り', '動詞/一般'], ['まし', '助動詞'], ['た', '助動詞'], ['。', '補助記号'],
];

function nestSentence(id: string): Sentence {
  let at = 0;
  const vocabularySuggestions: VocabularySuggestion[] = NEST.map(([surface, pos], i) => {
    const token = {
      id: `${id}-t${i}`, surface, start: at, end: at + surface.length, expression: surface, reading: surface,
      pos, source: 'morphology' as const, selectedByDefault: false,
    };
    at += surface.length;
    return token;
  });
  return plainSentence(id, NEST.map(([s]) => s).join(''), vocabularySuggestions);
}

function plainSentence(id: string, japanese = '猫が寝ています。', vocabularySuggestions: VocabularySuggestion[] = []): Sentence {
  return {
    id, normalizedKey: id, japanese, readingOnly: '', inlineReading: '', translation: `tr ${id}`,
    targetVocabulary: [], vocabularySuggestions, sourceReferences: [], conflicts: [], firstOccurrenceIndex: 0,
    importBatchIds: [], createdAt: T, updatedAt: T,
  };
}

async function addAudio(sentenceId: string, durationMs = 3000) {
  await getDb().sentenceAudio.put({
    id: `a-${sentenceId}`, sentenceId, sourceId: 's', sourceSentenceId: sentenceId, sourceTitle: 's',
    mimeType: 'audio/mpeg', durationMs, startMs: 0, endMs: durationMs, blob: new Blob(['x']), importedAt: T,
  });
}

async function lessonOrder(): Promise<string[]> {
  const session = await addMinutesToTodaySession(60);
  return session.steps.filter((step) => step.targetKind === 'sentence_learning').map((step) => step.sentenceId!);
}

describe('walkthrough supply: Sentence Growth-eligible lessons float within the existing window', () => {
  beforeEach(async () => {
    resetDbForTests(`growth-order-${createId('db')}`);
    await updateSettings({ sentenceLedFlow: false, sentenceFirstPlanning: true });
  });

  it('puts a qualifying sentence ahead of earlier plain ones, and keeps reading order within each group', async () => {
    const book = await createBook({ title: 'Order Book' });
    const db = getDb();
    const rows = [plainSentence('p1'), plainSentence('p2'), nestSentence('g1'), plainSentence('p3'), nestSentence('g2')];
    await db.sentences.bulkPut(rows);
    await addSentencesToBook(book.id, rows.map((row) => row.id));
    await addAudio('g1');
    await addAudio('g2');
    await addAudio('p1');

    expect(await lessonOrder()).toEqual(['g1', 'g2', 'p1', 'p2', 'p3']);
  });

  it('leaves reading order alone when nothing qualifies (no audio, or a clip over 10 s)', async () => {
    const book = await createBook({ title: 'Plain Book' });
    const db = getDb();
    const rows = [plainSentence('p1'), nestSentence('g1'), nestSentence('g2')];
    await db.sentences.bulkPut(rows);
    await addSentencesToBook(book.id, rows.map((row) => row.id));
    await addAudio('g2', 30_000);

    expect(await lessonOrder()).toEqual(['p1', 'g1', 'g2']);
  });

  it('is order only: every sentence is still offered, so none can be starved', async () => {
    const book = await createBook({ title: 'Complete Book' });
    const db = getDb();
    const rows = [plainSentence('p1'), nestSentence('g1')];
    await db.sentences.bulkPut(rows);
    await addSentencesToBook(book.id, rows.map((row) => row.id));
    await addAudio('g1');

    expect([...(await lessonOrder())].sort()).toEqual(['g1', 'p1']);
  });
});
