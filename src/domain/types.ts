export type StudyStatus = 'unstarted' | 'in_progress' | 'complete' | 'needs_review';
export type AnalysisStatus = 'empty' | 'in_progress' | 'complete';
export type ThemePreference = 'system' | 'light' | 'dark';
export type ImportDestination = 'inbox' | 'new_book' | 'existing_book';
export type TextDisplayMode = 'plain' | 'furigana' | 'reading';
export type InitialOrderMode =
  | 'first_occurrence'
  | 'earliest_created'
  | 'latest_created'
  | 'japanese'
  | 'english'
  | 'manual';

export interface TargetVocabulary {
  expression: string;
  reading: string;
  furigana: string;
  english: string;
  partsOfSpeech: string;
  sourceCardIds: string[];
  cardTypes: string[];
}

/** Morphology / import-derived vocabulary suggestion for the picker. */
export interface VocabularySuggestion {
  id: string;
  surface: string;
  start: number;
  end: number;
  expression: string;
  reading: string;
  pos: string;
  english?: string;
  source: 'morphology' | 'satori' | 'manual';
  /** True when this suggestion should start checked in the picker. */
  selectedByDefault: boolean;
}

export type VocabularyReviewStatus = 'unreviewed' | 'confirmed';

/**
 * Authoritative vocabulary choice for Anki mining.
 * `surface`/`start`/`end` locate the exact span in the sentence Japanese.
 */
export interface VocabularySelection {
  id: string;
  surface: string;
  start: number;
  end: number;
  expression: string;
  reading: string;
  english?: string;
  pos?: string;
  source: 'suggestion' | 'combined' | 'manual';
  suggestionIds?: string[];
}

export interface SourceReference {
  cardId: string;
  cardType: string;
  contextNumber: 1 | 2 | 3;
  whenCreated?: string;
  userNotes?: string;
  importBatchId: string;
}

export interface SourceConflict {
  field: 'translation' | 'readingOnly' | 'inlineReading' | 'japanese';
  preferred: string;
  alternatives: string[];
}

