import type {
  Book,
  BookSentence,
  ImportBatch,
  InboxMembership,
  Sentence,
  SentenceAnalysis,
  SentenceAudio,
} from '../domain/types';
import type { SyncEntity } from './types';

export type LocalSyncPayload =
  | Book
  | Sentence
  | BookSentence
  | SentenceAnalysis
  | ImportBatch
  | InboxMembership
  | ReferenceAudioLocal;

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
  }
}

export function idColumnForEntity(entity: SyncEntity): string {
  if (entity === 'analyses' || entity === 'inbox') return 'sentence_id';
  return 'id';
}
