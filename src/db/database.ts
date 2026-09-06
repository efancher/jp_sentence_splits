import Dexie, { type EntityTable, type Transaction } from 'dexie';

import { DB_NAME } from '../appConfig';
import type {
  AppSettings,
  Attempt,
  AttemptAlignment,
  AttemptAnalysisSummary,
  AttemptTranscription,
  Book,
  BookSentence,
  CardIssueReport,
  GrammarPattern,
  GrammarRelationship,
  ImportBatch,
  InboxMembership,
  Kanji,
  PlannerSession,
  ReferenceAlignment,
  Review,
  Sentence,
  SentenceAudio,
  SentenceAnalysis,
  SentenceGrammar,
  SentenceVocabulary,
  Source,
  StudyItem,
  SyncIssueReport,
  VocabularyConfusion,
  VocabularyItem,
  VocabularyKanji,
} from '../domain/types';
import type {
  SyncConflict,
  SyncMetaState,
  SyncQueueItem,
  SyncRecordMeta,
} from '../sync/types';
import type { ReferencePitchTrack } from '../lib/pitch';
import {
  BASELINE_SESSION_ALLOCATION,
  DEFAULT_DAILY_BUDGET_MINUTES,
} from '../lib/sessionPlannerConfig';

export const DEFAULT_TTS_SETTINGS = {
  rate: 0.9,
  pitch: 1.0,
  volume: 1.0,
} as const;

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'settings',
  theme: 'system',
  hideSatoriEnglishInitially: true,
  showReadingsInitially: false,
  defaultImportDestination: 'inbox',
  textDisplayMode: 'plain',
  tts: { ...DEFAULT_TTS_SETTINGS },
  newCardsPerSessionLimit: 20,
  graduationMinScheduledDays: 180,
  dailyBudgetMinutes: DEFAULT_DAILY_BUDGET_MINUTES,
  sessionAllocation: { ...BASELINE_SESSION_ALLOCATION },
  quietMode: false,
};

export class GlossbookDatabase extends Dexie {
  books!: EntityTable<Book, 'id'>;
  sentences!: EntityTable<Sentence, 'id'>;
  bookSentences!: EntityTable<BookSentence, 'id'>;
  analyses!: EntityTable<SentenceAnalysis, 'sentenceId'>;
  importBatches!: EntityTable<ImportBatch, 'id'>;
  inbox!: EntityTable<InboxMembership, 'sentenceId'>;
  settings!: EntityTable<AppSettings, 'id'>;
  sentenceAudio!: EntityTable<SentenceAudio, 'id'>;
  syncMeta!: EntityTable<SyncMetaState, 'id'>;
  syncQueue!: EntityTable<SyncQueueItem, 'id'>;
  syncRecordMeta!: EntityTable<SyncRecordMeta, 'key'>;
  syncConflicts!: EntityTable<SyncConflict, 'id'>;
  // Unified study model (docs/UNIFIED_APP_ARCHITECTURE.md §8) — additive,
  // not yet written to by any UI. Sync-engine wiring (mappers.ts,
  // SyncEntity) deferred until a writer exists (Phase 2+).
  sources!: EntityTable<Source, 'id'>;
  vocabularyItems!: EntityTable<VocabularyItem, 'id'>;
  sentenceVocabulary!: EntityTable<SentenceVocabulary, 'id'>;
  kanji!: EntityTable<Kanji, 'id'>;
  vocabularyKanji!: EntityTable<VocabularyKanji, 'id'>;
  studyItems!: EntityTable<StudyItem, 'id'>;
  reviews!: EntityTable<Review, 'id'>;
  // Shadowing practice core loop (docs/UNIFIED_APP_ARCHITECTURE.md §12,
  // Phase 3) — local-only, no sync wiring.
  attempts!: EntityTable<Attempt, 'id'>;
  // Interference/confusion tracking (Phase 7.1) — see docs/STATUS.md.
  vocabularyConfusions!: EntityTable<VocabularyConfusion, 'id'>;
  // Cached forced-alignment results (Phase 9, Milestone 2b) — local-only,
  // derived/recomputable data, no sync wiring, same precedent as `attempts`.
  referenceAlignments!: EntityTable<ReferenceAlignment, 'id'>;
  // Measured YIN pitch track of a reference clip (sentence-level pitch
  // overlay) — local-only derived cache, same precedent as referenceAlignments.
  referencePitchTracks!: EntityTable<ReferencePitchTrack, 'id'>;
  attemptAlignments!: EntityTable<AttemptAlignment, 'id'>;
  // Cached ASR transcriptions (Phase 9, Milestone 7) — learner attempts
  // only, same local-only precedent.
  attemptTranscriptions!: EntityTable<AttemptTranscription, 'id'>;
  // Lightweight per-attempt analysis summaries for the history view
  // (Phase 9, Milestone 8) — local-only, same precedent.
  attemptAnalysisSummaries!: EntityTable<AttemptAnalysisSummary, 'id'>;
  // Learner-reported card issues ("this reading looks wrong"), synced like
  // study_items/reviews so a future session can review a batch via
  // scripts/list-card-issues.ts — see docs/STATUS.md.
  cardIssueReports!: EntityTable<CardIssueReport, 'id'>;
  // Grammar-learning system (docs/AI_OVERVIEW.md) — Layer 2 on top of the
  // existing Cure-Dolly structural analysis. See src/db/repository.ts's
  // "Grammar patterns" section.
  grammarPatterns!: EntityTable<GrammarPattern, 'id'>;
  sentenceGrammar!: EntityTable<SentenceGrammar, 'id'>;
  grammarRelationships!: EntityTable<GrammarRelationship, 'id'>;
  // Learning Orchestrator (docs/AI_OVERVIEW.md) — recommended-session history.
  // Local-only, same precedent as `attempts`: this is execution history, not
  // durable content, and re-planning always works from live StudyItem/Review
  // data regardless of what's here.
  plannerSessions!: EntityTable<PlannerSession, 'id'>;
  // Learner-reported sync trouble ("more conflicts than expected"), synced
  // like cardIssueReports so a future session can review a batch via
  // scripts/list-sync-issues.ts — see docs/STATUS.md.
  syncIssueReports!: EntityTable<SyncIssueReport, 'id'>;

