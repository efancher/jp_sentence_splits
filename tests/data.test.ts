import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addSentencesToBook,
  assignBookSentencesToChapter,
  commitImport,
  confirmSentenceVocabulary,
  createBook,
  createBookChapter,
  deferUnreadyGrammarReviews,
  deferUnreadySentenceReviews,
  getProficientVocabularyItemIds,
  getSentenceListeningReadiness,
  deleteAttempt,
  deleteBookChapter,
  computeGrammarPatternContextDiversity,
  ensureGrammarPattern,
  ensureGrammarRelationship,
  ensureGrammarStudyItem,
  ensureKanji,
  ensureSentenceGrammar,
  ensureStudyItem,
  removeSentenceGrammar,
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
  getReferencePitchTrack,
  saveReferencePitchTrack,
  listAttemptAnalysisSummariesForSentence,
  listGrammarPatternSummaries,
  listGrammarRelationshipsForPattern,
  listSentenceGrammarForPattern,
  getVocabularyTargetCandidates,
  listAttemptsForSentence,
  listCardIssueReports,
  listCardIssueReportsWithContext,
  materializeVocabularySelections,
  moveBookSentence,
  getStudyItemDebugInfo,
  pickContextSentenceForGrammarPattern,
  pickContextSentenceForVocabularyItem,
  rateAttempt,
  recordConfusionObservation,
  recordGrammarNaturalEncounter,
  recordGrammarRelationshipObservation,
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
  recutSentenceAudioFromSource,
  saveReferenceAlignment,
  setAttemptFavorite,
  setBookSentenceStatus,
  setSentenceVocabularyAudioRange,
  setSentenceGrammarReviewStatus,
  transferBookSentences,
  updateBookChapter,
  updateGrammarPattern,
} from '../src/db/repository';
import type {
  AlignmentResult,
  Sentence,
  StudyActivityType,
  VocabularySelection,
} from '../src/domain/types';
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

describe('manual word-audio range (setSentenceVocabularyAudioRange)', () => {
  beforeEach(() => {
    resetDbForTests(`data-word-range-${createId('db')}`);
  });

  async function seedLink(): Promise<string> {
    await materializeVocabularySelections('wr-sent-1', [
      {
        id: 'wr-vsel-1',
        surface: '大学',
        start: 0,
        end: 2,
        expression: '大学',
        reading: 'だいがく',
        source: 'manual',
      },
    ]);
    const link = await getDb()
      .sentenceVocabulary.where('sentenceId')
      .equals('wr-sent-1')
      .first();
    return link!.id;
  }

  it('stores a rounded span on the link', async () => {
    const linkId = await seedLink();
    await setSentenceVocabularyAudioRange(linkId, { startMs: 1200.6, endMs: 1849.2 });

    const link = await getDb().sentenceVocabulary.get(linkId);
    expect(link?.audioStartMs).toBe(1201);
    expect(link?.audioEndMs).toBe(1849);
  });

  it('null clears the override back to the alignment guess', async () => {
    const linkId = await seedLink();
    await setSentenceVocabularyAudioRange(linkId, { startMs: 1000, endMs: 1500 });
    await setSentenceVocabularyAudioRange(linkId, null);

    const link = await getDb().sentenceVocabulary.get(linkId);
    expect(link?.audioStartMs).toBeUndefined();
    expect(link?.audioEndMs).toBeUndefined();
  });

  it('is a no-op for an unknown link', async () => {
    await expect(
      setSentenceVocabularyAudioRange('nope', { startMs: 0, endMs: 100 }),
    ).resolves.toBeUndefined();
  });
});

