import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addSentencesToBook,
  assignBookSentencesToChapter,
  commitImport,
  createBook,
  createBookChapter,
  deferUnreadySentenceReviews,
  deleteAttempt,
  deleteBookChapter,
  ensureKanji,
  ensureStudyItem,
  ensureVocabularyConfusion,
  ensureVocabularyItem,
  ensureVocabularyStudyItem,
  computeVocabularyContextDiversity,
  exportFullBackup,
  getAttemptAlignment,
  getAttemptTranscription,
  getDb,
  getDueStudyItems,
  getReferenceAlignment,
  listAttemptAnalysisSummariesForSentence,
  getVocabularyTargetCandidates,
  listAttemptsForSentence,
  listCardIssueReports,
  listCardIssueReportsWithContext,
  materializeVocabularySelections,
  moveBookSentence,
  getStudyItemDebugInfo,
  pickContextSentenceForVocabularyItem,
  rateAttempt,
  recordConfusionObservation,
  recordNaturalEncounter,
  recordReview,
  removeSentencesFromBook,
  reorderBookSentences,
  reportCardIssue,
  resolveCardIssueReport,
  restoreBookSentenceSnapshot,
  restoreBackup,
  saveAnalysis,
  saveAttempt,
  saveAttemptAlignment,
  saveAttemptAnalysisSummary,
  saveAttemptTranscription,
  saveReferenceAlignment,
  setAttemptFavorite,
  setBookSentenceStatus,
  transferBookSentences,
  updateBookChapter,
} from '../src/db/repository';
import type { AlignmentResult, Sentence, VocabularySelection } from '../src/domain/types';
import { parseBackupJson } from '../src/lib/backup';
import { parseSatoriCsvText } from '../src/lib/csvImport';
import { createId } from '../src/lib/ids';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const littleBirds = readFileSync(
  resolve(import.meta.dirname, '../fixtures/little-birds.csv'),
  'utf8',
);

describe('data layer', () => {
  beforeEach(() => {
    resetDbForTests(`data-${createId('db')}`);
  });

  it('creates books, shares sentences, reorders, and preserves analysis on reimport', async () => {
    const preview = parseSatoriCsvText(littleBirds, 'little-birds.csv');
    const selected = preview.drafts.map((item) => item.proposedId);
    await commitImport({
      preview,
      selectedIds: selected,
      destination: 'inbox',
    });

    const bookA = await createBook({ title: 'Book A' });
    const bookB = await createBook({ title: 'Book B' });
    await addSentencesToBook(bookA.id, selected.slice(0, 2));
    await addSentencesToBook(bookB.id, selected.slice(0, 1));

    const firstId = selected[0]!;
    await saveAnalysis(firstId, [
      {
        id: 'c1',
        order: 0,
        japanese: 'ある小鳥の',
        role: 'modifier/content',
        literalEnglish: "a-certain-little-bird's",
      },
    ]);
    await setBookSentenceStatus(bookA.id, firstId, 'in_progress');

    await reorderBookSentences(bookA.id, [selected[1]!, selected[0]!]);

    const reimport = parseSatoriCsvText(littleBirds, 'little-birds.csv');
    await commitImport({
      preview: reimport,
      selectedIds: reimport.drafts.map((item) => item.proposedId),
      destination: 'inbox',
    });

    const backup = await exportFullBackup();
    expect(backup.sentences.length).toBeGreaterThan(0);
    const analysis = backup.analyses.find((item) => item.sentenceId === firstId);
    expect(analysis?.chunks[0]?.literalEnglish).toBe("a-certain-little-bird's");
    const memberships = backup.bookSentences
      .filter((item) => item.bookId === bookA.id)
      .sort((a, b) => a.position - b.position);
    expect(memberships.map((item) => item.sentenceId)).toEqual([
      selected[1],
      selected[0],
    ]);
    expect(
      memberships.find((item) => item.sentenceId === firstId)?.status,
    ).toBe('in_progress');

    const parsed = parseBackupJson(JSON.stringify(backup));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      await restoreBackup(parsed.data, 'replace');
      const again = await exportFullBackup();
      expect(again.books).toHaveLength(backup.books.length);
      expect(again.sentences).toHaveLength(backup.sentences.length);
    }
  });

  it('moves and copies memberships, supports exact positions, and restores removal metadata', async () => {
    const preview = parseSatoriCsvText(littleBirds, 'little-birds.csv');
    const sentenceIds = preview.drafts.map((item) => item.proposedId);
    await commitImport({
      preview,
      selectedIds: sentenceIds,
      destination: 'inbox',
    });
    const source = await createBook({ title: 'Source' });
    const destination = await createBook({ title: 'Destination' });
    await addSentencesToBook(source.id, sentenceIds);
    await setBookSentenceStatus(source.id, sentenceIds[0]!, 'needs_review');

    await moveBookSentence(source.id, sentenceIds[0]!, 3);
    const db = getDb();
    const reordered = await db.bookSentences
      .where('bookId')
      .equals(source.id)
      .sortBy('position');
    expect(reordered[2]?.sentenceId).toBe(sentenceIds[0]);

    await transferBookSentences({
      sourceBookId: source.id,
      destinationBookId: destination.id,
      sentenceIds: [sentenceIds[0]!],
      mode: 'copy',
    });
    const copied = await db.bookSentences
      .where('[bookId+sentenceId]')
      .equals([destination.id, sentenceIds[0]!])
      .first();
    expect(copied?.status).toBe('needs_review');

    await transferBookSentences({
      sourceBookId: source.id,
      destinationBookId: destination.id,
      sentenceIds: [sentenceIds[1]!],
      mode: 'move',
    });
    expect(
      await db.bookSentences
        .where('[bookId+sentenceId]')
        .equals([source.id, sentenceIds[1]!])
        .count(),
    ).toBe(0);

    const beforeRemoval = await db.bookSentences
      .where('bookId')
      .equals(source.id)
      .sortBy('position');
    const snapshot = await removeSentencesFromBook(source.id, [
      sentenceIds[0]!,
    ]);
    await restoreBookSentenceSnapshot(source.id, snapshot);
    const restored = await db.bookSentences
      .where('bookId')
      .equals(source.id)
      .sortBy('position');
    expect(restored).toEqual(beforeRemoval);
    expect(
      restored.find((item) => item.sentenceId === sentenceIds[0])?.status,
    ).toBe('needs_review');
  });

  it('creates, orders, assigns, and deletes book chapters without duplicating sentences', async () => {
    const preview = parseSatoriCsvText(littleBirds, 'little-birds.csv');
    const sentenceIds = preview.drafts.map((item) => item.proposedId);
    await commitImport({
      preview,
      selectedIds: sentenceIds,
      destination: 'inbox',
    });
    const book = await createBook({ title: 'Chaptered Book' });
    await addSentencesToBook(book.id, sentenceIds);
    const first = await createBookChapter(book.id, 'Lesson One');
    const second = await createBookChapter(book.id, 'Lesson Two');
    await assignBookSentencesToChapter(book.id, sentenceIds.slice(0, 2), first.id);

    const db = getDb();
    let memberships = await db.bookSentences
      .where('bookId')
      .equals(book.id)
      .sortBy('position');
    expect(
      memberships.filter((item) => item.chapterId === first.id),
    ).toHaveLength(2);

    await updateBookChapter(book.id, second.id, { position: 0 });
    let storedBook = await db.books.get(book.id);
    expect(storedBook?.chapters.map((chapter) => chapter.title)).toEqual([
      'Lesson Two',
      'Lesson One',
    ]);

    const backup = await exportFullBackup();
    expect(
      backup.books.find((item) => item.id === book.id)?.chapters,
    ).toHaveLength(2);
    expect(
      backup.bookSentences.some((item) => item.chapterId === first.id),
    ).toBe(true);

    await deleteBookChapter(book.id, first.id);
    storedBook = await db.books.get(book.id);
    expect(storedBook?.chapters).toHaveLength(1);
    memberships = await db.bookSentences
      .where('bookId')
      .equals(book.id)
      .toArray();
    expect(memberships.some((item) => item.chapterId === first.id)).toBe(false);
    expect(await db.sentences.count()).toBe(sentenceIds.length);
  });

  it('imports selected sentences into a new or existing chapter', async () => {
    const preview = parseSatoriCsvText(littleBirds, 'little-birds.csv');
    const sentenceIds = preview.drafts.map((item) => item.proposedId);
    const book = await createBook({ title: 'Satori Series' });
    const existing = await createBookChapter(book.id, 'Earlier Lesson');

    const intoExisting = await commitImport({
      preview,
      selectedIds: sentenceIds.slice(0, 2),
      destination: 'existing_book',
      bookId: book.id,
      chapterId: existing.id,
    });
    expect(intoExisting.chapterId).toBe(existing.id);

    const intoNew = await commitImport({
      preview,
      selectedIds: sentenceIds.slice(2),
      destination: 'existing_book',
      bookId: book.id,
      newChapterTitle: 'Imported Lesson',
    });
    expect(intoNew.chapterId).toBeTruthy();

    const db = getDb();
    const storedBook = await db.books.get(book.id);
    expect(storedBook?.chapters.map((chapter) => chapter.title)).toEqual([
      'Earlier Lesson',
      'Imported Lesson',
    ]);
    const memberships = await db.bookSentences
      .where('bookId')
      .equals(book.id)
      .toArray();
    expect(
      memberships.filter((item) => item.chapterId === existing.id),
    ).toHaveLength(2);
    expect(
      memberships.filter((item) => item.chapterId === intoNew.chapterId),
    ).toHaveLength(sentenceIds.length - 2);
  });

  it('creates a book chapter during new-book import and assigns already-membered sentences', async () => {
    const preview = parseSatoriCsvText(littleBirds, 'little-birds.csv');
    const sentenceIds = preview.drafts.map((item) => item.proposedId);
    await commitImport({
      preview,
      selectedIds: sentenceIds.slice(0, 1),
      destination: 'new_book',
      newBookTitle: 'Starter',
    });
    const book = (await getDb().books.toArray())[0]!;

    const result = await commitImport({
      preview,
      selectedIds: sentenceIds,
      destination: 'existing_book',
      bookId: book.id,
      newChapterTitle: 'Full Export',
    });

    const memberships = await getDb()
      .bookSentences.where('bookId')
      .equals(book.id)
      .toArray();
    expect(memberships).toHaveLength(sentenceIds.length);
    expect(
      memberships.every((item) => item.chapterId === result.chapterId),
    ).toBe(true);
  });
});

