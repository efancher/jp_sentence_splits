import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addSentencesToBook,
  commitImport,
  createBook,
  ensureGrammarPattern,
  ensureSentenceGrammar,
  ensureStudyItem,
  exportBookBackup,
  exportFullBackup,
  getDb,
  recordReview,
  restoreBackup,
  saveAnalysis,
  updateSettings,
} from '../src/db/repository';
import { parseBackupJson } from '../src/lib/backup';
import { parseSatoriCsvText } from './helpers/satoriCsvFixture';
import { createId } from '../src/lib/ids';

const littleBirds = readFileSync(resolve(import.meta.dirname, '../fixtures/little-birds.csv'), 'utf8');

/** Two books sharing one of three sentences, an analysis, a reviewed study item and a grammar link. */
async function seedLibrary() {
  const preview = parseSatoriCsvText(littleBirds, 'little-birds.csv');
  const ids = preview.drafts.map((item) => item.proposedId);
  expect(ids).toHaveLength(3);
  await commitImport({ preview, selectedIds: ids, destination: 'inbox' });
  const bookA = await createBook({ title: 'Book A' });
  const bookB = await createBook({ title: 'Book B' });
  await addSentencesToBook(bookA.id, ids.slice(0, 2));
  await addSentencesToBook(bookB.id, ids.slice(1, 3));
  await saveAnalysis(ids[0]!, [
    { id: 'c1', order: 0, japanese: 'ある小鳥の', role: 'modifier/content', literalEnglish: "a-certain-little-bird's" },
  ]);
  const item = await ensureStudyItem('sentence', ids[0]!, 'reading_in_context');
  await recordReview({ studyItemId: item.id, rating: 'good' });
  const otherItem = await ensureStudyItem('sentence', ids[2]!, 'reading_in_context');
  await recordReview({ studyItemId: otherItem.id, rating: 'hard' });
  const pattern = await ensureGrammarPattern('～ました', {});
  await ensureSentenceGrammar(ids[0]!, pattern.id, {});
  await updateSettings({ newCardsPerSessionLimit: 7 });
  return { ids, bookA, bookB, item, otherItem, pattern };
}

const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));

async function snapshot() {
  const db = getDb();
  return {
    books: byId(await db.books.toArray()),
    sentences: byId(await db.sentences.toArray()),
    bookSentences: byId(await db.bookSentences.toArray()),
    analyses: (await db.analyses.toArray()).sort((a, b) => a.sentenceId.localeCompare(b.sentenceId)),
    studyItems: byId(await db.studyItems.toArray()),
    reviews: byId(await db.reviews.toArray()),
    grammarPatterns: byId(await db.grammarPatterns.toArray()),
    sentenceGrammar: byId(await db.sentenceGrammar.toArray()),
  };
}