export interface Sentence {
  id: string;
  normalizedKey: string;
  japanese: string;
  readingOnly: string;
  inlineReading: string;
  translation: string;
  targetVocabulary: TargetVocabulary[];
  /**
   * Clickable morphology / import suggestions for vocabulary review.
   * Separate from Satori `targetVocabulary` chips and Cure Dolly chunks.
   */
  vocabularySuggestions: VocabularySuggestion[];
  sourceReferences: SourceReference[];
  conflicts: SourceConflict[];
  earliestCreatedAt?: string;
  latestCreatedAt?: string;
  firstOccurrenceIndex: number;
  importBatchIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** Native/reference sentence audio imported from an external project. */
export interface SentenceAudio {
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
  blob: Blob;
  importedAt: string;
}

/** Manual A/B comparison rating against a sentence's reference audio. */
export type AttemptRating = 'better' | 'same' | 'worse' | 'unsure';

/**
 * A user's recorded shadowing attempt at a sentence
 * (docs/UNIFIED_APP_ARCHITECTURE.md §12, Phase 3). Local-only by design — no
 * sync wiring (§18). Blob stored inline, matching SentenceAudio's pattern
 * rather than a separate asset table, since each attempt's blob is 1:1 and
 * never reused.
 */
export interface Attempt {
  id: string;
  sentenceId: string;
  mimeType: string;
  durationMs: number;
  blob: Blob;
  notes?: string;
  manualRating?: AttemptRating;
  isFavorite?: boolean;
  createdAt: string;
}

export interface Book {
  id: string;
  title: string;
  /** Stable external-project identity, e.g. `shadowing:<source id>`. */
  sourceKey?: string;
  subtitle?: string;
  sourceUrl?: string;
  notes?: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  chapters: BookChapter[];
  /** Chapter ids (plus optional `__unassigned__`) currently hidden on the book list. */
  collapsedChapterIds: string[];
}

export interface BookChapter {
  id: string;
  title: string;
  position: number;
}

export interface BookSentence {
  id: string;
  bookId: string;
  sentenceId: string;
  position: number;
  status: StudyStatus;
  addedAt: string;
  lastStudiedAt?: string;
  note?: string;
  chapterId?: string;
}

export interface AnalysisChunk {
  id: string;
  order: number;
  japanese: string;
  role: string;
  literalEnglish: string;
  notes?: string;
  /**
   * `zero_ga` = invisible ∅が subject (not part of source Japanese).
   * Omitted or `surface` = normal chunk from the sentence text.
   */
  kind?: 'surface' | 'zero_ga';
}

export interface SentenceAnalysis {
  sentenceId: string;
  chunks: AnalysisChunk[];
  notes: string;
  status: AnalysisStatus;
  formatVersion: number;
  /** Vocabulary picker confirmation — independent of Cure Dolly chunk status. */
  vocabularyReviewStatus: VocabularyReviewStatus;
  vocabularySelections: VocabularySelection[];
  createdAt: string;
  updatedAt: string;
}

export interface ImportBatchCounts {
  totalRows: number;
  contextOccurrences: number;
  uniqueSentences: number;
  newSentences: number;
  updatedSentences: number;
  exactDuplicatesIgnored: number;
  newVocabularyAssociations: number;
  rowsSkipped: number;
  warningCount: number;
  conflictCount: number;
}

export interface ImportBatch {
  id: string;
  filename: string;
  batchName: string;
  importedAt: string;
  counts: ImportBatchCounts;
  warnings: string[];
}

export interface TtsSettings {
  /** Stable identifier of the preferred voice, when still installed. */
  voiceURI?: string;
  /** Human-readable fallback used when the voiceURI is no longer available. */
  preferredVoiceName?: string;
  rate: number;
  pitch: number;
  volume: number;
}

export interface AppSettings {
  id: 'settings';
  theme: ThemePreference;
  hideSatoriEnglishInitially: boolean;
  showReadingsInitially: boolean;
  lastOpenedBookId?: string;
  defaultImportDestination: ImportDestination;
  textDisplayMode: TextDisplayMode;
  tts: TtsSettings;
  /**
   * Session planner (Phase 7.10, docs/STATUS.md): caps how many new
   * (never-before-seeded) subjects ReviewPage introduces in one sitting —
   * a real number, not "0 = unlimited," so set it high if you want it out
   * of the way. Already-due reviews are never capped by this, only the
   * lazy-seeding of brand-new subjects.
   */
  newCardsPerSessionLimit: number;
  /**
   * Graduation (Phase 7.10, docs/STATUS.md): a study item stops being
   * treated as due once its FSRS interval (`scheduledDays`) grows past
   * this many days while in the stable `review` state — see
   * `isGraduated`, src/lib/scheduling.ts. `0` disables graduation
   * entirely (nothing ever retires from rotation).
   */
  graduationMinScheduledDays: number;
}

export interface InboxMembership {
  sentenceId: string;
  importBatchId: string;
  addedAt: string;
}

export type ParsedSentenceDraft = Omit<
  Sentence,
  'id' | 'createdAt' | 'updatedAt' | 'importBatchIds'
> & {
  importBatchIds?: string[];
};

// ---------------------------------------------------------------------------
// Unified study model (docs/UNIFIED_APP_ARCHITECTURE.md §8) — additive.
// None of the types above are changed by this section.
// ---------------------------------------------------------------------------

export type SourceType = 'satori' | 'youtube' | 'podcast' | 'manual' | 'other';

/** A place content came from — promotes Book.sourceKey/sourceUrl into a real entity. */
export interface Source {
  id: string;
  title: string;
  type: SourceType;
  creator?: string;
  url?: string;
  /** e.g. shadowmine's videoId — stable identity for dedup on re-import. */
  externalId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * A normalized word. Unique on (expression, reading) — deliberately *not*
 * unique on expression alone, since homophones (e.g. 週間/習慣) must stay
 * distinct (mirrors Anki's lemma_key and JMDict's own indexing).
 */
export interface VocabularyItem {
  id: string;
  expression: string;
  reading: string;
  meaning: string;
  partOfSpeech?: string;
  notes?: string;
  /** Stable id from an ingestion source (e.g. `wk:{subjectId}`, `jmdict:{entryId}`) for idempotent re-import. */
  externalId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Links a sentence (optionally a specific chunk) to a canonical VocabularyItem. */
export interface SentenceVocabulary {
  id: string;
  sentenceId: string;
  vocabularyItemId: string;
  chunkId?: string;
  /**
   * The exact conjugated/inflected text as it appeared in this sentence
   * (e.g. 表れていた for the dictionary form 表れる) — copied from
   * VocabularySelection.surface at materialization time. Used to highlight/
   * mask this specific occurrence in review UI (Phase 7.2). Undefined for
   * links created before this field existed or outside the picker (e.g. the
   * one-time Anki import) — those are simply not eligible as reading-
   * retrieval targets.
   */
  surfaceForm?: string;
  createdAt: string;
  updatedAt: string;
}

/** A single kanji character and its possible readings. */
export interface Kanji {
  id: string;
  character: string;
  meanings: string[];
  onyomi: string[];
  kunyomi: string[];
  nanori: string[];
  notes?: string;
  externalId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Which kanji appear in a vocabulary item's expression, and where — the
 * structure needed to eventually target "the reading of this word in
 * context" rather than an unordered list of a kanji's possible readings.
 */
export interface VocabularyKanji {
  id: string;
  vocabularyItemId: string;
  kanjiId: string;
  positionInWord: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * `vocabularyConfusion` added Phase 7.6 (docs/STATUS.md) — reserved ahead
 * of its first real consumer (Phase 7.7's contrastive review), same
 * precedent as `vocabularyItem` being reserved in Phase 1 before Phase 7.2
 * became its first consumer. subjectId for that type is a
 * VocabularyConfusion.id.
 */
export type StudySubjectType = 'sentence' | 'vocabularyItem' | 'chunk' | 'vocabularyConfusion';

/**
 * activityType is intentionally a plain string, not a closed union — new
 * activity types (comprehension, listening, reading, vocab_in_context,
 * cloze, build, shadowing, ...) are additive, never a schema change.
 */
export type StudyActivityType = string;

/** Opaque to everything except the scheduler — shaped to match ts-fsrs's Card. */
export interface FsrsState {
  due: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  /** ts-fsrs 6's within-day (re)learning step counter. */
  learningSteps: number;
  reps: number;
  lapses: number;
  state: 'new' | 'learning' | 'review' | 'relearning';
  lastReview?: string;
}

export interface StudyItem {
  id: string;
  subjectType: StudySubjectType;
  subjectId: string;
  activityType: StudyActivityType;
  fsrsState: FsrsState;
  createdAt: string;
  updatedAt: string;
}

/** FSRS's 4-point review-rating scale. */
export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

/**
 * Deliberately open-ended (§13): the schema must not prevent recording a
 * classification, but nothing populates this automatically yet.
 */
export type ErrorClassification =
  | 'incorrect_reading'
  | 'incorrect_meaning'
  | 'kanji_reading_interference'
  | 'vocabulary_confusion'
  | 'pronunciation_difficulty'
  | 'listening_failure'
  | 'grammar_misunderstanding'
  | { userDefined: string };

/**
 * What help the learner used to reach this answer (docs, brief §17). A
 * correct-with-help answer is weaker evidence than unaided retrieval, but is
 * never penalized — this is purely informational for the scheduler/planner.
 */
export type ReviewAssistance =
  | 'furigana_shown'
  | 'translation_shown'
  | 'mnemonic_shown'
  | 'audio_replayed'
  | 'chunks_shown'
  | 'hint_shown'
  | 'multiple_choice';

/**
 * Where this evidence came from (brief §9/§16). Absent/undefined means
 * `scheduled_review` (the only kind recorded today) — kept optional rather
 * than defaulted so existing Review rows need no migration.
 */
export type ReviewSource = 'scheduled_review' | 'natural_encounter';

/** Append-only — never updated after insert. Sync-conflict-free by construction. */
export interface Review {
  id: string;
  studyItemId: string;
  timestamp: string;
  rating: ReviewRating;
  responseRaw?: string;
  expectedAnswer?: string;
  elapsedMs?: number;
  errorClassification?: ErrorClassification;
  assistance?: ReviewAssistance[];
  source?: ReviewSource;
  /**
   * The sentence this evidence actually came from — may differ from the
   * study item's originally-seeded sentence, e.g. a natural encounter with a
   * vocabulary item in a different sentence than the one that first
   * generated its study item.
   */
  contextSentenceId?: string;
}

/**
 * A learner-observed confusion between two vocabulary items (docs brief
 * §10), e.g. 表す vs 表れる, transitive/intransitive pairs, similar kanji.
 * Undirected: itemAId/itemBId are canonicalized so a pair is never stored
 * twice in both directions. Not auto-populated in this phase — created
 * manually or by a future one-time seeding script (see docs/STATUS.md).
 */
export type VocabularyConfusionType =
  | 'reading'
  | 'kanji'
  | 'meaning'
  | 'transitivity'
  | 'synonym'
  | 'grammar'
  | 'other';

export interface VocabularyConfusion {
  id: string;
  itemAId: string;
  itemBId: string;
  confusionType: VocabularyConfusionType;
  observedCount: number;
  lastObservedAt: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
