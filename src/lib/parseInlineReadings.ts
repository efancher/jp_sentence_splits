export interface RubySegment {
  kind: 'ruby' | 'text';
  base: string;
  reading?: string;
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

  // Take the whole run of non-space, non-bracket characters immediately
  // before "[..]" as the ruby candidate, then strip a *leading* hiragana
  // prefix off it. The two markup styles this parser has to accept disagree
  // on where the base starts and ends:
  //
  //  - Satori CSV writes the base as the kanji core only, with okurigana
  //    trailing outside: "作[つく]りました".
  //  - inlineReadingFromTokens (mining / re-segmentation) writes the base as
  //    the whole written word, okurigana and all: "歩い[あるい]",
  //    "同い年[おないどし]", "焼き鳥[やきとり]".
  //
  // Keeping interior/trailing hiragana in the base handles the second style
  // (the reading then lines up with the whole word, not just its last
  // kanji). Stripping only a *leading* hiragana run still handles the case
  // the old kanji-only base guarded against: source data that omits the
  // space before a ruby word ("でもう1ヶ月[いっかげつ]" → base "1ヶ月",
  // "でもう" split off as text) — a real sentence's mora/hiragana row was
  // missing "でもう" entirely before that guard existed.
  const segments: RubySegment[] = [];
  const pattern = /([^\s[\]]+)\[([^\]]+)]/g;
  const LEADING_HIRAGANA = /^[ぁ-ゟ]+/;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const run = match[1] ?? '';
    const base = run.replace(LEADING_HIRAGANA, '');
    const rubyStart = match.index + (run.length - base.length);
    const matchEnd = match.index + match[0].length;

    if (rubyStart > lastIndex) {
      segments.push({ kind: 'text', base: text.slice(lastIndex, rubyStart) });
    }
    if (base) {
      segments.push({ kind: 'ruby', base, reading: match[2] ?? '' });
    } else {
      // The whole run was hiragana — no real kanji base (e.g. a bracketed
      // stage direction). Keep it, brackets and all, as plain text.
      segments.push({ kind: 'text', base: text.slice(rubyStart, matchEnd) });
    }
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
