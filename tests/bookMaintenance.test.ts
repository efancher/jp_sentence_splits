import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tracked = vi.hoisted(() => [] as { entity: string; recordId: string; operation: string }[]);
vi.mock('../src/sync/track', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/sync/track')>();
  return {
    ...actual,
    trackLocalMutation: async (input: { entity: string; recordId: string; operation: string }) => {
      tracked.push({ entity: input.entity, recordId: input.recordId, operation: input.operation });
    },
  };
});

const buildPackage = vi.hoisted(() => ({ spy: null as null | ReturnType<typeof vi.fn> }));
vi.mock('../src/lib/miningExport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/miningExport')>();
  buildPackage.spy = vi.fn(actual.buildMiningPackage);
  return { ...actual, buildMiningPackage: (...args: Parameters<typeof actual.buildMiningPackage>) => buildPackage.spy!(...args) };
});

import { ensureSettings, resetDbForTests } from '../src/db/database';
import {
  addSentencesToBook,
  applyCuratedVocabularyForBook,
  commitImport,
  createBook,
  createBookChapter,
  deleteBook,
  duplicateBookOrdering,
  exportBookMiningPackage,
  findResumeSentence,
  getDb,
  getOpenContentReports,
  listSyncIssueReports,
  logSentenceLearningEvent,
  rememberNhkEasyFeedUrl,
  rememberPodcastFeedUrl,
  renameImportBatch,
  reportSyncIssue,
  resolveContentReport,
  resolveSyncIssueReport,
  saveAnalysis,
  setBookCollapsedChapterIds,
  setBookSentenceStatus,
  updatePlannerSessionStep,
} from '../src/db/repository';
import type { PlannerSession, PlannerSessionStep } from '../src/domain/types';
import { CURATED_VOCAB_BOOKS } from '../src/lib/curatedVocabulary';
import { createId } from '../src/lib/ids';
import { parseSatoriCsvText } from './helpers/satoriCsvFixture';

const littleBirds = readFileSync(resolve(import.meta.dirname, '../fixtures/little-birds.csv'), 'utf8');

async function seedBook() {
  const preview = parseSatoriCsvText(littleBirds, 'little-birds.csv');
  const ids = preview.drafts.map((item) => item.proposedId);
  const { batchId } = await commitImport({ preview, selectedIds: ids, destination: 'inbox' });
  const book = await createBook({ title: 'Little birds' });
  await addSentencesToBook(book.id, ids);
  return { ids, book, batchId };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  resetDbForTests(`book-maint-${createId('db')}`);
  tracked.length = 0;
});

describe('addSentencesToBook', () => {
  it('appends new members in source order whatever order they were picked in, and skips ones already there', async () => {
    const preview = parseSatoriCsvText(littleBirds, 'little-birds.csv');
    const ids = preview.drafts.map((item) => item.proposedId);
    await commitImport({ preview, selectedIds: ids, destination: 'inbox' });
    const sentences = await getDb().sentences.bulkGet(ids);
    const bySource = [...sentences].sort((a, b) => a!.firstOccurrenceIndex - b!.firstOccurrenceIndex).map((s) => s!.id);
    const book = await createBook({ title: 'Picked' });

    await addSentencesToBook(book.id, [bySource[2]!]);
    await addSentencesToBook(book.id, [bySource[1]!, bySource[2]!, bySource[0]!]);
    const members = await getDb().bookSentences.where('bookId').equals(book.id).sortBy('position');
    expect(members.map((m) => m.sentenceId)).toEqual([bySource[2], bySource[0], bySource[1]]);
    expect(members.map((m) => m.position)).toEqual([0, 1, 2]);
    expect(await getDb().inbox.count()).toBe(0);
  });
});

