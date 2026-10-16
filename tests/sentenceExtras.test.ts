import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { createBook, createBookChapter, getBookWithExtras, getDb, saveSentenceExtras } from '../src/db/repository';

const draft = (japanese: string) => [{ japanese, role: 'engine' }];

describe('sentence_extras', () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    await resetDbForTests();
  });

  it('stores drafts per sentence, merges patches, and leaves the book row untouched', async () => {
    const book = await createBook({ title: 'B' });
    const chapter = await createBookChapter(book.id, 'C');
    await saveSentenceExtras(book.id, chapter.id, [['s1', { structureDraft: draft('a') }]]);
    await saveSentenceExtras(book.id, chapter.id, [['s1', { contextWalkthrough: { steps: [] } as never }]]);

    const row = (await getDb().sentenceExtras.get('s1'))!;
    expect(row.structureDraft).toEqual(draft('a'));
    expect(row.contextWalkthrough).toBeDefined();
    expect(row.bookId).toBe(book.id);
    expect((await getDb().books.get(book.id))!.chapters.every((c) => !c.structureDrafts && !c.contextWalkthroughs)).toBe(true);
  });

  it('overlays extras onto chapters, with extras winning over legacy inline drafts', async () => {
    const book = await createBook({ title: 'B' });
    const chapter = await createBookChapter(book.id, 'C');
    const stored = (await getDb().books.get(book.id))!;
    await getDb().books.put({
      ...stored,
      chapters: stored.chapters.map((c) => ({ ...c, structureDrafts: { legacy: draft('old'), both: draft('inline') } })),
    });
    await saveSentenceExtras(book.id, chapter.id, [['both', { structureDraft: draft('extras') }], ['new', { structureDraft: draft('n') }]]);

    const view = (await getBookWithExtras(book.id))!.chapters[0]!;
    expect(view.structureDrafts).toEqual({ legacy: draft('old'), both: draft('extras'), new: draft('n') });
    expect((await getDb().books.get(book.id))!.chapters[0]!.structureDrafts).toEqual({ legacy: draft('old'), both: draft('inline') });
  });

  it('falls back to bounded point reads after two cursor failures', async () => {
    const book = await createBook({ title: 'Large book' });
    const chapter = await createBookChapter(book.id, 'C');
    const db = getDb();
    const ids = Array.from({ length: 205 }, (_, i) => `s${i}`);
    await db.bookSentences.bulkPut(ids.map((sentenceId, position) => ({ id: `bs${position}`, bookId: book.id,
      sentenceId, position, chapterId: chapter.id, status: 'unstarted' as const, addedAt: '2026-10-15' })));
    await saveSentenceExtras(book.id, chapter.id, ids.map((id) => [id, { constructionDraft: [] }] as const));
    const read = vi.fn().mockRejectedValue(new Error("Attempt to iterate a cursor that doesn't exist"));
    vi.spyOn(db.sentenceExtras, 'where').mockReturnValue({ equals: () => ({ toArray: read }) } as never);
    const bulk = vi.spyOn(db.sentenceExtras, 'bulkGet');
    const view = await getBookWithExtras(book.id);
    expect(Object.keys(view!.chapters[0]!.constructionDrafts!)).toHaveLength(205);
    expect(read).toHaveBeenCalledTimes(2);
    expect(bulk.mock.calls.map(([keys]) => keys.length)).toEqual([100, 100, 5]);
  });

  it('rejects saving for a missing book', async () => {
    await expect(saveSentenceExtras('nope', 'c', [['s', { structureDraft: draft('a') }]])).rejects.toThrow('Book not found');
  });
});
