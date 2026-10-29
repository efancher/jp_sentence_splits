/**
 * Planning for repair-merged-book-chapters.ts: undoes the chapter collapse the
 * old mergeBookIntoChapter did (a whole source book became ONE chapter named
 * after the book, however many episode chapters it held). Pure so it is
 * testable without credentials.
 */

export interface PlanChapter {
  id: string;
  title: string;
  position: number;
  sourceId?: string;
  sourceDate?: string;
  [key: string]: unknown;
}

export interface PlanSourceBook {
  id: string;
  title: string;
  createdAt: string;
  chapters: PlanChapter[];
}

export interface PlanImport {
  bookId: string;
  chapterId: string;
  sentenceCount: number;
}

export interface PlanMembership {
  id: string;
  sentenceId: string;
  position: number;
  chapterId?: string;
}

export interface ChapterSplit {
  /** The collapsed chapter in the target book that gets repaired. */
  collapsedChapterId: string;
  sourceBookId: string;
  /** Final chapters replacing the collapsed one, in order. */
  chapters: PlanChapter[];
  /** book_sentences id -> chapter id, for rows whose chapter changes. */
  reassignments: Map<string, string>;
}

/** The collapsed chapter carries the source book's title and creation instant. */
export function isCollapsedFrom(chapter: PlanChapter, source: PlanSourceBook): boolean {
  if (chapter.title.trim() !== source.title.trim() || !chapter.sourceDate) return false;
  return new Date(chapter.sourceDate).getTime() === new Date(source.createdAt).getTime();
}

export function planChapterSplit(input: {
  collapsed: PlanChapter;
  source: PlanSourceBook;
  imports: readonly PlanImport[];
  memberships: readonly PlanMembership[];
  newChapterId: () => string;
}): ChapterSplit {
  const { collapsed, source } = input;
  const members = input.memberships
    .filter((item) => item.chapterId === collapsed.id)
    .sort((a, b) => a.position - b.position);
  const counts = new Map(
    input.imports.filter((item) => item.bookId === source.id).map((item) => [item.chapterId, item.sentenceCount]),
  );
  const ordered = source.chapters.slice().sort((a, b) => a.position - b.position).filter((item) => counts.has(item.id));
  if (!ordered.length) throw new Error(`No import records describe the chapters of ${source.id}.`);
  const total = ordered.reduce((sum, item) => sum + counts.get(item.id)!, 0);
  if (total !== members.length) {
    throw new Error(
      `Import records list ${total} sentences for ${source.id} but chapter ${collapsed.id} holds ${members.length}; refusing to guess.`,
    );
  }

  const chapters: PlanChapter[] = [];
  const reassignments = new Map<string, string>();
  let offset = 0;
  ordered.forEach((original, index) => {
    const id = index === 0 ? collapsed.id : input.newChapterId();
    chapters.push({
      ...original,
      id,
      position: collapsed.position + index,
      ...(collapsed.suspendedAt ? { suspendedAt: collapsed.suspendedAt } : {}),
    });
    const slice = members.slice(offset, offset + counts.get(original.id)!);
    offset += slice.length;
    if (index > 0) for (const item of slice) reassignments.set(item.id, id);
  });
  return { collapsedChapterId: collapsed.id, sourceBookId: source.id, chapters, reassignments };
}

/** Replaces the collapsed chapter with its split and renumbers positions. */
export function applySplitToChapters(all: readonly PlanChapter[], split: ChapterSplit): PlanChapter[] {
  const out: PlanChapter[] = [];
  for (const chapter of all.slice().sort((a, b) => a.position - b.position)) {
    if (chapter.id === split.collapsedChapterId) out.push(...split.chapters);
    else out.push(chapter);
  }
  return out.map((chapter, position) => ({ ...chapter, position }));
}
