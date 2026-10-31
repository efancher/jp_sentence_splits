import type { SentenceGrammar } from '../domain/types';

export interface ExampleParts {
  before: string;
  match: string;
  after: string;
}

type SpanFields = Pick<SentenceGrammar, 'surfaceForm' | 'start' | 'end'>;

/**
 * The sentence split around the words that make up the pattern. The stored offsets are trusted only while they
 * still select the stored surface form (a sentence edited after tagging would otherwise highlight the wrong words);
 * otherwise the surface form is searched for, and with neither a span there is nothing to highlight (null).
 */
export function splitAtSpan(japanese: string, link: SpanFields): ExampleParts | null {
  const form = link.surfaceForm;
  if (!form) return null;
  let start: number;
  if (link.start !== undefined && link.end !== undefined && japanese.slice(link.start, link.end) === form) start = link.start;
  else start = japanese.indexOf(form);
  if (start < 0) return null;
  return { before: japanese.slice(0, start), match: form, after: japanese.slice(start + form.length) };
}

export interface LinedUpExample<T> {
  item: T;
  parts: ExampleParts;
}

/** Examples that have a highlightable span, simplest (shortest sentence) first, oldest link first among equals. */
export function lineUpExamples<T extends { sentenceGrammar: SentenceGrammar; sentence: { japanese: string } }>(
  encounters: readonly T[],
): LinedUpExample<T>[] {
  return encounters
    .flatMap((item) => {
      const parts = splitAtSpan(item.sentence.japanese, item.sentenceGrammar);
      return parts ? [{ item, parts }] : [];
    })
    .sort(
      (a, b) =>
        a.item.sentence.japanese.length - b.item.sentence.japanese.length ||
        a.item.sentenceGrammar.createdAt.localeCompare(b.item.sentenceGrammar.createdAt),
    );
}

/** The distinct forms the pattern has taken (by matched text), most common first. */
export function formsSeen<T>(examples: readonly LinedUpExample<T>[]): { form: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const { parts } of examples) counts.set(parts.match, (counts.get(parts.match) ?? 0) + 1);
  return [...counts]
    .map(([form, count]) => ({ form, count }))
    .sort((a, b) => b.count - a.count || a.form.localeCompare(b.form, 'ja'));
}
