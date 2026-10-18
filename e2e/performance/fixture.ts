import type { Page } from '@playwright/test';
import type { Book, Review, Sentence, SentenceAnalysis, SentenceExtras, StudyItem, BookSentence } from '../../src/domain/types';

export const libraries = {
  small: { books: 2, sentencesPerBook: 100, chapterSize: 50 },
  large: { books: 20, sentencesPerBook: 200, chapterSize: 200 },
} as const;

/** Use the app-created schema, then commit all synthetic records before navigation.
 * No audio: transfer/playback costs are measured separately in audioUsage.test.ts. */
export async function seedLibrary(page: Page, size: keyof typeof libraries) {
  return page.evaluate(async (shape) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('satori-glossbook');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const start = performance.now();
    const stores = ['books', 'sentences', 'bookSentences', 'analyses', 'sentenceExtras', 'studyItems', 'reviews'];
    const tx = db.transaction(stores, 'readwrite');
    const now = '2026-01-01T00:00:00.000Z';
    for (const store of stores) tx.objectStore(store).clear();
    for (let b = 0; b < shape.books; b++) {
      const bookId = `perf-book-${b}`;
      const chapters = Array.from({ length: Math.ceil(shape.sentencesPerBook / shape.chapterSize) }, (_, c) => ({
        id: `${bookId}-chapter-${c}`, title: `Chapter ${c + 1}`, position: c,
      }));
      tx.objectStore('books').put({ id: bookId, title: `Performance book ${b + 1}`, chapters,
        archived: false, collapsedChapterIds: [], createdAt: now, updatedAt: now } satisfies Book);
      for (let s = 0; s < shape.sentencesPerBook; s++) {
        const id = `${bookId}-sentence-${s}`;
        const chapterId = chapters[Math.floor(s / shape.chapterSize)]!.id;
        const japanese = s % 2 ? '本を買いました。' : '本を読みます。';
        tx.objectStore('sentences').put({ id, normalizedKey: id, japanese,
          readingOnly: '', inlineReading: '', translation: s % 2 ? 'I bought a book.' : 'I read a book.',
          targetVocabulary: [], vocabularySuggestions: [], sourceReferences: [], conflicts: [],
          firstOccurrenceIndex: b * shape.sentencesPerBook + s, importBatchIds: [], createdAt: now, updatedAt: now } satisfies Sentence);
        tx.objectStore('bookSentences').put({ id: `membership-${id}`, bookId, sentenceId: id,
          chapterId, position: s, status: 'in_progress', addedAt: now } satisfies BookSentence);
        tx.objectStore('analyses').put({ sentenceId: id, chunks: [], notes: '', status: 'empty',
          formatVersion: 2, vocabularySelections: [], vocabularyReviewStatus: 'unreviewed',
          grammarReviewStatus: 'unreviewed', grammarSuggestions: [], createdAt: now, updatedAt: now,
          comprehensionCheck: { options: ['I read a book.', 'I wrote a letter.', 'I closed the window.', 'I drank tea.'],
            correctIndex: 0, provenance: 'manual', createdAt: now } } satisfies SentenceAnalysis);
        tx.objectStore('sentenceExtras').put({ id, bookId, chapterId, createdAt: now, updatedAt: now,
          contextWalkthrough: { natural: 'Synthetic walkthrough for performance measurement.', steps: [{
            text: japanese, start: 0, end: japanese.length, gloss: 'Synthetic fixture',
            explanation: 'Fixture explanation. '.repeat(40),
          }] } } satisfies SentenceExtras);
        tx.objectStore('studyItems').put({ id: `study-${id}`, subjectType: 'sentence', subjectId: id,
          activityType: 'reading_in_context', createdAt: now, updatedAt: now,
          fsrsState: { due: now, stability: 1, difficulty: 1, elapsedDays: 0, scheduledDays: 1,
            learningSteps: 0, reps: 2, lapses: 0, state: 'review' } } satisfies StudyItem);
        for (let r = 0; r < 5; r++) {
          tx.objectStore('reviews').put({ id: `review-${id}-${r}`, studyItemId: `study-${id}`,
            timestamp: new Date(Date.now() - (r + 1) * 86_400_000).toISOString(),
            rating: 'good', elapsedMs: 2000 } satisfies Review);
        }
      }
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Fixture transaction aborted'));
    });
    db.close();
    return { ...shape, sentences: shape.books * shape.sentencesPerBook,
      reviews: shape.books * shape.sentencesPerBook * 5, seedCommitMs: performance.now() - start };
  }, libraries[size]);
}
