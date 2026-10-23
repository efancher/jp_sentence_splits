/**
 * Pure planning helpers for `scripts/merge-adjacent-sentences.ts`: merge two
 * neighbouring sentences (one mined sentence that was split at a comma pause
 * and lost its clause-final connective) into one. No DB, no network.
 */
import type { StudyStatus } from '../../src/domain/types';

const STRIP_RE = /[\s。、．，！？!?「」『』（）()･・…]/g;
const compact = (text: string): string => text.replace(STRIP_RE, '');

export interface MergePair {
  /** Earlier sentence id. */
  first: string;
  /** Immediately following sentence id. */
  second: string;
  /** The merged Japanese, with the dropped connective restored. */
  japanese: string;
  /** English for the merged sentence (hand-written; the two old ones are joined). */
  translation: string;
}

/**
 * The merged text must be exactly the first sentence (minus its full stop),
 * then only a connective / punctuation, then the second sentence — so a typo in
 * the pairs file can't silently rewrite either sentence.
 */
export function validateMergedText(
  first: string,
  second: string,
  merged: string,
): { ok: true; connective: string } | { ok: false; reason: string } {
  const a = compact(first);
  const b = compact(second);
  const m = compact(merged);
  if (!m.startsWith(a)) return { ok: false, reason: 'merged text does not start with the first sentence' };
  if (!m.endsWith(b)) return { ok: false, reason: 'merged text does not end with the second sentence' };
  const middle = m.slice(a.length, m.length - b.length);
  if (m.length < a.length + b.length) return { ok: false, reason: 'merged text overlaps the sentences' };
  if (!/^(が|けれども|けれど|けど|から|ので|のに|し|ても)$/.test(middle)) {
    return { ok: false, reason: `unexpected text between the sentences: "${middle}"` };
  }
  return { ok: true, connective: middle };
}

const STATUS_RANK: Record<StudyStatus, number> = {
  unstarted: 0,
  in_progress: 1,
  needs_review: 2,
  complete: 3,
};

/** The merged sentence keeps the most advanced membership status of the two. */
export function mergedStatus(a: StudyStatus, b: StudyStatus): StudyStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

export interface MergeStudyItem {
  id: string;
  subjectId: string;
  activityType: string;
  reviewCount: number;
  fsrsReps: number;
}

/**
 * Same collision rule as `buildResegmentPlan`: per activity type the card with
 * more reviews keeps its FSRS history (then more reps, then id for
 * determinism); the other is retired. `study_items_uidx` is unique on
 * (owner, subject_type, subject_id, activity_type) among live rows, so two
 * survivors on the merged sentence would collide anyway.
 */
export function planStudyItemMoves(items: MergeStudyItem[]): {
  move: MergeStudyItem[];
  retire: MergeStudyItem[];
} {
  const byActivity = new Map<string, MergeStudyItem[]>();
  for (const item of items) {
    const list = byActivity.get(item.activityType) ?? [];
    list.push(item);
    byActivity.set(item.activityType, list);
  }
  const move: MergeStudyItem[] = [];
  const retire: MergeStudyItem[] = [];
  for (const list of byActivity.values()) {
    list.sort((x, y) => y.reviewCount - x.reviewCount || y.fsrsReps - x.fsrsReps || x.id.localeCompare(y.id));
    move.push(list[0]!);
    retire.push(...list.slice(1));
  }
  return { move, retire };
}

/** Rewrite (or append) the `Video position:` line in a shadowing userNotes. */
export function withVideoPosition(notes: string | undefined, startMs: number, endMs: number): string {
  const line = `Video position: ${(startMs / 1000).toFixed(3)}–${(endMs / 1000).toFixed(3)} seconds`;
  if (!notes) return line;
  return /Video position:[^\n]*/.test(notes) ? notes.replace(/Video position:[^\n]*/, line) : `${notes}\n${line}`;
}
