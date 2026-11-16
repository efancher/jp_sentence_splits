import { hashString, canonicalSourceId } from '../../lib/ids';
import type { MiningImport, Book, Sentence, StudyItem, SentenceAnalysis } from '../../domain/types';
import { getDb, readSettings } from '../database';
import { nowIso } from '../../lib/normalize';
import { notifySync } from '../syncNotify';
import { type StageCounts, emptyStageCounts, sentenceStage } from '../../lib/sentenceStages';
import { type MiningExportResult, buildMiningPackage } from '../../lib/miningExport';
import { curatedVocabForSourceKey, selectionsFromCuratedPicks } from '../../lib/curatedVocabulary';
import { saveAnalysis } from './sentenceWrites';

// ---------------------------------------------------------------------------
// Mining imports: one tracking row per mined episode/video (see MiningImport).
// Carries the import's destination across page reloads and devices (a mining
// job on the box only knows its URL, and the browser only kept a job id) and
// marks episodes imported or in flight. Bookkeeping only: callers swallow
// failures here, so an import never depends on this table.
// ---------------------------------------------------------------------------

/** Deterministic, so every device writing the same episode converges on one row. */
export function miningImportId(sourceId: string): string {
  return `mimp_${hashString(canonicalSourceId(sourceId))}`;
}

