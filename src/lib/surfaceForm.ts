/**
 * Splits `japanese` around the first occurrence of `surfaceForm`, for
 * highlighting the word under test in a sentence (`<mark>` the middle
 * element). Returns `[japanese, '', '']` when the surface form isn't
 * present, so callers can render the sentence unchanged.
 */
export function splitOnSurfaceForm(
  japanese: string,
  surfaceForm: string,
): [string, string, string] {
  const index = surfaceForm ? japanese.indexOf(surfaceForm) : -1;
  if (index === -1) return [japanese, '', ''];
  return [
    japanese.slice(0, index),
    surfaceForm,
    japanese.slice(index + surfaceForm.length),
  ];
}

const toKatakana = (text: string) =>
  text.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));

/**
 * A dictionary entry whose sentence spells it phonetically rather than with its
 * kanji — 綺麗 written きれい, 餌 written えさ, たか written タカ, 何とか written
 * なんとか. Finds the word's reading in the sentence as hiragana, then as
 * katakana, and only accepts it when it occurs exactly once (and is at least two
 * kana, so a stray っ or の can't match): a reading is short, and a second hit is
 * as likely a different word as this one. Returns null otherwise — the caller
 * leaves the link alone rather than guess. Inflected occurrences (おいしそう for
 * おいしい, でした for です) are deliberately not attempted here.
 */
export function surfaceFormFromReading(japanese: string, reading: string): string | null {
  if (reading.length < 2) return null;
  for (const spelling of [reading, toKatakana(reading)]) {
    const first = japanese.indexOf(spelling);
    if (first === -1) continue;
    return japanese.indexOf(spelling, first + 1) === -1 ? spelling : null;
  }
  return null;
}
