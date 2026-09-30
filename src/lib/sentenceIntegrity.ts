/**
 * Pure detection of sentence-membership corruption in the cloud data, used by
 * `scripts/check-sentence-integrity.ts`. Row shapes are the snake_case
 * Supabase columns; nothing here reads or writes anything.
 */
export interface IntegrityMembership {
  id: string;
  book_id: string;
  sentence_id: string;
  chapter_id: string | null;
  position: number;
}
export interface IntegritySentence {
  id: string;
  deleted_at: string | null;
}
export interface IntegrityClip {
  id: string;
  sentence_id: string;
  source_id: string;
  source_start_ms: number;
}

export interface IntegrityReport {
  /** Live membership whose sentence is soft-deleted or missing. */
  danglingMemberships: IntegrityMembership[];
  /** Live audio clip whose sentence is soft-deleted or missing. */
  orphanClips: IntegrityClip[];
  /** Same (book, chapter) holding one position twice. */
  duplicatePositions: { bookId: string; chapterId: string | null; position: number }[];
  /** Chapters whose live sentences are not in the order their own audio plays. */
  misorderedChapters: { bookId: string; chapterId: string; sourceId: string; inversions: number; sentenceIds: string[] }[];
}

const isLive = (sentence: IntegritySentence | undefined): sentence is IntegritySentence =>
  !!sentence && sentence.deleted_at == null;

export function findIntegrityProblems(input: {
  memberships: IntegrityMembership[];
  sentences: IntegritySentence[];
  clips: IntegrityClip[];
}): IntegrityReport {
  const sentenceById = new Map(input.sentences.map((s) => [s.id, s]));

  const danglingMemberships = input.memberships.filter((m) => !isLive(sentenceById.get(m.sentence_id)));
  const orphanClips = input.clips.filter((c) => !isLive(sentenceById.get(c.sentence_id)));

  const seen = new Set<string>();
  const duplicatePositions: IntegrityReport['duplicatePositions'] = [];
  for (const m of input.memberships) {
    const key = `${m.book_id}|${m.chapter_id ?? ''}|${m.position}`;
    if (seen.has(key)) duplicatePositions.push({ bookId: m.book_id, chapterId: m.chapter_id, position: m.position });
    seen.add(key);
  }

  // Order check: infer each chapter's own recording as the source most of its
  // sentences have a clip from, then require live sentences to play in that
  // recording's time order. Works for chapters with no recorded sourceId.
  const clipsBySentence = new Map<string, IntegrityClip[]>();
  for (const clip of input.clips) {
    const list = clipsBySentence.get(clip.sentence_id) ?? [];
    list.push(clip);
    clipsBySentence.set(clip.sentence_id, list);
  }
  const byChapter = new Map<string, IntegrityMembership[]>();
  for (const m of input.memberships) {
    if (!m.chapter_id || !isLive(sentenceById.get(m.sentence_id))) continue;
    const list = byChapter.get(m.chapter_id) ?? [];
    list.push(m);
    byChapter.set(m.chapter_id, list);
  }

  const misorderedChapters: IntegrityReport['misorderedChapters'] = [];
  for (const [chapterId, rows] of byChapter) {
    const votes = new Map<string, number>();
    for (const m of rows) {
      for (const sourceId of new Set((clipsBySentence.get(m.sentence_id) ?? []).map((c) => c.source_id))) {
        votes.set(sourceId, (votes.get(sourceId) ?? 0) + 1);
      }
    }
    const [sourceId, count] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (!sourceId || !count || count < rows.length / 2) continue;

    const timed = rows
      .slice()
      .sort((a, b) => a.position - b.position)
      .flatMap((m) => {
        const starts = (clipsBySentence.get(m.sentence_id) ?? [])
          .filter((c) => c.source_id === sourceId)
          .map((c) => c.source_start_ms);
        return starts.length ? [{ sentenceId: m.sentence_id, start: Math.min(...starts) }] : [];
      });
    const bad = new Set<string>();
    let inversions = 0;
    for (let i = 1; i < timed.length; i += 1) {
      if (timed[i]!.start < timed[i - 1]!.start) {
        inversions += 1;
        bad.add(timed[i]!.sentenceId);
        bad.add(timed[i - 1]!.sentenceId);
      }
    }
    if (inversions > 0) {
      misorderedChapters.push({
        bookId: rows[0]!.book_id,
        chapterId,
        sourceId,
        inversions,
        sentenceIds: [...bad],
      });
    }
  }

  return { danglingMemberships, orphanClips, duplicatePositions, misorderedChapters };
}
