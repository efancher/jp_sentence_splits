import type { Book, BookChapter } from '../domain/types';
import { forDiff } from './conflictDiff';
import { remoteToBook } from './mappers';

export type ChapterSide = 'local' | 'remote';

export interface ChapterDifference {
  id: string;
  title: string;
  kind: 'local_only' | 'remote_only' | 'differs';
}

export interface BookConflictSummary {
  /** Book-level fields (everything except `chapters`) that differ. */
  fieldChanges: string[];
  chapters: ChapterDifference[];
}

function comparable(value: unknown): string {
  return JSON.stringify(forDiff(value, 'books'));
}

function withoutChapters(book: Book): Record<string, unknown> {
  const { chapters: _chapters, ...rest } = book;
  return rest;
}

function fieldChanges(local: Book, remote: Book): string[] {
  const l = forDiff(withoutChapters(local), 'books') as Record<string, unknown>;
  const r = forDiff(withoutChapters(remote), 'books') as Record<string, unknown>;
  return [...new Set([...Object.keys(l), ...Object.keys(r)])]
    .filter((key) => JSON.stringify(l[key]) !== JSON.stringify(r[key]))
    .sort();
}

export function summarizeBookConflict(
  localPayload: unknown,
  remotePayload: unknown,
): BookConflictSummary {
  const local = localPayload as Book;
  const remote = remoteToBook(remotePayload as Record<string, unknown>);
  const localById = new Map(local.chapters.map((c) => [c.id, c]));
  const remoteById = new Map(remote.chapters.map((c) => [c.id, c]));
  const chapters: ChapterDifference[] = [];
  for (const rc of remote.chapters) {
    const lc = localById.get(rc.id);
    if (!lc) chapters.push({ id: rc.id, title: rc.title, kind: 'remote_only' });
    else if (comparable(lc) !== comparable(rc)) {
      chapters.push({ id: rc.id, title: lc.title, kind: 'differs' });
    }
  }
  for (const lc of local.chapters) {
    if (!remoteById.has(lc.id)) {
      chapters.push({ id: lc.id, title: lc.title, kind: 'local_only' });
    }
  }
  return { fieldChanges: fieldChanges(local, remote), chapters };
}

/**
 * Builds the book to keep: unchanged chapters pass through, each differing
 * chapter takes the chosen side (choosing the side that lacks it drops it), and
 * book-level fields come from `fields`.
 */
export function mergeBookByChoices(
  localPayload: unknown,
  remotePayload: unknown,
  choices: Record<string, ChapterSide>,
  fields: ChapterSide,
): Book {
  const local = localPayload as Book;
  const remote = remoteToBook(remotePayload as Record<string, unknown>);
  const localById = new Map(local.chapters.map((c) => [c.id, c]));
  const remoteById = new Map(remote.chapters.map((c) => [c.id, c]));
  const chapters: BookChapter[] = [];
  const pick = (id: string, lc?: BookChapter, rc?: BookChapter) => {
    if (lc && rc && comparable(lc) === comparable(rc)) return rc;
    return choices[id] === 'local' ? lc : rc;
  };
  for (const rc of remote.chapters) {
    const chosen = pick(rc.id, localById.get(rc.id), rc);
    if (chosen) chapters.push(chosen);
  }
  for (const lc of local.chapters) {
    if (remoteById.has(lc.id)) continue;
    const chosen = pick(lc.id, lc, undefined);
    if (chosen) chapters.push(chosen);
  }
  chapters.sort((a, b) => a.position - b.position);
  const base = fields === 'local' ? local : remote;
  return { ...base, chapters, updatedAt: new Date().toISOString() };
}