  constructor(name = DB_NAME) {
    super(name);

    this.version(1).stores({
      books: 'id, title, archived, updatedAt, lastOpenedAt',
      sentences: 'id, normalizedKey, updatedAt, earliestCreatedAt, latestCreatedAt',
      bookSentences: 'id, bookId, sentenceId, [bookId+sentenceId], position, status',
      analyses: 'sentenceId, status, updatedAt',
      importBatches: 'id, importedAt, batchName',
      inbox: 'sentenceId, importBatchId, addedAt',
      settings: 'id',
    });

    // Example future migration hook — keep versions explicit.
    this.version(2)
      .stores({
        books: 'id, title, archived, updatedAt, lastOpenedAt',
        sentences:
          'id, normalizedKey, updatedAt, earliestCreatedAt, latestCreatedAt',
        bookSentences:
          'id, bookId, sentenceId, [bookId+sentenceId], position, status',
        analyses: 'sentenceId, status, updatedAt',
        importBatches: 'id, importedAt, batchName',
        inbox: 'sentenceId, importBatchId, addedAt',
        settings: 'id',
      })
      .upgrade(async (tx) => {
        await migrateSettingsV2(tx);
      });

    this.version(3)
      .stores({
        books: 'id, title, archived, updatedAt, lastOpenedAt',
        sentences:
          'id, normalizedKey, updatedAt, earliestCreatedAt, latestCreatedAt',
        bookSentences:
          'id, bookId, sentenceId, [bookId+sentenceId], position, status, chapterId',
        analyses: 'sentenceId, status, updatedAt',
        importBatches: 'id, importedAt, batchName',
        inbox: 'sentenceId, importBatchId, addedAt',
        settings: 'id',
      })
      .upgrade(async (tx) => {
        await tx
          .table<Book>('books')
          .toCollection()
          .modify((book) => {
            book.chapters ??= [];
          });
      });

    this.version(4).stores({
      books: 'id, title, sourceKey, archived, updatedAt, lastOpenedAt',
      sentences:
        'id, normalizedKey, updatedAt, earliestCreatedAt, latestCreatedAt',
      bookSentences:
        'id, bookId, sentenceId, [bookId+sentenceId], position, status, chapterId',
      analyses: 'sentenceId, status, updatedAt',
      importBatches: 'id, importedAt, batchName',
      inbox: 'sentenceId, importBatchId, addedAt',
      settings: 'id',
      sentenceAudio:
        'id, sentenceId, sourceId, [sourceId+sourceSentenceId], importedAt',
    });

    this.version(5).stores({
      books: 'id, title, sourceKey, archived, updatedAt, lastOpenedAt',
      sentences:
        'id, normalizedKey, updatedAt, earliestCreatedAt, latestCreatedAt',
      bookSentences:
        'id, bookId, sentenceId, [bookId+sentenceId], position, status, chapterId',
      analyses: 'sentenceId, status, updatedAt',
      importBatches: 'id, importedAt, batchName',
      inbox: 'sentenceId, importBatchId, addedAt',
      settings: 'id',
      sentenceAudio:
        'id, sentenceId, sourceId, [sourceId+sourceSentenceId], importedAt',
      syncMeta: 'id',
      syncQueue: 'id, entity, recordId, [entity+recordId], localTimestamp',
      syncRecordMeta: 'key, entity, recordId, updatedAt',
      syncConflicts: 'id, entity, recordId, createdAt, resolvedAt',
    });

    // Unified study model (docs/UNIFIED_APP_ARCHITECTURE.md §8/§15 Phase 1).
    // Purely additive — every store above is unchanged.
    this.version(6).stores({
      books: 'id, title, sourceKey, archived, updatedAt, lastOpenedAt',
      sentences:
        'id, normalizedKey, updatedAt, earliestCreatedAt, latestCreatedAt',
      bookSentences:
        'id, bookId, sentenceId, [bookId+sentenceId], position, status, chapterId',
      analyses: 'sentenceId, status, updatedAt',
      importBatches: 'id, importedAt, batchName',
      inbox: 'sentenceId, importBatchId, addedAt',
      settings: 'id',
      sentenceAudio:
        'id, sentenceId, sourceId, [sourceId+sourceSentenceId], importedAt',
      syncMeta: 'id',
      syncQueue: 'id, entity, recordId, [entity+recordId], localTimestamp',
      syncRecordMeta: 'key, entity, recordId, updatedAt',
      syncConflicts: 'id, entity, recordId, createdAt, resolvedAt',
      sources: 'id, type, externalId, updatedAt',
      vocabularyItems:
        'id, expression, [expression+reading], externalId, updatedAt',
      sentenceVocabulary:
        'id, sentenceId, vocabularyItemId, [sentenceId+vocabularyItemId], chunkId',
      kanji: 'id, character, externalId, updatedAt',
      vocabularyKanji:
        'id, vocabularyItemId, kanjiId, [vocabularyItemId+kanjiId]',
      studyItems:
        'id, subjectType, subjectId, activityType, [subjectType+subjectId+activityType], updatedAt',
      reviews: 'id, studyItemId, timestamp',
    });

    // Shadowing practice core loop (docs/UNIFIED_APP_ARCHITECTURE.md §12,
    // Phase 3). Local-only user recordings — no sync wiring (§18).
    this.version(7).stores({
      books: 'id, title, sourceKey, archived, updatedAt, lastOpenedAt',
      sentences:
        'id, normalizedKey, updatedAt, earliestCreatedAt, latestCreatedAt',
      bookSentences:
        'id, bookId, sentenceId, [bookId+sentenceId], position, status, chapterId',
      analyses: 'sentenceId, status, updatedAt',
      importBatches: 'id, importedAt, batchName',
      inbox: 'sentenceId, importBatchId, addedAt',
      settings: 'id',
      sentenceAudio:
        'id, sentenceId, sourceId, [sourceId+sourceSentenceId], importedAt',
      syncMeta: 'id',
      syncQueue: 'id, entity, recordId, [entity+recordId], localTimestamp',
      syncRecordMeta: 'key, entity, recordId, updatedAt',
      syncConflicts: 'id, entity, recordId, createdAt, resolvedAt',
      sources: 'id, type, externalId, updatedAt',
      vocabularyItems:
        'id, expression, [expression+reading], externalId, updatedAt',
      sentenceVocabulary:
        'id, sentenceId, vocabularyItemId, [sentenceId+vocabularyItemId], chunkId',
      kanji: 'id, character, externalId, updatedAt',
      vocabularyKanji:
        'id, vocabularyItemId, kanjiId, [vocabularyItemId+kanjiId]',
      studyItems:
        'id, subjectType, subjectId, activityType, [subjectType+subjectId+activityType], updatedAt',
      reviews: 'id, studyItemId, timestamp',
      attempts: 'id, sentenceId, createdAt, manualRating',
    });

    // Interference/confusion tracking (Phase 7.1, see docs/STATUS.md) —
    // purely additive, every store above is unchanged.
    this.version(8).stores({
      books: 'id, title, sourceKey, archived, updatedAt, lastOpenedAt',
      sentences:
        'id, normalizedKey, updatedAt, earliestCreatedAt, latestCreatedAt',
      bookSentences:
        'id, bookId, sentenceId, [bookId+sentenceId], position, status, chapterId',
      analyses: 'sentenceId, status, updatedAt',
      importBatches: 'id, importedAt, batchName',
      inbox: 'sentenceId, importBatchId, addedAt',
      settings: 'id',
      sentenceAudio:
        'id, sentenceId, sourceId, [sourceId+sourceSentenceId], importedAt',
      syncMeta: 'id',
      syncQueue: 'id, entity, recordId, [entity+recordId], localTimestamp',
      syncRecordMeta: 'key, entity, recordId, updatedAt',
      syncConflicts: 'id, entity, recordId, createdAt, resolvedAt',
      sources: 'id, type, externalId, updatedAt',
      vocabularyItems:
        'id, expression, [expression+reading], externalId, updatedAt',
      sentenceVocabulary:
        'id, sentenceId, vocabularyItemId, [sentenceId+vocabularyItemId], chunkId',
      kanji: 'id, character, externalId, updatedAt',
      vocabularyKanji:
        'id, vocabularyItemId, kanjiId, [vocabularyItemId+kanjiId]',
      studyItems:
        'id, subjectType, subjectId, activityType, [subjectType+subjectId+activityType], updatedAt',
      reviews: 'id, studyItemId, timestamp',
      attempts: 'id, sentenceId, createdAt, manualRating',
      vocabularyConfusions:
        'id, itemAId, itemBId, [itemAId+itemBId], updatedAt',
    });

    this.version(9).stores({
      books: 'id, title, sourceKey, archived, updatedAt, lastOpenedAt',
      sentences:
        'id, normalizedKey, updatedAt, earliestCreatedAt, latestCreatedAt',
      bookSentences:
        'id, bookId, sentenceId, [bookId+sentenceId], position, status, chapterId',
      analyses: 'sentenceId, status, updatedAt',
      importBatches: 'id, importedAt, batchName',
      inbox: 'sentenceId, importBatchId, addedAt',
      settings: 'id',
      sentenceAudio:
        'id, sentenceId, sourceId, [sourceId+sourceSentenceId], importedAt',
      syncMeta: 'id',
      syncQueue: 'id, entity, recordId, [entity+recordId], localTimestamp',
      syncRecordMeta: 'key, entity, recordId, updatedAt',
      syncConflicts: 'id, entity, recordId, createdAt, resolvedAt',
      sources: 'id, type, externalId, updatedAt',
      vocabularyItems:
        'id, expression, [expression+reading], externalId, updatedAt',
      sentenceVocabulary:
        'id, sentenceId, vocabularyItemId, [sentenceId+vocabularyItemId], chunkId',
      kanji: 'id, character, externalId, updatedAt',
      vocabularyKanji:
        'id, vocabularyItemId, kanjiId, [vocabularyItemId+kanjiId]',
      studyItems:
        'id, subjectType, subjectId, activityType, [subjectType+subjectId+activityType], updatedAt',
      reviews: 'id, studyItemId, timestamp',
      attempts: 'id, sentenceId, createdAt, manualRating',
      vocabularyConfusions:
        'id, itemAId, itemBId, [itemAId+itemBId], updatedAt',
      referenceAlignments: 'id',
      attemptAlignments: 'id',
    });

    this.version(10).stores({
      books: 'id, title, sourceKey, archived, updatedAt, lastOpenedAt',
      sentences:
        'id, normalizedKey, updatedAt, earliestCreatedAt, latestCreatedAt',
      bookSentences:
        'id, bookId, sentenceId, [bookId+sentenceId], position, status, chapterId',
      analyses: 'sentenceId, status, updatedAt',
      importBatches: 'id, importedAt, batchName',
      inbox: 'sentenceId, importBatchId, addedAt',
      settings: 'id',
      sentenceAudio:
        'id, sentenceId, sourceId, [sourceId+sourceSentenceId], importedAt',
      syncMeta: 'id',
      syncQueue: 'id, entity, recordId, [entity+recordId], localTimestamp',
      syncRecordMeta: 'key, entity, recordId, updatedAt',
      syncConflicts: 'id, entity, recordId, createdAt, resolvedAt',
      sources: 'id, type, externalId, updatedAt',
      vocabularyItems:
        'id, expression, [expression+reading], externalId, updatedAt',
      sentenceVocabulary:
        'id, sentenceId, vocabularyItemId, [sentenceId+vocabularyItemId], chunkId',
      kanji: 'id, character, externalId, updatedAt',
      vocabularyKanji:
        'id, vocabularyItemId, kanjiId, [vocabularyItemId+kanjiId]',
      studyItems:
        'id, subjectType, subjectId, activityType, [subjectType+subjectId+activityType], updatedAt',
      reviews: 'id, studyItemId, timestamp',
      attempts: 'id, sentenceId, createdAt, manualRating',
      vocabularyConfusions:
        'id, itemAId, itemBId, [itemAId+itemBId], updatedAt',
      referenceAlignments: 'id',
      attemptAlignments: 'id',
      attemptTranscriptions: 'id',
    });

    this.version(11).stores({
      books: 'id, title, sourceKey, archived, updatedAt, lastOpenedAt',
      sentences:
        'id, normalizedKey, updatedAt, earliestCreatedAt, latestCreatedAt',
      bookSentences:
        'id, bookId, sentenceId, [bookId+sentenceId], position, status, chapterId',
      analyses: 'sentenceId, status, updatedAt',
      importBatches: 'id, importedAt, batchName',
      inbox: 'sentenceId, importBatchId, addedAt',
      settings: 'id',
      sentenceAudio:
        'id, sentenceId, sourceId, [sourceId+sourceSentenceId], importedAt',
      syncMeta: 'id',
      syncQueue: 'id, entity, recordId, [entity+recordId], localTimestamp',
      syncRecordMeta: 'key, entity, recordId, updatedAt',
      syncConflicts: 'id, entity, recordId, createdAt, resolvedAt',
      sources: 'id, type, externalId, updatedAt',
      vocabularyItems:
        'id, expression, [expression+reading], externalId, updatedAt',
      sentenceVocabulary:
        'id, sentenceId, vocabularyItemId, [sentenceId+vocabularyItemId], chunkId',
      kanji: 'id, character, externalId, updatedAt',
      vocabularyKanji:
        'id, vocabularyItemId, kanjiId, [vocabularyItemId+kanjiId]',
      studyItems:
        'id, subjectType, subjectId, activityType, [subjectType+subjectId+activityType], updatedAt',
      reviews: 'id, studyItemId, timestamp',
      attempts: 'id, sentenceId, createdAt, manualRating',
      vocabularyConfusions:
        'id, itemAId, itemBId, [itemAId+itemBId], updatedAt',
      referenceAlignments: 'id',
      attemptAlignments: 'id',
      attemptTranscriptions: 'id',
      attemptAnalysisSummaries: 'id, sentenceId, createdAt',
    });

    // Card issue reports — purely additive, every store above is unchanged.
    this.version(12).stores({
      books: 'id, title, sourceKey, archived, updatedAt, lastOpenedAt',
      sentences:
        'id, normalizedKey, updatedAt, earliestCreatedAt, latestCreatedAt',
      bookSentences:
        'id, bookId, sentenceId, [bookId+sentenceId], position, status, chapterId',
      analyses: 'sentenceId, status, updatedAt',
      importBatches: 'id, importedAt, batchName',
      inbox: 'sentenceId, importBatchId, addedAt',
      settings: 'id',
      sentenceAudio:
        'id, sentenceId, sourceId, [sourceId+sourceSentenceId], importedAt',
      syncMeta: 'id',
      syncQueue: 'id, entity, recordId, [entity+recordId], localTimestamp',
      syncRecordMeta: 'key, entity, recordId, updatedAt',
      syncConflicts: 'id, entity, recordId, createdAt, resolvedAt',
      sources: 'id, type, externalId, updatedAt',
      vocabularyItems:
        'id, expression, [expression+reading], externalId, updatedAt',
      sentenceVocabulary:
        'id, sentenceId, vocabularyItemId, [sentenceId+vocabularyItemId], chunkId',
      kanji: 'id, character, externalId, updatedAt',
      vocabularyKanji:
        'id, vocabularyItemId, kanjiId, [vocabularyItemId+kanjiId]',
      studyItems:
        'id, subjectType, subjectId, activityType, [subjectType+subjectId+activityType], updatedAt',
      reviews: 'id, studyItemId, timestamp',
      attempts: 'id, sentenceId, createdAt, manualRating',
      vocabularyConfusions:
        'id, itemAId, itemBId, [itemAId+itemBId], updatedAt',
      referenceAlignments: 'id',
      attemptAlignments: 'id',
      attemptTranscriptions: 'id',
      attemptAnalysisSummaries: 'id, sentenceId, createdAt',
      cardIssueReports: 'id, studyItemId, sentenceId, status, createdAt',
    });

    // Grammar-learning system foundation — purely additive, every store
    // above is unchanged.
    this.version(13).stores({
      books: 'id, title, sourceKey, archived, updatedAt, lastOpenedAt',
      sentences:
        'id, normalizedKey, updatedAt, earliestCreatedAt, latestCreatedAt',
      bookSentences:
        'id, bookId, sentenceId, [bookId+sentenceId], position, status, chapterId',
      analyses: 'sentenceId, status, updatedAt',
      importBatches: 'id, importedAt, batchName',
      inbox: 'sentenceId, importBatchId, addedAt',
      settings: 'id',
      sentenceAudio:
        'id, sentenceId, sourceId, [sourceId+sourceSentenceId], importedAt',
      syncMeta: 'id',
      syncQueue: 'id, entity, recordId, [entity+recordId], localTimestamp',
      syncRecordMeta: 'key, entity, recordId, updatedAt',
      syncConflicts: 'id, entity, recordId, createdAt, resolvedAt',
      sources: 'id, type, externalId, updatedAt',
      vocabularyItems:
        'id, expression, [expression+reading], externalId, updatedAt',
      sentenceVocabulary:
        'id, sentenceId, vocabularyItemId, [sentenceId+vocabularyItemId], chunkId',
      kanji: 'id, character, externalId, updatedAt',
      vocabularyKanji:
        'id, vocabularyItemId, kanjiId, [vocabularyItemId+kanjiId]',
      studyItems:
        'id, subjectType, subjectId, activityType, [subjectType+subjectId+activityType], updatedAt',
      reviews: 'id, studyItemId, timestamp',
      attempts: 'id, sentenceId, createdAt, manualRating',
      vocabularyConfusions:
        'id, itemAId, itemBId, [itemAId+itemBId], updatedAt',
      referenceAlignments: 'id',
      attemptAlignments: 'id',
      attemptTranscriptions: 'id',
      attemptAnalysisSummaries: 'id, sentenceId, createdAt',
      cardIssueReports: 'id, studyItemId, sentenceId, status, createdAt',
      grammarPatterns: 'id, canonicalName, normalizedKey, updatedAt',
      sentenceGrammar:
        'id, sentenceId, grammarPatternId, [sentenceId+grammarPatternId], chunkId, updatedAt',
      grammarRelationships:
        'id, patternAId, patternBId, [patternAId+patternBId+relationshipType], relationshipType, updatedAt',
    });

    // Learning Orchestrator (recommended-session history) — purely
    // additive, local-only (see plannerSessions field comment above).
    this.version(14).stores({
      books: 'id, title, sourceKey, archived, updatedAt, lastOpenedAt',
      sentences:
        'id, normalizedKey, updatedAt, earliestCreatedAt, latestCreatedAt',
      bookSentences:
        'id, bookId, sentenceId, [bookId+sentenceId], position, status, chapterId',
      analyses: 'sentenceId, status, updatedAt',
      importBatches: 'id, importedAt, batchName',
      inbox: 'sentenceId, importBatchId, addedAt',
      settings: 'id',
      sentenceAudio:
        'id, sentenceId, sourceId, [sourceId+sourceSentenceId], importedAt',
      syncMeta: 'id',
      syncQueue: 'id, entity, recordId, [entity+recordId], localTimestamp',
      syncRecordMeta: 'key, entity, recordId, updatedAt',
      syncConflicts: 'id, entity, recordId, createdAt, resolvedAt',
      sources: 'id, type, externalId, updatedAt',
      vocabularyItems:
        'id, expression, [expression+reading], externalId, updatedAt',
      sentenceVocabulary:
        'id, sentenceId, vocabularyItemId, [sentenceId+vocabularyItemId], chunkId',
      kanji: 'id, character, externalId, updatedAt',
      vocabularyKanji:
        'id, vocabularyItemId, kanjiId, [vocabularyItemId+kanjiId]',
      studyItems:
        'id, subjectType, subjectId, activityType, [subjectType+subjectId+activityType], updatedAt',
      reviews: 'id, studyItemId, timestamp',
      attempts: 'id, sentenceId, createdAt, manualRating',
      vocabularyConfusions:
        'id, itemAId, itemBId, [itemAId+itemBId], updatedAt',
      referenceAlignments: 'id',
      attemptAlignments: 'id',
      attemptTranscriptions: 'id',
      attemptAnalysisSummaries: 'id, sentenceId, createdAt',
      cardIssueReports: 'id, studyItemId, sentenceId, status, createdAt',
      grammarPatterns: 'id, canonicalName, normalizedKey, updatedAt',
      sentenceGrammar:
        'id, sentenceId, grammarPatternId, [sentenceId+grammarPatternId], chunkId, updatedAt',
      grammarRelationships:
        'id, patternAId, patternBId, [patternAId+patternBId+relationshipType], relationshipType, updatedAt',
      plannerSessions: 'id, status, createdAt',
    });

    // PlannerSession becomes a per-day, growable list (one session per
    // local calendar day, found by `date`, topped up in place) rather than
    // one fixed-length record per "Start Session" click — see PlannerSession's
    // field comment in ../domain/types.ts. Backfills `date` on any
    // already-existing local sessions from `createdAt` (best-effort — the
    // original local timezone isn't recorded, so this is an approximation
    // for pre-migration rows only).
    this.version(15)
      .stores({
        books: 'id, title, sourceKey, archived, updatedAt, lastOpenedAt',
        sentences:
          'id, normalizedKey, updatedAt, earliestCreatedAt, latestCreatedAt',
        bookSentences:
          'id, bookId, sentenceId, [bookId+sentenceId], position, status, chapterId',
        analyses: 'sentenceId, status, updatedAt',
        importBatches: 'id, importedAt, batchName',
        inbox: 'sentenceId, importBatchId, addedAt',
        settings: 'id',
        sentenceAudio:
          'id, sentenceId, sourceId, [sourceId+sourceSentenceId], importedAt',
        syncMeta: 'id',
        syncQueue: 'id, entity, recordId, [entity+recordId], localTimestamp',
        syncRecordMeta: 'key, entity, recordId, updatedAt',
        syncConflicts: 'id, entity, recordId, createdAt, resolvedAt',
        sources: 'id, type, externalId, updatedAt',
        vocabularyItems:
          'id, expression, [expression+reading], externalId, updatedAt',
        sentenceVocabulary:
          'id, sentenceId, vocabularyItemId, [sentenceId+vocabularyItemId], chunkId',
        kanji: 'id, character, externalId, updatedAt',
        vocabularyKanji:
          'id, vocabularyItemId, kanjiId, [vocabularyItemId+kanjiId]',
        studyItems:
          'id, subjectType, subjectId, activityType, [subjectType+subjectId+activityType], updatedAt',
        reviews: 'id, studyItemId, timestamp',
        attempts: 'id, sentenceId, createdAt, manualRating',
        vocabularyConfusions:
          'id, itemAId, itemBId, [itemAId+itemBId], updatedAt',
        referenceAlignments: 'id',
        attemptAlignments: 'id',
        attemptTranscriptions: 'id',
        attemptAnalysisSummaries: 'id, sentenceId, createdAt',
        cardIssueReports: 'id, studyItemId, sentenceId, status, createdAt',
        grammarPatterns: 'id, canonicalName, normalizedKey, updatedAt',
        sentenceGrammar:
          'id, sentenceId, grammarPatternId, [sentenceId+grammarPatternId], chunkId, updatedAt',
        grammarRelationships:
          'id, patternAId, patternBId, [patternAId+patternBId+relationshipType], relationshipType, updatedAt',
        plannerSessions: 'id, status, createdAt, date',
      })
      .upgrade(async (tx) => {
        await tx
          .table<PlannerSession>('plannerSessions')
          .toCollection()
          .modify((session) => {
            session.date ??= localDateKey(new Date(session.createdAt));
          });
      });

    // v16: measured reference-clip pitch tracks — additive, local-only
    // derived cache (same precedent as referenceAlignments), no upgrade.
    this.version(16).stores({
      books: 'id, title, sourceKey, archived, updatedAt, lastOpenedAt',
      sentences:
        'id, normalizedKey, updatedAt, earliestCreatedAt, latestCreatedAt',
      bookSentences:
        'id, bookId, sentenceId, [bookId+sentenceId], position, status, chapterId',
      analyses: 'sentenceId, status, updatedAt',
      importBatches: 'id, importedAt, batchName',
      inbox: 'sentenceId, importBatchId, addedAt',
      settings: 'id',
      sentenceAudio:
        'id, sentenceId, sourceId, [sourceId+sourceSentenceId], importedAt',
      syncMeta: 'id',
      syncQueue: 'id, entity, recordId, [entity+recordId], localTimestamp',
      syncRecordMeta: 'key, entity, recordId, updatedAt',
      syncConflicts: 'id, entity, recordId, createdAt, resolvedAt',
      sources: 'id, type, externalId, updatedAt',
      vocabularyItems:
        'id, expression, [expression+reading], externalId, updatedAt',
      sentenceVocabulary:
        'id, sentenceId, vocabularyItemId, [sentenceId+vocabularyItemId], chunkId',
      kanji: 'id, character, externalId, updatedAt',
      vocabularyKanji:
        'id, vocabularyItemId, kanjiId, [vocabularyItemId+kanjiId]',
      studyItems:
        'id, subjectType, subjectId, activityType, [subjectType+subjectId+activityType], updatedAt',
      reviews: 'id, studyItemId, timestamp',
      attempts: 'id, sentenceId, createdAt, manualRating',
      vocabularyConfusions:
        'id, itemAId, itemBId, [itemAId+itemBId], updatedAt',
      referenceAlignments: 'id',
      referencePitchTracks: 'id',
      attemptAlignments: 'id',
      attemptTranscriptions: 'id',
      attemptAnalysisSummaries: 'id, sentenceId, createdAt',
      cardIssueReports: 'id, studyItemId, sentenceId, status, createdAt',
      grammarPatterns: 'id, canonicalName, normalizedKey, updatedAt',
      sentenceGrammar:
        'id, sentenceId, grammarPatternId, [sentenceId+grammarPatternId], chunkId, updatedAt',
      grammarRelationships:
        'id, patternAId, patternBId, [patternAId+patternBId+relationshipType], relationshipType, updatedAt',
      plannerSessions: 'id, status, createdAt, date',
    });

    // Sync issue reports — purely additive, every store above is unchanged.
    this.version(17).stores({
      syncIssueReports: 'id, status, createdAt',
    });
  }
}