describe('recutSentenceAudioFromSource', () => {
  beforeEach(() => {
    resetDbForTests(`data-recut-${createId('db')}`);
  });

  async function seedAudio(withSourceUrl = true) {
    const db = getDb();
    await db.sentenceAudio.put({
      id: 'ra-1',
      sentenceId: 'rc-sent-1',
      sourceId: 'src-1',
      sourceSentenceId: 'src-1:0',
      sourceTitle: 'Vid',
      sourceUrl: withSourceUrl ? 'https://youtu.be/VID' : undefined,
      mimeType: 'audio/mp4',
      durationMs: 1200,
      startMs: 6000,
      endMs: 7200,
      blob: new Blob(['old'], { type: 'audio/mp4' }),
      importedAt: new Date().toISOString(),
    });
  }

  it('re-cuts the clip from the source and updates only that audio row', async () => {
    await seedAudio();
    const clipFromSource = vi.fn(async (_url: string, cuts: { startMs: number; endMs: number }[]) => [
      { blob: new Blob(['recut'], { type: 'audio/mp4' }), durationMs: cuts[0]!.endMs - cuts[0]!.startMs },
    ]);

    const result = await recutSentenceAudioFromSource(
      'ra-1',
      { startMs: 5800.4, endMs: 7000.9 },
      { clipFromSource },
    );

    expect(clipFromSource).toHaveBeenCalledWith('https://youtu.be/VID', [
      { startMs: 5800, endMs: 7001 },
    ]);
    expect(result.durationMs).toBe(1201);
    const row = await getDb().sentenceAudio.get('ra-1');
    expect(row?.startMs).toBe(5800);
    expect(row?.endMs).toBe(7001);
    expect(row?.durationMs).toBe(1201);
    expect(row?.blob).toBeDefined();
    expect(row?.importedAt).not.toBe('');
  });

  it('rejects an empty span, a missing row, and a source with no URL', async () => {
    await seedAudio(false);
    const clipFromSource = vi.fn();
    await expect(
      recutSentenceAudioFromSource('ra-1', { startMs: 100, endMs: 100 }, { clipFromSource }),
    ).rejects.toThrow(/greater than/);
    await expect(
      recutSentenceAudioFromSource('nope', { startMs: 0, endMs: 100 }, { clipFromSource }),
    ).rejects.toThrow(/no longer exists/);
    await expect(
      recutSentenceAudioFromSource('ra-1', { startMs: 0, endMs: 100 }, { clipFromSource }),
    ).rejects.toThrow(/No source URL/);
    expect(clipFromSource).not.toHaveBeenCalled();
  });
});

describe('cached reference pitch track (native-clip pitch overlay)', () => {
  beforeEach(() => {
    resetDbForTests(`data-pitch-track-${createId('db')}`);
  });

  const payload = {
    frames: [
      { timeSeconds: 0, hz: 120, voiced: true, confidence: 0.8, relativeSemitones: 0 },
      { timeSeconds: 0.02, hz: 140, voiced: true, confidence: 0.8, relativeSemitones: 2.7 },
    ],
    medianHz: 130,
    voicedRatio: 1,
    durationSeconds: 0.04,
  };

  it('round-trips a reference pitch track', async () => {
    expect(await getReferencePitchTrack('audio-1')).toBeUndefined();
    await saveReferencePitchTrack('audio-1', payload);
    expect(await getReferencePitchTrack('audio-1')).toEqual(payload);
  });

  it('treats a stale pitchVersion as a cache miss', async () => {
    await saveReferencePitchTrack('audio-1', payload);
    await getDb().referencePitchTracks.update('audio-1', { pitchVersion: 0 });

    expect(await getReferencePitchTrack('audio-1')).toBeUndefined();
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

describe('deferUnreadyGrammarReviews (grammar context gating)', () => {
  beforeEach(() => {
    resetDbForTests(`data-defer-grammar-${createId('db')}`);
  });

  async function dueGrammarItem(patternId: string, activityType: StudyActivityType) {
    const item = await ensureGrammarStudyItem(patternId, activityType);
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await getDb().studyItems.update(item.id, { fsrsState: { ...item.fsrsState, due: past } });
    return (await getDb().studyItems.get(item.id))!;
  }

  it('defers a due grammar item whose pattern has no linked sentence at all', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    const item = await dueGrammarItem(pattern.id, 'grammar_comprehension');

    const now = new Date();
    const result = await deferUnreadyGrammarReviews({ now });
    expect(result).toEqual({ deferred: 1, checked: 1 });
    const persisted = await getDb().studyItems.get(item.id);
    expect(new Date(persisted!.fsrsState.due).getTime()).toBeGreaterThanOrEqual(
      now.getTime() + 7 * 24 * 60 * 60 * 1000,
    );
  });

  it("defers a due grammar item whose only linked sentence isn't full-review-ready", async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    await getDb().sentences.put(stubSentence('sent-1'));
    await ensureSentenceGrammar('sent-1', pattern.id, {});
    // No analyses row → sentence vocab unreviewed → not ready.
    const item = await dueGrammarItem(pattern.id, 'grammar_completion');

    const result = await deferUnreadyGrammarReviews();
    expect(result).toEqual({ deferred: 1, checked: 1 });
    const persisted = await getDb().studyItems.get(item.id);
    expect(new Date(persisted!.fsrsState.due).getTime()).toBeGreaterThan(Date.now());
  });

  it('leaves a due grammar item alone once a linked sentence is full-review-ready', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    await getDb().sentences.put(stubSentence('sent-1'));
    await ensureSentenceGrammar('sent-1', pattern.id, {});
    await confirmSentenceVocabulary('sent-1', []);
    const item = await dueGrammarItem(pattern.id, 'grammar_comprehension');

    const result = await deferUnreadyGrammarReviews();
    expect(result).toEqual({ deferred: 0, checked: 1 });
    const persisted = await getDb().studyItems.get(item.id);
    expect(persisted?.fsrsState.due).toBe(item.fsrsState.due);
  });

  it('never pulls a due date earlier — a not-yet-due unready grammar item is untouched', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    const item = await ensureGrammarStudyItem(pattern.id, 'grammar_comprehension');
    const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await getDb().studyItems.update(item.id, {
      fsrsState: { ...item.fsrsState, due: farFuture },
    });

    const result = await deferUnreadyGrammarReviews();
    expect(result).toEqual({ deferred: 0, checked: 0 });
    const persisted = await getDb().studyItems.get(item.id);
    expect(persisted?.fsrsState.due).toBe(farFuture);
  });
});

