import Papa from 'papaparse';

import type {
  ImportBatchCounts,
  ParsedSentenceDraft,
  SourceConflict,
  SourceReference,
  TargetVocabulary,
  VocabularySuggestion,
} from '../domain/types';
import { sentenceIdFromNormalizedKey } from './ids';
import {
  displayJapanese,
  normalizeExpressionKey,
  normalizeSentenceKey,
} from './normalize';
import { mergeVocabularySuggestions } from './vocabularySuggestions';

const CONTEXT_NUMBERS = [1, 2, 3] as const;

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

function cell(row: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    const value = (row[key] ?? '').trim();
    if (value) return value;
  }
  return '';
}

function parseWhenCreated(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value.trim();
  return new Date(parsed).toISOString();
}

function mergeTimes(
  a?: string,
  b?: string,
): { earliest?: string; latest?: string } {
  const values = [a, b].filter((value): value is string => Boolean(value));
  if (!values.length) return {};
  const sorted = [...values].sort();
  return { earliest: sorted[0], latest: sorted[sorted.length - 1] };
}

function mergeVocabulary(
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

function recordConflict(
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

function uniqueRefs(refs: SourceReference[]): SourceReference[] {
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

export function parseSatoriCsvText(
  csvText: string,
  filename: string,
  options?: {
    existing?: ExistingSentenceLookup[];
    importBatchId?: string;
    batchName?: string;
  },
): ImportPreview {
  const warnings: ImportWarning[] = [];
  const existingByKey = new Map(
    (options?.existing ?? []).map((item) => [item.normalizedKey, item]),
  );
  const importBatchId = options?.importBatchId ?? 'preview';
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.replace(/^\uFEFF/, '').trim(),
    // Satori exports can omit trailing empty context columns on some rows.
  });

  // Filter noisy field-count warnings; keep genuine parse failures.
  const meaningfulErrors = parsed.errors.filter(
    (error) => error.code !== 'TooFewFields' && error.code !== 'TooManyFields',
  );

  if (meaningfulErrors.length) {
    for (const error of meaningfulErrors.slice(0, 20)) {
      warnings.push({
        message: error.message,
        rowNumber: typeof error.row === 'number' ? error.row + 1 : undefined,
      });
    }
  }

  const rows = parsed.data;
  const draftsByKey = new Map<string, ParsedSentenceDraft>();
  const occurrenceOrder: string[] = [];
  let contextOccurrences = 0;
  let rowsSkipped = 0;
  let exactDuplicatesIgnored = 0;
  let newVocabularyAssociations = 0;
  let occurrenceIndex = 0;

  rows.forEach((row, rowIndex) => {
    const cardId = cell(row, 'CardID') || `row-${rowIndex + 1}`;
    const cardType = cell(row, 'CardType').toUpperCase();
    const expression = cell(row, 'Expression');
    const reading = cell(row, 'Expression-ReadingsOnly');
    const furigana = cell(row, 'Expression-ReadingsInline');
    const english = cell(row, 'English');
    const partsOfSpeech = cell(row, 'PartsOfSpeech');
    const whenCreated = parseWhenCreated(cell(row, 'WhenCreated'));
    const userNotes = cell(row, 'UserNotes');

    let sawContext = false;
    for (const contextNumber of CONTEXT_NUMBERS) {
      const japaneseRaw = cell(row, `Context${contextNumber}`);
      if (!japaneseRaw) continue;
      sawContext = true;
      contextOccurrences += 1;
      occurrenceIndex += 1;

      const japanese = displayJapanese(japaneseRaw);
      const normalizedKey = normalizeSentenceKey(japanese);
      if (!normalizedKey) {
        rowsSkipped += 1;
        warnings.push({
          message: `Empty normalized sentence at row ${rowIndex + 1}, Context${contextNumber}`,
          rowNumber: rowIndex + 1,
        });
        continue;
      }

      const readingOnly = cell(row, `Context${contextNumber}-ReadingsOnly`);
      const inlineReading = cell(
        row,
        `Context${contextNumber}-ReadingsInline`,
        `Context${contextNumber}-PerYourPreferencesReadingsInline`,
      );
      const translation = cell(row, `Context${contextNumber}-Translation`);

      const vocab: TargetVocabulary | null = expression
        ? {
            expression,
            reading,
            furigana,
            english,
            partsOfSpeech,
            sourceCardIds: [cardId],
            cardTypes: cardType ? [cardType] : [],
          }
        : null;

      const sourceRef: SourceReference = {
        cardId,
        cardType,
        contextNumber,
        whenCreated,
        userNotes: userNotes || undefined,
        importBatchId,
      };

      const existingDraft = draftsByKey.get(normalizedKey);
      if (!existingDraft) {
        draftsByKey.set(normalizedKey, {
          normalizedKey,
          japanese,
          readingOnly,
          inlineReading,
          translation,
          targetVocabulary: vocab ? [vocab] : [],
          vocabularySuggestions: [],
          sourceReferences: [sourceRef],
          conflicts: [],
          earliestCreatedAt: whenCreated,
          latestCreatedAt: whenCreated,
          firstOccurrenceIndex: occurrenceIndex,
        });
        occurrenceOrder.push(normalizedKey);
        if (vocab) newVocabularyAssociations += 1;
        continue;
      }

      // Same sentence again in this CSV (JE/EJ or shared context).
      let conflicts = existingDraft.conflicts;
      let nextTranslation = existingDraft.translation;
      let nextReadingOnly = existingDraft.readingOnly;
      let nextInlineReading = existingDraft.inlineReading;

      if (translation) {
        if (!nextTranslation) nextTranslation = translation;
        else if (translation !== nextTranslation) {
          conflicts = recordConflict(
            conflicts,
            'translation',
            nextTranslation,
            translation,
          );
        }
      }
      if (readingOnly) {
        if (!nextReadingOnly) nextReadingOnly = readingOnly;
        else if (readingOnly !== nextReadingOnly) {
          conflicts = recordConflict(
            conflicts,
            'readingOnly',
            nextReadingOnly,
            readingOnly,
          );
        }
      }
      if (inlineReading) {
        if (!nextInlineReading) nextInlineReading = inlineReading;
        else if (inlineReading !== nextInlineReading) {
          conflicts = recordConflict(
            conflicts,
            'inlineReading',
            nextInlineReading,
            inlineReading,
          );
        }
      }

      let targetVocabulary = existingDraft.targetVocabulary;
      if (vocab) {
        const merged = mergeVocabulary(targetVocabulary, vocab);
        targetVocabulary = merged.list;
        if (merged.added) newVocabularyAssociations += 1;
      }

      const times = mergeTimes(
        existingDraft.earliestCreatedAt ?? existingDraft.latestCreatedAt,
        whenCreated,
      );

      const previousRefCount = existingDraft.sourceReferences.length;
      const sourceReferences = uniqueRefs([
        ...existingDraft.sourceReferences,
        sourceRef,
      ]);
      if (sourceReferences.length === previousRefCount && !vocab) {
        exactDuplicatesIgnored += 1;
      }

      draftsByKey.set(normalizedKey, {
        ...existingDraft,
        readingOnly: nextReadingOnly,
        inlineReading: nextInlineReading,
        translation: nextTranslation,
        targetVocabulary,
        sourceReferences,
        conflicts,
        earliestCreatedAt: times.earliest ?? existingDraft.earliestCreatedAt,
        latestCreatedAt: times.latest ?? existingDraft.latestCreatedAt,
      });
    }

    if (!sawContext && !expression) {
      rowsSkipped += 1;
    } else if (!sawContext) {
      rowsSkipped += 1;
      warnings.push({
        message: `Row ${rowIndex + 1} has no Context1–3 values`,
        rowNumber: rowIndex + 1,
      });
    }
  });

  const previewSentences: ImportPreviewSentence[] = occurrenceOrder.map(
    (key) => {
      const draft = draftsByKey.get(key)!;
      const existing = existingByKey.get(key);
      const proposedId = existing?.id ?? sentenceIdFromNormalizedKey(key);
      const isNew = !existing;
      let willUpdate = false;
      if (existing) {
        const existingVocabKeys = new Set(
          existing.targetVocabulary.map((item) =>
            normalizeExpressionKey(item.expression, item.reading),
          ),
        );
        const hasNewVocab = draft.targetVocabulary.some(
          (item) =>
            !existingVocabKeys.has(
              normalizeExpressionKey(item.expression, item.reading),
            ),
        );
        willUpdate =
          hasNewVocab ||
          (!existing.translation && Boolean(draft.translation)) ||
          (!existing.readingOnly && Boolean(draft.readingOnly)) ||
          (!existing.inlineReading && Boolean(draft.inlineReading)) ||
          draft.conflicts.length > 0;
      }
      return {
        draft,
        proposedId,
        isNew,
        willUpdate,
        selected: true,
      };
    },
  );

  const conflictCount = previewSentences.reduce(
    (sum, item) => sum + item.draft.conflicts.length,
    0,
  );
  if (conflictCount) {
    warnings.push({
      message: `${conflictCount} conflicting translation/reading value(s) found`,
    });
  }

  const counts: ImportBatchCounts = {
    totalRows: rows.length,
    contextOccurrences,
    uniqueSentences: previewSentences.length,
    newSentences: previewSentences.filter((item) => item.isNew).length,
    updatedSentences: previewSentences.filter((item) => item.willUpdate).length,
    exactDuplicatesIgnored,
    newVocabularyAssociations,
    rowsSkipped,
    warningCount: warnings.length,
    conflictCount,
  };

  const defaultBatchName = `${filename.replace(/\.csv$/i, '')} · ${new Date()
    .toISOString()
    .slice(0, 10)}`;

  return {
    filename,
    batchName: options?.batchName ?? defaultBatchName,
    totalRows: rows.length,
    drafts: previewSentences,
    counts,
    warnings,
  };
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

  return {
    ...existing,
    japanese: existing.japanese || draft.japanese,
    readingOnly,
    inlineReading,
    translation,
    targetVocabulary,
    vocabularySuggestions: mergeVocabularySuggestions(
      existing.vocabularySuggestions ?? [],
      draft.vocabularySuggestions ?? [],
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
