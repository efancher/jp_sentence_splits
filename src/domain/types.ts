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
  /**
   * Reference-audio playback rate in effect when this attempt was recorded
   * (e.g. 0.5 for a half-speed listen-and-shadow). Undefined for attempts
   * recorded before this was tracked — treat as 1 (native speed) then.
   * Lets analysis compare duration against the pace the learner actually
   * practiced at, not always the reference clip's native speed.
   */
  referencePlaybackRate?: number;
  /**
   * Set when this attempt was saved from the guided/progressive practice
   * flow's final "Record & Compare" stage (ShadowPage.tsx). Only that stage
   * persists — the earlier Listen/Repeat/Delayed/Close reps are ephemeral
   * and never reach this table, so 'final' is the only value ever written.
   */
  practiceStage?: 'final';
  /**
   * Groups attempts recorded during the same guided-practice run (one
   * `crypto.randomUUID()` minted per run). Undefined for free-form attempts.
   */
  practiceSessionId?: string;
  createdAt: string;
}

/** Shape returned by the forced-alignment service (docs/STATUS.md Phase 9). */
export interface PhoneAlignment {
  start: number;
  end: number;
  text: string;
}

export interface WordAlignment {
  start: number;
  end: number;
  text: string;
  phones: PhoneAlignment[];
}

export interface AlignmentResult {
  durationSeconds: number;
  words: WordAlignment[];
}

/**
 * Cached forced alignment for a sentence's reference clip (Phase 9,
 * Milestone 2b) — reference audio doesn't change, so this is kept
 * indefinitely unless `alignmentVersion` goes stale. Local-only, same
 * precedent as `Attempt` (§18): derived/recomputable data, not worth
 * syncing.
 */
export interface ReferenceAlignment {
  /** = SentenceAudio.id */
  id: string;
  alignmentVersion: number;
  result: AlignmentResult;
  computedAt: string;
}

/** Cached forced alignment for one shadowing attempt (Phase 9, Milestone 2b). */
export interface AttemptAlignment {
  /** = Attempt.id */
  id: string;
  alignmentVersion: number;
  result: AlignmentResult;
  computedAt: string;
}

/**
 * Cached ASR transcription of a learner attempt (Phase 9, Milestone 7) —
 * a secondary, non-authoritative diagnostic signal only. No
 * reference-side equivalent: the reference transcript is already known.
 * Local-only, same precedent as `AttemptAlignment`.
 */
export interface AttemptTranscription {
  /** = Attempt.id */
  id: string;
  transcriptionVersion: number;
  text: string;
  computedAt: string;
}

/**
 * Lightweight per-attempt analysis summary (Phase 9, Milestone 8) —
 * deliberately not every derived observation forever, just enough to show
 * a trend over time ("Timing: needs work" -> "improving" -> "close").
 * Full detail is already recomputable on demand from the cached
 * alignment/transcription (Milestones 2b/7). Local-only, same precedent
 * as the other attempt-scoped analysis caches.
 */