describe('setSentenceGrammarReviewStatus', () => {
  beforeEach(() => {
    resetDbForTests(`data-grammar-review-status-${createId('db')}`);
  });

  it('flips grammarReviewStatus on the analysis, creating one if absent, and toggles back', async () => {
    let analysis = await setSentenceGrammarReviewStatus('sent-1', 'confirmed');
    expect(analysis.grammarReviewStatus).toBe('confirmed');
    expect((await getDb().analyses.get('sent-1'))?.grammarReviewStatus).toBe('confirmed');

    analysis = await setSentenceGrammarReviewStatus('sent-1', 'unreviewed');
    expect(analysis.grammarReviewStatus).toBe('unreviewed');
  });

  it('leaves structural chunks and vocabulary state untouched', async () => {
    await saveAnalysis(
      'sent-1',
      [{ id: 'c1', order: 0, japanese: '猫が', role: 'actor', literalEnglish: 'cat' }],
      'a note',
      { reviewStatus: 'confirmed', selections: [] },
    );
    const analysis = await setSentenceGrammarReviewStatus('sent-1', 'confirmed');
    expect(analysis.chunks).toHaveLength(1);
    expect(analysis.notes).toBe('a note');
    expect(analysis.status).toBe('complete');
    expect(analysis.vocabularyReviewStatus).toBe('confirmed');
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
    // Force distinct, well-separated createdAt values: both reports can
    // land in the same millisecond under a fast/loaded test run, and
    // Dexie/IndexedDB doesn't guarantee insertion order for a plain
    // toArray() scan — sorting on createdAt alone would then be flaky
    // (same class of bug fixed for listSentenceGrammarForPattern's own
    // test, see the grammar patterns describe block above).
    await getDb().cardIssueReports.update(first.id, {
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await getDb().cardIssueReports.update(second.id, {
      createdAt: '2026-02-01T00:00:00.000Z',
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

describe('grammar patterns (grammar-learning system, Phase 1 foundation)', () => {
  beforeEach(() => {
    resetDbForTests(`data-grammar-${createId('db')}`);
  });

  it('ensureGrammarPattern creates a new pattern and dedups on normalizedKey', async () => {
    const first = await ensureGrammarPattern('〜わけがない', {
      shortMeaning: "there's no way...",
    });
    const second = await ensureGrammarPattern('わけがない', { shortMeaning: 'ignored' });
    expect(second.id).toBe(first.id);
    expect(second.shortMeaning).toBe("there's no way...");
    expect(await getDb().grammarPatterns.count()).toBe(1);
  });

  it('treats distinct patterns (different normalizedKey) as separate rows', async () => {
    const wakega = await ensureGrammarPattern('〜わけがない');
    const hazuga = await ensureGrammarPattern('〜はずがない');
    expect(wakega.id).not.toBe(hazuga.id);
    expect(await getDb().grammarPatterns.count()).toBe(2);
  });

  it('updateGrammarPattern patches fields without touching others', async () => {
    const pattern = await ensureGrammarPattern('〜てしまう', { family: 'aspect' });
    const updated = await updateGrammarPattern(pattern.id, {
      explanation: 'completion, often with a regret/unwanted-result nuance',
    });
    expect(updated.explanation).toBe(
      'completion, often with a regret/unwanted-result nuance',
    );
    expect(updated.family).toBe('aspect');
  });

  it('ensureSentenceGrammar creates an occurrence link', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    const link = await ensureSentenceGrammar('sent-1', pattern.id, {
      surfaceForm: 'わけないでしょ',
      confirmedByLearner: true,
      source: 'manual',
    });
    expect(link.sentenceId).toBe('sent-1');
    expect(link.grammarPatternId).toBe(pattern.id);
    expect(link.confirmedByLearner).toBe(true);
    expect(await getDb().sentenceGrammar.count()).toBe(1);
  });

  it('ensureSentenceGrammar is get-or-create per (sentenceId, grammarPatternId), merging new fields in', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    const first = await ensureSentenceGrammar('sent-1', pattern.id, {
      source: 'ai_suggested',
    });
    const second = await ensureSentenceGrammar('sent-1', pattern.id, {
      confirmedByLearner: true,
    });
    expect(second.id).toBe(first.id);
    expect(second.confirmedByLearner).toBe(true);
    expect(second.source).toBe('ai_suggested');
    expect(await getDb().sentenceGrammar.count()).toBe(1);
  });

  it('ensureSentenceGrammar never un-confirms an already-confirmed occurrence', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    await ensureSentenceGrammar('sent-1', pattern.id, { confirmedByLearner: true });
    const second = await ensureSentenceGrammar('sent-1', pattern.id, {});
    expect(second.confirmedByLearner).toBe(true);
  });

  it('removeSentenceGrammar unlinks the occurrence but keeps the canonical pattern', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    const link = await ensureSentenceGrammar('sent-1', pattern.id, {
      confirmedByLearner: true,
    });
    await removeSentenceGrammar(link.id);
    expect(await getDb().sentenceGrammar.get(link.id)).toBeUndefined();
    expect(await getDb().grammarPatterns.get(pattern.id)).toBeTruthy();
  });

  it('removeSentenceGrammar is a no-op for an id that does not exist', async () => {
    await expect(removeSentenceGrammar('missing-id')).resolves.toBeUndefined();
  });

  it('listSentenceGrammarForPattern returns an empty array with no encounters', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    expect(await listSentenceGrammarForPattern(pattern.id)).toEqual([]);
  });

  it('listSentenceGrammarForPattern returns encounters newest first with book/audio context', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    await getDb().sentences.bulkPut([stubSentence('sent-old'), stubSentence('sent-new')]);
    const book = await createBook({ title: 'Book A' });
    await getDb().bookSentences.add({
      id: 'bs-1',
      bookId: book.id,
      sentenceId: 'sent-new',
      position: 0,
      status: 'unstarted',
      addedAt: nowIsoForTest(),
    });
    await getDb().sentenceAudio.add({
      id: 'audio-1',
      sentenceId: 'sent-new',
      sourceId: 'src-1',
      sourceSentenceId: 'src-sent-1',
      sourceTitle: 'Source',
      mimeType: 'audio/mp3',
      durationMs: 1000,
      startMs: 0,
      endMs: 1000,
      blob: new Blob(['fake audio'], { type: 'audio/mp3' }),
      importedAt: nowIsoForTest(),
    });
    const oldLink = await ensureSentenceGrammar('sent-old', pattern.id, {
      confirmedByLearner: true,
    });
    const newLink = await ensureSentenceGrammar('sent-new', pattern.id, {
      confirmedByLearner: true,
    });
    // Force distinct, well-separated createdAt values: both links can land
    // in the same millisecond in a fast in-memory test run, and Dexie/
    // IndexedDB doesn't guarantee insertion order for equal index keys —
    // sorting on createdAt alone would then be flaky under the full suite.
    await getDb().sentenceGrammar.update(oldLink.id, {
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await getDb().sentenceGrammar.update(newLink.id, {
      createdAt: '2026-02-01T00:00:00.000Z',
    });

    const encounters = await listSentenceGrammarForPattern(pattern.id);
    expect(encounters).toHaveLength(2);
    expect(encounters[0]?.sentence.id).toBe('sent-new');
    expect(encounters[0]?.books.map((b) => b.id)).toEqual([book.id]);
    expect(encounters[0]?.audio.map((a) => a.id)).toEqual(['audio-1']);
    expect(encounters[1]?.sentence.id).toBe('sent-old');
    expect(encounters[1]?.books).toEqual([]);
    expect(encounters[1]?.audio).toEqual([]);
  });

  it('ensureGrammarStudyItem creates a grammarPattern-subject study item', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    const studyItem = await ensureGrammarStudyItem(pattern.id, 'grammar_comprehension');
    expect(studyItem.subjectType).toBe('grammarPattern');
    expect(studyItem.subjectId).toBe(pattern.id);
  });

  it('pickContextSentenceForGrammarPattern returns the most recently linked sentence whose vocabulary is confirmed and proficient', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    await getDb().sentences.bulkPut([stubSentence('sent-old'), stubSentence('sent-new')]);
    const oldLink = await ensureSentenceGrammar('sent-old', pattern.id, {});
    const newLink = await ensureSentenceGrammar('sent-new', pattern.id, {});
    await getDb().sentenceGrammar.update(oldLink.id, {
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await getDb().sentenceGrammar.update(newLink.id, {
      createdAt: '2026-02-01T00:00:00.000Z',
    });
    await confirmSentenceVocabulary('sent-old', []);
    await confirmSentenceVocabulary('sent-new', []);

    const picked = await pickContextSentenceForGrammarPattern(pattern.id);
    expect(picked?.sentence.id).toBe('sent-new');
  });

  it('pickContextSentenceForGrammarPattern returns undefined with no links', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    expect(await pickContextSentenceForGrammarPattern(pattern.id)).toBeUndefined();
  });

  it("pickContextSentenceForGrammarPattern skips the most recent link if its vocabulary isn't confirmed+proficient, and returns undefined if none qualify", async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    await getDb().sentences.bulkPut([stubSentence('sent-old'), stubSentence('sent-new')]);
    const oldLink = await ensureSentenceGrammar('sent-old', pattern.id, {});
    const newLink = await ensureSentenceGrammar('sent-new', pattern.id, {});
    await getDb().sentenceGrammar.update(oldLink.id, {
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await getDb().sentenceGrammar.update(newLink.id, {
      createdAt: '2026-02-01T00:00:00.000Z',
    });

    // Neither sentence has confirmed vocabulary yet — no candidate at all.
    expect(await pickContextSentenceForGrammarPattern(pattern.id)).toBeUndefined();

    // Only the older sentence is ready — it's picked over the unready newer one.
    await confirmSentenceVocabulary('sent-old', []);
    const picked = await pickContextSentenceForGrammarPattern(pattern.id);
    expect(picked?.sentence.id).toBe('sent-old');
  });

  it('computeGrammarPatternContextDiversity mirrors the vocabulary version, over sentenceGrammar', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    expect(await computeGrammarPatternContextDiversity(pattern.id)).toEqual({
      distinctSentenceCount: 0,
      distinctSourceCount: 0,
    });

    const bookA = await createBook({ title: 'Book A' });
    const bookB = await createBook({ title: 'Book B' });
    await ensureSentenceGrammar('sent-1', pattern.id, {});
    await ensureSentenceGrammar('sent-2', pattern.id, {});
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

    expect(await computeGrammarPatternContextDiversity(pattern.id)).toEqual({
      distinctSentenceCount: 2,
      distinctSourceCount: 2,
    });
  });

  it('ensureGrammarRelationship creates a canonicalized, deduped edge', async () => {
    const wakega = await ensureGrammarPattern('〜わけがない');
    const hazuga = await ensureGrammarPattern('〜はずがない');

    const forward = await ensureGrammarRelationship(
      wakega.id,
      hazuga.id,
      'structural_relative',
    );
    const backward = await ensureGrammarRelationship(
      hazuga.id,
      wakega.id,
      'structural_relative',
    );

    expect(backward.id).toBe(forward.id);
    expect(await getDb().grammarRelationships.count()).toBe(1);
    const [expectedA, expectedB] =
      wakega.id < hazuga.id ? [wakega.id, hazuga.id] : [hazuga.id, wakega.id];
    expect(forward.patternAId).toBe(expectedA);
    expect(forward.patternBId).toBe(expectedB);
  });

  it('allows more than one relationship row for the same pair, one per relationshipType', async () => {
    const wakega = await ensureGrammarPattern('〜わけがない');
    const hazuga = await ensureGrammarPattern('〜はずがない');
    await ensureGrammarRelationship(wakega.id, hazuga.id, 'structural_relative');
    await ensureGrammarRelationship(wakega.id, hazuga.id, 'commonly_confused');
    expect(await getDb().grammarRelationships.count()).toBe(2);
  });

  it('recordGrammarRelationshipObservation increments the count and bumps lastObservedAt', async () => {
    const wakega = await ensureGrammarPattern('〜わけがない');
    const hazuga = await ensureGrammarPattern('〜はずがない');

    const first = await recordGrammarRelationshipObservation(
      wakega.id,
      hazuga.id,
      'commonly_confused',
    );
    expect(first.observedCount).toBe(1);

    const second = await recordGrammarRelationshipObservation(
      hazuga.id,
      wakega.id,
      'commonly_confused',
    );
    expect(second.id).toBe(first.id);
    expect(second.observedCount).toBe(2);
    expect(await getDb().grammarRelationships.count()).toBe(1);
  });

  it('recordGrammarNaturalEncounter creates the pattern\'s grammar_comprehension study item and tags the review source/context', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    await getDb().sentences.add(stubSentence('sent-natural'));

    const { review, studyItem } = await recordGrammarNaturalEncounter({
      grammarPatternId: pattern.id,
      sentenceId: 'sent-natural',
      rating: 'good',
    });

    expect(studyItem.subjectType).toBe('grammarPattern');
    expect(studyItem.subjectId).toBe(pattern.id);
    expect(studyItem.activityType).toBe('grammar_comprehension');
    expect(review.source).toBe('natural_encounter');
    expect(review.contextSentenceId).toBe('sent-natural');
  });

  it('recordGrammarNaturalEncounter reuses an existing tracked study item rather than creating a second one', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    const tracked = await ensureGrammarStudyItem(pattern.id, 'grammar_comprehension');
    await getDb().sentences.add(stubSentence('sent-natural'));

    const { studyItem } = await recordGrammarNaturalEncounter({
      grammarPatternId: pattern.id,
      sentenceId: 'sent-natural',
      rating: 'easy',
    });

    expect(studyItem.id).toBe(tracked.id);
    expect(
      await getDb().studyItems.where('subjectId').equals(pattern.id).count(),
    ).toBe(1);
  });

  it('exportFullBackup/restoreBackup round-trips grammar data', async () => {
    const wakega = await ensureGrammarPattern('〜わけがない', {
      shortMeaning: "there's no way...",
    });
    const hazuga = await ensureGrammarPattern('〜はずがない');
    await ensureSentenceGrammar('sent-1', wakega.id, { confirmedByLearner: true });
    await ensureGrammarRelationship(wakega.id, hazuga.id, 'structural_relative');

    const backup = await exportFullBackup();
    expect(backup.grammarPatterns).toHaveLength(2);
    expect(backup.sentenceGrammar).toHaveLength(1);
    expect(backup.grammarRelationships).toHaveLength(1);

    const parsed = parseBackupJson(JSON.stringify(backup));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      await restoreBackup(parsed.data, 'replace');
      expect(await getDb().grammarPatterns.count()).toBe(2);
      expect(await getDb().sentenceGrammar.count()).toBe(1);
      expect(await getDb().grammarRelationships.count()).toBe(1);
    }
  });

  it('parseBackupJson accepts an older backup missing the grammar keys entirely', async () => {
    const backup = await exportFullBackup();
    const raw = JSON.parse(JSON.stringify(backup)) as Record<string, unknown>;
    delete raw.grammarPatterns;
    delete raw.sentenceGrammar;
    delete raw.grammarRelationships;
    const counts = raw.counts as Record<string, unknown>;
    delete counts.grammarPatterns;
    delete counts.sentenceGrammar;
    delete counts.grammarRelationships;

    const parsed = parseBackupJson(JSON.stringify(raw));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.grammarPatterns).toEqual([]);
      expect(parsed.data.sentenceGrammar).toEqual([]);
      expect(parsed.data.grammarRelationships).toEqual([]);
      expect(parsed.data.counts.grammarPatterns).toBe(0);
    }
  });

  it('enqueues sync metadata for grammar pattern/occurrence/relationship writes', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    await ensureSentenceGrammar('sent-1', pattern.id, { confirmedByLearner: true });
    const other = await ensureGrammarPattern('〜はずがない');
    await ensureGrammarRelationship(pattern.id, other.id, 'structural_relative');

    await vi.waitFor(async () => {
      const keys = (await getDb().syncRecordMeta.toArray()).map((row) => row.entity);
      expect(keys).toContain('grammar_patterns');
      expect(keys).toContain('sentence_grammar');
      expect(keys).toContain('grammar_relationships');
    });
  });
});

