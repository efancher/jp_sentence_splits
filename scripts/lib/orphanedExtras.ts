export interface ExtrasRef {
  id: string;
  bookId: string | null;
  chapterId: string | null;
}

export interface MembershipRef {
  sentenceId: string;
  bookId: string;
  chapterId: string | null;
}

export interface ExtrasRepoint {
  id: string;
  from: { bookId: string | null; chapterId: string | null };
  to: { bookId: string; chapterId: string | null };
}

export interface OrphanedExtrasPlan {
  repoints: ExtrasRepoint[];
  /** Orphaned rows whose sentence is in no live book, or in several (never guess). */
  unresolved: { id: string; reason: 'no-live-membership' | 'multiple-memberships' }[];
}

/**
 * sentence_extras rows are read by book_id, so a row whose book was deleted (e.g.
 * by a book merge that didn't carry extras across) is invisible. Repoint each such
 * row to the one live book its sentence belongs to.
 */
export function planOrphanedExtrasRepair(
  extras: readonly ExtrasRef[],
  liveBookIds: ReadonlySet<string>,
  memberships: readonly MembershipRef[],
): OrphanedExtrasPlan {
  const bySentence = new Map<string, MembershipRef[]>();
  for (const m of memberships) {
    if (!liveBookIds.has(m.bookId)) continue;
    const list = bySentence.get(m.sentenceId);
    if (list) list.push(m);
    else bySentence.set(m.sentenceId, [m]);
  }
  const plan: OrphanedExtrasPlan = { repoints: [], unresolved: [] };
  for (const row of extras) {
    if (row.bookId && liveBookIds.has(row.bookId)) continue;
    const candidates = bySentence.get(row.id) ?? [];
    if (candidates.length === 0) plan.unresolved.push({ id: row.id, reason: 'no-live-membership' });
    else if (new Set(candidates.map((c) => c.bookId)).size > 1) {
      plan.unresolved.push({ id: row.id, reason: 'multiple-memberships' });
    } else {
      const target = candidates[0]!;
      plan.repoints.push({
        id: row.id,
        from: { bookId: row.bookId, chapterId: row.chapterId },
        to: { bookId: target.bookId, chapterId: target.chapterId },
      });
    }
  }
  return plan;
}
