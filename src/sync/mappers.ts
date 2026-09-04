import type {
  Book,
  BookSentence,
  CardIssueReport,
  GrammarPattern,
  GrammarRelationship,
  ImportBatch,
  InboxMembership,
  Kanji,
  PlannerSession,
  Review,
  Sentence,
  SentenceAnalysis,
  SentenceAudio,
  SentenceGrammar,
  SentenceVocabulary,
  StudyItem,
  SyncIssueReport,
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
  | CardIssueReport
  | GrammarPattern
  | SentenceGrammar
  | GrammarRelationship
  | PlannerSession
  | SyncIssueReport;

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
    grammar_suggestions: analysis.grammarSuggestions ?? [],
    grammar_review_status: analysis.grammarReviewStatus ?? 'unreviewed',
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
    grammarSuggestions:
      (row.grammar_suggestions as SentenceAnalysis['grammarSuggestions']) ?? [],
    grammarReviewStatus:
      (row.grammar_review_status as SentenceAnalysis['grammarReviewStatus']) ??
      'unreviewed',
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
    pitch_accent_positions: item.pitchAccentPositions ?? null,
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
    pitchAccentPositions:
      (row.pitch_accent_positions as number[] | null) ?? undefined,
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
    audio_start_ms: link.audioStartMs ?? null,
    audio_end_ms: link.audioEndMs ?? null,
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
    audioStartMs: (row.audio_start_ms as number | null) ?? undefined,
    audioEndMs: (row.audio_end_ms as number | null) ?? undefined,
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

export function grammarPatternToRemote(
  pattern: GrammarPattern,
  ownerId: string,
  version: number,
) {
  return {
    id: pattern.id,
    owner_id: ownerId,
    canonical_name: pattern.canonicalName,
    normalized_key: pattern.normalizedKey,
    aliases: pattern.aliases,
    short_meaning: pattern.shortMeaning,
    structural_template: pattern.structuralTemplate ?? null,
    explanation: pattern.explanation ?? null,
    structural_notes: pattern.structuralNotes ?? null,
    family: pattern.family ?? null,
    notes: pattern.notes ?? null,
    provenance: pattern.provenance,
    external_id: pattern.externalId ?? null,
    created_at: pattern.createdAt,
    updated_at: pattern.updatedAt,
    deleted_at: null,
    version,
  };
}

export function remoteToGrammarPattern(row: Record<string, unknown>): GrammarPattern {
  return {
    id: String(row.id),
    canonicalName: String(row.canonical_name),
    normalizedKey: String(row.normalized_key),
    aliases: (row.aliases as string[] | null) ?? [],
    shortMeaning: String(row.short_meaning ?? ''),
    structuralTemplate: (row.structural_template as string | null) ?? undefined,
    explanation: (row.explanation as string | null) ?? undefined,
    structuralNotes: (row.structural_notes as string | null) ?? undefined,
    family: (row.family as string | null) ?? undefined,
    notes: (row.notes as string | null) ?? undefined,
    provenance: row.provenance as GrammarPattern['provenance'],
    externalId: (row.external_id as string | null) ?? undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function sentenceGrammarToRemote(
  link: SentenceGrammar,
  ownerId: string,
  version: number,
) {
  return {
    id: link.id,
    owner_id: ownerId,
    sentence_id: link.sentenceId,
    grammar_pattern_id: link.grammarPatternId,
    chunk_id: link.chunkId ?? null,
    surface_form: link.surfaceForm ?? null,
    // start/end -> *_index: `end` needs quoting as a Postgres identifier
    // (reserved in CASE...END etc.), simplest to just avoid it.
    start_index: link.start ?? null,
    end_index: link.end ?? null,
    occurrence_explanation: link.occurrenceExplanation ?? null,
    confirmed_by_learner: link.confirmedByLearner,
    source: link.source,
    created_at: link.createdAt,
    updated_at: link.updatedAt,
    deleted_at: null,
    version,
  };
}

export function remoteToSentenceGrammar(row: Record<string, unknown>): SentenceGrammar {
  return {
    id: String(row.id),
    sentenceId: String(row.sentence_id),
    grammarPatternId: String(row.grammar_pattern_id),
    chunkId: (row.chunk_id as string | null) ?? undefined,
    surfaceForm: (row.surface_form as string | null) ?? undefined,
    start: (row.start_index as number | null) ?? undefined,
    end: (row.end_index as number | null) ?? undefined,
    occurrenceExplanation: (row.occurrence_explanation as string | null) ?? undefined,
    confirmedByLearner: Boolean(row.confirmed_by_learner),
    source: row.source as SentenceGrammar['source'],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function grammarRelationshipToRemote(
  relationship: GrammarRelationship,
  ownerId: string,
  version: number,
) {
  return {
    id: relationship.id,
    owner_id: ownerId,
    pattern_a_id: relationship.patternAId,
    pattern_b_id: relationship.patternBId,
    relationship_type: relationship.relationshipType,
    notes: relationship.notes ?? null,
    observed_count: relationship.observedCount,
    last_observed_at: relationship.lastObservedAt,
    created_at: relationship.createdAt,
    updated_at: relationship.updatedAt,
    deleted_at: null,
    version,
  };
}

export function remoteToGrammarRelationship(
  row: Record<string, unknown>,
): GrammarRelationship {
  return {
    id: String(row.id),
    patternAId: String(row.pattern_a_id),
    patternBId: String(row.pattern_b_id),
    relationshipType: row.relationship_type as GrammarRelationship['relationshipType'],
    notes: (row.notes as string | null) ?? undefined,
    observedCount: Number(row.observed_count),
    lastObservedAt: String(row.last_observed_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function plannerSessionToRemote(
  session: PlannerSession,
  ownerId: string,
  version: number,
) {
  return {
    id: session.id,
    owner_id: ownerId,
    date: session.date,
    target_minutes: session.targetMinutes,
    allocation: session.allocation,
    explanation: session.explanation,
    steps: session.steps,
    status: session.status,
    ended_at: session.endedAt ?? null,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    deleted_at: null,
    version,
  };
}

export function remoteToPlannerSession(
  row: Record<string, unknown>,
): PlannerSession {
  return {
    id: String(row.id),
    date: String(row.date),
    targetMinutes: Number(row.target_minutes ?? 0),
    allocation: (row.allocation as PlannerSession['allocation']) ?? {},
    explanation: Array.isArray(row.explanation) ? (row.explanation as string[]) : [],
    steps: Array.isArray(row.steps) ? (row.steps as PlannerSession['steps']) : [],
    status: row.status as PlannerSession['status'],
    endedAt: (row.ended_at as string | null) ?? undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function syncIssueReportToRemote(
  report: SyncIssueReport,
  ownerId: string,
  version: number,
) {
  return {
    id: report.id,
    owner_id: ownerId,
    note: report.note,
    diagnostics_snapshot: report.diagnosticsSnapshot,
    conflict_entity: report.conflictEntity ?? null,
    conflict_record_id: report.conflictRecordId ?? null,
    status: report.status,
    resolved_at: report.resolvedAt ?? null,
    created_at: report.createdAt,
    updated_at: report.updatedAt,
    deleted_at: null,
    version,
  };
}

export function remoteToSyncIssueReport(
  row: Record<string, unknown>,
): SyncIssueReport {
  return {
    id: String(row.id),
    note: String(row.note),
    diagnosticsSnapshot: String(row.diagnostics_snapshot),
    conflictEntity: (row.conflict_entity as string | null) ?? undefined,
    conflictRecordId: (row.conflict_record_id as string | null) ?? undefined,
    status: row.status as SyncIssueReport['status'],
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
    case 'grammar_patterns':
      return grammarPatternToRemote(payload as GrammarPattern, ownerId, version);
    case 'sentence_grammar':
      return sentenceGrammarToRemote(payload as SentenceGrammar, ownerId, version);
    case 'grammar_relationships':
      return grammarRelationshipToRemote(payload as GrammarRelationship, ownerId, version);
    case 'planner_sessions':
      return plannerSessionToRemote(payload as PlannerSession, ownerId, version);
    case 'sync_issue_reports':
      return syncIssueReportToRemote(payload as SyncIssueReport, ownerId, version);
  }
}

export function idColumnForEntity(entity: SyncEntity): string {
  if (entity === 'analyses' || entity === 'inbox') return 'sentence_id';
  return 'id';
}
