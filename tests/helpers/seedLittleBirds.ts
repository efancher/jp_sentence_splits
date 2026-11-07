import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { commitImport } from '../../src/db/repository';
import { parseSatoriCsvText } from './satoriCsvFixture';

const littleBirds = readFileSync(
  resolve(import.meta.dirname, '../../fixtures/little-birds.csv'),
  'utf8',
);

/**
 * Seeds the little-birds fixture through the real `commitImport`, standing in
 * for the removed CSV upload page. 'inbox' leaves the sentences in the Inbox;
 * 'new_book' creates a book titled after the batch and returns its id.
 */
export async function seedLittleBirds(
  destination: 'inbox' | 'new_book' = 'inbox',
): Promise<{ bookId?: string }> {
  const preview = parseSatoriCsvText(littleBirds, 'little-birds.csv');
  const result = await commitImport({
    preview,
    selectedIds: preview.drafts.map((item) => item.proposedId),
    destination,
    newBookTitle: preview.batchName,
  });
  return { bookId: result.bookId };
}
