import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  mergeSentenceOnReimport,
  parseSatoriCsvText,
} from '../src/lib/csvImport';

const littleBirds = readFileSync(
  resolve(import.meta.dirname, '../fixtures/little-birds.csv'),
  'utf8',
);

describe('parseSatoriCsvText', () => {
  it('handles UTF-8 BOM', () => {
    const bom = `\uFEFFCardID,CardType,Expression,Context1,Context1-Translation\nid1,JE,春,暖かい春がやって来ました。,Warm spring.\n`;
    const preview = parseSatoriCsvText(bom, 'bom.csv');
    expect(preview.counts.uniqueSentences).toBe(1);
    expect(preview.drafts[0]?.draft.japanese).toBe('暖かい春がやって来ました。');
  });

  it('dedupes JE/EJ and merges four vocabulary words onto one sentence', () => {
    const preview = parseSatoriCsvText(littleBirds, 'little-birds.csv');
    const nest = preview.drafts.find((item) =>
      item.draft.japanese.includes('小鳥の夫婦'),
    );
    expect(nest).toBeTruthy();
    expect(nest!.draft.translation).toBe(
      'A certain little bird couple made a nest in a tree.',
    );
    expect(nest!.draft.targetVocabulary.map((item) => item.expression).sort()).toEqual(
      ['作る', '巣', '小鳥', '夫婦'].sort(),
    );
    for (const vocab of nest!.draft.targetVocabulary) {
      expect(vocab.expression).toBeTruthy();
      expect(vocab.reading).toBeTruthy();
      expect(vocab.sourceCardIds.length).toBeGreaterThan(0);
    }
    const kotori = nest!.draft.targetVocabulary.find(
      (item) => item.expression === '小鳥',
    );
    expect(kotori?.reading).toBe('ことり');
    expect(kotori?.cardTypes.sort()).toEqual(['EJ', 'JE']);
  });

  it('iterates Context2 and skips empty contexts', () => {
    const preview = parseSatoriCsvText(littleBirds, 'little-birds.csv');
    expect(preview.counts.contextOccurrences).toBeGreaterThanOrEqual(7);
    expect(
      preview.drafts.some((item) => item.draft.japanese === 'もう一つの文です。'),
    ).toBe(true);
  });

  it('records conflicting translations without discarding them', () => {
    const csv = readFileSync(
      resolve(import.meta.dirname, '../fixtures/conflict-translation.csv'),
      'utf8',
    );
    const preview = parseSatoriCsvText(csv, 'conflict.csv');
    expect(preview.counts.uniqueSentences).toBe(1);
    expect(preview.counts.conflictCount).toBeGreaterThan(0);
    expect(preview.drafts[0]?.draft.conflicts[0]?.field).toBe('translation');
    expect(preview.drafts[0]?.draft.translation).toBe(
      'The warm spring came along.',
    );
  });

  it('is idempotent on reimport and can add a new target word', () => {
    const first = parseSatoriCsvText(littleBirds, 'little-birds.csv');
    const existing = first.drafts.map((item) => ({
      id: item.proposedId,
      ...item.draft,
      importBatchIds: ['batch1'],
    }));
    const second = parseSatoriCsvText(littleBirds, 'little-birds.csv', {
      existing,
    });
    expect(second.counts.newSentences).toBe(0);

    const extra = `${littleBirds}
id-ki-je,JE,木,き,木[き],tree,n,2024-01-01T10:20:00Z,ある小鳥の夫婦が、木に巣を作りました。,あることりのふうふが、きにすをつくりました。,ある 小鳥[ことり]の 夫婦[ふうふ]が、 木[き]に 巣[す]を 作[つく]りました。,A certain little bird couple made a nest in a tree.,,,
`;
    const third = parseSatoriCsvText(extra, 'little-birds-plus.csv', {
      existing,
    });
    const nest = third.drafts.find((item) =>
      item.draft.japanese.includes('小鳥の夫婦'),
    );
    expect(nest?.willUpdate).toBe(true);
    const merged = mergeSentenceOnReimport(
      existing.find((item) => item.normalizedKey === nest!.draft.normalizedKey)!,
      nest!.draft,
      'batch2',
    );
    expect(
      merged.targetVocabulary.some((item) => item.expression === '木'),
    ).toBe(true);
  });

  it('tolerates missing optional columns and malformed rows', () => {
    const csv =
      'CardID,Expression,Context1\n1,春,暖かい春がやって来ました。\nnot-a-row\n';
    const preview = parseSatoriCsvText(csv, 'sparse.csv');
    expect(preview.counts.uniqueSentences).toBe(1);
  });
});
