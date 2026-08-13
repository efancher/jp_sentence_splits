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

export const sentenceAnalysisSchema = z.object({
  sentenceId: z.string(),
  chunks: z.array(analysisChunkSchema),
  notes: z.string(),
  status: analysisStatusSchema,
  formatVersion: z.number().default(ANALYSIS_FORMAT_VERSION),
  vocabularyReviewStatus: vocabularyReviewStatusSchema.default('unreviewed'),
  vocabularySelections: z.array(vocabularySelectionSchema).default([]),
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
});

export const inboxMembershipSchema = z.object({
  sentenceId: z.string(),
  importBatchId: z.string(),
  addedAt: z.string(),
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
  }),
  books: z.array(bookSchema),
  sentences: z.array(sentenceSchema),
  bookSentences: z.array(bookSentenceSchema),
  analyses: z.array(sentenceAnalysisSchema),
  importBatches: z.array(importBatchSchema),
  inbox: z.array(inboxMembershipSchema),
  settings: settingsSchema,
});

export type BackupPayload = z.infer<typeof backupSchema>;

// ---------------------------------------------------------------------------
// Unified study model (docs/UNIFIED_APP_ARCHITECTURE.md §8) — additive.
// Not yet part of backupSchema — added once these tables carry real data.
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

export const vocabularyItemSchema = z.object({
  id: z.string(),
  expression: z.string().min(1),
  reading: z.string(),
  meaning: z.string(),
  partOfSpeech: z.string().optional(),
  notes: z.string().optional(),
  externalId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const sentenceVocabularySchema = z.object({
  id: z.string(),
  sentenceId: z.string(),
  vocabularyItemId: z.string(),
  chunkId: z.string().optional(),
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

export const studySubjectTypeSchema = z.enum(['sentence', 'vocabularyItem', 'chunk']);

export const fsrsStateSchema = z.object({
  due: z.string(),
  stability: z.number(),
  difficulty: z.number(),
  elapsedDays: z.number(),
  scheduledDays: z.number(),
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  state: z.enum(['new', 'learning', 'review', 'relearning']),
  lastReview: z.string().optional(),
});

export const studyItemSchema = z.object({
  id: z.string(),
  subjectType: studySubjectTypeSchema,
  subjectId: z.string(),
  // Intentionally a bare string, not the closed union above — see StudyActivityType.
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

export const reviewSchema = z.object({
  id: z.string(),
  studyItemId: z.string(),
  timestamp: z.string(),
  rating: reviewRatingSchema,
  responseRaw: z.string().optional(),
  expectedAnswer: z.string().optional(),
  elapsedMs: z.number().nonnegative().optional(),
  errorClassification: errorClassificationSchema.optional(),
});