export async function beginMiningImport(input: {
  /** The episode/video URL as the caller picked it. */
  sourceId: string;
  sourceType: MiningImport['sourceType'];
  title: string;
  jobId: string;
  seriesId?: string;
  seriesTitle?: string;
  seriesUrl?: string;
  targetBookId?: string;
  sourceDate?: string;
}): Promise<MiningImport> {
  const db = getDb();
  const id = miningImportId(input.sourceId);
  const existing = await db.miningImports.get(id);
  const timestamp = nowIso();
  // A fresh run replaces the previous run's outcome (re-import is allowed),
  // but keeps the row's identity and creation time.
  const record: MiningImport = {
    id,
    sourceId: canonicalSourceId(input.sourceId),
    sourceType: input.sourceType,
    title: input.title,
    jobId: input.jobId,
    status: 'mining',
    ...(input.seriesId ? { seriesId: input.seriesId } : {}),
    ...(input.seriesTitle ? { seriesTitle: input.seriesTitle } : {}),
    ...(input.seriesUrl ? { seriesUrl: input.seriesUrl } : {}),
    ...(input.targetBookId ? { targetBookId: input.targetBookId } : {}),
    ...(input.sourceDate ? { sourceDate: input.sourceDate } : {}),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  await db.miningImports.put(record);
  notifySync('mining_imports', record.id, record);
  return record;
}

export async function getMiningImportForJob(jobId: string): Promise<MiningImport | undefined> {
  return getDb().miningImports.where('jobId').equals(jobId).first();
}

export async function getMiningImportForSource(sourceId: string): Promise<MiningImport | undefined> {
  return getDb().miningImports.get(miningImportId(sourceId));
}

/** Patch the row for a mining job (no-op if none was recorded, e.g. a job started before tracking). */
export async function updateMiningImportForJob(
  jobId: string,
  patch: Partial<
    Pick<MiningImport, 'status' | 'bookId' | 'chapterId' | 'sentenceCount' | 'error' | 'committedAt'>
  >,
): Promise<MiningImport | undefined> {
  const db = getDb();
  const existing = await getMiningImportForJob(jobId);
  if (!existing) return undefined;
  const updated: MiningImport = { ...existing, ...patch, updatedAt: nowIso() };
  if (patch.status && patch.status !== 'failed' && !('error' in patch)) delete updated.error;
  await db.miningImports.put(updated);
  notifySync('mining_imports', updated.id, updated);
  return updated;
}

export async function searchAll(query: string): Promise<{
  books: Book[];
  sentences: Sentence[];
}> {
  const db = getDb();
  const q = query.trim().toLowerCase();
  if (!q) return { books: [], sentences: [] };
  const books = (await db.books.toArray()).filter(
    (book) =>
      book.title.toLowerCase().includes(q) ||
      (book.subtitle ?? '').toLowerCase().includes(q),
  );
  const sentences = (await db.sentences.toArray()).filter((sentence) => {
    if (sentence.japanese.includes(query) || sentence.translation.toLowerCase().includes(q)) {
      return true;
    }
    return sentence.targetVocabulary.some(
      (vocab) =>
        vocab.expression.includes(query) ||
        vocab.reading.includes(query) ||
        vocab.english.toLowerCase().includes(q),
    );
  });
  return { books, sentences };
}

export async function getBookProgress(bookId: string): Promise<{
  total: number;
  complete: number;
  percent: number;
}> {
  const db = getDb();
  const memberships = await db.bookSentences.where('bookId').equals(bookId).toArray();
  const total = memberships.length;
  const complete = memberships.filter((item) => item.status === 'complete').length;
  return {
    total,
    complete,
    percent: total ? Math.round((complete / total) * 100) : 0,
  };
}

/**
 * Per-book sentence-stage rollup for the Books list, via the same per-sentence
 * rule as the book page's bars (`sentenceStage`). One pass over the sentence
 * study items and book memberships rather than a query per book.
 */
export async function getBookStageCounts(): Promise<
  Map<string, { total: number; counts: StageCounts; shelved: number }>
> {
  const db = getDb();
  const [books, memberships, studyItems, settings] = await Promise.all([
    db.books.toArray(),
    db.bookSentences.toArray(),
    db.studyItems.where('subjectType').equals('sentence').toArray(),
    readSettings(),
  ]);
  const itemsBySentence = new Map<string, StudyItem[]>();
  for (const item of studyItems) {
    const list = itemsBySentence.get(item.subjectId) ?? [];
    list.push(item);
    itemsBySentence.set(item.subjectId, list);
  }
  // Sentences in suspended episodes are left out of the bar (and counted in
  // `shelved`) — otherwise a few active episodes vanish next to a shelved backlog.
  const suspendedChapters = new Map(
    books.map((book) => [
      book.id,
      new Set((book.chapters ?? []).filter((chapter) => chapter.suspendedAt).map((chapter) => chapter.id)),
    ]),
  );
  const result = new Map<string, { total: number; counts: StageCounts; shelved: number }>();
  const seen = new Set<string>();
  for (const membership of memberships) {
    const key = `${membership.bookId}:${membership.sentenceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = result.get(membership.bookId) ?? { total: 0, counts: emptyStageCounts(), shelved: 0 };
    result.set(membership.bookId, entry);
    if (membership.chapterId && suspendedChapters.get(membership.bookId)?.has(membership.chapterId)) {
      entry.shelved += 1;
      continue;
    }
    const items = itemsBySentence.get(membership.sentenceId) ?? [];
    entry.total += 1;
    entry.counts[sentenceStage(items, settings.graduationMinScheduledDays)] += 1;
  }
  return result;
}

export async function exportBookMiningPackage(
  bookId: string,
): Promise<MiningExportResult> {
  const db = getDb();
  const book = await db.books.get(bookId);
  if (!book) throw new Error('Book not found.');
  const memberships = await db.bookSentences
    .where('bookId')
    .equals(bookId)
    .sortBy('position');
  const sentenceIds = memberships.map((item) => item.sentenceId);
  const sentences = (await db.sentences.bulkGet(sentenceIds)).filter(
    (item): item is Sentence => Boolean(item),
  );
  const analyses = (await db.analyses.bulkGet(sentenceIds)).filter(
    (item): item is SentenceAnalysis => Boolean(item),
  );
  const audio = (
    await Promise.all(
      sentenceIds.map((sentenceId) =>
        db.sentenceAudio.where('sentenceId').equals(sentenceId).toArray(),
      ),
    )
  ).flat();
  return buildMiningPackage({ book, sentences, analyses, audio });
}

/**
 * Apply offline curated vocabulary picks for a known immersion book.
 * Overwrites unreviewed analyses; skips sentences already confirmed unless
 * `overwriteConfirmed` is true.
 */
export async function applyCuratedVocabularyForBook(
  bookId: string,
  options: { overwriteConfirmed?: boolean } = {},
): Promise<{
  updated: number;
  confirmed: number;
  skippedConfirmed: number;
  missingPicks: number;
  unresolvedPicks: number;
}> {
  const db = getDb();
  const book = await db.books.get(bookId);
  if (!book) throw new Error('Book not found.');
  const curated = curatedVocabForSourceKey(book.sourceKey);
  if (!curated) {
    throw new Error('No curated vocabulary pack is available for this book.');
  }

  const memberships = await db.bookSentences
    .where('bookId')
    .equals(bookId)
    .sortBy('position');
  let updated = 0;
  let confirmed = 0;
  let skippedConfirmed = 0;
  let missingPicks = 0;
  let unresolvedPicks = 0;

  for (const membership of memberships) {
    const sentence = await db.sentences.get(membership.sentenceId);
    if (!sentence) continue;
    const existing = await db.analyses.get(sentence.id);
    if (
      existing?.vocabularyReviewStatus === 'confirmed' &&
      !options.overwriteConfirmed
    ) {
      skippedConfirmed += 1;
      continue;
    }

    const picks = curated.picksByJapanese[sentence.japanese];
    if (!picks) {
      missingPicks += 1;
      continue;
    }

    const selections = selectionsFromCuratedPicks(
      sentence.japanese,
      picks,
      sentence.vocabularySuggestions ?? [],
    );
    unresolvedPicks += Math.max(0, picks.length - selections.length);

    await saveAnalysis(sentence.id, existing?.chunks ?? [], existing?.notes ?? '', {
      reviewStatus: selections.length ? 'confirmed' : 'unreviewed',
      selections,
    });
    updated += 1;
    if (selections.length) confirmed += 1;
  }

  return {
    updated,
    confirmed,
    skippedConfirmed,
    missingPicks,
    unresolvedPicks,
  };
}

export async function findResumeSentence(
  bookId: string,
): Promise<string | null> {
  const db = getDb();
  const memberships = await db.bookSentences
    .where('bookId')
    .equals(bookId)
    .sortBy('position');
  const target =
    memberships.find(
      (item) => item.status === 'needs_review' || item.status === 'in_progress',
    ) ?? memberships.find((item) => item.status === 'unstarted');
  return target?.sentenceId ?? memberships[0]?.sentenceId ?? null;
}