/** Local (not UTC) calendar-day key, `YYYY-MM-DD` — the natural key for "today's" PlannerSession. */
export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function migrateSettingsV2(tx: Transaction): Promise<void> {
  const table = tx.table('settings');
  const current = await table.get('settings');
  if (!current) {
    await table.put(DEFAULT_SETTINGS);
    return;
  }
  await table.put({
    ...DEFAULT_SETTINGS,
    ...current,
    id: 'settings',
  });
}

let dbInstance: GlossbookDatabase | null = null;

export function getDb(): GlossbookDatabase {
  if (!dbInstance) {
    dbInstance = new GlossbookDatabase();
  }
  return dbInstance;
}

/** Test helper: true once a test has actually called getDb()/resetDbForTests(). */
export function hasDbInstanceForTests(): boolean {
  return dbInstance !== null;
}

/** Test helper: replace the singleton with a fresh in-memory-named DB. */
export function resetDbForTests(name?: string): GlossbookDatabase {
  if (dbInstance) {
    dbInstance.close();
  }
  dbInstance = new GlossbookDatabase(name ?? `${DB_NAME}-test-${Date.now()}`);
  return dbInstance;
}

/** Test helper: null out the singleton so the next getDb() creates fresh. */
export function clearDbInstanceForTests(): void {
  dbInstance = null;
}

export async function readSettings(db = getDb()): Promise<AppSettings> {
  const existing = await db.settings.get('settings');
  if (!existing) return DEFAULT_SETTINGS;
  // Fill fields added after the record was written (e.g. tts) without a write.
  return { ...DEFAULT_SETTINGS, ...existing };
}

/** May write — do not call from a Dexie liveQuery callback. */
export async function ensureSettings(db = getDb()): Promise<AppSettings> {
  const existing = await db.settings.get('settings');
  if (existing) return existing;
  await db.settings.put(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}
