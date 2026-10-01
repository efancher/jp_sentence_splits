import type { Sentence } from '../domain/types';

export interface ReviewDocument {
  bookId: string;
  bookTitle: string;
  chapterTitle?: string;
  activeMembershipId: string;
  rows: { membershipId: string; sentence: Sentence }[];
  /** Known surface forms of the cloze's canonical vocabulary item. */
  vocabularyForms: string[];
}

export interface ReviewTextSpan {
  start: number;
  end: number;
}

/** Without occurrence offsets, do not pretend the first repeated word is unique. */
export function uniqueReviewSpan(text: string, surface: string): ReviewTextSpan | undefined {
  if (!surface) return undefined;
  const start = text.indexOf(surface);
  if (start < 0 || text.indexOf(surface, start + 1) >= 0) return undefined;
  return { start, end: start + surface.length };
}

/** Literal matching, with overlapping aliases merged and no answer in markup. */
export function maskReviewText(text: string, forms: readonly string[]): string {
  const spans: ReviewTextSpan[] = [];
  for (const form of new Set(forms.filter(Boolean))) {
    let start = text.indexOf(form);
    while (start >= 0) {
      spans.push({ start, end: start + form.length });
      start = text.indexOf(form, start + 1);
    }
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: ReviewTextSpan[] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span.start < last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  let cursor = 0;
  let result = '';
  for (const span of merged) {
    result += text.slice(cursor, span.start) + '_____';
    cursor = span.end;
  }
  return result + text.slice(cursor);
}

/** Include tokenizer-known inflections, not just the source's dictionary spelling. */
export function reviewDocumentMaskForms(
  sentences: Sentence[],
  expression: string,
  surface: string,
  linkedForms: string[] = [],
): string[] {
  const forms = new Set([expression, surface, ...linkedForms].filter(Boolean));
  for (const sentence of sentences) {
    for (const suggestion of sentence.vocabularySuggestions ?? []) {
      if (suggestion.expression === expression && suggestion.surface) forms.add(suggestion.surface);
    }
  }
  return [...forms];
}
