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

  // The ruby base excludes hiragana (ぁ-ゟ) as well as whitespace/
  // brackets: furigana only ever annotates kanji (or occasionally katakana/
  // digits, e.g. "1ヶ月[いっかげつ]"), never plain hiragana. Source data
  // doesn't reliably put a space between a preceding plain-kana run and the
  // next ruby-annotated word (e.g. "でもう1ヶ月[いっかげつ]", no space
  // before "1ヶ月") — without this exclusion, the non-greedy base would
  // still expand across that hiragana run to reach the "[", silently
  // swallowing it into the base (and, since only `reading` is rendered for
  // ruby segments, losing it — a real sentence's mora/hiragana row was
  // missing "でもう" entirely because of this).
  const segments: RubySegment[] = [];
  const pattern = /([^\s[\]ぁ-ゟ]+?)\[([^\]]+)]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: 'text', base: text.slice(lastIndex, match.index) });
    }
    segments.push({
      kind: 'ruby',
      base: match[1] ?? '',
      reading: match[2] ?? '',
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ kind: 'text', base: text.slice(lastIndex) });
  }

  if (!segments.some((segment) => segment.kind === 'ruby')) {
    return [{ kind: 'text', base: text }];
  }

  return segments;
}
