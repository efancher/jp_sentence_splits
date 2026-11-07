import Papa from 'papaparse';

import type { ParsedSentenceDraft, SourceReference, TargetVocabulary } from '../../src/domain/types';
import { sentenceIdFromNormalizedKey } from '../../src/lib/ids';
import {
  displayJapanese,
  normalizeExpressionKey,
  normalizeSentenceKey,
} from '../../src/lib/normalize';
import {
  mergeTimes,
  mergeVocabulary,
  recordConflict,
  uniqueRefs,
  type ExistingSentenceLookup,
  type ImportPreview,
  type ImportPreviewSentence,
  type ImportWarning,
} from '../../src/lib/sentenceImport';

/**
 * TEST-ONLY. The Satori CSV importer was removed from the app (2026-11-07);
 * this parser remains so the data-layer and UI tests can still build an
 * `ImportPreview` from fixtures/little-birds.csv and seed through the real
 * `commitImport`.
 */
const CONTEXT_NUMBERS = [1, 2, 3] as const;

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
