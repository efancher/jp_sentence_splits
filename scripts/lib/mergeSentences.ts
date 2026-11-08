/**
 * Pure planning helpers for `scripts/merge-adjacent-sentences.ts`: merge two
 * neighbouring sentences (one mined sentence that was split at a comma pause
 * and lost its clause-final connective) into one. No DB, no network. The
 * status/card/video-position helpers are shared with the in-app merge.
 */
export {
  mergedStatus,
  planStudyItemMoves,
  withVideoPosition,
  type MergeStudyItem,
} from '../../src/lib/mergeSentences';

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