describe('deleteBook', () => {
  it('removes the book and its memberships but keeps the shared sentences, and queues tombstones', async () => {
    const { ids, book } = await seedBook();
    const other = await createBook({ title: 'Other' });
    await addSentencesToBook(other.id, [ids[0]!]);
    const memberships = await getDb().bookSentences.where('bookId').equals(book.id).toArray();
    tracked.length = 0;

    await deleteBook(book.id);
    await flush();
    const db = getDb();
    expect(await db.books.get(book.id)).toBeUndefined();
    expect(await db.bookSentences.where('bookId').equals(book.id).count()).toBe(0);
    expect(await db.sentences.count()).toBe(ids.length);
    expect(await db.bookSentences.where('bookId').equals(other.id).count()).toBe(1);
    expect(tracked).toEqual(
      expect.arrayContaining([
        { entity: 'books', recordId: book.id, operation: 'delete' },
        ...memberships.map((m) => ({ entity: 'book_sentences', recordId: m.id, operation: 'delete' })),
      ]),
    );
  });
});

describe('duplicateBookOrdering', () => {
  it('copies the order and chapters under new ids, without study history, and leaves the original alone', async () => {
    const { ids, book } = await seedBook();
    const chapter = await createBookChapter(book.id, 'Episode 1');
    const db = getDb();
    const first = await db.bookSentences.where('[bookId+sentenceId]').equals([book.id, ids[0]!]).first();
    await db.bookSentences.update(first!.id, { chapterId: chapter.id });
    await setBookSentenceStatus(book.id, ids[0]!, 'in_progress');

    const copy = await duplicateBookOrdering(book.id);
    expect(copy.id).not.toBe(book.id);
    expect(copy.title).toBe('Little birds (copy)');
    expect(copy.chapters).toHaveLength(1);
    expect(copy.chapters![0]!.id).not.toBe(chapter.id);
    expect(copy.chapters![0]!.title).toBe('Episode 1');

    const copied = await db.bookSentences.where('bookId').equals(copy.id).sortBy('position');
    const original = await db.bookSentences.where('bookId').equals(book.id).sortBy('position');
    expect(copied.map((m) => m.sentenceId)).toEqual(original.map((m) => m.sentenceId));
    expect(copied.every((m) => m.lastStudiedAt === undefined)).toBe(true);
    expect(copied[0]!.chapterId).toBe(copy.chapters![0]!.id);
    expect(copied.slice(1).every((m) => m.chapterId === undefined)).toBe(true);
    expect(new Set([...copied, ...original].map((m) => m.id)).size).toBe(copied.length + original.length);
    expect(original[0]!.chapterId).toBe(chapter.id);
    expect((await db.books.get(copy.id))?.chapters).toEqual(copy.chapters);
  });

  it('rejects an unknown book', async () => {
    await expect(duplicateBookOrdering('missing')).rejects.toThrow('Book not found');
  });
});

describe('small book and batch edits', () => {
  it('stores collapsed chapter ids once each and syncs the book', async () => {
    const { book } = await seedBook();
    tracked.length = 0;
    await setBookCollapsedChapterIds(book.id, ['c1', 'c2', 'c1']);
    await flush();
    expect((await getDb().books.get(book.id))?.collapsedChapterIds).toEqual(['c1', 'c2']);
    expect(tracked).toContainEqual({ entity: 'books', recordId: book.id, operation: 'upsert' });
    await expect(setBookCollapsedChapterIds('missing', [])).rejects.toThrow('Book not found');
  });

  it('renames an import batch but ignores a blank name', async () => {
    const { batchId } = await seedBook();
    const original = (await getDb().importBatches.get(batchId))!.batchName;
    await renameImportBatch(batchId, '  ');
    expect((await getDb().importBatches.get(batchId))?.batchName).toBe(original);
    await renameImportBatch(batchId, '  Spring birds ');
    expect((await getDb().importBatches.get(batchId))?.batchName).toBe('Spring birds');
    await expect(renameImportBatch('missing', 'x')).rejects.toThrow('Import batch not found');
  });

  it('keeps the eight most recent feed urls per list, newest first, without duplicates', async () => {
    for (let i = 0; i < 10; i += 1) await rememberPodcastFeedUrl(`https://feeds.example.com/${i}`);
    await rememberPodcastFeedUrl('https://feeds.example.com/5');
    await rememberNhkEasyFeedUrl('https://nhk.example.com/a');
    const settings = await ensureSettings();
    expect(settings.recentPodcastFeedUrls).toEqual([5, 9, 8, 7, 6, 4, 3, 2].map((i) => `https://feeds.example.com/${i}`));
    expect(settings.recentNhkEasyFeedUrls).toEqual(['https://nhk.example.com/a']);
  });
});

