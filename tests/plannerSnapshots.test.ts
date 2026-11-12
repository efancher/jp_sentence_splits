import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  clearPlannerSnapshots,
  flushPlannerSnapshotSaves,
  loadSnapshot,
  setSnapshotSaveDelayForTests,
} from '../src/db/plannerSnapshots';
import {
  addSentencesToBook,
  createBook,
  getDb,
  getSessionPlannerInput,
  resetPlannerReadCachesForTests,
  setBookSuspended,
} from '../src/db/repository';
import type { BookSentence, Sentence } from '../src/domain/types';
import { createId } from '../src/lib/ids';

function makeSentence(japanese: string): Sentence {
  const timestamp = new Date().toISOString();
  const id = createId('sent');
  return {
    id,
    normalizedKey: id,
    japanese,
    readingOnly: '',
    inlineReading: '',
    translation: 'x',
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const membership = (id: string): BookSentence => ({
  id,
  bookId: 'book',
  sentenceId: `s-${id}`,
  position: 0,
  status: 'unstarted',
  addedAt: new Date().toISOString(),
});

describe('planner snapshots', () => {
  beforeEach(() => {
    resetDbForTests(`snapshots-${createId('db')}`);
    setSnapshotSaveDelayForTests(0);
    resetPlannerReadCachesForTests();
  });

  const read = (build = () => getDb().bookSentences.toArray()) => loadSnapshot(getDb(), 'bookSentences', build);

  it('serves a saved snapshot without scanning the table again', async () => {
    await getDb().bookSentences.bulkPut(Array.from({ length: 1000 }, (_, i) => membership(String(i))));
    const build = vi.fn(() => getDb().bookSentences.toArray());
    expect(await read(build)).toHaveLength(1000);
    await flushPlannerSnapshotSaves();

    const second = await read(build);
    expect(build).toHaveBeenCalledTimes(1);
    expect(second).toHaveLength(1000);
    expect(second.map((row) => row.id).sort()).toEqual((await getDb().bookSentences.toArray()).map((row) => row.id).sort());
  });

  it('rebuilds after the table is written, deleted from, or cleared', async () => {
    await getDb().bookSentences.bulkPut([membership('a'), membership('b')]);
    const build = vi.fn(() => getDb().bookSentences.toArray());
    await read(build);
    await flushPlannerSnapshotSaves();

    // An in-place edit leaves the row count unchanged, so only the write notification can catch it.
    await getDb().bookSentences.update('a', { status: 'complete' });
    const afterEdit = await read(build);
    expect(build).toHaveBeenCalledTimes(2);
    expect(afterEdit.find((row) => row.id === 'a')?.status).toBe('complete');
    await flushPlannerSnapshotSaves();

    await getDb().bookSentences.delete('b');
    expect((await read(build)).map((row) => row.id)).toEqual(['a']);
    await flushPlannerSnapshotSaves();

    await getDb().bookSentences.clear();
    expect(await read(build)).toEqual([]);
  });

  it('does not trust a snapshot built before a write that landed while it was being built', async () => {
    await getDb().bookSentences.put(membership('a'));
    const racing = vi.fn(async () => {
      const rows = await getDb().bookSentences.toArray();
      await getDb().bookSentences.put(membership('late'));
      return rows;
    });
    await read(racing);
    await flushPlannerSnapshotSaves();
    expect((await read()).map((row) => row.id).sort()).toEqual(['a', 'late']);
  });

  it('is discarded by clearPlannerSnapshots', async () => {
    await getDb().bookSentences.put(membership('a'));
    const build = vi.fn(() => getDb().bookSentences.toArray());
    await read(build);
    await flushPlannerSnapshotSaves();
    await clearPlannerSnapshots(getDb());
    await read(build);
    expect(build).toHaveBeenCalledTimes(2);
  });
});

describe('planner output from snapshots matches the table scans', () => {
  beforeEach(async () => {
    resetDbForTests(`snapshots-parity-${createId('db')}`);
    setSnapshotSaveDelayForTests(0);
    resetPlannerReadCachesForTests();
  });

  it('gives the same candidates whether the reads come from snapshots or from the tables', async () => {
    const db = getDb();
    const books = [await createBook({ title: 'One' }), await createBook({ title: 'Two' }), await createBook({ title: 'Shelved' })];
    for (const [index, book] of books.entries()) {
      const sentences = ['今日は雨です。', '明日は晴れです。', '昨日は曇りでした。'].map((text) => makeSentence(`${text}${index}`));
      await db.sentences.bulkPut(sentences);
      await addSentencesToBook(book.id, sentences.map((sentence) => sentence.id));
      // One walked-through sentence per book, a few days ago.
      await db.sentenceLearningEvents.put({
        id: createId('sle'),
        sentenceId: sentences[0]!.id,
        bookId: book.id,
        action: 'walkthrough_completed',
        timestamp: new Date(Date.now() - 4 * 86_400_000).toISOString(),
      } as never);
    }
    await setBookSuspended(books[2]!.id, true);

    const cold = await getSessionPlannerInput(60);
    await flushPlannerSnapshotSaves();
    resetPlannerReadCachesForTests();
    const fromSnapshots = await getSessionPlannerInput(60);

    const strip = (input: typeof cold) => ({
      explore: input.exploreCandidates,
      shadow: input.shadowCandidates,
      readCheck: input.readCheckCandidates,
      listening: input.listeningToolCandidates,
      retain: input.retainDue.length,
      practice: input.practiceDue.length,
      recent: input.recentActivity.length,
    });
    expect(strip(fromSnapshots)).toEqual(strip(cold));
    expect(fromSnapshots.exploreCandidates.length).toBeGreaterThan(0);
  });
});
