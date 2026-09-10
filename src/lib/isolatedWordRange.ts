import type { WordAlignment } from '../domain/types';
import type { TimeRangeMs } from './recording';

/**
 * Maps a sentence's target word to a time range in its reference recording,
 * using the forced aligner's word boundaries. The aligner tokenizes on its
 * own terms (dictionary-normalized spellings, re-segmentation) so its word
 * text can't be string-matched against `japanese` directly — position is
 * carried over by character-count proportion, the same approximation
 * `SyncedShadowText` uses for karaoke highlighting: the target's
 * [charIndex, charIndex+len) fraction of `japanese` is intersected with
 * each aligned word's own cumulative fraction of the (usable) transcript.
 *
 * The immediately-following aligned word is folded in when it's short
 * (≤2 chars — a case particle) so the learner hears whether the pitch stays
 * up after the word, which is the only audible heiban/odaka cue. A small
 * pad is added each side. Returns null when the word can't be located (no
 * alignment, surface form absent, degenerate range) — callers fall back to
 * whole-sentence playback.
 *
 * Also returns null when an out-of-vocabulary token (`<unk>` — a word the
 * aligner's lexicon didn't have, chiefly casual contractions like
 * 怖がってたり) sits at or before the matched range: its characters are
 * missing from the proportional basis while its airtime is not, so every
 * token after it is time-shifted against its character position and the
 * downstream mapping can't be trusted. Better a whole-sentence fallback
 * than a confidently-wrong span. (`<eps>` is ordinary inter-word silence
 * and doesn't trigger this.)
 */
export function isolatedWordRange(
  words: WordAlignment[],
  japanese: string,
  surfaceForm: string,
): TimeRangeMs | null {
  const charIndex = japanese.indexOf(surfaceForm);
  if (charIndex === -1 || surfaceForm.length === 0) return null;

  const usable = words.filter(
    (word) => word.text && word.text !== '<eps>' && word.text !== '<unk>',
  );
  const total = usable.reduce((sum, word) => sum + word.text.length, 0);
  if (total === 0) return null;

  const startFrac = charIndex / japanese.length;
  const endFrac = (charIndex + surfaceForm.length) / japanese.length;

  let acc = 0;
  let startMs: number | null = null;
  let endMs: number | null = null;
  let lastIndex = -1;
  usable.forEach((word, index) => {
    const wordStartFrac = acc / total;
    acc += word.text.length;
    const wordEndFrac = acc / total;
    if (wordEndFrac > startFrac && wordStartFrac < endFrac) {
      if (startMs === null) startMs = word.start * 1000;
      endMs = word.end * 1000;
      lastIndex = index;
    }
  });
  if (startMs === null || endMs === null || endMs <= startMs) return null;

  // An OOV token at/before the match makes the proportional map downstream
  // unreliable (see doc comment) — bail to whole-sentence playback.
  const matchEndMs = endMs;
  if (words.some((w) => w.text === '<unk>' && w.end > w.start && w.start * 1000 < matchEndMs)) {
    return null;
  }

  const nextWord = usable[lastIndex + 1];
  if (nextWord && nextWord.text.length <= 2) endMs = nextWord.end * 1000;

  return { startMs: Math.max(0, startMs - 60), endMs: endMs + 120 };
}