describe('findResumeSentence', () => {
  it('prefers work in progress, then the first unstarted sentence, then the first sentence', async () => {
    const { ids, book } = await seedBook();
    expect(await findResumeSentence(book.id)).toBe(ids[0]);
    await setBookSentenceStatus(book.id, ids[0]!, 'completed');
    expect(await findResumeSentence(book.id)).toBe(ids[1]);
    await setBookSentenceStatus(book.id, ids[2]!, 'needs_review');
    expect(await findResumeSentence(book.id)).toBe(ids[2]);
    for (const id of ids) await setBookSentenceStatus(book.id, id, 'completed');
    expect(await findResumeSentence(book.id)).toBe(ids[0]);
    expect(await findResumeSentence('empty-book')).toBeNull();
  });
});

describe('exportBookMiningPackage', () => {
  const clip = (id: string, sentenceId: string, startMs: number) => ({
    id,
    sentenceId,
    sourceId: 'src-1',
    sourceSentenceId: `src-${id}`,
    sourceTitle: 'Little birds',
    mimeType: 'audio/webm',
    durationMs: 1000,
    startMs,
    endMs: startMs + 1000,
    blob: new Blob(['x']),
    importedAt: '2026-11-01T00:00:00.000Z',
  });

  it('hands the builder this book\'s sentences in reading order, with their analyses and audio', async () => {
    const { ids, book } = await seedBook();
    const db = getDb();
    await saveAnalysis(ids[1]!, [], '', { reviewStatus: 'confirmed', selections: [] });
    await saveAnalysis(ids[2]!, [], '', { reviewStatus: 'confirmed', selections: [] });
    await db.sentenceAudio.bulkPut([clip('a0', ids[0]!, 0), clip('a1', ids[1]!, 1000), clip('a2', ids[2]!, 2000)]);
    const elsewhere = await createBook({ title: 'Elsewhere' });
    await addSentencesToBook(elsewhere.id, [ids[2]!]);

    // Stored blobs come back from fake IndexedDB without arrayBuffer(); the
    // package format itself is covered by tests/miningExport.test.ts.
    buildPackage.spy!.mockResolvedValue({ blob: new Blob([]), filename: 'x.zip', sentenceCount: 0, selectionCount: 0, skippedUnconfirmed: 0 });
    await exportBookMiningPackage(book.id);
    const input = buildPackage.spy!.mock.calls.at(-1)![0];
    expect(input.book.id).toBe(book.id);
    expect(input.sentences.map((x: { id: string }) => x.id)).toEqual(ids);
    expect(input.analyses.map((x: { sentenceId: string }) => x.sentenceId).sort()).toEqual([ids[1], ids[2]].sort());
    expect(input.audio.map((x: { id: string }) => x.id).sort()).toEqual(['a0', 'a1', 'a2']);

    await exportBookMiningPackage(elsewhere.id);
    const other = buildPackage.spy!.mock.calls.at(-1)![0];
    expect(other.sentences.map((x: { id: string }) => x.id)).toEqual([ids[2]]);
    expect(other.audio.map((x: { id: string }) => x.id)).toEqual(['a2']);
    buildPackage.spy!.mockReset();
    buildPackage.spy!.mockImplementation((await vi.importActual<typeof import('../src/lib/miningExport')>('../src/lib/miningExport')).buildMiningPackage);
  });

  it('refuses a book with nothing confirmed, and an unknown book', async () => {
    const { book } = await seedBook();
    await expect(exportBookMiningPackage(book.id)).rejects.toThrow('No confirmed vocabulary');
    await expect(exportBookMiningPackage('missing')).rejects.toThrow('Book not found');
  });
});

