export interface RubySegment {
  kind: 'ruby' | 'text';
  base: string;
  reading?: string;
}

// Kanji, CJK compat ideographs, iteration marks, 々〆〤 and ヶ — matches
// inlineReadingFromTokens' KANJI_RE. ヶ counts so "1ヶ月[いっかげつ]"'s base
// is the whole run.
const KANJI_RE = /[々〇㐀-鿿豈-﫿々〆〤ヶ]/;
const DIGIT_RE = /[0-9０-９]/;

/**
 * Where the ruby base starts inside `run` (the maximal non-space, non-bracket
 * run sitting immediately before a "[..]"). The base begins at the run's
 * first kanji, so leading okurigana-less material stays out of it:
 *
 *  - "お先" → base "先" ("お" is text: お+さき, not おさき)
 *  - "コーヒー飲" → base "飲" (the katakana word is text)
 *  - "でもう1ヶ月" → base "1ヶ月" (the particle run is text)
 *
 * Interior / trailing kana after that first kanji stays in the base, so a
 * whole-word reading lines up: "同い年[おないどし]", "歩い[あるい]",
 * "焼き鳥[やきとり]". A leading digit run joins the base when a kanji follows
 * it directly ("1ヶ月", "22歳", "3年") or when nothing but kana sits between
 * it and the "[" ("1つ[ひとつ]", "2つ[ふたつ]") — but not "1つ下[した]",
 * where "1つ" is a separate word and the reading is 下's alone.
 *
 * Returns -1 when the run has no usable base (all kana / katakana / a bare
 * bracketed stage direction), so the caller leaves it as plain text.
 */
function rubyBaseOffset(run: string): number {
  const chars = Array.from(run);
  let offset = 0;
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i]!;
    if (KANJI_RE.test(char)) return offset;
    if (DIGIT_RE.test(char)) {
      let j = i;
      let ahead = offset;
      while (j < chars.length && DIGIT_RE.test(chars[j]!)) {
        ahead += chars[j]!.length;
        j += 1;
      }
      const nextIsKanji = j < chars.length && KANJI_RE.test(chars[j]!);
      const onlyKanaBeforeBracket = !chars.slice(j).some((c) => KANJI_RE.test(c));
      if (nextIsKanji || onlyKanaBeforeBracket) return offset;
      offset = ahead;
      i = j - 1;
      continue;
    }
    offset += char.length;
  }
  return -1;
}

/**
 * Parse Satori-style inline readings: 小鳥[ことり].
 * Fall back to plain text when the syntax cannot be parsed safely.
 */
export function parseInlineReadings(input: string): RubySegment[] {
  const text = input ?? '';
  if (!text.includes('[')) {
    return [{ kind: 'text', base: text }];
  }

  const segments: RubySegment[] = [];
  const pattern = /([^\s[\]]+)\[([^\]]+)]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const run = match[1] ?? '';
    const matchEnd = match.index + match[0].length;
    const baseOffset = rubyBaseOffset(run);

    if (baseOffset === -1) {
      // No kanji base (e.g. a bracketed stage direction "[音楽]") — keep the
      // whole "run[..]" verbatim as text.
      if (match.index > lastIndex) {
        segments.push({ kind: 'text', base: text.slice(lastIndex, match.index) });
      }
      segments.push({ kind: 'text', base: text.slice(match.index, matchEnd) });
      lastIndex = matchEnd;
      continue;
    }

    const rubyStart = match.index + baseOffset;
    if (rubyStart > lastIndex) {
      segments.push({ kind: 'text', base: text.slice(lastIndex, rubyStart) });
    }
    segments.push({
      kind: 'ruby',
      base: run.slice(baseOffset),
      reading: match[2] ?? '',
    });
    lastIndex = matchEnd;
  }

  if (lastIndex < text.length) {
    segments.push({ kind: 'text', base: text.slice(lastIndex) });
  }

  if (!segments.some((segment) => segment.kind === 'ruby')) {
    return [{ kind: 'text', base: text }];
  }

  return segments;
}
