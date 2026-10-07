import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  findGrammarNoticingCandidates,
  getDb,
  getSessionPlannerInput,
  setChapterSuspended,
  updateSettings,
} from '../src/db/repository';
import { createId } from '../src/lib/ids';

async function seed(status: 'unstarted' | 'complete') {
  const db = getDb();
  const now = new Date().toISOString();
  await db.books.put({
    id: 'b1',
    title: 'Podcast',
    archived: false,
    createdAt: now,
    updatedAt: now,
    chapters: [
      { id: 'c1', title: 'ep1', position: 0 },
      { id: 'c2', title: 'ep2', position: 1 },
    ],
  } as never);
  for (const [sid, chapterId, position] of [
    ['s1', 'c1', 0],
    ['s2', 'c2', 1],
  ] as const) {
    await db.sentences.put({
      id: sid,
      normalizedKey: sid,
      japanese: `猫が寝ています${sid}。`,
      readingOnly: '',
      inlineReading: '',
      translation: 't',
      targetVocabulary: [],
      vocabularySuggestions: [],
      sourceReferences: [],
      conflicts: [],
      firstOccurrenceIndex: 0,
      importBatchIds: [],
      createdAt: now,
      updatedAt: now,
    } as never);
    await db.bookSentences.put({
      id: `bs_${sid}`,
      bookId: 'b1',
      sentenceId: sid,
      position,
      status,
      addedAt: now,
      chapterId,
    });
  }
}

describe('suspended chapters in session-planner finders', () => {
  beforeEach(async () => {
    resetDbForTests(`chapter-finders-${createId('db')}`);
    await updateSettings({ sentenceLedFlow: false });
  });

  it('explore candidates skip sentences in a suspended chapter', async () => {
    await seed('unstarted');
    const ids = async () =>
      (await getSessionPlannerInput(60)).exploreCandidates
        .filter((c) => c.bookId === 'b1')
        .flatMap((c) => c.sentences.map((s) => s.sentenceId));
    expect((await ids()).sort()).toEqual(['s1', 's2']);
    await setChapterSuspended('b1', 'c1', true);
    expect(await ids()).toEqual(['s2']);
  });

  it('grammar-noticing candidates skip sentences in a suspended chapter', async () => {
    await seed('complete');
    await setChapterSuspended('b1', 'c1', true);
    const candidates = await findGrammarNoticingCandidates(10);
    expect(candidates.map((c) => c.sentenceId)).not.toContain('s1');
  });
});
