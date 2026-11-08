/**
 * Pure helpers for merging two neighbouring sentences into one
 * (`mergeAdjacentSentences` in `src/db/repository.ts`, and the offline
 * `scripts/merge-adjacent-sentences.ts`). No DB, no network.
 */
import type { StudyStatus } from '../domain/types';

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

const TRAILING_STOP_RE = /[。．.！？!?\s]+$/;

/**
 * Default text for the merge dialog: the first sentence without its closing
 * full stop, then the second. The learner edits in any connective the split
 * dropped (が、けど、から …) before confirming.
 */
export function suggestMergedJapanese(first: string, second: string): string {
  const head = first.trim().replace(TRAILING_STOP_RE, '');
  const tail = second.trim();
  if (!head) return tail;
  if (!tail) return first.trim();
  return /[、，,]$/.test(head) ? `${head}${tail}` : `${head}、${tail}`;
}

export function suggestMergedTranslation(first: string, second: string): string {
  return [first.trim(), second.trim()].filter(Boolean).join(' ');
}

const STRIP_RE = /[\s。、．，！？!?「」『』（）()･・…]/g;
const compact = (text: string): string => text.replace(STRIP_RE, '');

/**
 * Guard against a typo silently rewriting either sentence: the merged text
 * must still start with the first sentence, end with the second, and have
 * only a short connective between them.
 */
export function validateMergedJapanese(
  first: string,
  second: string,
  merged: string,
): { ok: true } | { ok: false; reason: string } {
  const a = compact(first);
  const b = compact(second);
  const m = compact(merged);
  if (!m.startsWith(a)) return { ok: false, reason: 'The merged text must start with the first sentence.' };
  if (!m.endsWith(b)) return { ok: false, reason: 'The merged text must end with the second sentence.' };
  if (m.length < a.length + b.length) return { ok: false, reason: 'The merged text overlaps the two sentences.' };
  if (m.length - a.length - b.length > 6) {
    return { ok: false, reason: 'Only a short connective may sit between the two sentences.' };
  }
  return { ok: true };
}
