import type { MoraUnit } from './mora';
import type { WordAlignment } from '../domain/types';

export interface KanaTimelineEntry {
  /** Kana for this word's slice of the sentence (falls back to the aligner's own token when no reading is available). */
  text: string;
  /** Clip-relative seconds, already adjusted for `timeOffsetSeconds`. */
  start: number;
  end: number;
  /** Horizontal placement over a 0..100 width track. */
  leftPct: number;
  widthPct: number;
}

const INAUDIBLE = new Set(['', '<eps>', '<unk>', '<sil>', '<pad>']);

/**
 * Places the sentence's kana under a linear time axis (the pitch contours in
 * AnalysisPanel), one label per forced-alignment word.
 *
 * The forced aligner, the mora sequence, and the raw sentence are three
 * independently-tokenized representations that production data has been seen
 * to diverge between (see SyncedShadowText's note). Rather than string-match
 * across them, each word's share of the total (audible) transcript character
 * count is mapped onto the mora sequence by proportion — the same
 * approximation SyncedShadowText uses for karaoke highlighting. Worst case a
 * label is a mora or two off; it never throws or drops a word.
 *
 * `timeOffsetSeconds` handles the practice-target case: the reference pitch
 * contour is sliced to `[targetRange]`, but the reference alignment is keyed
 * to the full clip, so word times need the range's start subtracted.
 */
export function buildKanaTimeline({
  words,
  moraUnits,
  durationSeconds,
  timeOffsetSeconds = 0,
}: {
  words: WordAlignment[];
  moraUnits: MoraUnit[];
  durationSeconds: number;
  timeOffsetSeconds?: number;
}): KanaTimelineEntry[] {
  if (durationSeconds <= 0) return [];
  const audible = words.filter((word) => !INAUDIBLE.has(word.text));
  if (audible.length === 0) return [];
  const totalChars = audible.reduce((sum, word) => sum + word.text.length, 0);

  let charsBefore = 0;
  const entries: KanaTimelineEntry[] = [];
  for (const word of audible) {
    const startFrac = totalChars > 0 ? charsBefore / totalChars : 0;
    charsBefore += word.text.length;
    const endFrac = totalChars > 0 ? charsBefore / totalChars : 1;

    let text = word.text;
    if (moraUnits.length > 0) {
      const from = Math.round(startFrac * moraUnits.length);
      const to = Math.max(from + 1, Math.round(endFrac * moraUnits.length));
      text = moraUnits.slice(from, to).map((unit) => unit.text).join('') || word.text;
    }

    const start = word.start - timeOffsetSeconds;
    const end = word.end - timeOffsetSeconds;
    // Drop words that fall entirely outside a sliced practice-target window.
    if (end <= 0 || start >= durationSeconds) continue;

    const leftPct = Math.max(0, Math.min(100, (start / durationSeconds) * 100));
    const rightPct = Math.max(0, Math.min(100, (end / durationSeconds) * 100));
    entries.push({ text, start, end, leftPct, widthPct: Math.max(0, rightPct - leftPct) });
  }
  return entries;
}
