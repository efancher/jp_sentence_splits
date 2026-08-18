import type {
  Book,
  BookSentence,
  CardIssueReport,
  ImportBatch,
  InboxMembership,
  Kanji,
  Review,
  Sentence,
  SentenceAnalysis,
  SentenceAudio,
  SentenceVocabulary,
  StudyItem,
  VocabularyConfusion,
  VocabularyItem,
  VocabularyKanji,
} from '../domain/types';
import type { SyncEntity } from './types';

export type LocalSyncPayload =
  | Book
  | Sentence
  | BookSentence
  | SentenceAnalysis
  | ImportBatch
  | InboxMembership
  | ReferenceAudioLocal
  | StudyItem
  | Review
  | VocabularyItem
  | SentenceVocabulary
  | Kanji
  | VocabularyKanji
  | VocabularyConfusion
  | CardIssueReport;

/** Local reference-audio row without the Blob (for sync payloads). */
export interface ReferenceAudioLocal {
  id: string;
  sentenceId: string;
  sourceId: string;
  sourceSentenceId: string;
  sourceTitle: string;
  sourceUrl?: string;
  mimeType: string;
  durationMs: number;
  startMs: number;
  endMs: number;
  bookId?: string;
  storagePath?: string;
  sizeBytes?: number;
  checksum?: string;
  importedAt: string;
}

export function sentenceAudioToReferenceMeta(
  audio: SentenceAudio,
  bookId?: string,
): ReferenceAudioLocal {
  return {
    id: audio.id,
    sentenceId: audio.sentenceId,
    sourceId: audio.sourceId,
    sourceSentenceId: audio.sourceSentenceId,
    sourceTitle: audio.sourceTitle,
    sourceUrl: audio.sourceUrl,
    mimeType: audio.mimeType,
    durationMs: audio.durationMs,
    startMs: audio.startMs,
    endMs: audio.endMs,
    bookId,
    sizeBytes: audio.blob.size,
    importedAt: audio.importedAt,
  };
}

export function bookToRemote(book: Book, ownerId: string, version: number) {
  return {
    id: book.id,
    owner_id: ownerId,
    title: book.title,
    source_key: book.sourceKey ?? null,
    subtitle: book.subtitle ?? null,
    source_url: book.sourceUrl ?? null,
    notes: book.notes ?? null,
    archived: book.archived,
    chapters: book.chapters ?? [],
    collapsed_chapter_ids: book.collapsedChapterIds ?? [],
    last_opened_at: book.lastOpenedAt ?? null,
    created_at: book.createdAt,
    updated_at: book.updatedAt,
    deleted_at: null,
    version,
  };
}

export function remoteToBook(row: Record<string, unknown>): Book {
  return {
    id: String(row.id),
    title: String(row.title),
    sourceKey: (row.source_key as string | null) ?? undefined,
    subtitle: (row.subtitle as string | null) ?? undefined,
    sourceUrl: (row.source_url as string | null) ?? undefined,
    notes: (row.notes as string | null) ?? undefined,
    archived: Boolean(row.archived),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastOpenedAt: (row.last_opened_at as string | null) ?? undefined,
    chapters: Array.isArray(row.chapters) ? (row.chapters as Book['chapters']) : [],
    collapsedChapterIds: Array.isArray(row.collapsed_chapter_ids)
      ? (row.collapsed_chapter_ids as string[])
      : [],
  };
}

export function sentenceToRemote(
  sentence: Sentence,
  ownerId: string,
  version: number,
) {
  return {
    id: sentence.id,
    owner_id: ownerId,
    normalized_key: sentence.normalizedKey,
    japanese: sentence.japanese,
    reading_only: sentence.readingOnly,
    inline_reading: sentence.inlineReading,
    translation: sentence.translation,
    target_vocabulary: sentence.targetVocabulary,
    vocabulary_suggestions: sentence.vocabularySuggestions ?? [],
    source_references: sentence.sourceReferences,
    conflicts: sentence.conflicts,
    earliest_created_at: sentence.earliestCreatedAt ?? null,
    latest_created_at: sentence.latestCreatedAt ?? null,
    first_occurrence_index: sentence.firstOccurrenceIndex,
    import_batch_ids: sentence.importBatchIds,
    created_at: sentence.createdAt,
    updated_at: sentence.updatedAt,
    deleted_at: null,
    version,
  };
}

