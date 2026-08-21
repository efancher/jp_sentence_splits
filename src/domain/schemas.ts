import { z } from 'zod';

import { ANALYSIS_FORMAT_VERSION, BACKUP_FORMAT_VERSION } from '../appConfig';

export const studyStatusSchema = z.enum([
  'unstarted',
  'in_progress',
  'complete',
  'needs_review',
]);

export const analysisStatusSchema = z.enum(['empty', 'in_progress', 'complete']);

export const targetVocabularySchema = z.object({
  expression: z.string(),
  reading: z.string(),
  furigana: z.string(),
  english: z.string(),
  partsOfSpeech: z.string(),
  sourceCardIds: z.array(z.string()),
  cardTypes: z.array(z.string()),
});

export const vocabularySuggestionSchema = z.object({
  id: z.string(),
  surface: z.string().min(1),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  expression: z.string().min(1),
  reading: z.string(),
  pos: z.string(),
  english: z.string().optional(),
  source: z.enum(['morphology', 'satori', 'manual']),
  selectedByDefault: z.boolean(),
});

export const vocabularySelectionSchema = z.object({
  id: z.string(),
  surface: z.string().min(1),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  expression: z.string().min(1),
  reading: z.string(),
  english: z.string().optional(),
  pos: z.string().optional(),
  source: z.enum(['suggestion', 'combined', 'manual']),
  suggestionIds: z.array(z.string()).optional(),
});

export const vocabularyReviewStatusSchema = z.enum(['unreviewed', 'confirmed']);

export const sourceReferenceSchema = z.object({
  cardId: z.string(),
  cardType: z.string(),
  contextNumber: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  whenCreated: z.string().optional(),
  userNotes: z.string().optional(),
  importBatchId: z.string(),
});

export const sourceConflictSchema = z.object({
  field: z.enum(['translation', 'readingOnly', 'inlineReading', 'japanese']),
  preferred: z.string(),
  alternatives: z.array(z.string()),
});

export const sentenceSchema = z.object({
  id: z.string(),
  normalizedKey: z.string(),
  japanese: z.string(),
  readingOnly: z.string(),
  inlineReading: z.string(),
  translation: z.string(),
  targetVocabulary: z.array(targetVocabularySchema),
  vocabularySuggestions: z.array(vocabularySuggestionSchema).default([]),
  sourceReferences: z.array(sourceReferenceSchema),
  conflicts: z.array(sourceConflictSchema),
  earliestCreatedAt: z.string().optional(),
  latestCreatedAt: z.string().optional(),
  firstOccurrenceIndex: z.number(),
  importBatchIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const bookSchema = z.object({
  id: z.string(),
  title: z.string(),
  sourceKey: z.string().optional(),
  subtitle: z.string().optional(),
  sourceUrl: z.string().optional(),
  notes: z.string().optional(),
  archived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastOpenedAt: z.string().optional(),
  chapters: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        position: z.number(),
      }),
    )
    .default([]),
  collapsedChapterIds: z.array(z.string()).default([]),
});

export const bookSentenceSchema = z.object({
  id: z.string(),
  bookId: z.string(),
  sentenceId: z.string(),
  position: z.number(),
  status: studyStatusSchema,
  addedAt: z.string(),
  lastStudiedAt: z.string().optional(),
  note: z.string().optional(),
  chapterId: z.string().optional(),
});

export const analysisChunkSchema = z.object({
  id: z.string(),
  order: z.number(),
  japanese: z.string(),
  role: z.string(),
  literalEnglish: z.string(),
  notes: z.string().optional(),
  kind: z.enum(['surface', 'zero_ga']).optional(),
});

export const grammarSuggestionSchema = z.object({
  id: z.string(),
  candidateName: z.string().min(1),
  matchedPatternId: z.string().optional(),
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().positive().optional(),
  chunkId: z.string().optional(),
  shortMeaning: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  rank: z.enum(['important', 'familiar', 'nuance', 'optional']),
  source: z.enum(['ai', 'manual']),
});