describe('full backup', () => {
  beforeEach(() => {
    resetDbForTests(`backup-${createId('db')}`);
  });

  it('round-trips through JSON into an empty device with replace', async () => {
    await seedLibrary();
    const before = await snapshot();
    const payload = await exportFullBackup();
    expect(payload.counts).toMatchObject({ books: 2, sentences: 3, bookSentences: 4, reviews: 2, sentenceGrammar: 1 });

    const parsed = parseBackupJson(JSON.stringify(payload));
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'));

    resetDbForTests(`backup-restore-${createId('db')}`);
    await restoreBackup(parsed.data, 'replace');
    expect(await snapshot()).toEqual(before);
    expect((await getDb().settings.get('settings'))?.newCardsPerSessionLimit).toBe(7);
  });

  it('replace drops local rows the backup does not have but keeps audio for restored sentences', async () => {
    const { ids } = await seedLibrary();
    const payload = await exportFullBackup();
    const db = getDb();
    const extra = await createBook({ title: 'Made after the backup' });
    const clip = {
      sourceId: 'src-1',
      sourceSentenceId: 'src-1-0',
      sourceTitle: 'Little birds',
      mimeType: 'audio/webm',
      durationMs: 1000,
      startMs: 0,
      endMs: 1000,
      blob: new Blob(['x']),
      importedAt: '2026-11-01T00:00:00.000Z',
    };
    await db.sentenceAudio.bulkPut([
      { ...clip, id: 'audio-kept', sentenceId: ids[0]! },
      { ...clip, id: 'audio-orphan', sentenceId: 'sentence-not-in-backup' },
    ]);

    await restoreBackup(payload, 'replace');
    expect(await db.books.get(extra.id)).toBeUndefined();
    // Backups carry no audio: clips of restored sentences stay, orphans go.
    expect((await db.sentenceAudio.toArray()).map((row) => row.id)).toEqual(['audio-kept']);
  });

  it('merge keeps newer local edits, adds missing rows, and never duplicates reviews or memberships', async () => {
    const { bookA, item } = await seedLibrary();
    const payload = await exportFullBackup();
    const db = getDb();

    // Local edit made after the backup: newer updatedAt must win over the backup copy.
    await db.books.update(bookA.id, { title: 'Renamed later', updatedAt: '2099-01-01T00:00:00.000Z' });
    // Rows lost locally since the backup: merge brings them back.
    const lostBook = payload.books.find((b) => b.id !== bookA.id)!;
    await db.books.delete(lostBook.id);
    const reviewCount = await db.reviews.count();
    const membershipCount = await db.bookSentences.count();
    await db.studyItems.delete(item.id);

    await restoreBackup(payload, 'merge');
    expect((await db.books.get(bookA.id))?.title).toBe('Renamed later');
    expect(await db.books.get(lostBook.id)).toBeTruthy();
    expect(await db.studyItems.get(item.id)).toBeTruthy();
    expect(await db.reviews.count()).toBe(reviewCount);
    expect(await db.bookSentences.count()).toBe(membershipCount);

    // An older backup copy of the book does not overwrite the newer local one on a second merge either.
    await restoreBackup(payload, 'merge');
    expect((await db.books.get(bookA.id))?.title).toBe('Renamed later');
  });

  it('merge overlays backup settings onto the current settings row', async () => {
    await seedLibrary();
    const payload = await exportFullBackup();
    await updateSettings({ newCardsPerSessionLimit: 30 });
    await restoreBackup(payload, 'merge');
    const settings = await getDb().settings.get('settings');
    expect(settings?.id).toBe('settings');
    expect(settings?.newCardsPerSessionLimit).toBe(7);
  });
});

describe('book backup', () => {
  beforeEach(() => {
    resetDbForTests(`book-backup-${createId('db')}`);
  });

  it('contains only the book, its sentences and what hangs off them', async () => {
    const { ids, bookA, bookB, item, pattern } = await seedLibrary();
    const payload = await exportBookBackup(bookA.id);

    expect(payload.books.map((b) => b.id)).toEqual([bookA.id]);
    expect(payload.bookSentences.every((m) => m.bookId === bookA.id)).toBe(true);
    expect(payload.sentences.map((s) => s.id).sort()).toEqual(ids.slice(0, 2).sort());
    expect(payload.analyses.map((a) => a.sentenceId)).toEqual([ids[0]]);
    expect(payload.studyItems.map((s) => s.id)).toEqual([item.id]);
    expect(payload.reviews.every((r) => r.studyItemId === item.id)).toBe(true);
    expect(payload.reviews).toHaveLength(1);
    expect(payload.grammarPatterns.map((p) => p.id)).toEqual([pattern.id]);
    expect(payload.grammarRelationships).toEqual([]);
    expect(payload.plannerSessions).toEqual([]);
    expect(payload.inbox).toEqual([]);
    expect(payload.books.some((b) => b.id === bookB.id)).toBe(false);
    expect(parseBackupJson(JSON.stringify(payload)).ok).toBe(true);
  });

  it('merging a book backup into another device leaves its other books alone', async () => {
    const { bookA } = await seedLibrary();
    const payload = await exportBookBackup(bookA.id);
    resetDbForTests(`book-backup-target-${createId('db')}`);
    const local = await createBook({ title: 'Already here' });
    await restoreBackup(payload, 'merge');
    const titles = (await getDb().books.toArray()).map((b) => b.title).sort();
    expect(titles).toEqual(['Already here', 'Book A']);
    expect(await getDb().books.get(local.id)).toBeTruthy();
    expect(await getDb().bookSentences.where('bookId').equals(bookA.id).count()).toBe(2);
  });

  it('rejects an unknown book', async () => {
    await expect(exportBookBackup('missing')).rejects.toThrow('Book not found');
  });
});
