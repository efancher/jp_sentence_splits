/**
 * Pure edits for the mining wizard's transcript stage (stage 1). The
 * reviewer fixes ASR/caption text and coarse boundaries here, before
 * resegmentation runs on the server. Segment-level, not sentence-level:
 * one entry per ASR/caption segment, carrying its confidence flag.
 */

import { joinJapanese } from './resegmentPlan';

export interface WizardTranscriptSeg {
  text: string;
  startMs: number;
  endMs: number;
  isAuto: boolean;
  /** ASR flagged this segment shaky — the UI marks it for a careful listen. */
  lowConfidence: boolean;
}

/** Split on the character *after* each sentence-final mark, keeping the mark. */
const SENTENCE_SPLIT_RE = /(?<=[。！？!?…])/;

/** Fold segment `index + 1` into `index` — join text, span the union. */
export function mergeTranscriptSegDown(
  segs: WizardTranscriptSeg[],
  index: number,
): WizardTranscriptSeg[] {
  if (index < 0 || index + 1 >= segs.length) return segs;
  const a = segs[index]!;
  const b = segs[index + 1]!;
  const merged: WizardTranscriptSeg = {
    text: joinJapanese(a.text.trimEnd(), b.text.trimStart()),
    startMs: Math.min(a.startMs, b.startMs),
    endMs: Math.max(a.endMs, b.endMs),
    isAuto: a.isAuto || b.isAuto,
    lowConfidence: a.lowConfidence || b.lowConfidence,
  };
  return [...segs.slice(0, index), merged, ...segs.slice(index + 2)];
}

/**
 * Split segment `index` on internal sentence-final punctuation into one
 * segment per sentence, dividing the time span proportionally by character
 * count. No-op when there is nothing to split.
 */
export function splitTranscriptSeg(
  segs: WizardTranscriptSeg[],
  index: number,
): WizardTranscriptSeg[] {
  const seg = segs[index];
  if (!seg) return segs;
  const pieces = seg.text
    .split(SENTENCE_SPLIT_RE)
    .map((piece) => piece.trim())
    .filter(Boolean);
  if (pieces.length <= 1) return segs;
  const totalChars = pieces.reduce((n, p) => n + p.length, 0) || 1;
  const span = seg.endMs - seg.startMs;
  let cursor = seg.startMs;
  const replacements: WizardTranscriptSeg[] = pieces.map((text, i) => {
    const start = cursor;
    cursor =
      i === pieces.length - 1
        ? seg.endMs
        : Math.round(start + (span * text.length) / totalChars);
    return {
      text,
      startMs: start,
      endMs: cursor,
      isAuto: seg.isAuto,
      lowConfidence: seg.lowConfidence,
    };
  });
  return [...segs.slice(0, index), ...replacements, ...segs.slice(index + 1)];
}

/** Set one segment's text without disturbing the rest. */
export function editTranscriptSegText(
  segs: WizardTranscriptSeg[],
  index: number,
  text: string,
): WizardTranscriptSeg[] {
  return segs.map((seg, i) => (i === index ? { ...seg, text } : seg));
}