describe('shadowing attempts', () => {
  beforeEach(() => {
    resetDbForTests(`data-attempts-${createId('db')}`);
  });

  function makeBlob(bytes = 'audio-bytes'): Blob {
    return new Blob([bytes], { type: 'audio/webm' });
  }

  it('saves an attempt with expected defaults', async () => {
    const attempt = await saveAttempt({
      sentenceId: 'sent-1',
      blob: makeBlob(),
      mimeType: 'audio/webm',
      durationMs: 1_500,
    });
    expect(attempt.id).toMatch(/^attempt_/);
    expect(attempt.sentenceId).toBe('sent-1');
    expect(attempt.manualRating).toBeUndefined();
    expect(await getDb().attempts.get(attempt.id)).toMatchObject({
      sentenceId: 'sent-1',
      durationMs: 1_500,
    });
  });

  it('lists attempts for a sentence newest-first, excluding other sentences', async () => {
    const first = await saveAttempt({
      sentenceId: 'sent-1',
      blob: makeBlob('one'),
      mimeType: 'audio/webm',
      durationMs: 1_000,
    });
    const second = await saveAttempt({
      sentenceId: 'sent-1',
      blob: makeBlob('two'),
      mimeType: 'audio/webm',
      durationMs: 1_000,
    });
    await saveAttempt({
      sentenceId: 'sent-2',
      blob: makeBlob('other'),
      mimeType: 'audio/webm',
      durationMs: 1_000,
    });

    const attempts = await listAttemptsForSentence('sent-1');
    expect(attempts.map((item) => item.id)).toEqual([second.id, first.id]);
  });

  it('deletes an attempt', async () => {
    const attempt = await saveAttempt({
      sentenceId: 'sent-1',
      blob: makeBlob(),
      mimeType: 'audio/webm',
      durationMs: 1_000,
    });
    await deleteAttempt(attempt.id);
    expect(await getDb().attempts.get(attempt.id)).toBeUndefined();
  });

  it('rates an attempt and rejects an unknown id', async () => {
    const attempt = await saveAttempt({
      sentenceId: 'sent-1',
      blob: makeBlob(),
      mimeType: 'audio/webm',
      durationMs: 1_000,
    });
    const rated = await rateAttempt(attempt.id, 'better');
    expect(rated.manualRating).toBe('better');

    await expect(rateAttempt('missing-id', 'worse')).rejects.toThrow(
      'Attempt not found',
    );
  });

  it('never enqueues sync metadata for attempt writes (local-only by design)', async () => {
    const attempt = await saveAttempt({
      sentenceId: 'sent-1',
      blob: makeBlob(),
      mimeType: 'audio/webm',
      durationMs: 1_000,
    });
    await rateAttempt(attempt.id, 'same');
    await deleteAttempt(attempt.id);

    expect(await getDb().syncRecordMeta.count()).toBe(0);
    expect(await getDb().syncQueue.count()).toBe(0);
  });

  it('toggles favorite on an attempt and rejects an unknown id', async () => {
    const attempt = await saveAttempt({
      sentenceId: 'sent-1',
      blob: makeBlob(),
      mimeType: 'audio/webm',
      durationMs: 1_000,
    });
    expect(attempt.isFavorite).toBeUndefined();

    const favorited = await setAttemptFavorite(attempt.id, true);
    expect(favorited.isFavorite).toBe(true);

    const unfavorited = await setAttemptFavorite(attempt.id, false);
    expect(unfavorited.isFavorite).toBe(false);

    await expect(setAttemptFavorite('missing-id', true)).rejects.toThrow(
      'Attempt not found',
    );
  });

  it('saves an attempt with notes', async () => {
    const attempt = await saveAttempt({
      sentenceId: 'sent-1',
      blob: makeBlob(),
      mimeType: 'audio/webm',
      durationMs: 1_000,
      notes: 'Focus on the pitch drop.',
    });
    expect(attempt.notes).toBe('Focus on the pitch drop.');
    expect(await getDb().attempts.get(attempt.id)).toMatchObject({
      notes: 'Focus on the pitch drop.',
    });
  });
});