describe('listGrammarPatternSummaries/listGrammarRelationshipsForPattern (grammar-learning system Phase 6/7/8)', () => {
  beforeEach(() => {
    resetDbForTests(`data-grammar-summaries-${createId('db')}`);
  });

  it('buckets an untracked, lightly-encountered pattern as recently_encountered', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    await getDb().sentences.add(stubSentence('sent-1'));
    await ensureSentenceGrammar('sent-1', pattern.id);

    const summaries = await listGrammarPatternSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      encounterCount: 1,
      tracked: false,
      state: 'encountered',
      priorityBucket: 'recently_encountered',
    });
    expect(summaries[0].priorityExplanation).toContain('not tracked yet');
  });

  it('buckets an untracked pattern encountered 3+ times as worth_learning_now', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    await getDb().sentences.bulkAdd([
      stubSentence('sent-1'),
      stubSentence('sent-2'),
      stubSentence('sent-3'),
    ]);
    await ensureSentenceGrammar('sent-1', pattern.id);
    await ensureSentenceGrammar('sent-2', pattern.id);
    await ensureSentenceGrammar('sent-3', pattern.id);

    const summaries = await listGrammarPatternSummaries();
    expect(summaries[0].encounterCount).toBe(3);
    expect(summaries[0].priorityBucket).toBe('worth_learning_now');
  });

  it('counts distinct sources across two different books', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    const bookA = await createBook({ title: 'Book A' });
    const bookB = await createBook({ title: 'Book B' });
    await getDb().sentences.bulkAdd([stubSentence('sent-1'), stubSentence('sent-2')]);
    await ensureSentenceGrammar('sent-1', pattern.id);
    await ensureSentenceGrammar('sent-2', pattern.id);
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

    const summaries = await listGrammarPatternSummaries();
    expect(summaries[0].distinctSourceCount).toBe(2);
  });

  it('buckets a tracked but not-yet-proficient pattern as developing', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    await ensureGrammarStudyItem(pattern.id, 'grammar_comprehension');

    const summaries = await listGrammarPatternSummaries();
    expect(summaries[0]).toMatchObject({ tracked: true, priorityBucket: 'developing' });
  });

  it('buckets a tracked, proficient pattern with no recent again ratings as strong', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    const item = await ensureGrammarStudyItem(pattern.id, 'grammar_comprehension');
    await getDb().studyItems.update(item.id, {
      fsrsState: { ...item.fsrsState, state: 'review' },
    });

    const summaries = await listGrammarPatternSummaries();
    expect(summaries[0]).toMatchObject({
      tracked: true,
      state: 'recognized',
      priorityBucket: 'strong',
    });
  });

  it('buckets a tracked, contrast-proficient pattern as distinguished', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    const comprehensionItem = await ensureGrammarStudyItem(pattern.id, 'grammar_comprehension');
    await getDb().studyItems.update(comprehensionItem.id, {
      fsrsState: { ...comprehensionItem.fsrsState, state: 'review' },
    });
    const contrastItem = await ensureGrammarStudyItem(pattern.id, 'grammar_contrast');
    await getDb().studyItems.update(contrastItem.id, {
      fsrsState: { ...contrastItem.fsrsState, state: 'review' },
    });

    const summaries = await listGrammarPatternSummaries();
    expect(summaries[0]).toMatchObject({
      state: 'distinguished',
      priorityBucket: 'strong',
    });
  });

  it('reports needed-help counts from the last 7 grammar_comprehension reviews in the priority explanation', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    const item = await ensureGrammarStudyItem(pattern.id, 'grammar_comprehension');
    await recordReview({ studyItemId: item.id, rating: 'again' });
    await recordReview({ studyItemId: item.id, rating: 'good' });

    const summaries = await listGrammarPatternSummaries();
    expect(summaries[0].recentReviewCount).toBe(2);
    expect(summaries[0].recentAgainCount).toBe(1);
    expect(summaries[0].priorityExplanation).toContain('needed help on 1 of the last 2 reviews');
  });

  it('listGrammarRelationshipsForPattern returns empty for a pattern with no relationships', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    expect(await listGrammarRelationshipsForPattern(pattern.id)).toEqual([]);
  });

  it('listGrammarRelationshipsForPattern returns the other pattern regardless of which side of the edge it is on', async () => {
    const wakega = await ensureGrammarPattern('〜わけがない');
    const hazuga = await ensureGrammarPattern('〜はずがない');
    await ensureGrammarRelationship(wakega.id, hazuga.id, 'commonly_confused');

    const fromWakega = await listGrammarRelationshipsForPattern(wakega.id);
    expect(fromWakega).toHaveLength(1);
    expect(fromWakega[0].otherPattern.id).toBe(hazuga.id);
    expect(fromWakega[0].relationship.relationshipType).toBe('commonly_confused');

    const fromHazuga = await listGrammarRelationshipsForPattern(hazuga.id);
    expect(fromHazuga).toHaveLength(1);
    expect(fromHazuga[0].otherPattern.id).toBe(wakega.id);
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

  it('returns a grammarPattern subject with its computed maturity level', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    const studyItem = await ensureGrammarStudyItem(pattern.id, 'grammar_comprehension');

    const info = await getStudyItemDebugInfo(studyItem.id);
    expect(info?.subject.kind).toBe('grammarPattern');
    if (info?.subject.kind === 'grammarPattern') {
      expect(info.subject.grammarPattern.id).toBe(pattern.id);
      // No sentence links at all -> zero diversity -> fragile.
      expect(info.subject.maturity.level).toBe('fragile');
      expect(info.subject.maturity.diversity).toEqual({
        distinctSentenceCount: 0,
        distinctSourceCount: 0,
      });
    }
  });
});

