import { APP_VERSION, BACKUP_FORMAT_VERSION } from '../appConfig';
import { backupSchema, type BackupPayload } from '../domain/schemas';
import type {
  AppSettings,
  Book,
  BookSentence,
  ImportBatch,
  InboxMembership,
  Kanji,
  Review,
  Sentence,
  SentenceAnalysis,
  SentenceVocabulary,
  StudyItem,
  VocabularyItem,
  VocabularyKanji,
} from '../domain/types';
import { hashString } from './ids';

export interface BackupBundle {
  books: Book[];
  sentences: Sentence[];
  bookSentences: BookSentence[];
  analyses: SentenceAnalysis[];
  importBatches: ImportBatch[];
  inbox: InboxMembership[];
  studyItems: StudyItem[];
  reviews: Review[];
  vocabularyItems: VocabularyItem[];
  sentenceVocabulary: SentenceVocabulary[];
  kanji: Kanji[];
  vocabularyKanji: VocabularyKanji[];
  settings: AppSettings;
}

export function buildBackupPayload(bundle: BackupBundle): BackupPayload {
  const payload: BackupPayload = {
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    counts: {
      books: bundle.books.length,
      sentences: bundle.sentences.length,
      bookSentences: bundle.bookSentences.length,
      analyses: bundle.analyses.length,
      importBatches: bundle.importBatches.length,
      inbox: bundle.inbox.length,
      studyItems: bundle.studyItems.length,
      reviews: bundle.reviews.length,
      vocabularyItems: bundle.vocabularyItems.length,
      sentenceVocabulary: bundle.sentenceVocabulary.length,
      kanji: bundle.kanji.length,
      vocabularyKanji: bundle.vocabularyKanji.length,
    },
    books: bundle.books,
    sentences: bundle.sentences,
    bookSentences: bundle.bookSentences,
    analyses: bundle.analyses,
    importBatches: bundle.importBatches,
    inbox: bundle.inbox,
    studyItems: bundle.studyItems,
    reviews: bundle.reviews,
    vocabularyItems: bundle.vocabularyItems,
    sentenceVocabulary: bundle.sentenceVocabulary,
    kanji: bundle.kanji,
    vocabularyKanji: bundle.vocabularyKanji,
    settings: bundle.settings,
  };
  const checksum = hashString(
    JSON.stringify({
      ...payload,
      checksum: undefined,
    }),
  );
  return { ...payload, checksum };
}

export function parseBackupJson(raw: string): {
  ok: true;
  data: BackupPayload;
} | {
  ok: false;
  errors: string[];
} {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ['Backup file is not valid JSON.'] };
  }

  const result = backupSchema.safeParse(json);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map(
        (issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`,
      ),
    };
  }
  return { ok: true, data: result.data };
}

export function filterBackupForBook(
  payload: BackupPayload,
  bookId: string,
): BackupPayload {
  const book = payload.books.find((item) => item.id === bookId);
  if (!book) {
    throw new Error(`Book ${bookId} not found in backup`);
  }
  const memberships = payload.bookSentences.filter(
    (item) => item.bookId === bookId,
  );
  const sentenceIds = new Set(memberships.map((item) => item.sentenceId));
  const sentences = payload.sentences.filter((item) => sentenceIds.has(item.id));
  const analyses = payload.analyses.filter((item) =>
    sentenceIds.has(item.sentenceId),
  );
  const importBatchIds = new Set(
    sentences.flatMap((item) => item.importBatchIds),
  );
  const studyItems = payload.studyItems.filter(
    (item) => item.subjectType === 'sentence' && sentenceIds.has(item.subjectId),
  );
  const studyItemIds = new Set(studyItems.map((item) => item.id));
  const reviews = payload.reviews.filter((item) =>
    studyItemIds.has(item.studyItemId),
  );
  const sentenceVocabulary = payload.sentenceVocabulary.filter((item) =>
    sentenceIds.has(item.sentenceId),
  );
  const vocabularyItemIds = new Set(
    sentenceVocabulary.map((item) => item.vocabularyItemId),
  );
  const vocabularyItems = payload.vocabularyItems.filter((item) =>
    vocabularyItemIds.has(item.id),
  );
  const vocabularyKanji = payload.vocabularyKanji.filter((item) =>
    vocabularyItemIds.has(item.vocabularyItemId),
  );
  const kanjiIds = new Set(vocabularyKanji.map((item) => item.kanjiId));
  const kanji = payload.kanji.filter((item) => kanjiIds.has(item.id));
  const bundle = buildBackupPayload({
    books: [book],
    sentences,
    bookSentences: memberships,
    analyses,
    importBatches: payload.importBatches.filter((item) =>
      importBatchIds.has(item.id),
    ),
    inbox: [],
    studyItems,
    reviews,
    vocabularyItems,
    sentenceVocabulary,
    kanji,
    vocabularyKanji,
    settings: payload.settings,
  });
  return bundle;
}
