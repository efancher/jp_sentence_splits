import { describe, expect, it } from 'vitest';

import { findIntegrityProblems } from '../src/lib/sentenceIntegrity';

const m = (id: string, sentence: string, chapter: string | null, position: number) => ({
  id, book_id: 'b', sentence_id: sentence, chapter_id: chapter, position,
});
const live = (id: string) => ({ id, deleted_at: null });
const clip = (sentence: string, source: string, start: number) => ({
  id: `${sentence}-${source}`, sentence_id: sentence, source_id: source, source_start_ms: start,
});

describe('findIntegrityProblems', () => {
  it('reports nothing for a consistent, ordered chapter', () => {
    const report = findIntegrityProblems({
      memberships: [m('1', 'a', 'c', 0), m('2', 'b', 'c', 1)],
      sentences: [live('a'), live('b')],
      clips: [clip('a', 's1', 0), clip('b', 's1', 5000)],
    });
    expect(report).toEqual({ danglingMemberships: [], orphanClips: [], duplicatePositions: [], misorderedChapters: [] });
  });

  it('flags live memberships and clips that point at deleted or missing sentences', () => {
    const report = findIntegrityProblems({
      memberships: [m('1', 'a', 'c', 0), m('2', 'gone', 'c', 1), m('3', 'ghost', 'c', 2)],
      sentences: [live('a'), { id: 'gone', deleted_at: '2026-09-23T00:00:00Z' }],
      clips: [clip('a', 's1', 0), clip('gone', 's1', 1000)],
    });
    expect(report.danglingMemberships.map((x) => x.id)).toEqual(['2', '3']);
    expect(report.orphanClips.map((x) => x.sentence_id)).toEqual(['gone']);
  });

  it('flags a shared line placed ahead of where its own episode says it plays', () => {
    // "bye" is spoken at 364s in episode e1 and 276s in e2; here it sits first in e1.
    const report = findIntegrityProblems({
      memberships: [m('1', 'bye', 'c1', 0), m('2', 'intro', 'c1', 1), m('3', 'body', 'c1', 2), m('4', 'bye', 'c2', 0), m('5', 'x', 'c2', 1)],
      sentences: [live('bye'), live('intro'), live('body'), live('x')],
      clips: [
        clip('bye', 'e1', 364000), clip('bye', 'e2', 276000),
        clip('intro', 'e1', 2000), clip('body', 'e1', 9000), clip('x', 'e2', 500000),
      ],
    });
    expect(report.misorderedChapters).toHaveLength(1);
    const c1 = report.misorderedChapters[0]!;
    expect(c1.chapterId).toBe('c1');
    expect(c1.sourceId).toBe('e1');
    expect(c1.sentenceIds).toContain('bye');
  });

  it('does not flag a repeated line that has two clips in one episode at its earliest time', () => {
    const report = findIntegrityProblems({
      memberships: [m('1', 'a', 'c', 0), m('2', 'rep', 'c', 1), m('3', 'b', 'c', 2)],
      sentences: [live('a'), live('rep'), live('b')],
      clips: [clip('a', 's', 0), clip('rep', 's', 1000), clip('rep', 's', 9000), clip('b', 's', 2000)],
    });
    expect(report.misorderedChapters).toEqual([]);
  });

  it('flags duplicate positions within one chapter', () => {
    const report = findIntegrityProblems({
      memberships: [m('1', 'a', 'c', 3), m('2', 'b', 'c', 3)],
      sentences: [live('a'), live('b')],
      clips: [],
    });
    expect(report.duplicatePositions).toEqual([{ bookId: 'b', chapterId: 'c', position: 3 }]);
  });
});
