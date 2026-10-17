import { describe, expect, it } from 'vitest';
import { activeQuestionCoverage, type CoverageBook } from '../src/lib/clauseQuestionCoverage';
import notes from '../src/data/clauseReviewNotes.json';
import { CLAUSE_PILOT } from '../src/data/clausePilot';

describe('active question coverage', () => {
  it('excludes shelved books, archived books and shelved chapters, retaining shared active memberships once', () => {
    const books: CoverageBook[] = [
      { id: 'active', title: 'Active', archived: false, chapters: [{ id: 'shelved', title: 'Later', position: 0, suspendedAt: 'now' }] },
      { id: 'suspended', title: 'Suspended', archived: false, suspendedAt: 'now' },
      { id: 'archived', title: 'Archived', archived: true },
    ];
    const sources = ['a', 'b', 'c', 'd'].map((id) => ({ id, japanese: '未準備' + id, translation: '' }));
    const result = activeQuestionCoverage(books, [
      { bookId: 'suspended', sentenceId: 'a', position: 0 },
      { bookId: 'active', chapterId: 'shelved', sentenceId: 'b', position: 0 },
      { bookId: 'archived', sentenceId: 'c', position: 0 },
      { bookId: 'active', sentenceId: 'a', position: 1 },
      { bookId: 'active', sentenceId: 'a', position: 2 },
      { bookId: 'active', sentenceId: 'd', position: 3 },
    ], sources);
    expect(result.map((row) => row.id)).toEqual(['a', 'd']);
    expect(result[0].memberships).toHaveLength(2);
    expect(result.every((row) => row.status === 'missing')).toBe(true);
  });

  it('review notes are unique and never overlap a ready source or identifier', () => {
    const all = [...CLAUSE_PILOT, ...notes];
    expect(new Set(all.map((row) => row.id)).size).toBe(all.length);
    expect(new Set(all.map((row) => row.source)).size).toBe(all.length);
    expect(notes.every((note) => note.reason.trim().length > 0)).toBe(true);
  });
});
