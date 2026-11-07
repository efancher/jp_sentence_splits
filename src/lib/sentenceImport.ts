import type {
  ImportBatchCounts,
  ParsedSentenceDraft,
  SourceConflict,
  SourceReference,
  TargetVocabulary,
  VocabularySuggestion,
} from '../domain/types';
import { normalizeExpressionKey } from './normalize';
import { mergeVocabularySuggestions } from './vocabularySuggestions';

/**
 * Types and merge rules shared by every sentence import path (YouTube/podcast
 * mining, Shadowmine packages, series episodes). The Satori CSV parser that
 * used to live beside these was removed 2026-11-07; a copy survives only as
 * the test fixture loader in tests/helpers/satoriCsvFixture.ts.
 */

export interface ImportWarning {
  message: string;
  rowNumber?: number;
}

export interface ImportPreviewSentence {
  draft: ParsedSentenceDraft;
  proposedId: string;
  isNew: boolean;
  willUpdate: boolean;
  selected: boolean;
}

export interface ImportPreview {
  filename: string;
  batchName: string;
  totalRows: number;
  drafts: ImportPreviewSentence[];
  counts: ImportBatchCounts;
  warnings: ImportWarning[];
}

export interface ExistingSentenceLookup {
  id: string;
  normalizedKey: string;
  japanese: string;
  readingOnly: string;
  inlineReading: string;
  translation: string;
  targetVocabulary: TargetVocabulary[];
  vocabularySuggestions?: VocabularySuggestion[];
  sourceReferences: SourceReference[];
  conflicts: SourceConflict[];
  earliestCreatedAt?: string;
  latestCreatedAt?: string;
  firstOccurrenceIndex: number;
  importBatchIds: string[];
}

export function mergeTimes(
  a?: string,
  b?: string,
): { earliest?: string; latest?: string } {
  const values = [a, b].filter((value): value is string => Boolean(value));
  if (!values.length) return {};
  const sorted = [...values].sort();
  return { earliest: sorted[0], latest: sorted[sorted.length - 1] };
}

export function mergeVocabulary(
  existing: TargetVocabulary[],
  next: TargetVocabulary,
): { list: TargetVocabulary[]; added: boolean } {
  const key = normalizeExpressionKey(next.expression, next.reading);
  const index = existing.findIndex(
    (item) => normalizeExpressionKey(item.expression, item.reading) === key,
  );
  if (index < 0) {
    return { list: [...existing, next], added: true };
  }
  const current = existing[index]!;
  const merged: TargetVocabulary = {
    ...current,
    expression: current.expression || next.expression,
    reading: current.reading || next.reading,
    furigana: current.furigana || next.furigana,
    english: current.english || next.english,
    partsOfSpeech: current.partsOfSpeech || next.partsOfSpeech,
    sourceCardIds: Array.from(
      new Set([...current.sourceCardIds, ...next.sourceCardIds]),
    ),
    cardTypes: Array.from(new Set([...current.cardTypes, ...next.cardTypes])),
  };
  const list = [...existing];
  list[index] = merged;
  return { list, added: false };
}

export function recordConflict(
  conflicts: SourceConflict[],
  field: SourceConflict['field'],
  preferred: string,
  alternative: string,
): SourceConflict[] {
  if (!alternative || alternative === preferred) return conflicts;
  const existing = conflicts.find((item) => item.field === field);
  if (!existing) {
    return [
      ...conflicts,
      { field, preferred, alternatives: [alternative] },
    ];
  }
  if (
    existing.alternatives.includes(alternative) ||
    existing.preferred === alternative
  ) {
    return conflicts;
  }
  return conflicts.map((item) =>
    item.field === field
      ? {
          ...item,
          alternatives: [...item.alternatives, alternative],
        }
      : item,
  );
}

export function uniqueRefs(refs: SourceReference[]): SourceReference[] {
  const seen = new Set<string>();
  const result: SourceReference[] = [];
  for (const ref of refs) {
    const key = `${ref.cardId}|${ref.cardType}|${ref.contextNumber}|${ref.importBatchId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}

export function mergeSentenceOnReimport(
  existing: ExistingSentenceLookup,
  draft: ParsedSentenceDraft,
  importBatchId: string,
): ExistingSentenceLookup {
  let targetVocabulary = existing.targetVocabulary;
  for (const vocab of draft.targetVocabulary) {
    targetVocabulary = mergeVocabulary(targetVocabulary, vocab).list;
  }

  let conflicts = [...existing.conflicts, ...draft.conflicts];
  let translation = existing.translation;
  let readingOnly = existing.readingOnly;
  let inlineReading = existing.inlineReading;

  if (draft.translation) {
    if (!translation) translation = draft.translation;
    else if (draft.translation !== translation) {
      conflicts = recordConflict(
        conflicts,
        'translation',
        translation,
        draft.translation,
      );
    }
  }
  if (draft.readingOnly) {
    if (!readingOnly) readingOnly = draft.readingOnly;
    else if (draft.readingOnly !== readingOnly) {
      conflicts = recordConflict(
        conflicts,
        'readingOnly',
        readingOnly,
        draft.readingOnly,
      );
    }
  }
  if (draft.inlineReading) {
    if (!inlineReading) inlineReading = draft.inlineReading;
    else if (draft.inlineReading !== inlineReading) {
      conflicts = recordConflict(
        conflicts,
        'inlineReading',
        inlineReading,
        draft.inlineReading,
      );
    }
  }

  const times = mergeTimes(
    existing.earliestCreatedAt ?? existing.latestCreatedAt,
    draft.earliestCreatedAt ?? draft.latestCreatedAt,
  );

  const sourceReferences = uniqueRefs([
    ...existing.sourceReferences.map((ref) =>
      ref.importBatchId === 'preview'
        ? { ...ref, importBatchId }
        : ref,
    ),
    ...draft.sourceReferences.map((ref) => ({ ...ref, importBatchId })),
  ]);

  const japanese = existing.japanese || draft.japanese;

  return {
    ...existing,
    japanese,
    readingOnly,
    inlineReading,
    translation,
    targetVocabulary,
    vocabularySuggestions: mergeVocabularySuggestions(
      existing.vocabularySuggestions ?? [],
      draft.vocabularySuggestions ?? [],
      japanese,
    ),
    sourceReferences,
    conflicts,
    earliestCreatedAt: times.earliest ?? existing.earliestCreatedAt,
    latestCreatedAt: times.latest ?? existing.latestCreatedAt,
    importBatchIds: Array.from(
      new Set([...existing.importBatchIds, importBatchId]),
    ),
  };
}
