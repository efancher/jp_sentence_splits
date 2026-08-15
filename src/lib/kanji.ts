/**
 * Code-point-safe kanji detection, shared between the materialization
 * repository functions and the vocabulary/kanji browsing pages. Uses
 * Array.from (not indexing/regex over the raw string) so astral-plane kanji
 * like 𠮟 (U+20B9F, a surrogate pair) are handled correctly — same reasoning
 * as kanjiSchema's code-point-based single-character check.
 */
const HAN_CHARACTER_RE = /\p{Script=Han}/u;

export function isHanCharacter(character: string): boolean {
  return HAN_CHARACTER_RE.test(character);
}
