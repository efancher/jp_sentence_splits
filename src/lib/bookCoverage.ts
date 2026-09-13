/**
 * "Ready to read" difficulty/coverage scoring (docs/ROADMAP.md, promoted
 * from "Possibilities" 2026-09-13) — the direct answer to "I have several
 * books now, which is the easiest one to pick up next": what fraction of a
 * book's confirmed vocabulary is already at FSRS reading-proficiency.
 *
 * Pure, no Dexie/network — same convention as `blindSpots.ts` /
 * `progressReport.ts`. `src/db/repository.ts#getBookVocabularyCoverage`
 * does the only fetching, reusing the same
 * `getReviewableVocabularyItemIdsBySentence` / `getProficientVocabularyItemIds`
 * primitives `isSentenceReadyForFullReview` is built from, so "known" here
 * means exactly what it means everywhere else in the app.
 */

export interface BookCoverageInput {
  bookId: string;
  /** Every sentence currently filed into this book. */
  sentenceIds: string[];
}

export interface BookCoverage {
  bookId: string;
  /** Distinct confirmed vocabulary items in the book already FSRS-proficient. */
  knownCount: number;
  /** Distinct confirmed vocabulary items in the book, proficient or not. */
  totalCount: number;
  /**
   * `knownCount / totalCount`, or `null` when the book has no confirmed
   * vocabulary yet — an unanalyzed book has nothing to be "ready" about,
   * which is a different state from "0% known" (a book you've read and
   * found entirely unfamiliar).
   */
  ratio: number | null;
}

export function buildBookCoverage(
  books: readonly BookCoverageInput[],
  vocabularyItemIdsBySentence: ReadonlyMap<string, readonly string[]>,
  proficientVocabularyItemIds: ReadonlySet<string>,
): BookCoverage[] {
  return books.map(({ bookId, sentenceIds }) => {
    const distinctIds = new Set<string>();
    for (const sentenceId of sentenceIds) {
      for (const id of vocabularyItemIdsBySentence.get(sentenceId) ?? []) {
        distinctIds.add(id);
      }
    }
    const totalCount = distinctIds.size;
    let knownCount = 0;
    for (const id of distinctIds) {
      if (proficientVocabularyItemIds.has(id)) knownCount += 1;
    }
    return {
      bookId,
      knownCount,
      totalCount,
      ratio: totalCount === 0 ? null : knownCount / totalCount,
    };
  });
}

/** Whole-percent for display, or `null` to mirror `ratio`'s "not analyzed yet". */
export function coveragePercent(coverage: Pick<BookCoverage, 'ratio'>): number | null {
  return coverage.ratio === null ? null : Math.round(coverage.ratio * 100);
}