describe('report triage', () => {
  it('resolving a sync issue report marks it resolved and syncs it', async () => {
    const report = await reportSyncIssue({ note: 'stuck at Pending 3', diagnosticsSnapshot: '{}' });
    tracked.length = 0;
    const resolved = await resolveSyncIssueReport(report.id);
    await flush();
    expect(resolved).toMatchObject({ id: report.id, status: 'resolved' });
    expect(resolved.resolvedAt).toBeTruthy();
    expect(await listSyncIssueReports('open')).toEqual([]);
    expect((await listSyncIssueReports('resolved')).map((r) => r.id)).toEqual([report.id]);
    expect(tracked).toContainEqual({ entity: 'sync_issue_reports', recordId: report.id, operation: 'upsert' });
    await expect(resolveSyncIssueReport('missing')).rejects.toThrow('not found');
  });

  it('resolving a content report closes it without touching the sentence', async () => {
    const { ids, book } = await seedBook();
    const before = await getDb().sentences.get(ids[0]!);
    await logSentenceLearningEvent({
      visitId: createId('sl_visit'),
      action: 'content_report',
      bookId: book.id,
      sentenceId: ids[0]!,
      report: 'poor_question',
      timestamp: '2026-11-01T00:00:00.000Z',
    });
    const [open] = await getOpenContentReports();
    expect(open).toMatchObject({ sentenceId: ids[0], japanese: before!.japanese });

    await resolveContentReport(open!, 'dismissed');
    expect(await getOpenContentReports()).toEqual([]);
    expect(await getDb().sentences.get(ids[0]!)).toEqual(before);
  });
});

describe('settling a planner step advances its real progress marker', () => {
  const T = '2026-11-16T00:00:00.000Z';
  function step(id: string, targetKind: PlannerSessionStep['targetKind'], extra: Partial<PlannerSessionStep> = {}): PlannerSessionStep {
    return { id, bucket: 'glossing', activityType: targetKind, targetKind, label: id, estimatedMinutes: 5, reason: '', status: 'pending', ...extra };
  }
  async function session(steps: PlannerSessionStep[]): Promise<PlannerSession> {
    const row: PlannerSession = {
      id: createId('session'),
      createdAt: T,
      updatedAt: T,
      date: '2026-11-16',
      targetMinutes: 20,
      allocation: {} as PlannerSession['allocation'],
      explanation: [],
      steps,
      status: 'in_progress',
    };
    await getDb().plannerSessions.put(row);
    return row;
  }
  const membership = (bookId: string, sentenceId: string) =>
    getDb().bookSentences.where('[bookId+sentenceId]').equals([bookId, sentenceId]).first();

  it('continue_book completes an unstarted or in-progress sentence, but leaves needs_review alone', async () => {
    const { ids, book } = await seedBook();
    await setBookSentenceStatus(book.id, ids[1]!, 'in_progress');
    await setBookSentenceStatus(book.id, ids[2]!, 'needs_review');
    const s = await session(ids.map((id, i) => step(`s${i}`, 'continue_book', { bookId: book.id, sentenceId: id })));
    for (let i = 0; i < ids.length; i += 1) await updatePlannerSessionStep(s.id, `s${i}`, { status: 'completed' });
    expect((await membership(book.id, ids[0]!))?.status).toBe('complete');
    expect((await membership(book.id, ids[1]!))?.status).toBe('complete');
    expect((await membership(book.id, ids[2]!))?.status).toBe('needs_review');
    expect((await getDb().plannerSessions.get(s.id))?.status).toBe('completed');
  });

  it('skipping, or re-completing an already completed step, does not advance anything', async () => {
    const { ids, book } = await seedBook();
    const s = await session([step('a', 'continue_book', { bookId: book.id, sentenceId: ids[0]! })]);
    await updatePlannerSessionStep(s.id, 'a', { status: 'skipped' });
    expect((await membership(book.id, ids[0]!))?.status).toBe('unstarted');

    const done = await session([step('b', 'continue_book', { bookId: book.id, sentenceId: ids[1]!, status: 'completed' })]);
    await updatePlannerSessionStep(done.id, 'b', { status: 'completed' });
    expect((await membership(book.id, ids[1]!))?.status).toBe('unstarted');
  });

  it('vocabulary_review confirms the sentence vocabulary; grammar_noticing confirms every listed sentence', async () => {
    const { ids } = await seedBook();
    const s = await session([
      step('v', 'vocabulary_review', { sentenceId: ids[0]! }),
      step('g', 'grammar_noticing', { sentenceIds: [ids[1]!, ids[2]!] }),
    ]);
    await updatePlannerSessionStep(s.id, 'v', { status: 'completed' });
    await updatePlannerSessionStep(s.id, 'g', { status: 'completed' });
    const analyses = await getDb().analyses.bulkGet(ids);
    expect(analyses[0]?.vocabularyReviewStatus).toBe('confirmed');
    expect(analyses[1]?.grammarReviewStatus).toBe('confirmed');
    expect(analyses[2]?.grammarReviewStatus).toBe('confirmed');
  });

  it('a step whose sentence is gone still settles', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const s = await session([step('g', 'grammar_noticing', { sentenceId: 'no-such-sentence' })]);
    const updated = await updatePlannerSessionStep(s.id, 'g', { status: 'completed' });
    expect(updated?.steps[0]?.status).toBe('completed');
    error.mockRestore();
  });

  it('returns undefined for an unknown session', async () => {
    expect(await updatePlannerSessionStep('missing', 'x', { status: 'completed' })).toBeUndefined();
  });
});

