import { createInitialFsrsState } from '../../src/lib/scheduling';

export interface LibrarySize {
  books: number;
  sentences: number;
  reviewsPerCard: number;
}

/** Rows seeded for a library: each sentence adds membership, a card, its reviews and one event. */
export function libraryRows({ books, sentences, reviewsPerCard }: LibrarySize): number {
  return books + sentences * (1 + 1 + 1 + reviewsPerCard + 1);
}

/**
 * SQL that seeds a study library for one user on the server: books, sentences with
 * book membership, one sentence card each, `reviewsPerCard` reviews per card and one
 * walkthrough event per sentence. Used by the Postgres usage tests and the real-browser
 * restore measurement so both restore identical data. Ids are stable (`s_1`, `r_1_2`, ...).
 */
export function librarySeedStatements(userId: string, size: LibrarySize): string[] {
  const { books, sentences, reviewsPerCard } = size;
  const fsrs = JSON.stringify(createInitialFsrsState(new Date('2026-11-10T00:00:00Z')));
  return [
    `insert into books (id, owner_id, title) select 'book_' || n, '${userId}', 'Book ' || n from generate_series(1,${books}) n`,
    `insert into sentences (id, owner_id, normalized_key, japanese, translation, first_occurrence_index)
      select 's_' || n, '${userId}', 'key-' || n, '日本語の例文 ' || n, 'Example sentence ' || n, n from generate_series(1,${sentences}) n`,
    `insert into book_sentences (id, book_id, sentence_id, owner_id, position)
      select 'bs_' || n, 'book_' || ((n - 1) % ${books} + 1), 's_' || n, '${userId}', n from generate_series(1,${sentences}) n`,
    `insert into study_items (id, owner_id, subject_type, subject_id, activity_type, fsrs_state)
      select 'si_' || n, '${userId}', 'sentence', 's_' || n, 'reading_in_context', '${fsrs}'::jsonb from generate_series(1,${sentences}) n`,
    `insert into reviews (id, owner_id, study_item_id, rating, "timestamp")
      select 'r_' || n || '_' || k, '${userId}', 'si_' || n, (array['again','hard','good','easy'])[1 + (n + k) % 4],
        timestamptz '2026-11-01' + (n * k) * interval '1 second' from generate_series(1,${sentences}) n, generate_series(1,${reviewsPerCard}) k`,
    `insert into sentence_learning_events (id, owner_id, visit_id, action, book_id, sentence_id)
      select 'e_' || n, '${userId}', 'visit_' || n, 'walkthrough_completed', 'book_' || ((n - 1) % ${books} + 1), 's_' || n from generate_series(1,${sentences}) n`,
  ];
}

/** Library sizes for the real-browser restore measurement (the large one matches the load benchmark's large fixture). */
export const RESTORE_SIZES: Record<string, LibrarySize> = {
  small: { books: 4, sentences: 400, reviewsPerCard: 3 },
  medium: { books: 4, sentences: 1600, reviewsPerCard: 3 },
  large: { books: 20, sentences: 4000, reviewsPerCard: 5 },
};
