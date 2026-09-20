import type { MoraUnit } from './mora';
import { phonesToMoraIntervals, type MoraInterval } from './moraTiming';
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
 * AnalysisPanel), one label per mora — spread across each word's own
 * phone-level sub-alignment so a label's width reflects roughly how long
 * that mora was actually held, not just an even split of the word.
 *
 * The forced aligner, the mora sequence, and the raw sentence are three
 * independently-tokenized representations that production data has been seen
 * to diverge between (see SyncedShadowText's note). Rather than string-match
 * across them, each word's share of the total (audible) transcript character
 * count is mapped onto the mora sequence by proportion — the same
 * approximation SyncedShadowText uses for karaoke highlighting — to decide
 * *which* morae belong to a word. Worst case a mora ends up assigned to the
 * wrong neighboring word; it never throws or drops one.
 *
 * Within a word, morae are then spread across that word's own phones the
 * same way: proportionally, by index, not by string content. Phone count
 * and mora count aren't equal in general (a geminate/long vowel collapses
 * two morae onto one shared phone), so this is an approximation too — but
 * unlike an even split, real per-phone durations still show through, which
 * is the point: a mora a learner drags out shows up as a wider label.
 *
 * **Exact path** (`exactMoraIntervals`): when every audible token's phones parse
 * into morae (`phonesToMoraIntervals`) and the counts add up to the reading's
 * mora list, each mora gets its own measured interval — no character-proportion
 * guess about which morae belong to which word, no even spread over phones. Any
 * mismatch (an `<unk>` token, a dropped vowel, a reading that differs from the
 * pronunciation, a learner who elongated or skipped a sound) falls back to the
 * approximation above for the whole sentence.
 *
 * `timeOffsetSeconds` handles the practice-target case: the reference pitch
 * contour is sliced to `[targetRange]`, but the reference alignment is keyed
 * to the full clip, so times need the range's start subtracted.
 */
/**
 * One measured interval per mora of `moraUnits`, or null when the aligned tokens'
 * own phones don't yield exactly that many morae in order.
 */
export function exactMoraIntervals(
  audible: readonly WordAlignment[],
  moraUnits: readonly MoraUnit[],
): MoraInterval[] | null {
  if (moraUnits.length === 0 || audible.length === 0) return null;
  const all: MoraInterval[] = [];
  for (const word of audible) {
    const intervals = phonesToMoraIntervals(word.phones);
    if (!intervals || intervals.length === 0) return null;
    all.push(...intervals);
  }
  return all.length === moraUnits.length ? all : null;
}

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

  const entries: KanaTimelineEntry[] = [];
  const pushEntry = (text: string, rawStart: number, rawEnd: number) => {
    const start = rawStart - timeOffsetSeconds;
    const end = rawEnd - timeOffsetSeconds;
    // Drop labels that fall entirely outside a sliced practice-target window.
    if (end <= 0 || start >= durationSeconds) return;
    const leftPct = Math.max(0, Math.min(100, (start / durationSeconds) * 100));
    const rightPct = Math.max(0, Math.min(100, (end / durationSeconds) * 100));
    entries.push({ text, start, end, leftPct, widthPct: Math.max(0, rightPct - leftPct) });
  };

  const exact = exactMoraIntervals(audible, moraUnits);
  if (exact) {
    moraUnits.forEach((unit, index) => pushEntry(unit.text, exact[index]!.start, exact[index]!.end));
    return entries;
  }

  let charsBefore = 0;
  for (const word of audible) {
    const startFrac = totalChars > 0 ? charsBefore / totalChars : 0;
    charsBefore += word.text.length;
    const endFrac = totalChars > 0 ? charsBefore / totalChars : 1;

    let wordMorae: MoraUnit[] = [];
    if (moraUnits.length > 0) {
      const from = Math.round(startFrac * moraUnits.length);
      const to = Math.max(from + 1, Math.round(endFrac * moraUnits.length));
      wordMorae = moraUnits.slice(from, to);
    }

    if (wordMorae.length === 0) {
      // No mora reading available for this word — one label for the whole span.
      pushEntry(word.text, word.start, word.end);
      continue;
    }
    if (word.phones.length === 0 || wordMorae.length === 1) {
      // Nothing to sub-divide: no phone timing, or the word is one mora.
      pushEntry(wordMorae.map((unit) => unit.text).join(''), word.start, word.end);
      continue;
    }

    const phones = word.phones;
    const boundaries = [phones[0]!.start, ...phones.map((phone) => phone.end)];
    const timeAt = (index: number) => {
      const lo = Math.floor(index);
      const hi = Math.min(boundaries.length - 1, Math.ceil(index));
      const frac = index - lo;
      return boundaries[lo]! + (boundaries[hi]! - boundaries[lo]!) * frac;
    };
    const phonesPerMora = phones.length / wordMorae.length;
    wordMorae.forEach((unit, index) => {
      pushEntry(unit.text, timeAt(index * phonesPerMora), timeAt((index + 1) * phonesPerMora));
    });
  }
  return entries;
}