export function remoteToSentence(row: Record<string, unknown>): Sentence {
  return {
    id: String(row.id),
    normalizedKey: String(row.normalized_key),
    japanese: String(row.japanese),
    readingOnly: String(row.reading_only ?? ''),
    inlineReading: String(row.inline_reading ?? ''),
    translation: String(row.translation ?? ''),
    targetVocabulary: (row.target_vocabulary as Sentence['targetVocabulary']) ?? [],
    vocabularySuggestions:
      (row.vocabulary_suggestions as Sentence['vocabularySuggestions']) ?? [],
    sourceReferences: (row.source_references as Sentence['sourceReferences']) ?? [],
    conflicts: (row.conflicts as Sentence['conflicts']) ?? [],
    earliestCreatedAt: (row.earliest_created_at as string | null) ?? undefined,
    latestCreatedAt: (row.latest_created_at as string | null) ?? undefined,
    firstOccurrenceIndex: Number(row.first_occurrence_index ?? 0),
    importBatchIds: (row.import_batch_ids as string[]) ?? [],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function bookSentenceToRemote(
  item: BookSentence,
  ownerId: string,
  version: number,
) {
  return {
    id: item.id,
    book_id: item.bookId,
    sentence_id: item.sentenceId,
    owner_id: ownerId,
    position: item.position,
    status: item.status,
    added_at: item.addedAt,
    last_studied_at: item.lastStudiedAt ?? null,
    note: item.note ?? null,
    chapter_id: item.chapterId ?? null,
    created_at: item.addedAt,
    updated_at: item.lastStudiedAt ?? item.addedAt,
    deleted_at: null,
    version,
  };
}

export function remoteToBookSentence(row: Record<string, unknown>): BookSentence {
  return {
    id: String(row.id),
    bookId: String(row.book_id),
    sentenceId: String(row.sentence_id),
    position: Number(row.position ?? 0),
    status: row.status as BookSentence['status'],
    addedAt: String(row.added_at),
    lastStudiedAt: (row.last_studied_at as string | null) ?? undefined,
    note: (row.note as string | null) ?? undefined,
    chapterId: (row.chapter_id as string | null) ?? undefined,
  };
}

export function analysisToRemote(
  analysis: SentenceAnalysis,
  ownerId: string,
  version: number,
) {
  return {
    sentence_id: analysis.sentenceId,
    owner_id: ownerId,
    chunks: analysis.chunks,
    notes: analysis.notes,
    status: analysis.status,
    format_version: analysis.formatVersion,
    vocabulary_review_status: analysis.vocabularyReviewStatus ?? 'unreviewed',
    vocabulary_selections: analysis.vocabularySelections ?? [],
    created_at: analysis.createdAt,
    updated_at: analysis.updatedAt,
    deleted_at: null,
    version,
  };
}

export function remoteToAnalysis(row: Record<string, unknown>): SentenceAnalysis {
  return {
    sentenceId: String(row.sentence_id),
    chunks: (row.chunks as SentenceAnalysis['chunks']) ?? [],
    notes: String(row.notes ?? ''),
    status: row.status as SentenceAnalysis['status'],
    formatVersion: Number(row.format_version ?? 1),
    vocabularyReviewStatus:
      (row.vocabulary_review_status as SentenceAnalysis['vocabularyReviewStatus']) ??
      'unreviewed',
    vocabularySelections:
      (row.vocabulary_selections as SentenceAnalysis['vocabularySelections']) ??
      [],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function importBatchToRemote(
  batch: ImportBatch,
  ownerId: string,
  version: number,
) {
  return {
    id: batch.id,
    owner_id: ownerId,
    filename: batch.filename,
    batch_name: batch.batchName,
    imported_at: batch.importedAt,
    counts: batch.counts,
    warnings: batch.warnings,
    created_at: batch.importedAt,
    updated_at: batch.importedAt,
    deleted_at: null,
    version,
  };
}

export function remoteToImportBatch(row: Record<string, unknown>): ImportBatch {
  return {
    id: String(row.id),
    filename: String(row.filename),
    batchName: String(row.batch_name),
    importedAt: String(row.imported_at),
    counts: row.counts as ImportBatch['counts'],
    warnings: (row.warnings as string[]) ?? [],
  };
}

export function inboxToRemote(
  item: InboxMembership,
  ownerId: string,
  version: number,
) {
  return {
    sentence_id: item.sentenceId,
    owner_id: ownerId,
    import_batch_id: item.importBatchId,
    added_at: item.addedAt,
    created_at: item.addedAt,
    updated_at: item.addedAt,
    deleted_at: null,
    version,
  };
}

export function remoteToInbox(row: Record<string, unknown>): InboxMembership {
  return {
    sentenceId: String(row.sentence_id),
    importBatchId: String(row.import_batch_id),
    addedAt: String(row.added_at),
  };
}

export function referenceAudioToRemote(
  audio: ReferenceAudioLocal,
  ownerId: string,
  version: number,
) {
  return {
    id: audio.id,
    owner_id: ownerId,
    book_id: audio.bookId ?? null,
    sentence_id: audio.sentenceId,
    source_id: audio.sourceId,
    source_sentence_id: audio.sourceSentenceId,
    source_title: audio.sourceTitle,
    storage_path: audio.storagePath ?? null,
    mime_type: audio.mimeType,
    duration_ms: audio.durationMs,
    size_bytes: audio.sizeBytes ?? 0,
    source_url: audio.sourceUrl ?? null,
    source_start_ms: audio.startMs,
    source_end_ms: audio.endMs,
    checksum: audio.checksum ?? null,
    created_at: audio.importedAt,
    updated_at: audio.importedAt,
    deleted_at: null,
    version,
  };
}

export function remoteToReferenceAudio(
  row: Record<string, unknown>,
): ReferenceAudioLocal {
  return {
    id: String(row.id),
    sentenceId: String(row.sentence_id ?? ''),
    sourceId: String(row.source_id ?? ''),
    sourceSentenceId: String(row.source_sentence_id ?? ''),
    sourceTitle: String(row.source_title ?? ''),
    sourceUrl: (row.source_url as string | null) ?? undefined,
    mimeType: String(row.mime_type),
    durationMs: Number(row.duration_ms ?? 0),
    startMs: Number(row.source_start_ms ?? 0),
    endMs: Number(row.source_end_ms ?? 0),
    bookId: (row.book_id as string | null) ?? undefined,
    storagePath: (row.storage_path as string | null) ?? undefined,
    sizeBytes: Number(row.size_bytes ?? 0),
    checksum: (row.checksum as string | null) ?? undefined,
    importedAt: String(row.created_at),
  };
}

export function studyItemToRemote(
  item: StudyItem,
  ownerId: string,
  version: number,
) {
  return {
    id: item.id,
    owner_id: ownerId,
    subject_type: item.subjectType,
    subject_id: item.subjectId,
    activity_type: item.activityType,
    fsrs_state: item.fsrsState,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    deleted_at: null,
    version,
  };
}

export function remoteToStudyItem(row: Record<string, unknown>): StudyItem {
  return {
    id: String(row.id),
    subjectType: row.subject_type as StudyItem['subjectType'],
    subjectId: String(row.subject_id),
    activityType: String(row.activity_type),
    fsrsState: row.fsrs_state as StudyItem['fsrsState'],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function reviewToRemote(review: Review, ownerId: string, version: number) {
  return {
    id: review.id,
    owner_id: ownerId,
    study_item_id: review.studyItemId,
    timestamp: review.timestamp,
    rating: review.rating,
    response_raw: review.responseRaw ?? null,
    expected_answer: review.expectedAnswer ?? null,
    elapsed_ms: review.elapsedMs ?? null,
    error_classification: review.errorClassification ?? null,
    assistance: review.assistance ?? null,
    source: review.source ?? null,
    context_sentence_id: review.contextSentenceId ?? null,
    created_at: review.timestamp,
    updated_at: review.timestamp,
    deleted_at: null,
    version,
  };
}

export function remoteToReview(row: Record<string, unknown>): Review {
  return {
    id: String(row.id),
    studyItemId: String(row.study_item_id),
    timestamp: String(row.timestamp),
    rating: row.rating as Review['rating'],
    responseRaw: (row.response_raw as string | null) ?? undefined,
    expectedAnswer: (row.expected_answer as string | null) ?? undefined,
    elapsedMs: (row.elapsed_ms as number | null) ?? undefined,
    errorClassification:
      (row.error_classification as Review['errorClassification'] | null) ??
      undefined,
    assistance: (row.assistance as Review['assistance'] | null) ?? undefined,
    source: (row.source as Review['source'] | null) ?? undefined,
    contextSentenceId:
      (row.context_sentence_id as string | null) ?? undefined,
  };
}

export function vocabularyItemToRemote(
  item: VocabularyItem,
  ownerId: string,
  version: number,
) {
  return {
    id: item.id,
    owner_id: ownerId,
    expression: item.expression,
    reading: item.reading,
    meaning: item.meaning,
    part_of_speech: item.partOfSpeech ?? null,
    notes: item.notes ?? null,
    external_id: item.externalId ?? null,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    deleted_at: null,
    version,
  };
}

export function remoteToVocabularyItem(
  row: Record<string, unknown>,
): VocabularyItem {
  return {
    id: String(row.id),
    expression: String(row.expression),
    reading: String(row.reading),
    meaning: String(row.meaning),
    partOfSpeech: (row.part_of_speech as string | null) ?? undefined,
    notes: (row.notes as string | null) ?? undefined,
    externalId: (row.external_id as string | null) ?? undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function sentenceVocabularyToRemote(
  link: SentenceVocabulary,
  ownerId: string,
  version: number,
) {
  return {
    id: link.id,
    owner_id: ownerId,
    sentence_id: link.sentenceId,
    vocabulary_item_id: link.vocabularyItemId,
    chunk_id: link.chunkId ?? null,
    surface_form: link.surfaceForm ?? null,
    created_at: link.createdAt,
    updated_at: link.updatedAt,
    deleted_at: null,
    version,
  };
}

export function remoteToSentenceVocabulary(
  row: Record<string, unknown>,
): SentenceVocabulary {
  return {
    id: String(row.id),
    sentenceId: String(row.sentence_id),
    vocabularyItemId: String(row.vocabulary_item_id),
    chunkId: (row.chunk_id as string | null) ?? undefined,
    surfaceForm: (row.surface_form as string | null) ?? undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function kanjiToRemote(kanji: Kanji, ownerId: string, version: number) {
  return {
    id: kanji.id,
    owner_id: ownerId,
    character: kanji.character,
    meanings: kanji.meanings,
    onyomi: kanji.onyomi,
    kunyomi: kanji.kunyomi,
    nanori: kanji.nanori,
    notes: kanji.notes ?? null,
    external_id: kanji.externalId ?? null,
    created_at: kanji.createdAt,
    updated_at: kanji.updatedAt,
    deleted_at: null,
    version,
  };
}

export function remoteToKanji(row: Record<string, unknown>): Kanji {
  return {
    id: String(row.id),
    character: String(row.character),
    meanings: (row.meanings as string[] | null) ?? [],
    onyomi: (row.onyomi as string[] | null) ?? [],
    kunyomi: (row.kunyomi as string[] | null) ?? [],
    nanori: (row.nanori as string[] | null) ?? [],
    notes: (row.notes as string | null) ?? undefined,
    externalId: (row.external_id as string | null) ?? undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function vocabularyKanjiToRemote(
  link: VocabularyKanji,
  ownerId: string,
  version: number,
) {
  return {
    id: link.id,
    owner_id: ownerId,
    vocabulary_item_id: link.vocabularyItemId,
    kanji_id: link.kanjiId,
    position_in_word: link.positionInWord,
    created_at: link.createdAt,
    updated_at: link.updatedAt,
    deleted_at: null,
    version,
  };
}

export function remoteToVocabularyKanji(
  row: Record<string, unknown>,
): VocabularyKanji {
  return {
    id: String(row.id),
    vocabularyItemId: String(row.vocabulary_item_id),
    kanjiId: String(row.kanji_id),
    positionInWord: Number(row.position_in_word),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function vocabularyConfusionToRemote(
  confusion: VocabularyConfusion,
  ownerId: string,
  version: number,
) {
  return {
    id: confusion.id,
    owner_id: ownerId,
    item_a_id: confusion.itemAId,
    item_b_id: confusion.itemBId,
    confusion_type: confusion.confusionType,
    observed_count: confusion.observedCount,
    last_observed_at: confusion.lastObservedAt,
    notes: confusion.notes ?? null,
    created_at: confusion.createdAt,
    updated_at: confusion.updatedAt,
    deleted_at: null,
    version,
  };
}

export function remoteToVocabularyConfusion(
  row: Record<string, unknown>,
): VocabularyConfusion {
  return {
    id: String(row.id),
    itemAId: String(row.item_a_id),
    itemBId: String(row.item_b_id),
    confusionType: row.confusion_type as VocabularyConfusion['confusionType'],
    observedCount: Number(row.observed_count),
    lastObservedAt: String(row.last_observed_at),
    notes: (row.notes as string | null) ?? undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function cardIssueReportToRemote(
  report: CardIssueReport,
  ownerId: string,
  version: number,
) {
  return {
    id: report.id,
    owner_id: ownerId,
    study_item_id: report.studyItemId,
    sentence_id: report.sentenceId ?? null,
    activity_type: report.activityType,
    note: report.note,
    status: report.status,
    resolved_at: report.resolvedAt ?? null,
    created_at: report.createdAt,
    updated_at: report.updatedAt,
    deleted_at: null,
    version,
  };
}

export function remoteToCardIssueReport(
  row: Record<string, unknown>,
): CardIssueReport {
  return {
    id: String(row.id),
    studyItemId: String(row.study_item_id),
    sentenceId: (row.sentence_id as string | null) ?? undefined,
    activityType: String(row.activity_type),
    note: String(row.note),
    status: row.status as CardIssueReport['status'],
    resolvedAt: (row.resolved_at as string | null) ?? undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function toRemoteRow(
  entity: SyncEntity,
  payload: unknown,
  ownerId: string,
  version: number,
): Record<string, unknown> {
  switch (entity) {
    case 'books':
      return bookToRemote(payload as Book, ownerId, version);
    case 'sentences':
      return sentenceToRemote(payload as Sentence, ownerId, version);
    case 'book_sentences':
      return bookSentenceToRemote(payload as BookSentence, ownerId, version);
    case 'analyses':
      return analysisToRemote(payload as SentenceAnalysis, ownerId, version);
    case 'import_batches':
      return importBatchToRemote(payload as ImportBatch, ownerId, version);
    case 'inbox':
      return inboxToRemote(payload as InboxMembership, ownerId, version);
    case 'reference_audio':
      return referenceAudioToRemote(
        payload as ReferenceAudioLocal,
        ownerId,
        version,
      );
    case 'study_items':
      return studyItemToRemote(payload as StudyItem, ownerId, version);
    case 'reviews':
      return reviewToRemote(payload as Review, ownerId, version);
    case 'vocabulary_items':
      return vocabularyItemToRemote(payload as VocabularyItem, ownerId, version);
    case 'sentence_vocabulary':
      return sentenceVocabularyToRemote(
        payload as SentenceVocabulary,
        ownerId,
        version,
      );
    case 'kanji':
      return kanjiToRemote(payload as Kanji, ownerId, version);
    case 'vocabulary_kanji':
      return vocabularyKanjiToRemote(
        payload as VocabularyKanji,
        ownerId,
        version,
      );
    case 'vocabulary_confusions':
      return vocabularyConfusionToRemote(
        payload as VocabularyConfusion,
        ownerId,
        version,
      );
    case 'card_issue_reports':
      return cardIssueReportToRemote(payload as CardIssueReport, ownerId, version);
  }
}

export function idColumnForEntity(entity: SyncEntity): string {
  if (entity === 'analyses' || entity === 'inbox') return 'sentence_id';
  return 'id';
}
