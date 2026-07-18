import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseSatoriCsvText } from '../src/lib/csvImport';

/**
 * Optional local smoke test against a personal Satori export.
 * Place `exported 4.csv` at the repo root (gitignored). CI skips this file.
 */
const PERSONAL_EXPORT_PATH = resolve(
  import.meta.dirname,
  '../exported 4.csv',
);
const hasPersonalExport = existsSync(PERSONAL_EXPORT_PATH);

describe.skipIf(!hasPersonalExport)('personal export smoke (local only)', () => {
  it('parses exported 4.csv without crashing and yields stable aggregates', () => {
    const csvText = readFileSync(PERSONAL_EXPORT_PATH, 'utf8');
    const preview = parseSatoriCsvText(csvText, 'exported 4.csv');

    // Structural / aggregate checks only — do not assert on sentence text.
    expect(preview.totalRows).toBe(96);
    expect(preview.counts.totalRows).toBe(96);
    expect(preview.counts.uniqueSentences).toBeGreaterThan(0);
    expect(preview.counts.uniqueSentences).toBeLessThanOrEqual(
      preview.counts.totalRows,
    );
    expect(preview.drafts).toHaveLength(preview.counts.uniqueSentences);
    expect(preview.counts.contextOccurrences).toBeGreaterThanOrEqual(
      preview.counts.uniqueSentences,
    );
    expect(preview.counts.newSentences).toBe(preview.counts.uniqueSentences);
    expect(preview.counts.rowsSkipped).toBe(0);

    for (const item of preview.drafts) {
      expect(item.draft.japanese.length).toBeGreaterThan(0);
      expect(item.draft.normalizedKey.length).toBeGreaterThan(0);
      expect(item.draft.targetVocabulary.length).toBeGreaterThan(0);
      expect(item.selected).toBe(true);
      expect(item.isNew).toBe(true);
    }

    const multiVocab = preview.drafts.filter(
      (item) => item.draft.targetVocabulary.length > 1,
    );
    expect(multiVocab.length).toBeGreaterThan(0);

    // Pin the observed unique-sentence count so local regressions are obvious.
    expect(preview.counts.uniqueSentences).toBe(29);
  });

  it('is idempotent when re-parsing the same personal export', () => {
    const csvText = readFileSync(PERSONAL_EXPORT_PATH, 'utf8');
    const first = parseSatoriCsvText(csvText, 'exported 4.csv');
    const second = parseSatoriCsvText(csvText, 'exported 4.csv', {
      existing: first.drafts.map((item) => ({
        id: item.proposedId,
        normalizedKey: item.draft.normalizedKey,
        japanese: item.draft.japanese,
        readingOnly: item.draft.readingOnly,
        inlineReading: item.draft.inlineReading,
        translation: item.draft.translation,
        targetVocabulary: item.draft.targetVocabulary,
        sourceReferences: item.draft.sourceReferences,
        conflicts: item.draft.conflicts,
        earliestCreatedAt: item.draft.earliestCreatedAt,
        latestCreatedAt: item.draft.latestCreatedAt,
        firstOccurrenceIndex: item.draft.firstOccurrenceIndex,
        importBatchIds: item.draft.importBatchIds,
      })),
    });

    expect(second.counts.uniqueSentences).toBe(first.counts.uniqueSentences);
    expect(second.counts.newSentences).toBe(0);
    expect(second.drafts.every((item) => !item.isNew)).toBe(true);
  });
});