function nowIsoForTest(): string {
  return new Date().toISOString();
}

describe('getProficientVocabularyItemIds', () => {
  beforeEach(() => {
    resetDbForTests(`data-proficient-vocab-${createId('db')}`);
  });

  async function makeProficient(studyItemId: string) {
    const item = await getDb().studyItems.get(studyItemId);
    await getDb().studyItems.update(studyItemId, {
      fsrsState: { ...item!.fsrsState, state: 'review' },
    });
  }

  it('returns an empty set for no ids', async () => {
    expect(await getProficientVocabularyItemIds([])).toEqual(new Set());
  });

  it('includes a word with a proficient study item and excludes a still-new one', async () => {
    const proficient = await ensureStudyItem('vocabularyItem', 'v-good', 'reading_retrieval');
    await makeProficient(proficient.id);
    await ensureStudyItem('vocabularyItem', 'v-new', 'reading_retrieval'); // stays 'new'

    const result = await getProficientVocabularyItemIds(['v-good', 'v-new']);
    expect(result).toEqual(new Set(['v-good']));
  });

  it('counts a word proficient once any one of its activity types is proficient', async () => {
    const reading = await ensureStudyItem('vocabularyItem', 'v-1', 'reading_retrieval');
    await ensureStudyItem('vocabularyItem', 'v-1', 'cloze'); // stays 'new'
    await makeProficient(reading.id);

    expect(await getProficientVocabularyItemIds(['v-1'])).toEqual(new Set(['v-1']));
  });
});