describe('cached forced alignment (Phase 9, Milestone 2b)', () => {
  beforeEach(() => {
    resetDbForTests(`data-alignment-${createId('db')}`);
  });

  const result: AlignmentResult = {
    durationSeconds: 1.7,
    words: [{ start: 0.5, end: 0.84, text: 'ちょっと', phones: [] }],
  };

  it('round-trips a reference alignment', async () => {
    expect(await getReferenceAlignment('audio-1')).toBeUndefined();
    await saveReferenceAlignment('audio-1', result);
    expect(await getReferenceAlignment('audio-1')).toEqual(result);
  });

  it('round-trips an attempt alignment', async () => {
    expect(await getAttemptAlignment('attempt-1')).toBeUndefined();
    await saveAttemptAlignment('attempt-1', result);
    expect(await getAttemptAlignment('attempt-1')).toEqual(result);
  });

  it('treats a stale alignmentVersion as a cache miss', async () => {
    await saveReferenceAlignment('audio-1', result);
    await getDb().referenceAlignments.update('audio-1', { alignmentVersion: 0 });

    expect(await getReferenceAlignment('audio-1')).toBeUndefined();
  });
});

describe('cached ASR transcription (Phase 9, Milestone 7)', () => {
  beforeEach(() => {
    resetDbForTests(`data-transcription-${createId('db')}`);
  });

  it('round-trips an attempt transcription', async () => {
    expect(await getAttemptTranscription('attempt-1')).toBeUndefined();
    await saveAttemptTranscription('attempt-1', '今日はちょっと寒いですね');
    expect(await getAttemptTranscription('attempt-1')).toBe('今日はちょっと寒いですね');
  });

  it('treats a stale transcriptionVersion as a cache miss', async () => {
    await saveAttemptTranscription('attempt-1', '今日はちょっと寒いですね');
    await getDb().attemptTranscriptions.update('attempt-1', { transcriptionVersion: 0 });

    expect(await getAttemptTranscription('attempt-1')).toBeUndefined();
  });
});

describe('pronunciation history summaries (Phase 9, Milestone 8)', () => {
  beforeEach(() => {
    resetDbForTests(`data-history-${createId('db')}`);
  });

  it('saves and lists summaries for a sentence, oldest and newest', async () => {
    await saveAttemptAnalysisSummary({
      id: 'attempt-1',
      sentenceId: 'sent-1',
      createdAt: '2026-08-12T00:00:00.000Z',
      timingSeverity: 0.8,
      pitchSeverity: 0.2,
    });
    await saveAttemptAnalysisSummary({
      id: 'attempt-2',
      sentenceId: 'sent-1',
      createdAt: '2026-08-14T00:00:00.000Z',
      timingSeverity: 0.3,
      pitchSeverity: 0.1,
      primaryIssueKind: 'sokuon_timing',
      primaryIssueMessage: 'Your 「っ」 in 「ちょっと」 is shorter than the reference.',
    });
    // A different sentence's summary should never leak in.
    await saveAttemptAnalysisSummary({
      id: 'attempt-3',
      sentenceId: 'sent-2',
      createdAt: '2026-08-13T00:00:00.000Z',
      timingSeverity: 0.5,
      pitchSeverity: 0.5,
    });

    const summaries = await listAttemptAnalysisSummariesForSentence('sent-1');
    expect(summaries.map((s) => s.id).sort()).toEqual(['attempt-1', 'attempt-2']);
    const withIssue = summaries.find((s) => s.id === 'attempt-2');
    expect(withIssue?.primaryIssueKind).toBe('sokuon_timing');
  });

  it('excludes summaries with a stale analysisSummaryVersion', async () => {
    await saveAttemptAnalysisSummary({
      id: 'attempt-1',
      sentenceId: 'sent-1',
      createdAt: '2026-08-12T00:00:00.000Z',
      timingSeverity: 0.5,
      pitchSeverity: 0.5,
    });
    await getDb().attemptAnalysisSummaries.update('attempt-1', { analysisSummaryVersion: 0 });

    expect(await listAttemptAnalysisSummariesForSentence('sent-1')).toEqual([]);
  });
});