export const sentenceAnalysisSchema = z.object({
  sentenceId: z.string(),
  chunks: z.array(analysisChunkSchema),
  notes: z.string(),
  status: analysisStatusSchema,
  formatVersion: z.number().default(ANALYSIS_FORMAT_VERSION),
  vocabularyReviewStatus: vocabularyReviewStatusSchema.default('unreviewed'),
  vocabularySelections: z.array(vocabularySelectionSchema).default([]),
  // Additive (grammar-learning system): absent on analyses saved before this
  // field existed.
  grammarSuggestions: z.array(grammarSuggestionSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const importBatchSchema = z.object({
  id: z.string(),
  filename: z.string(),
  batchName: z.string(),
  importedAt: z.string(),
  counts: z.object({
    totalRows: z.number(),
    contextOccurrences: z.number(),
    uniqueSentences: z.number(),
    newSentences: z.number(),
    updatedSentences: z.number(),
    exactDuplicatesIgnored: z.number(),
    newVocabularyAssociations: z.number(),
    rowsSkipped: z.number(),
    warningCount: z.number(),
    conflictCount: z.number(),
  }),
  warnings: z.array(z.string()),
});

export const ttsSettingsSchema = z.object({
  voiceURI: z.string().optional(),
  preferredVoiceName: z.string().optional(),
  rate: z.number(),
  pitch: z.number(),
  volume: z.number(),
});

export const settingsSchema = z.object({
  id: z.literal('settings'),
  theme: z.enum(['system', 'light', 'dark']),
  hideSatoriEnglishInitially: z.boolean(),
  showReadingsInitially: z.boolean(),
  lastOpenedBookId: z.string().optional(),
  defaultImportDestination: z.enum(['inbox', 'new_book', 'existing_book']),
  textDisplayMode: z.enum(['plain', 'furigana', 'reading']),
  // Additive in backup format v1: absent in older backups.
  tts: ttsSettingsSchema.default({ rate: 0.9, pitch: 1.0, volume: 1.0 }),
  // Additive (Phase 7.10): absent in older backups.
  newCardsPerSessionLimit: z.number().int().nonnegative().default(20),
  // Additive (Phase 7.10): absent in older backups.
  graduationMinScheduledDays: z.number().int().nonnegative().default(180),
});

export const inboxMembershipSchema = z.object({
  sentenceId: z.string(),
  importBatchId: z.string(),
  addedAt: z.string(),
});

export const studySubjectTypeSchema = z.enum([
  'sentence',
  'vocabularyItem',
  'chunk',
  'vocabularyConfusion',
  'grammarPattern',
]);

export const fsrsStateSchema = z.object({
  due: z.string(),
  stability: z.number(),
  difficulty: z.number(),
  elapsedDays: z.number(),
  scheduledDays: z.number(),
  learningSteps: z.number().int().nonnegative(),
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  state: z.enum(['new', 'learning', 'review', 'relearning']),
  lastReview: z.string().optional(),
});

export const studyItemSchema = z.object({
  id: z.string(),
  subjectType: studySubjectTypeSchema,
  subjectId: z.string(),
  // Intentionally a bare string, not a closed union — see StudyActivityType.
  activityType: z.string().min(1),
  fsrsState: fsrsStateSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const reviewRatingSchema = z.enum(['again', 'hard', 'good', 'easy']);

export const errorClassificationSchema = z.union([
  z.enum([
    'incorrect_reading',
    'incorrect_meaning',
    'kanji_reading_interference',
    'vocabulary_confusion',
    'pronunciation_difficulty',
    'listening_failure',
    'grammar_misunderstanding',
  ]),
  z.object({ userDefined: z.string() }),
]);

export const reviewAssistanceSchema = z.enum([
  'furigana_shown',
  'translation_shown',
  'mnemonic_shown',
  'audio_replayed',
  'chunks_shown',
  'hint_shown',
  'multiple_choice',
]);

export const reviewSourceSchema = z.enum(['scheduled_review', 'natural_encounter']);

export const reviewSchema = z.object({
  id: z.string(),
  studyItemId: z.string(),
  timestamp: z.string(),
  rating: reviewRatingSchema,
  responseRaw: z.string().optional(),
  expectedAnswer: z.string().optional(),
  elapsedMs: z.number().nonnegative().optional(),
  errorClassification: errorClassificationSchema.optional(),
  assistance: z.array(reviewAssistanceSchema).optional(),
  source: reviewSourceSchema.optional(),
  contextSentenceId: z.string().optional(),
});

export const vocabularyConfusionTypeSchema = z.enum([
  'reading',
  'kanji',
  'meaning',
  'transitivity',
  'synonym',
  'grammar',
  'other',
]);

export const vocabularyConfusionSchema = z.object({
  id: z.string(),
  itemAId: z.string(),
  itemBId: z.string(),
  confusionType: vocabularyConfusionTypeSchema,
  observedCount: z.number().int().nonnegative(),
  lastObservedAt: z.string(),
  notes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const cardIssueStatusSchema = z.enum(['open', 'resolved']);

export const cardIssueReportSchema = z.object({
  id: z.string(),
  studyItemId: z.string(),
  sentenceId: z.string().optional(),
  activityType: z.string(),
  note: z.string().min(1),
  status: cardIssueStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  resolvedAt: z.string().optional(),
});

// Moved ahead of backupSchema (which now references them) — const bindings
// can't be forward-referenced across a module's top-level evaluation order,
// same reason fsrsStateSchema/studyItemSchema/reviewSchema were reordered in
// Phase 4.
export const vocabularyItemSchema = z.object({
  id: z.string(),
  expression: z.string().min(1),
  reading: z.string(),
  meaning: z.string(),
  partOfSpeech: z.string().optional(),
  notes: z.string().optional(),
  externalId: z.string().optional(),
  pitchAccentPositions: z.array(z.number()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const sentenceVocabularySchema = z.object({
  id: z.string(),
  sentenceId: z.string(),
  vocabularyItemId: z.string(),
  chunkId: z.string().optional(),
  surfaceForm: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const kanjiSchema = z.object({
  id: z.string(),
  // Not .length(1): that counts UTF-16 code units, which rejects legitimate
  // astral-plane kanji (e.g. 𠮟, U+20B9F, a real jinmeiyō character) that
  // JS represents as a surrogate pair. Iterate by code point instead, to
  // match Postgres's char_length() semantics used by the matching
  // kanji_character_single_char check constraint.
  character: z.string().refine((value) => [...value].length === 1, {
    message: 'character must be exactly one Unicode code point',
  }),
  meanings: z.array(z.string()),
  onyomi: z.array(z.string()),
  kunyomi: z.array(z.string()),
  nanori: z.array(z.string()),
  notes: z.string().optional(),
  externalId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const vocabularyKanjiSchema = z.object({
  id: z.string(),
  vocabularyItemId: z.string(),
  kanjiId: z.string(),
  positionInWord: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Grammar-learning system (docs/AI_OVERVIEW.md) — additive, same "moved
// ahead of backupSchema" reasoning as vocabularyItemSchema etc. above.
export const grammarPatternSchema = z.object({
  id: z.string(),
  canonicalName: z.string().min(1),
  normalizedKey: z.string(),
  aliases: z.array(z.string()).default([]),
  shortMeaning: z.string(),
  structuralTemplate: z.string().optional(),
  explanation: z.string().optional(),
  structuralNotes: z.string().optional(),
  family: z.string().optional(),
  notes: z.string().optional(),
  provenance: z.enum(['manual', 'ai_suggested']),
  externalId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const sentenceGrammarSchema = z.object({
  id: z.string(),
  sentenceId: z.string(),
  grammarPatternId: z.string(),
  chunkId: z.string().optional(),
  surfaceForm: z.string().optional(),
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().positive().optional(),
  occurrenceExplanation: z.string().optional(),
  confirmedByLearner: z.boolean(),
  source: z.enum(['manual', 'ai_suggested']),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const grammarRelationshipTypeSchema = z.enum([
  'similar_meaning',
  'contrast',
  'commonly_confused',
  'stronger_stance',
  'weaker_stance',
  'formal_variant',
  'structural_relative',
]);

export const grammarRelationshipSchema = z.object({
  id: z.string(),
  patternAId: z.string(),
  patternBId: z.string(),
  relationshipType: grammarRelationshipTypeSchema,
  notes: z.string().optional(),
  observedCount: z.number().int().nonnegative(),
  lastObservedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Learning Orchestrator (docs/AI_OVERVIEW.md) — additive, local-only. Moved
// ahead of backupSchema for the same forward-reference reason as
// vocabularyItemSchema/grammarPatternSchema above.
export const learningModeSchema = z.enum(['explore', 'understand', 'practice', 'retain']);
export const sessionLengthSchema = z.enum(['quick', 'normal', 'deep']);
export const plannerStepStatusSchema = z.enum([
  'pending',
  'active',
  'completed',
  'skipped',
  'replaced',
]);
export const plannerStepTargetKindSchema = z.enum([
  'continue_book',
  'grammar_detail',
  'shadow',
  'review',
  'vocabulary_detail',
]);

export const plannerSessionStepSchema = z.object({
  id: z.string(),
  mode: learningModeSchema,
  activityType: z.string().min(1),
  targetKind: plannerStepTargetKindSchema,
  bookId: z.string().optional(),
  sentenceId: z.string().optional(),
  grammarPatternId: z.string().optional(),
  vocabularyItemId: z.string().optional(),
  label: z.string(),
  estimatedMinutes: z.number().nonnegative(),
  reason: z.string(),
  status: plannerStepStatusSchema,
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  feedback: z.enum(['too_easy', 'difficult']).optional(),
});

export const plannerSessionSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  length: sessionLengthSchema,
  targetMinutes: z.number().positive(),
  allocation: z.record(learningModeSchema, z.number()),
  explanation: z.array(z.string()),
  steps: z.array(plannerSessionStepSchema),
  status: z.enum(['in_progress', 'completed', 'ended_early']),
  endedAt: z.string().optional(),
});

export const backupSchema = z.object({
  formatVersion: z.literal(BACKUP_FORMAT_VERSION),
  appVersion: z.string(),
  exportedAt: z.string(),
  checksum: z.string().optional(),
  counts: z.object({
    books: z.number(),
    sentences: z.number(),
    bookSentences: z.number(),
    analyses: z.number(),
    importBatches: z.number(),
    inbox: z.number(),
    studyItems: z.number(),
    reviews: z.number(),
    // .default(0)/.default([]) below (unlike studyItems/reviews above, which
    // aren't defaulted): backups exported before this change won't have
    // these keys at all, and without a default, restoring one would fail
    // safeParse outright instead of just importing zero rows for these
    // tables.
    vocabularyItems: z.number().default(0),
    sentenceVocabulary: z.number().default(0),
    kanji: z.number().default(0),
    vocabularyKanji: z.number().default(0),
    // Additive (grammar-learning system): same "missing key -> 0, not a
    // parse failure" reasoning as the vocabulary/kanji counts above.
    grammarPatterns: z.number().default(0),
    sentenceGrammar: z.number().default(0),
    grammarRelationships: z.number().default(0),
    // Additive (Learning Orchestrator): same "missing key -> 0" reasoning.
    plannerSessions: z.number().default(0),
  }),
  books: z.array(bookSchema),
  sentences: z.array(sentenceSchema),
  bookSentences: z.array(bookSentenceSchema),
  analyses: z.array(sentenceAnalysisSchema),
  importBatches: z.array(importBatchSchema),
  inbox: z.array(inboxMembershipSchema),
  studyItems: z.array(studyItemSchema),
  reviews: z.array(reviewSchema),
  vocabularyItems: z.array(vocabularyItemSchema).default([]),
  sentenceVocabulary: z.array(sentenceVocabularySchema).default([]),
  kanji: z.array(kanjiSchema).default([]),
  vocabularyKanji: z.array(vocabularyKanjiSchema).default([]),
  // Additive (grammar-learning system): backups exported before this change
  // won't have these keys at all — .default([]) so restoring one still
  // succeeds instead of failing safeParse (same lesson as Phase 5's own
  // documented fix for vocabularyItems/kanji/etc. above).
  grammarPatterns: z.array(grammarPatternSchema).default([]),
  sentenceGrammar: z.array(sentenceGrammarSchema).default([]),
  grammarRelationships: z.array(grammarRelationshipSchema).default([]),
  // Additive (Learning Orchestrator): backups exported before this feature
  // won't have this key — .default([]) so restoring one still succeeds.
  plannerSessions: z.array(plannerSessionSchema).default([]),
  settings: settingsSchema,
});

export type BackupPayload = z.infer<typeof backupSchema>;

// ---------------------------------------------------------------------------
// Unified study model (docs/UNIFIED_APP_ARCHITECTURE.md §8) — additive.
// studyItems/reviews (Phase 4) and vocabularyItems/sentenceVocabulary/kanji/
// vocabularyKanji (Phase 5) are part of backupSchema now that they carry real
// UI-written data. sources remains excluded — still nothing writes to it.
// ---------------------------------------------------------------------------

export const sourceTypeSchema = z.enum(['satori', 'youtube', 'podcast', 'manual', 'other']);

export const sourceSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  type: sourceTypeSchema,
  creator: z.string().optional(),
  url: z.string().optional(),
  externalId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

