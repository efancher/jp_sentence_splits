import { describe, expect, it } from 'vitest';

import type { Book } from '../domain/types';
import { bookToRemote } from './mappers';
import { mergeBookByChoices, summarizeBookConflict } from './bookChapterConflict';

const ch = (id: string, position: number, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Chapter ${id}`,
  position,
  ...extra,
});

function book(chapters: Book['chapters'], over: Partial<Book> = {}): Book {
  return {
    id: 'book_1',
    title: 'Slow Japanese',
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    chapters,
    collapsedChapterIds: [],
    ...over,
  };
}

const remoteRow = (b: Book) => bookToRemote(b, 'owner', 210);

describe('summarizeBookConflict', () => {
  it('lists only the chapters that differ and ignores identical ones', () => {
    const local = book([ch('a', 0), ch('b', 1, { notes: 'x' }), ch('c', 2)]);
    const remote = book([ch('a', 0), ch('b', 1), ch('d', 3)]);
    const summary = summarizeBookConflict(local, remoteRow(remote));
    expect(summary.fieldChanges).toEqual([]);
    expect(summary.chapters).toEqual([
      { id: 'b', title: 'Chapter b', kind: 'differs' },
      { id: 'd', title: 'Chapter d', kind: 'remote_only' },
      { id: 'c', title: 'Chapter c', kind: 'local_only' },
    ]);
  });

  it('reports book-level field differences', () => {
    const summary = summarizeBookConflict(
      book([], { notes: 'mine' }),
      remoteRow(book([])),
    );
    expect(summary.fieldChanges).toEqual(['notes']);
  });
});

describe('mergeBookByChoices', () => {
  const local = book([ch('a', 0), ch('b', 1, { notes: 'local' }), ch('c', 2)], {
    notes: 'local book',
  });
  const remote = book([ch('a', 0), ch('b', 1, { notes: 'remote' }), ch('d', 3)], {
    notes: 'remote book',
  });

  it('applies per-chapter choices, keeping one-sided chapters only if chosen', () => {
    const merged = mergeBookByChoices(
      local,
      remoteRow(remote),
      { b: 'local', c: 'local', d: 'remote' },
      'remote',
    );
    expect(merged.chapters.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(merged.chapters.find((c) => c.id === 'b')).toMatchObject({ notes: 'local' });
    expect(merged.notes).toBe('remote book');
  });

  it('drops one-sided chapters when the other side is chosen', () => {
    const merged = mergeBookByChoices(local, remoteRow(remote), {}, 'local');
    expect(merged.chapters.map((c) => c.id)).toEqual(['a', 'b', 'd']);
    expect(merged.chapters.find((c) => c.id === 'b')).toMatchObject({ notes: 'remote' });
    expect(merged.notes).toBe('local book');
  });
});