describe('applyCuratedVocabularyForBook', () => {
  const pack = CURATED_VOCAB_BOOKS[0]!;
  const curatedLines = Object.entries(pack.picksByJapanese).filter(([, picks]) => picks.length > 0).slice(0, 2);

  async function seedCuratedBook() {
    const { ids, book } = await seedBook();
    const db = getDb();
    await db.books.update(book.id, { sourceKey: pack.sourceKey });
    await db.sentences.update(ids[0]!, { japanese: curatedLines[0]![0] });
    await db.sentences.update(ids[1]!, { japanese: curatedLines[1]![0] });
    await saveAnalysis(ids[1]!, [], 'learner notes', { reviewStatus: 'confirmed', selections: [] });
    return { ids, book };
  }

  it('confirms curated picks, skips already-confirmed sentences, and counts lines without picks', async () => {
    const { ids, book } = await seedCuratedBook();
    const result = await applyCuratedVocabularyForBook(book.id);
    expect(result).toEqual({ updated: 1, confirmed: 1, skippedConfirmed: 1, missingPicks: 1, unresolvedPicks: 0 });
    const analyses = await getDb().analyses.bulkGet(ids);
    expect(analyses[0]?.vocabularyReviewStatus).toBe('confirmed');
    expect(analyses[0]?.vocabularySelections?.length).toBeGreaterThan(0);
    expect(analyses[1]?.vocabularySelections).toEqual([]);
    expect(analyses[2]).toBeUndefined();
  });

  it('overwrites confirmed sentences only when asked, keeping their notes', async () => {
    const { ids, book } = await seedCuratedBook();
    const result = await applyCuratedVocabularyForBook(book.id, { overwriteConfirmed: true });
    expect(result).toMatchObject({ updated: 2, skippedConfirmed: 0 });
    expect((await getDb().analyses.get(ids[1]!))?.notes).toBe('learner notes');
  });

  it('refuses books without a curated pack, and unknown books', async () => {
    const { book } = await seedBook();
    await expect(applyCuratedVocabularyForBook(book.id)).rejects.toThrow('No curated vocabulary pack');
    await expect(applyCuratedVocabularyForBook('missing')).rejects.toThrow('Book not found');
  });
});
