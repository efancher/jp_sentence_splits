import { describe, expect, it } from 'vitest';

import { buildWordEvidence, strugglingWordIds } from '../src/lib/wordEvidence';

const ts = '2026-10-30T00:00:00.000Z';
const at = Date.parse(ts);

const studyItems = [
  { id: 'i_read', subjectType: 'vocabularyItem' as const, subjectId: 'w1', activityType: 'reading_retrieval' },
  { id: 'i_cloze', subjectType: 'vocabularyItem' as const, subjectId: 'w1', activityType: 'cloze' },
  { id: 'i_sent', subjectType: 'sentence' as const, subjectId: 's1', activityType: 'reading_in_context' },
];
const wordsBySentence = new Map([['s1', ['w1', 'w2']]]);

describe('buildWordEvidence', () => {
  it('turns word reading reviews into recall, using the explicit rating', () => {
    const map = buildWordEvidence({
      studyItems,
      wordsBySentence,
      reviews: [
        { studyItemId: 'i_read', timestamp: ts, rating: 'again' },
        { studyItemId: 'i_read', timestamp: ts, rating: 'good' },
      ],
    });
    expect(map.get('w1')).toEqual([
      { wordId: 'w1', facet: 'reading', kind: 'recall', at, success: false },
      { wordId: 'w1', facet: 'reading', kind: 'recall', at, success: true },
    ]);
  });

  it('ignores retired cloze reviews', () => {
    const map = buildWordEvidence({ studyItems, wordsBySentence, reviews: [{ studyItemId: 'i_cloze', timestamp: ts, rating: 'good' }] });
    expect(map.size).toBe(0);
  });

  it('credits exposure to every word of a reviewed or walked-through sentence', () => {
    const map = buildWordEvidence({
      studyItems,
      wordsBySentence,
      reviews: [{ studyItemId: 'i_sent', timestamp: ts, rating: 'again' }],
      learningEvents: [
        { sentenceId: 's1', timestamp: ts, action: 'walkthrough_completed' },
        { sentenceId: 's1', timestamp: ts, action: 'walkthrough_opened' },
      ],
    });
    expect(map.get('w2')).toHaveLength(2);
    expect(map.get('w2')!.every((e) => e.kind === 'exposure' && e.sentenceId === 's1')).toBe(true);
  });

  it('turns resolved typed recalls into reading recall evidence', () => {
    const map = buildWordEvidence({
      studyItems,
      wordsBySentence,
      reviews: [],
      typedRecalls: [{ wordId: 'w2', at, success: false }],
    });
    expect(map.get('w2')).toEqual([{ wordId: 'w2', facet: 'reading', kind: 'recall', at, success: false }]);
  });

  it('skips unknown study items and unparseable timestamps', () => {
    const map = buildWordEvidence({
      studyItems,
      wordsBySentence,
      reviews: [
        { studyItemId: 'missing', timestamp: ts, rating: 'good' },
        { studyItemId: 'i_read', timestamp: 'not a date', rating: 'good' },
      ],
    });
    expect(map.size).toBe(0);
  });
});

describe('strugglingWordIds', () => {
  const tap = (wordId: string, outcome: 'got_it' | 'not_yet', minutes: number) => ({
    sentenceId: 's1',
    timestamp: new Date(at + minutes * 60_000).toISOString(),
    action: 'target_practice' as const,
    outcome,
    support: 'target_masked' as const,
    target: { kind: 'vocabulary' as never, key: `vocab-read:${wordId}`, label: '' },
  });

  it('needs repeated failures, the latest being a failure', () => {
    const now = at + 3_600_000;
    expect(strugglingWordIds([tap('a', 'not_yet', 0)], now).size).toBe(0);
    expect([...strugglingWordIds([tap('a', 'not_yet', 0), tap('a', 'not_yet', 1)], now)]).toEqual(['a']);
  });

  it('lets a later success recover the word', () => {
    const now = at + 3_600_000;
    const events = [tap('a', 'not_yet', 0), tap('a', 'not_yet', 1), tap('a', 'got_it', 2)];
    expect(strugglingWordIds(events, now).size).toBe(0);
  });

  it('honours a custom minimum', () => {
    const events = [tap('a', 'not_yet', 0)];
    expect([...strugglingWordIds(events, at + 60_000, 1)]).toEqual(['a']);
  });
});
