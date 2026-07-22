/**
 * Japanese sentence normalization for duplicate detection.
 * Mirrors the behavioral intent of reference/satori_gloss.py normalize_sentence_key.
 */

export function stripMarkup(value: string): string {
  let text = value ?? '';
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'");

  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    text = textarea.value;
  } else {
    text = text.replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    );
    text = text.replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
  }

  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/?div[^>]*>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/[ \t]+\n/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

export function normalizeSentenceKey(japanese: string): string {
  const text = stripMarkup(japanese).normalize('NFC');
  return text.replace(/\s+/g, '');
}

/**
 * Looser key for matching pasted article text to stored sentences.
 * Uses NFKC so full-width digits (１) match ASCII (1) and similar
 * compatibility characters align. Do not use for sentence identity —
 * that remains {@link normalizeSentenceKey}.
 */
export function normalizeForPasteMatch(japanese: string): string {
  const text = stripMarkup(japanese).normalize('NFKC');
  return text.replace(/\s+/g, '');
}

export function displayJapanese(japanese: string): string {
  return stripMarkup(japanese).normalize('NFC').trim();
}

export function normalizeExpressionKey(expression: string, reading: string): string {
  return `${normalizeSentenceKey(expression)}::${normalizeSentenceKey(reading)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