export interface AttemptAnalysisSummary {
  /** = Attempt.id */
  id: string;
  sentenceId: string;
  createdAt: string;
  analysisSummaryVersion: number;
  /** Max severity (0-1) among this attempt's timing-category observations, 0 if none. */
  timingSeverity: number;
  /** Max severity (0-1) among this attempt's pitch-category observations, 0 if none. */
  pitchSeverity: number;
  primaryIssueKind?: string;
  primaryIssueMessage?: string;
  /** The primary issue's own severity (0-1) — distinct from timingSeverity/pitchSeverity, which are category maxes, not necessarily this specific observation's value. Used for cross-recording comparison (docs/STATUS.md). */
  primaryIssueSeverity?: number;
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

/**
 * A candidate grammar construction detected in a sentence (grammar-learning
 * system, see docs/AI_OVERVIEW.md) — embedded, not a table, mirroring
 * VocabularySuggestion's shape: a lightweight, non-canonical hint that only
 * materializes into a real GrammarPattern/SentenceGrammar row once the
 * learner acts on it (Got it / Explain / Track). Lives on SentenceAnalysis
 * rather than Sentence (unlike VocabularySuggestion) because grammar
 * detection is an analysis-time concern — it needs the sentence text and
 * potentially the chunk structure — not an import-time tokenizer artifact.
 */
export interface GrammarSuggestion {
  id: string;
  /** Proposed display form, e.g. "〜わけがない" — matched against GrammarPattern.canonicalName/aliases on confirm. */
  candidateName: string;
  /** Set once resolved to an existing canonical pattern (dedup/merge, not a fresh create). */
  matchedPatternId?: string;
  start?: number;
  end?: number;
  chunkId?: string;
  shortMeaning?: string;
  /** 0-1, when supplied by an AI suggestion; absent for manual entries. */
  confidence?: number;
  /** Coarse priority so Analyze can show only what's worth noticing (design brief §16). */
  rank: 'important' | 'familiar' | 'nuance' | 'optional';
  source: 'ai' | 'manual';
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
  /**
   * Grammar-pattern candidates surfaced for this sentence (design brief §3).
   * Additive, same precedent as vocabularySelections/vocabularyReviewStatus
   * (Phase 5): declared required here, but analyses saved before this field
   * existed won't actually have it at runtime — readers should still treat
   * it defensively (`?? []`), same as remoteToAnalysis already does for the
   * other additive SentenceAnalysis fields.
   */
  grammarSuggestions: GrammarSuggestion[];
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
  /**
   * Learning Orchestrator (docs/AI_OVERVIEW.md): starting budget (minutes)
   * for a brand-new daily session, before any top-up. Mirrors
   * DEFAULT_DAILY_BUDGET_MINUTES in sessionPlannerConfig.ts, which remains
   * the shipped default.
   */
  dailyBudgetMinutes: number;
  /**
   * Learning Orchestrator (docs/AI_OVERVIEW.md): user-adjustable starting
   * heuristic for how a session's time splits across the four concrete
   * activity buckets before neglect-based nudging — a guideline, not a
   * quota (see allocateTimeAcrossModes). Shares don't need to sum to 1;
   * they're renormalized proportionally each time. Set directly on Home
   * right before adding time (2026-08-26 follow-up), not on Settings.
   * Mirrors BASELINE_SESSION_ALLOCATION in sessionPlannerConfig.ts, which
   * remains the shipped default.
   */
  sessionAllocation: Record<SessionBucket, number>;
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
  /**
   * Mora index of the pitch-accent drop, from the Kanjium dictionary
   * (0 = heiban, 1 = atamadaka, N = nakadaka/odaka). Array because a word
   * can have more than one accepted accent. Absent/empty means not yet
   * backfilled or no dictionary match (`scripts/backfill-pitch-accent.ts`).
   */
  pitchAccentPositions?: number[];
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
export type StudySubjectType =
  | 'sentence'
  | 'vocabularyItem'
  | 'chunk'
  | 'vocabularyConfusion'
  | 'grammarPattern';

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

export type CardIssueStatus = 'open' | 'resolved';

/**
 * A learner-authored free-text flag on a review card ("this reading looks
 * wrong", "translation doesn't match") — a lightweight substitute for
 * fixing the card mid-review. `sentenceId` is the sentence shown at report
 * time (absent for subject types with no single sentence, e.g. a
 * contrastive pair spanning two). Meant to be batched: reported during
 * study, resolved later in one sitting (`/issues`, or a future Claude
 * session reading them via `scripts/list-card-issues.ts`), not acted on
 * immediately.
 */
export interface CardIssueReport {
  id: string;
  studyItemId: string;
  sentenceId?: string;
  activityType: StudyActivityType;
  note: string;
  status: CardIssueStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

// ---------------------------------------------------------------------------
// Grammar-learning system (docs/AI_OVERVIEW.md) — additive. Layer 2 on top of
// the existing Cure-Dolly structural analysis (SentenceAnalysis.chunks,
// unchanged): GrammarPattern is the reusable Japanese construction (analogous
// to VocabularyItem), SentenceGrammar is one encounter with it in one
// sentence (analogous to SentenceVocabulary), GrammarRelationship is a typed
// edge between two patterns (structurally mirrors VocabularyConfusion but is
// its own table — see docs/STATUS.md design notes). GrammarPattern rows are
// only ever created from a real encounter (materialized from a
// GrammarSuggestion on learner confirm) — no pre-seeded taxonomy, matching
// this app's "native media first" principle.
// ---------------------------------------------------------------------------

/**
 * The reusable Japanese construction (e.g. ～わけがない), canonical across
 * the whole corpus — never exists in an "unconfirmed" state, mirroring
 * VocabularyItem (only GrammarSuggestion, embedded on SentenceAnalysis, is
 * ever provisional).
 */
export interface GrammarPattern {
  id: string;
  /** Display form, e.g. "〜わけがない". */
  canonicalName: string;
  /**
   * Dedup key (leading/trailing tilde/wave-dash and whitespace stripped,
   * NFC-normalized — see src/lib/grammarPatterns.ts). Deliberately *not*
   * kanji/kana-variant-aware in v1 (e.g. 訳がない vs わけがない still create
   * distinct rows) — that class of canonicalization is AI-assisted
   * merge-on-confirm work, not automatic exact-match dedup.
   */
  normalizedKey: string;
  /** Known variant surface forms/spellings, e.g. ["わけない", "訳がない"]. */
  aliases: string[];
  /** Concise communicative function — not a dictionary definition. */
  shortMeaning: string;
  /** e.g. "[verb/adj plain form] + わけがない". */
  structuralTemplate?: string;
  /** Literal/structural mechanics + communicative function + natural English — not collapsed into one gloss (design brief §4). */
  explanation?: string;
  /** Cure-Dolly-compatible structural breakdown, complementing (not replacing) AnalysisChunk. */
  structuralNotes?: string;
  /** Loose functional grouping tag, free string like StudyActivityType — no fixed ontology. */
  family?: string;
  notes?: string;
  provenance: 'manual' | 'ai_suggested';
  /** For future idempotent seeding/import; unused by any current writer. */
  externalId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * One encounter with a GrammarPattern in one Sentence — analogous to
 * SentenceVocabulary. `chunkId` is not a real FK (AnalysisChunk lives inside
 * one jsonb blob per sentence), same accepted limitation as
 * SentenceVocabulary.chunkId.
 */
export interface SentenceGrammar {
  id: string;
  sentenceId: string;
  grammarPatternId: string;
  chunkId?: string;
  /** Exact text as it appeared in this sentence, e.g. "わけないでしょ". */
  surfaceForm?: string;
  start?: number;
  end?: number;
  /** Explanation specific to *this* occurrence — what the construction is doing here, not the pattern's generic explanation. */
  occurrenceExplanation?: string;
  /**
   * True once the learner has explicitly acted on this occurrence (Got it /
   * Explain / Track) — false for an AI-suggested occurrence nobody has
   * looked at yet. Does not by itself imply a StudyItem exists; see
   * ensureGrammarStudyItem in repository.ts.
   */
  confirmedByLearner: boolean;
  source: 'manual' | 'ai_suggested';
  createdAt: string;
  updatedAt: string;
}

/**
 * A typed edge between two GrammarPatterns (design brief §7/§8) — structural
 * sibling of VocabularyConfusion (same canonicalized-pair/get-or-create/
 * observation-count shape) rather than a literal reuse: VocabularyConfusion's
 * itemAId/itemBId are non-polymorphic FKs into vocabulary_items and its
 * confusionType values (reading/kanji/transitivity) don't apply to grammar.
 * Unlike VocabularyConfusion, more than one relationship row can exist for
 * the same pair (one per distinct relationshipType) — two patterns can be
 * both a `structural_relative` and, independently, `commonly_confused`, and
 * collapsing those into a single typed field would lose one of the facts.
 */
export type GrammarRelationshipType =
  | 'similar_meaning'
  | 'contrast'
  | 'commonly_confused'
  | 'stronger_stance'
  | 'weaker_stance'
  | 'formal_variant'
  | 'structural_relative';

export interface GrammarRelationship {
  id: string;
  /** Canonicalized patternAId < patternBId, so a pair is never stored twice in both directions for the same relationshipType. */
  patternAId: string;
  patternBId: string;
  relationshipType: GrammarRelationshipType;
  notes?: string;
  observedCount: number;
  lastObservedAt: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Learning Orchestrator (docs/AI_OVERVIEW.md) — additive, local-only (no sync
// wiring, same precedent as Attempt/ReferenceAlignment). A scheduling/
// recommendation layer on top of the existing StudyItem/Review/Attempt/
// SentenceGrammar data, not a parallel content model: PlannerSession only
// ever *references* existing subjects (sentences, vocabulary items, grammar
// patterns, study items) by id, it never duplicates their data. Distinct
// from AppSettings.newCardsPerSessionLimit's "session planner" (an existing,
// unrelated per-sitting new-card cap on ReviewPage) — this is a separate
// concept, deliberately named differently to avoid confusion.
// ---------------------------------------------------------------------------

/**
 * The four concrete activities the Orchestrator schedules a session's time
 * across (docs/AI_OVERVIEW.md; reworked 2026-08-26 from an earlier abstract
 * Explore/Understand/Practice/Retain taxonomy that user feedback found not
 * concrete enough to set percentages against directly): `glossing`
 * (structural analysis + vocab confirmation on new sentences), `grammar`
 * (examining not-yet-tracked patterns), `shadowing` (pronunciation
 * practice), `review` (every FSRS due card — comprehension, cloze,
 * production, grammar drills, etc. — one shared due-queue, one bucket).
 */
export type SessionBucket = 'glossing' | 'grammar' | 'shadowing' | 'review';

export type PlannerStepStatus = 'pending' | 'active' | 'completed' | 'skipped' | 'replaced';

/**
 * What a step's "Go" action opens. Deliberately deep-links into existing
 * pages/flows rather than rebuilding their UI inside the runner — the
 * Orchestrator sequences and tracks activities, it doesn't reimplement them.
 */
export type PlannerStepTargetKind =
  | 'continue_book'
  | 'grammar_detail'
  | 'shadow'
  | 'review'
  | 'vocabulary_detail'
  | 'vocabulary_review';

export interface PlannerSessionStep {
  id: string;
  bucket: SessionBucket;
  /** A real StudyActivityType for review-surface steps; a synthetic label (e.g. 'shadowing_practice', 'new_sentence', 'grammar_explore') for steps with no StudyItem of their own. */
  activityType: string;
  targetKind: PlannerStepTargetKind;
  bookId?: string;
  sentenceId?: string;
  grammarPatternId?: string;
  vocabularyItemId?: string;
  label: string;
  estimatedMinutes: number;
  /** Short human-readable reason this specific step was chosen (design brief §7's "not opaque" requirement), e.g. "Encountered 3 times, not tracked yet." */
  reason: string;
  status: PlannerStepStatus;
  startedAt?: string;
  completedAt?: string;
  /** Lightweight implicit-feedback signal (design brief §9) — set only when the learner explicitly flags it, never required. */
  feedback?: 'too_easy' | 'difficult';
  /** Item count this step targets, currently only set for `review` steps (batched "do N due reviews") — lets ReviewPage track live progress toward it rather than parsing the label. */
  targetCount?: number;
}

/**
 * One calendar day's recommended session — a single growing list the
 * learner can pick up in small pieces throughout the day rather than a
 * fixed-length sitting. `date` (local `YYYY-MM-DD`) is the natural key: at
 * most one `PlannerSession` per day, found via `date` rather than always
 * creating a new record. `targetMinutes`/`allocation`/`steps` grow each
 * time more time is added (`addMinutesToTodaySession`); `explanation`
 * accumulates one entry per top-up, so it reads as the story of the whole
 * day rather than being overwritten. `steps` already-settled
 * (completed/skipped) are never touched by a later top-up — only new steps
 * are appended, or an unstarted due-batch step is left alone rather than
 * duplicated (see `addMinutesToTodaySession`'s own comment).
 */
export interface PlannerSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Local calendar day this session belongs to, `YYYY-MM-DD` — see `localDateKey`. */
  date: string;
  targetMinutes: number;
  allocation: Record<SessionBucket, number>;
  explanation: string[];
  steps: PlannerSessionStep[];
  status: 'in_progress' | 'completed' | 'ended_early';
  endedAt?: string;
}
