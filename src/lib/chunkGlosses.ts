export interface GlossWord {
  expression: string;
  english: string;
}

const KANA_END = /[ぁ-ゖ]$/;

function shortEnglish(english: string): string {
  return english.split(/\s*[/;,]\s*/)[0]?.trim() ?? '';
}

function occursIn(chunk: string, expression: string): boolean {
  if (chunk.includes(expression)) return true;
  // Inflected verbs/adjectives: 書く appears as 書い, 高い as 高く.
  return expression.length > 1 && KANA_END.test(expression) && chunk.includes(expression.slice(0, -1));
}

/** Word-list English per chunk; each word goes to the first chunk that contains it. */
export function glossesFromWords(chunks: { id: string; japanese: string }[], words: GlossWord[]): Map<string, string> {
  const byChunk = new Map<string, string[]>();
  for (const word of words) {
    const english = shortEnglish(word.english);
    if (!english || !word.expression) continue;
    const owner = chunks.find((chunk) => occursIn(chunk.japanese, word.expression));
    if (!owner) continue;
    byChunk.set(owner.id, [...(byChunk.get(owner.id) ?? []), english]);
  }
  return new Map([...byChunk].map(([id, list]) => [id, list.join(' · ')]));
}