describe('FSRS review (study_items/reviews)', () => {
  beforeEach(() => {
    resetDbForTests(`data-review-${createId('db')}`);
  });

  it('ensureStudyItem creates a new, due-now card the first time a subject is seen', async () => {
    const item = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    expect(item.subjectType).toBe('sentence');
    expect(item.subjectId).toBe('sent-1');
    expect(item.activityType).toBe('comprehension');
    expect(item.fsrsState.state).toBe('new');
    expect(item.fsrsState.reps).toBe(0);
  });

  it('ensureStudyItem is idempotent for the same subject/activity pair', async () => {
    const first = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    const second = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    expect(second.id).toBe(first.id);
    expect(await getDb().studyItems.count()).toBe(1);
  });

  it('ensureStudyItem treats different activity types as distinct study items', async () => {
    const comprehension = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    const reading = await ensureStudyItem('sentence', 'sent-1', 'reading_in_context');
    expect(comprehension.id).not.toBe(reading.id);
    expect(await getDb().studyItems.count()).toBe(2);
  });

  it('getDueStudyItems only returns items due now, filtered by activity type and subject', async () => {
    const due = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    const other = await ensureStudyItem('sentence', 'sent-2', 'comprehension');
    const notDue = await ensureStudyItem('sentence', 'sent-3', 'comprehension');
    await getDb().studyItems.update(notDue.id, {
      fsrsState: {
        ...notDue.fsrsState,
        due: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
    });

    const results = await getDueStudyItems(['comprehension'], {
      subjectIds: [due.subjectId, other.subjectId, notDue.subjectId],
    });
    expect(results.map((item) => item.id).sort()).toEqual(
      [due.id, other.id].sort(),
    );
  });

  it('getDueStudyItems excludes other activity types even when due', async () => {
    await ensureStudyItem('sentence', 'sent-1', 'shadowing');
    const results = await getDueStudyItems(['comprehension', 'reading_in_context']);
    expect(results).toEqual([]);
  });

  it('getDueStudyItems excludes a graduated item when graduationMinScheduledDays is set (Phase 7.10)', async () => {
    const item = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    await getDb().studyItems.update(item.id, {
      fsrsState: { ...item.fsrsState, state: 'review', scheduledDays: 200 },
    });
    const withGraduation = await getDueStudyItems(['comprehension'], {
      graduationMinScheduledDays: 180,
    });
    expect(withGraduation).toEqual([]);

    const withoutGraduation = await getDueStudyItems(['comprehension']);
    expect(withoutGraduation.map((row) => row.id)).toEqual([item.id]);
  });

  it('recordReview appends a Review and advances the study item past "new"', async () => {
    const item = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    const { review, studyItem } = await recordReview({
      studyItemId: item.id,
      rating: 'good',
    });
    expect(review.studyItemId).toBe(item.id);
    expect(review.rating).toBe('good');
    expect(studyItem.fsrsState.state).not.toBe('new');
    expect(studyItem.fsrsState.reps).toBe(1);
    expect(new Date(studyItem.fsrsState.due).getTime()).toBeGreaterThan(
      Date.now(),
    );
    expect(await getDb().reviews.count()).toBe(1);
    const persisted = await getDb().studyItems.get(item.id);
    expect(persisted?.fsrsState.reps).toBe(1);
  });

  it('recordReview rejects an unknown study item id', async () => {
    await expect(
      recordReview({ studyItemId: 'missing-id', rating: 'good' }),
    ).rejects.toThrow('Study item not found');
  });

  it('auto-classifies a wrong reading_production answer as incorrect_reading', async () => {
    const item = await ensureStudyItem('vocabularyItem', 'word-1', 'reading_production');
    const { review } = await recordReview({
      studyItemId: item.id,
      rating: 'again',
      responseRaw: 'たべる',
      expectedAnswer: 'たべた',
    });
    expect(review.errorClassification).toBe('incorrect_reading');
  });

  it('auto-classifies a wrong sentence_transformation answer as grammar_misunderstanding', async () => {
    const item = await ensureStudyItem('vocabularyItem', 'word-1', 'sentence_transformation');
    const { review } = await recordReview({
      studyItemId: item.id,
      rating: 'hard',
      responseRaw: 'いった',
      expectedAnswer: 'いかなかった',
    });
    expect(review.errorClassification).toBe('grammar_misunderstanding');
  });

  it('auto-classifies a failed contrastive-pair review as vocabulary_confusion', async () => {
    const item = await ensureStudyItem('vocabularyConfusion', 'pair-1', 'contrastive');
    const { review } = await recordReview({ studyItemId: item.id, rating: 'again' });
    expect(review.errorClassification).toBe('vocabulary_confusion');
  });

  it('leaves a bare self-rated comprehension review unclassified', async () => {
    const item = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    const { review } = await recordReview({ studyItemId: item.id, rating: 'again' });
    expect(review.errorClassification).toBeUndefined();
  });

  it('does not override an explicitly-provided errorClassification', async () => {
    const item = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    const { review } = await recordReview({
      studyItemId: item.id,
      rating: 'again',
      errorClassification: 'listening_failure',
    });
    expect(review.errorClassification).toBe('listening_failure');
  });

  it('enqueues sync metadata for study_items/reviews writes, unlike local-only attempts', async () => {
    const item = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    await recordReview({ studyItemId: item.id, rating: 'good' });

    await vi.waitFor(async () => {
      expect(await getDb().syncRecordMeta.count()).toBeGreaterThan(0);
    });
    const keys = (await getDb().syncRecordMeta.toArray()).map((row) => row.entity);
    expect(keys).toContain('study_items');
    expect(keys).toContain('reviews');
  });
});

describe('deferUnreadySentenceReviews (full-sentence gating)', () => {
  beforeEach(() => {
    resetDbForTests(`data-defer-${createId('db')}`);
  });

  async function linkVocabulary(sentenceId: string, vocabularyItemId: string) {
    const now = nowIsoForTest();
    await getDb().sentenceVocabulary.add({
      id: createId('svoc'),
      sentenceId,
      vocabularyItemId,
      surfaceForm: '本',
      createdAt: now,
      updatedAt: now,
    });
  }

  async function confirmVocabularyReview(sentenceId: string) {
    const now = nowIsoForTest();
    await getDb().analyses.put({
      sentenceId,
      chunks: [],
      notes: '',
      status: 'empty',
      formatVersion: 2,
      vocabularyReviewStatus: 'confirmed',
      vocabularySelections: [],
      createdAt: now,
      updatedAt: now,
    });
  }

  it('defers a due sentence item that has never had its vocabulary reviewed at all (a brand-new sentence)', async () => {
    // No sentence_vocabulary links and no `analyses` row at all — exactly
    // the state of a freshly imported sentence. This must gate, not pass
    // through as "nothing to check" (the bug the user caught: a new
    // sentence shouldn't skip ahead of ones whose vocabulary is proven).
    const item = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    const result = await deferUnreadySentenceReviews(['comprehension']);
    expect(result).toEqual({ deferred: 1, checked: 1 });
    const persisted = await getDb().studyItems.get(item.id);
    expect(new Date(persisted!.fsrsState.due).getTime()).toBeGreaterThan(Date.now());
  });

  it('leaves a due sentence item alone once its vocabulary review is confirmed with nothing linked', async () => {
    // Reviewed and found nothing worth tracking (e.g. a very short
    // sentence) — genuinely nothing left to gate on.
    const item = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    await confirmVocabularyReview('sent-1');
    const result = await deferUnreadySentenceReviews(['comprehension']);
    expect(result).toEqual({ deferred: 0, checked: 1 });
    const persisted = await getDb().studyItems.get(item.id);
    expect(persisted?.fsrsState.due).toBe(item.fsrsState.due);
  });

  it('defers a due sentence item whose linked vocabulary is not yet proficient', async () => {
    const sentenceItem = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    await confirmVocabularyReview('sent-1');
    await ensureStudyItem('vocabularyItem', 'vocab-1', 'reading_retrieval'); // stays 'new'
    await linkVocabulary('sent-1', 'vocab-1');

    const now = new Date();
    const result = await deferUnreadySentenceReviews(['comprehension'], { now });
    expect(result).toEqual({ deferred: 1, checked: 1 });

    const persisted = await getDb().studyItems.get(sentenceItem.id);
    const deferredDue = new Date(persisted!.fsrsState.due);
    expect(deferredDue.getTime()).toBeGreaterThanOrEqual(
      now.getTime() + 7 * 24 * 60 * 60 * 1000,
    );
  });

  it('leaves a sentence item due once all its linked vocabulary is proficient', async () => {
    const sentenceItem = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    await confirmVocabularyReview('sent-1');
    const vocabItem = await ensureStudyItem('vocabularyItem', 'vocab-1', 'reading_retrieval');
    await getDb().studyItems.update(vocabItem.id, {
      fsrsState: { ...vocabItem.fsrsState, state: 'review' },
    });
    await linkVocabulary('sent-1', 'vocab-1');

    const result = await deferUnreadySentenceReviews(['comprehension']);
    expect(result).toEqual({ deferred: 0, checked: 1 });
    const persisted = await getDb().studyItems.get(sentenceItem.id);
    expect(persisted?.fsrsState.due).toBe(sentenceItem.fsrsState.due);
  });

  it('requires every linked vocabulary item to be proficient, not just one', async () => {
    const sentenceItem = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    await confirmVocabularyReview('sent-1');
    const proficientVocab = await ensureStudyItem(
      'vocabularyItem',
      'vocab-proficient',
      'reading_retrieval',
    );
    await getDb().studyItems.update(proficientVocab.id, {
      fsrsState: { ...proficientVocab.fsrsState, state: 'review' },
    });
    await ensureStudyItem('vocabularyItem', 'vocab-new', 'reading_retrieval'); // stays 'new'
    await linkVocabulary('sent-1', 'vocab-proficient');
    await linkVocabulary('sent-1', 'vocab-new');

    const result = await deferUnreadySentenceReviews(['comprehension']);
    expect(result).toEqual({ deferred: 1, checked: 1 });
    const persisted = await getDb().studyItems.get(sentenceItem.id);
    expect(new Date(persisted!.fsrsState.due).getTime()).toBeGreaterThan(Date.now());
  });

  it('ignores a sentence_vocabulary link with no surfaceForm (not a real review target)', async () => {
    const sentenceItem = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    await confirmVocabularyReview('sent-1');
    await ensureStudyItem('vocabularyItem', 'vocab-1', 'reading_retrieval'); // stays 'new'
    const now = nowIsoForTest();
    await getDb().sentenceVocabulary.add({
      id: createId('svoc'),
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-1',
      createdAt: now,
      updatedAt: now,
      // no surfaceForm
    });

    const result = await deferUnreadySentenceReviews(['comprehension']);
    expect(result).toEqual({ deferred: 0, checked: 1 });
    const persisted = await getDb().studyItems.get(sentenceItem.id);
    expect(persisted?.fsrsState.due).toBe(sentenceItem.fsrsState.due);
  });

  it('never pulls a due date earlier, only pushes an unready item further out', async () => {
    const item = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await getDb().studyItems.update(item.id, { fsrsState: { ...item.fsrsState, due: farFuture } });
    await ensureStudyItem('vocabularyItem', 'vocab-1', 'reading_retrieval'); // stays 'new'
    await linkVocabulary('sent-1', 'vocab-1');

    // Not due yet (30 days out), so deferUnreadySentenceReviews shouldn't touch it.
    const result = await deferUnreadySentenceReviews(['comprehension']);
    expect(result).toEqual({ deferred: 0, checked: 0 });
    const persisted = await getDb().studyItems.get(item.id);
    expect(persisted?.fsrsState.due).toBe(farFuture);
  });
});

function selection(
  overrides: Partial<VocabularySelection> &
    Pick<VocabularySelection, 'surface' | 'start' | 'end' | 'expression'>,
): VocabularySelection {
  return {
    id: createId('vsel'),
    reading: '',
    source: 'manual',
    ...overrides,
  };
}

describe('vocabulary/kanji materialization (Phase 5)', () => {
  beforeEach(() => {
    resetDbForTests(`data-vocab-${createId('db')}`);
  });

  it('ensureVocabularyItem creates a new item and dedups on (expression, reading)', async () => {
    const first = await ensureVocabularyItem('大学', 'だいがく', { meaning: 'university' });
    const second = await ensureVocabularyItem('大学', 'だいがく', { meaning: 'ignored' });
    expect(second.id).toBe(first.id);
    expect(second.meaning).toBe('university');
    expect(await getDb().vocabularyItems.count()).toBe(1);
  });

  it('treats homophones (same expression, different reading) as distinct items', async () => {
    const shukan = await ensureVocabularyItem('週間', 'しゅうかん');
    const shuukan = await ensureVocabularyItem('習慣', 'しゅうかん');
    expect(shukan.id).not.toBe(shuukan.id);
    expect(await getDb().vocabularyItems.count()).toBe(2);
  });

  it('creates kanji rows and vocabulary_kanji links at the correct positions', async () => {
    const item = await ensureVocabularyItem('大学', 'だいがく');
    const links = await getDb()
      .vocabularyKanji.where('vocabularyItemId')
      .equals(item.id)
      .toArray();
    expect(links).toHaveLength(2);
    const byPosition = new Map(links.map((link) => [link.positionInWord, link]));
    const dai = await getDb().kanji.get(byPosition.get(0)!.kanjiId);
    const gaku = await getDb().kanji.get(byPosition.get(1)!.kanjiId);
    expect(dai?.character).toBe('大');
    expect(gaku?.character).toBe('学');
  });

  it('reuses an existing kanji row across vocabulary items instead of duplicating it', async () => {
    await ensureVocabularyItem('大学', 'だいがく');
    await ensureVocabularyItem('大きい', 'おおきい');
    expect(await getDb().kanji.count()).toBe(2); // 大, 学
  });

  it('links a repeated kanji at each of its true positions in the word', async () => {
    const item = await ensureVocabularyItem('民主主義', 'みんしゅしゅぎ');
    const links = await getDb()
      .vocabularyKanji.where('vocabularyItemId')
      .equals(item.id)
      .toArray();
    expect(links.map((link) => link.positionInWord).sort()).toEqual([0, 1, 2, 3]);
    const shu = await getDb().kanji.where('character').equals('主').first();
    const shuLinks = links.filter((link) => link.kanjiId === shu?.id);
    expect(shuLinks.map((link) => link.positionInWord).sort()).toEqual([1, 2]);
  });

  it('handles astral-plane kanji (surrogate pairs) as a single character', async () => {
    const item = await ensureVocabularyItem('𠮟る', 'しかる');
    const links = await getDb()
      .vocabularyKanji.where('vocabularyItemId')
      .equals(item.id)
      .toArray();
    expect(links).toHaveLength(1);
    const kanji = await getDb().kanji.get(links[0]!.kanjiId);
    expect(kanji?.character).toBe('𠮟');
  });

  it('ensureKanji is idempotent by character', async () => {
    const first = await ensureKanji('水');
    const second = await ensureKanji('水');
    expect(second.id).toBe(first.id);
    expect(await getDb().kanji.count()).toBe(1);
  });

  it('materializeVocabularySelections links confirmed selections to the sentence', async () => {
    await materializeVocabularySelections('sent-1', [
      selection({ surface: '大学', start: 0, end: 2, expression: '大学', reading: 'だいがく' }),
    ]);
    const links = await getDb()
      .sentenceVocabulary.where('sentenceId')
      .equals('sent-1')
      .toArray();
    expect(links).toHaveLength(1);
    const item = await getDb().vocabularyItems.get(links[0]!.vocabularyItemId);
    expect(item?.expression).toBe('大学');
  });

  it('materializeVocabularySelections captures the surface span onto the link (Phase 7.2)', async () => {
    await materializeVocabularySelections('sent-1', [
      selection({
        surface: '表れていた',
        start: 5,
        end: 10,
        expression: '表れる',
        reading: 'あらわれる',
      }),
    ]);
    const links = await getDb()
      .sentenceVocabulary.where('sentenceId')
      .equals('sent-1')
      .toArray();
    expect(links[0]?.surfaceForm).toBe('表れていた');
  });

  it('re-confirming removes stale links but keeps the underlying vocabulary item', async () => {
    await materializeVocabularySelections('sent-1', [
      selection({ surface: '大学', start: 0, end: 2, expression: '大学', reading: 'だいがく' }),
    ]);
    await materializeVocabularySelections('sent-1', []);

    const links = await getDb()
      .sentenceVocabulary.where('sentenceId')
      .equals('sent-1')
      .toArray();
    expect(links).toHaveLength(0);
    expect(await getDb().vocabularyItems.count()).toBe(1);
  });

  it('collapses duplicate selections resolving to the same item into one link', async () => {
    await materializeVocabularySelections('sent-1', [
      selection({ surface: '大学', start: 0, end: 2, expression: '大学', reading: 'だいがく' }),
      selection({ surface: '大学', start: 3, end: 5, expression: '大学', reading: 'だいがく' }),
    ]);
    const links = await getDb()
      .sentenceVocabulary.where('sentenceId')
      .equals('sent-1')
      .toArray();
    expect(links).toHaveLength(1);
  });

  it('enqueues sync metadata for all four vocabulary/kanji tables', async () => {
    await materializeVocabularySelections('sent-1', [
      selection({ surface: '大学', start: 0, end: 2, expression: '大学', reading: 'だいがく' }),
    ]);

    await vi.waitFor(async () => {
      expect(await getDb().syncRecordMeta.count()).toBeGreaterThan(0);
    });
    const keys = (await getDb().syncRecordMeta.toArray()).map((row) => row.entity);
    expect(keys).toContain('vocabulary_items');
    expect(keys).toContain('sentence_vocabulary');
    expect(keys).toContain('kanji');
    expect(keys).toContain('vocabulary_kanji');
  });
});

function stubSentence(id: string, overrides: Partial<Sentence> = {}): Sentence {
  const now = new Date().toISOString();
  return {
    id,
    normalizedKey: id,
    japanese: `${id}-japanese`,
    readingOnly: '',
    inlineReading: '',
    translation: '',
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('evidence-model foundation (Phase 7.1)', () => {
  beforeEach(() => {
    resetDbForTests(`data-evidence-${createId('db')}`);
  });

  it('ensureVocabularyStudyItem creates a vocabularyItem-subject study item, distinct from a sentence one', async () => {
    const vocabItem = await ensureVocabularyItem('表す', 'あらわす');
    const wordLevel = await ensureVocabularyStudyItem(vocabItem.id, 'reading');
    expect(wordLevel.subjectType).toBe('vocabularyItem');
    expect(wordLevel.subjectId).toBe(vocabItem.id);

    const sentenceLevel = await ensureStudyItem('sentence', 'sent-1', 'reading');
    expect(sentenceLevel.id).not.toBe(wordLevel.id);
  });

  it('ensureVocabularyStudyItem is idempotent for the same vocabulary item/activity pair', async () => {
    const vocabItem = await ensureVocabularyItem('表す', 'あらわす');
    const first = await ensureVocabularyStudyItem(vocabItem.id, 'reading');
    const second = await ensureVocabularyStudyItem(vocabItem.id, 'reading');
    expect(second.id).toBe(first.id);
  });

  it('pickContextSentenceForVocabularyItem returns the most recently linked sentence and its surfaceForm', async () => {
    const vocabItem = await ensureVocabularyItem('表す', 'あらわす');
    await getDb().sentences.bulkPut([stubSentence('sent-old'), stubSentence('sent-new')]);
    await getDb().sentenceVocabulary.bulkPut([
      {
        id: 'link-old',
        sentenceId: 'sent-old',
        vocabularyItemId: vocabItem.id,
        surfaceForm: '表した',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'link-new',
        sentenceId: 'sent-new',
        vocabularyItemId: vocabItem.id,
        surfaceForm: '表します',
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z',
      },
    ]);

    const picked = await pickContextSentenceForVocabularyItem(vocabItem.id);
    expect(picked?.sentence.id).toBe('sent-new');
    expect(picked?.surfaceForm).toBe('表します');
  });

  it('pickContextSentenceForVocabularyItem returns undefined with no links', async () => {
    const vocabItem = await ensureVocabularyItem('表す', 'あらわす');
    expect(await pickContextSentenceForVocabularyItem(vocabItem.id)).toBeUndefined();
  });

  it('ensureVocabularyConfusion creates a canonicalized, deduped pair', async () => {
    const arawasu = await ensureVocabularyItem('表す', 'あらわす');
    const arawareru = await ensureVocabularyItem('表れる', 'あらわれる');

    const forward = await ensureVocabularyConfusion(
      arawasu.id,
      arawareru.id,
      'transitivity',
    );
    const backward = await ensureVocabularyConfusion(
      arawareru.id,
      arawasu.id,
      'transitivity',
    );

    expect(backward.id).toBe(forward.id);
    expect(await getDb().vocabularyConfusions.count()).toBe(1);
    // Canonicalized regardless of call order.
    const [expectedA, expectedB] =
      arawasu.id < arawareru.id ? [arawasu.id, arawareru.id] : [arawareru.id, arawasu.id];
    expect(forward.itemAId).toBe(expectedA);
    expect(forward.itemBId).toBe(expectedB);
  });

  it('recordConfusionObservation increments the count and bumps lastObservedAt', async () => {
    const a = await ensureVocabularyItem('開く', 'あく');
    const b = await ensureVocabularyItem('開ける', 'あける');

    const first = await recordConfusionObservation(a.id, b.id, 'transitivity');
    expect(first.observedCount).toBe(1);

    const second = await recordConfusionObservation(b.id, a.id, 'transitivity');
    expect(second.id).toBe(first.id);
    expect(second.observedCount).toBe(2);
    expect(await getDb().vocabularyConfusions.count()).toBe(1);
  });

  it('recordConfusionObservation enqueues sync metadata', async () => {
    const a = await ensureVocabularyItem('開く', 'あく');
    const b = await ensureVocabularyItem('開ける', 'あける');
    await recordConfusionObservation(a.id, b.id, 'transitivity');

    await vi.waitFor(async () => {
      const keys = (await getDb().syncRecordMeta.toArray()).map((row) => row.entity);
      expect(keys).toContain('vocabulary_confusions');
    });
  });

  it('getVocabularyTargetCandidates only returns links with a surfaceForm', async () => {
    await getDb().sentences.add(stubSentence('sent-1'));
    await materializeVocabularySelections('sent-1', [
      selection({ surface: '大学', start: 0, end: 2, expression: '大学', reading: 'だいがく' }),
    ]);
    // No surfaceForm — e.g. an Anki-imported link, created directly, not via the picker.
    const noSurface = await ensureVocabularyItem('猫', 'ねこ');
    await getDb().sentences.add(stubSentence('sent-2'));
    await getDb().sentenceVocabulary.add({
      id: 'link-no-surface',
      sentenceId: 'sent-2',
      vocabularyItemId: noSurface.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const candidates = await getVocabularyTargetCandidates(['sent-1', 'sent-2']);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.vocabularyItem.expression).toBe('大学');
    expect(candidates[0]?.surfaceForm).toBe('大学');
  });

  it('getVocabularyTargetCandidates returns one candidate per vocabulary item, not per sentence', async () => {
    await getDb().sentences.bulkAdd([stubSentence('sent-1'), stubSentence('sent-2')]);
    await materializeVocabularySelections('sent-1', [
      selection({ surface: '大学', start: 0, end: 2, expression: '大学', reading: 'だいがく' }),
    ]);
    await materializeVocabularySelections('sent-2', [
      selection({ surface: '大学に', start: 0, end: 3, expression: '大学', reading: 'だいがく' }),
    ]);

    const candidates = await getVocabularyTargetCandidates(['sent-1', 'sent-2']);
    expect(candidates).toHaveLength(1);
  });

  it('getVocabularyTargetCandidates returns an empty array for no sentence ids', async () => {
    expect(await getVocabularyTargetCandidates([])).toEqual([]);
  });

  it('recordNaturalEncounter creates the word\'s reading_retrieval study item and tags the review source/context (Phase 7.8)', async () => {
    const vocabItem = await ensureVocabularyItem('表す', 'あらわす');
    await getDb().sentences.add(stubSentence('sent-natural'));

    const { review, studyItem } = await recordNaturalEncounter({
      vocabularyItemId: vocabItem.id,
      sentenceId: 'sent-natural',
      rating: 'good',
    });

    expect(studyItem.subjectType).toBe('vocabularyItem');
    expect(studyItem.subjectId).toBe(vocabItem.id);
    expect(studyItem.activityType).toBe('reading_retrieval');
    expect(review.source).toBe('natural_encounter');
    expect(review.contextSentenceId).toBe('sent-natural');
    expect(review.rating).toBe('good');
  });

  it('recordNaturalEncounter reuses an existing reading_retrieval study item rather than creating a second one', async () => {
    const vocabItem = await ensureVocabularyItem('表す', 'あらわす');
    const formal = await ensureVocabularyStudyItem(vocabItem.id, 'reading_retrieval');
    await getDb().sentences.add(stubSentence('sent-natural'));

    const { studyItem } = await recordNaturalEncounter({
      vocabularyItemId: vocabItem.id,
      sentenceId: 'sent-natural',
      rating: 'easy',
    });

    expect(studyItem.id).toBe(formal.id);
    expect(
      await getDb().studyItems.where('subjectId').equals(vocabItem.id).count(),
    ).toBe(1);
  });

  it('recordReview leaves source/contextSentenceId undefined for an ordinary scheduled review', async () => {
    const item = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    const { review } = await recordReview({ studyItemId: item.id, rating: 'good' });
    expect(review.source).toBeUndefined();
    expect(review.contextSentenceId).toBeUndefined();
  });
});

describe('card issue reports', () => {
  beforeEach(() => {
    resetDbForTests(`data-issues-${createId('db')}`);
  });

  it('reportCardIssue creates an open report referencing the study item and sentence', async () => {
    const studyItem = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    const report = await reportCardIssue({
      studyItemId: studyItem.id,
      sentenceId: 'sent-1',
      activityType: 'comprehension',
      note: 'Translation looks wrong.',
    });

    expect(report.status).toBe('open');
    expect(report.studyItemId).toBe(studyItem.id);
    expect(report.sentenceId).toBe('sent-1');
    expect(await getDb().cardIssueReports.get(report.id)).toBeTruthy();
  });

  it('listCardIssueReports filters by status and sorts newest first', async () => {
    const studyItem = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    const first = await reportCardIssue({
      studyItemId: studyItem.id,
      activityType: 'comprehension',
      note: 'First.',
    });
    const second = await reportCardIssue({
      studyItemId: studyItem.id,
      activityType: 'comprehension',
      note: 'Second.',
    });
    await resolveCardIssueReport(first.id);

    const open = await listCardIssueReports('open');
    expect(open.map((item) => item.id)).toEqual([second.id]);

    const all = await listCardIssueReports();
    expect(all.map((item) => item.id)).toEqual([second.id, first.id]);
  });

  it('resolveCardIssueReport marks the report resolved with a timestamp', async () => {
    const studyItem = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    const report = await reportCardIssue({
      studyItemId: studyItem.id,
      activityType: 'comprehension',
      note: 'Something is off.',
    });

    const resolved = await resolveCardIssueReport(report.id);
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedAt).toBeTruthy();
  });

  it('listCardIssueReportsWithContext attaches the sentence shown at report time', async () => {
    const studyItem = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    await getDb().sentences.add(stubSentence('sent-1', { japanese: '猫が好きです。' }));
    await reportCardIssue({
      studyItemId: studyItem.id,
      sentenceId: 'sent-1',
      activityType: 'comprehension',
      note: 'Reading missing.',
    });

    const [withContext] = await listCardIssueReportsWithContext();
    expect(withContext?.sentence?.japanese).toBe('猫が好きです。');
  });
});

describe('computeVocabularyContextDiversity (Phase 7.5)', () => {
  beforeEach(() => {
    resetDbForTests(`data-diversity-${createId('db')}`);
  });

  it('returns zero counts for a vocabulary item with no sentence links', async () => {
    const item = await ensureVocabularyItem('読む', 'よむ');
    expect(await computeVocabularyContextDiversity(item.id)).toEqual({
      distinctSentenceCount: 0,
      distinctSourceCount: 0,
    });
  });

  it('counts one sentence/one source for a single book, single sentence link', async () => {
    const item = await ensureVocabularyItem('読む', 'よむ');
    const book = await createBook({ title: 'Book A' });
    await getDb().sentenceVocabulary.add({
      id: 'sv-1',
      sentenceId: 'sent-1',
      vocabularyItemId: item.id,
      createdAt: nowIsoForTest(),
      updatedAt: nowIsoForTest(),
    });
    await getDb().bookSentences.add({
      id: 'bs-1',
      bookId: book.id,
      sentenceId: 'sent-1',
      position: 0,
      status: 'unstarted',
      addedAt: nowIsoForTest(),
    });

    expect(await computeVocabularyContextDiversity(item.id)).toEqual({
      distinctSentenceCount: 1,
      distinctSourceCount: 1,
    });
  });

  it('counts two distinct sources when the same word occurs in sentences from two different books', async () => {
    const item = await ensureVocabularyItem('読む', 'よむ');
    const bookA = await createBook({ title: 'Book A' });
    const bookB = await createBook({ title: 'Book B' });
    await getDb().sentenceVocabulary.bulkAdd([
      {
        id: 'sv-1',
        sentenceId: 'sent-1',
        vocabularyItemId: item.id,
        createdAt: nowIsoForTest(),
        updatedAt: nowIsoForTest(),
      },
      {
        id: 'sv-2',
        sentenceId: 'sent-2',
        vocabularyItemId: item.id,
        createdAt: nowIsoForTest(),
        updatedAt: nowIsoForTest(),
      },
    ]);
    await getDb().bookSentences.bulkAdd([
      {
        id: 'bs-1',
        bookId: bookA.id,
        sentenceId: 'sent-1',
        position: 0,
        status: 'unstarted',
        addedAt: nowIsoForTest(),
      },
      {
        id: 'bs-2',
        bookId: bookB.id,
        sentenceId: 'sent-2',
        position: 0,
        status: 'unstarted',
        addedAt: nowIsoForTest(),
      },
    ]);

    expect(await computeVocabularyContextDiversity(item.id)).toEqual({
      distinctSentenceCount: 2,
      distinctSourceCount: 2,
    });
  });
});

describe('getStudyItemDebugInfo (Phase 7.10)', () => {
  beforeEach(() => {
    resetDbForTests(`data-debug-${createId('db')}`);
  });

  it('returns undefined for an unknown study item id', async () => {
    expect(await getStudyItemDebugInfo('missing-id')).toBeUndefined();
  });

  it('returns a sentence subject with its reviews, most-recent-first, and no maturity block', async () => {
    const studyItem = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    await getDb().sentences.add(stubSentence('sent-1'));
    await recordReview({ studyItemId: studyItem.id, rating: 'good' });
    await recordReview({ studyItemId: studyItem.id, rating: 'again' });

    const info = await getStudyItemDebugInfo(studyItem.id);
    expect(info?.subject).toEqual({ kind: 'sentence', sentence: expect.objectContaining({ id: 'sent-1' }) });
    expect(info?.reviews).toHaveLength(2);
    expect(info?.reviews[0]?.rating).toBe('again');
    expect(info?.reviews[1]?.rating).toBe('good');
  });

  it('returns a vocabularyItem subject with its computed maturity level', async () => {
    const vocabItem = await ensureVocabularyItem('表す', 'あらわす');
    const studyItem = await ensureVocabularyStudyItem(vocabItem.id, 'reading_retrieval');

    const info = await getStudyItemDebugInfo(studyItem.id);
    expect(info?.subject.kind).toBe('vocabularyItem');
    if (info?.subject.kind === 'vocabularyItem') {
      expect(info.subject.vocabularyItem.id).toBe(vocabItem.id);
      // No sentence links at all -> zero diversity -> fragile.
      expect(info.subject.maturity.level).toBe('fragile');
      expect(info.subject.maturity.diversity).toEqual({
        distinctSentenceCount: 0,
        distinctSourceCount: 0,
      });
    }
  });

  it('resolves each review\'s contextSentenceId to a Sentence, keyed for lookup', async () => {
    const vocabItem = await ensureVocabularyItem('表す', 'あらわす');
    const studyItem = await ensureVocabularyStudyItem(vocabItem.id, 'reading_retrieval');
    await getDb().sentences.add(stubSentence('sent-context'));
    await recordReview({
      studyItemId: studyItem.id,
      rating: 'good',
      source: 'natural_encounter',
      contextSentenceId: 'sent-context',
    });

    const info = await getStudyItemDebugInfo(studyItem.id);
    expect(info?.reviews[0]?.source).toBe('natural_encounter');
    expect(info?.reviews[0]?.contextSentenceId).toBe('sent-context');
    expect(info?.contextSentencesById.get('sent-context')?.id).toBe('sent-context');
  });

  it('returns a vocabularyConfusion subject with both member vocabulary items', async () => {
    const itemA = await ensureVocabularyItem('開く', 'あく');
    const itemB = await ensureVocabularyItem('開ける', 'あける');
    const confusion = await ensureVocabularyConfusion(itemA.id, itemB.id, 'transitivity');
    const studyItem = await ensureStudyItem('vocabularyConfusion', confusion.id, 'contrastive');

    const info = await getStudyItemDebugInfo(studyItem.id);
    expect(info?.subject.kind).toBe('vocabularyConfusion');
    if (info?.subject.kind === 'vocabularyConfusion') {
      expect(info.subject.confusion.id).toBe(confusion.id);
      expect([info.subject.itemA.id, info.subject.itemB.id].sort()).toEqual(
        [itemA.id, itemB.id].sort(),
      );
    }
  });
});

function nowIsoForTest(): string {
  return new Date().toISOString();
}
