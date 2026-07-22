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
