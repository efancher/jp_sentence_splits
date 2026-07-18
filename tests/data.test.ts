import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addSentencesToBook,
  commitImport,
  createBook,
  exportFullBackup,
  reorderBookSentences,
  restoreBackup,
  saveAnalysis,
  setBookSentenceStatus,
} from '../src/db/repository';
import { parseBackupJson } from '../src/lib/backup';
import { parseSatoriCsvText } from '../src/lib/csvImport';
import { createId } from '../src/lib/ids';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const littleBirds = readFileSync(
  resolve(import.meta.dirname, '../fixtures/little-birds.csv'),
  'utf8',
);

describe('data layer', () => {
  beforeEach(() => {
    resetDbForTests(`data-${createId('db')}`);
  });

  it('creates books, shares sentences, reorders, and preserves analysis on reimport', async () => {
    const preview = parseSatoriCsvText(littleBirds, 'little-birds.csv');
    const selected = preview.drafts.map((item) => item.proposedId);
    await commitImport({
      preview,
      selectedIds: selected,
      destination: 'inbox',
    });

    const bookA = await createBook({ title: 'Book A' });
    const bookB = await createBook({ title: 'Book B' });
    await addSentencesToBook(bookA.id, selected.slice(0, 2));
    await addSentencesToBook(bookB.id, selected.slice(0, 1));

    const firstId = selected[0]!;
    await saveAnalysis(firstId, [
      {
        id: 'c1',
        order: 0,
        japanese: 'ある小鳥の',
        role: 'modifier/content',
        literalEnglish: "a-certain-little-bird's",
      },
    ]);
    await setBookSentenceStatus(bookA.id, firstId, 'in_progress');

    await reorderBookSentences(bookA.id, [selected[1]!, selected[0]!]);

    const reimport = parseSatoriCsvText(littleBirds, 'little-birds.csv');
    await commitImport({
      preview: reimport,
      selectedIds: reimport.drafts.map((item) => item.proposedId),
      destination: 'inbox',
    });

    const backup = await exportFullBackup();
    expect(backup.sentences.length).toBeGreaterThan(0);
    const analysis = backup.analyses.find((item) => item.sentenceId === firstId);
    expect(analysis?.chunks[0]?.literalEnglish).toBe("a-certain-little-bird's");
    const memberships = backup.bookSentences
      .filter((item) => item.bookId === bookA.id)
      .sort((a, b) => a.position - b.position);
    expect(memberships.map((item) => item.sentenceId)).toEqual([
      selected[1],
      selected[0],
    ]);
    expect(
      memberships.find((item) => item.sentenceId === firstId)?.status,
    ).toBe('in_progress');

    const parsed = parseBackupJson(JSON.stringify(backup));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      await restoreBackup(parsed.data, 'replace');
      const again = await exportFullBackup();
      expect(again.books).toHaveLength(backup.books.length);
      expect(again.sentences).toHaveLength(backup.sentences.length);
    }
  });
});
