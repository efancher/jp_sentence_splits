/**
 * Helpers for WaniKani mnemonic text shown on review cards (see
 * `CardMnemonic` in `src/pages/ReviewPage.tsx` and
 * `src/components/MnemonicText.tsx`).
 */

/** Removes WaniKani's inline `<radical>`/`<kanji>`/`<reading>`/… markup, leaving plain text. */
export function stripMnemonicMarkup(text: string): string {
  return text.replace(/<[^>]+>/g, '');
}

// WaniKani's reading (and sometimes meaning) mnemonic for a lot of jukugo and
// single-kanji vocab isn't a mnemonic at all — it's a placeholder telling the
// learner they already know the component kanji readings. Those are useless on
// a card if the learner *doesn't* remember the kanji, so we detect them and
// fall through to the component-kanji mnemonics instead.
const DEFERRAL_CUES: RegExp[] = [
  /jukugo word.{0,40}on'?yomi/,
  /\bon your own\b/,
  /read (this|it)(\s+\w+)? (on your own|by yourself)/,
  /(reading|meaning) is (the same as|basically the same as|just) the kanji/,
  /same as the kanji'?s? (reading|meaning)/,
  /(kanji|radical|word|vocab\w*) and (the |this )?(kanji|radical|word|vocab\w*) are exactly the same/,
  /they share (meanings?|readings?)( as well| too)?/,
  /shares? (its |the same )?(meaning|reading) with the kanji/,
  /you (already )?(know|learned|remember) (this|it|the reading|the meaning|these)/,
  /you learned (for|in|from) the kanji/,
  /(should|able to) (read|guess|figure out) this .{0,20}on your own/,
  /use[ds]? the on'?yomi (reading )?you (already )?(know|learned)/,
  /don'?t need a mnemonic/,
  /\bno mnemonic (is )?(needed|required|here)\b/,
];

/**
 * True when a WaniKani mnemonic is one of its "you already know the kanji"
 * placeholders rather than an actual memory aid. Conservative — a real
 * paragraph-length mnemonic with none of the boilerplate cues returns false.
 */
export function isDeferralMnemonic(text: string): boolean {
  const plain = stripMnemonicMarkup(text).toLowerCase().replace(/\s+/g, ' ').trim();
  // Empty / near-empty is a placeholder; anything with real content is judged
  // on its wording, not its length (some genuine mnemonics are terse).
  if (plain.length < 25) return true;
  return DEFERRAL_CUES.some((re) => re.test(plain));
}