describe('getSentenceListeningReadiness (word_listening tier-2 gate)', () => {
  beforeEach(() => {
    resetDbForTests(`data-listening-readiness-${createId('db')}`);
  });

  async function addAudio(sentenceId: string) {
    await getDb().sentenceAudio.add({
      id: createId('audio'),
      sentenceId,
      sourceId: 'src',
      sourceSentenceId: 'src-sent',
      sourceTitle: 'Source',
      mimeType: 'audio/mp3',
      durationMs: 1000,
      startMs: 0,
      endMs: 1000,
      blob: new Blob(['x'], { type: 'audio/mp3' }),
      importedAt: nowIsoForTest(),
    });
  }

  async function linkVocab(sentenceId: string, surfaceForm: string): Promise<string> {
    const now = nowIsoForTest();
    const id = createId('svoc');
    await getDb().sentenceVocabulary.add({
      id,
      sentenceId,
      vocabularyItemId: createId('vocab'),
      surfaceForm,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  async function addWordListeningItem(linkId: string, state: 'new' | 'learning' | 'review') {
    const item = await ensureStudyItem('sentenceVocabulary', linkId, 'word_listening');
    if (state !== 'new') {
      await getDb().studyItems.update(item.id, {
        fsrsState: { ...item.fsrsState, state },
      });
    }
  }

  it('is not ready when a surface-form occurrence has no word_listening item yet', async () => {
    await addAudio('sent-1');
    await linkVocab('sent-1', '本');
    const readiness = await getSentenceListeningReadiness(['sent-1']);
    expect(readiness.get('sent-1')).toBe(false);
  });

  it('is ready once every occurrence has a proficient word_listening item', async () => {
    await addAudio('sent-1');
    const a = await linkVocab('sent-1', '本');
    const b = await linkVocab('sent-1', '読み');
    await addWordListeningItem(a, 'review');
    await addWordListeningItem(b, 'review');
    const readiness = await getSentenceListeningReadiness(['sent-1']);
    expect(readiness.get('sent-1')).toBe(true);
  });

  it('is not ready while one occurrence is still learning', async () => {
    await addAudio('sent-1');
    const a = await linkVocab('sent-1', '本');
    const b = await linkVocab('sent-1', '読み');
    await addWordListeningItem(a, 'review');
    await addWordListeningItem(b, 'learning');
    const readiness = await getSentenceListeningReadiness(['sent-1']);
    expect(readiness.get('sent-1')).toBe(false);
  });

  it('is ready for an audio sentence with no surface-form vocabulary (nothing to gate on)', async () => {
    await addAudio('sent-1');
    const readiness = await getSentenceListeningReadiness(['sent-1']);
    expect(readiness.get('sent-1')).toBe(true);
  });

  it('ignores links with no surfaceForm', async () => {
    await addAudio('sent-1');
    const now = nowIsoForTest();
    await getDb().sentenceVocabulary.add({
      id: createId('svoc'),
      sentenceId: 'sent-1',
      vocabularyItemId: createId('vocab'),
      surfaceForm: undefined,
      createdAt: now,
      updatedAt: now,
    });
    const readiness = await getSentenceListeningReadiness(['sent-1']);
    expect(readiness.get('sent-1')).toBe(true);
  });
});
