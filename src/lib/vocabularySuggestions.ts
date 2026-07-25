/**
 * Vocabulary suggestion helpers for the Glossbook picker.
 *
 * Morphology tokens come from Shadowmine package v2. Cure Dolly analysis chunks
 * stay separate — a vocabulary expression can be smaller than or span across
 * grammar chunks.
 */

import type {
  VocabularySelection,
  VocabularySuggestion,
} from '../domain/types';
import { createId } from './ids';

export interface MorphologyToken {
  surface: string;
  start: number;
  end: number;
  lemma: string;
  reading?: string;
  pos?: string;
}

/** POS prefixes that are usually worth studying as vocabulary. */
const CONTENT_POS_PREFIXES = [
  '名詞',
  '動詞',
  '形容詞',
  '形容動詞',
  '副詞',
  '連体詞',
  '感動詞',
] as const;

const SKIP_POS_PREFIXES = [
  '助詞',
  '助動詞',
  '補助記号',
  '記号',
  '空白',
] as const;

export function isContentPos(pos: string): boolean {
  if (!pos) return false;
  if (SKIP_POS_PREFIXES.some((prefix) => pos.startsWith(prefix))) return false;
  return CONTENT_POS_PREFIXES.some((prefix) => pos.startsWith(prefix));
}

export function validateSpan(
  japanese: string,
  start: number,
  end: number,
  surface: string,
): boolean {
  if (start < 0 || end <= start || end > japanese.length) return false;
  return japanese.slice(start, end) === surface;
}

export function suggestionFromToken(
  token: MorphologyToken,
  japanese: string,
): VocabularySuggestion | null {
  if (!validateSpan(japanese, token.start, token.end, token.surface)) {
    return null;
  }
  const expression = token.lemma.trim() || token.surface;
  const pos = token.pos?.trim() ?? '';
  return {
    id: createId('vsug'),
    surface: token.surface,
    start: token.start,
    end: token.end,
    expression,
    reading: token.reading?.trim() ?? '',
    pos,
    source: 'morphology',
    selectedByDefault: isContentPos(pos),
  };
}

export function suggestionsFromTokens(
  japanese: string,
  tokens: MorphologyToken[],
): VocabularySuggestion[] {
  const out: VocabularySuggestion[] = [];
  for (const token of tokens) {
    const suggestion = suggestionFromToken(token, japanese);
    if (suggestion) out.push(suggestion);
  }
  return out;
}

export function defaultSelectionsFromSuggestions(
  suggestions: VocabularySuggestion[],
  japanese: string,
): VocabularySelection[] {
  return suggestions
    .filter((item) => item.selectedByDefault)
    .filter((item) =>
      validateSpan(japanese, item.start, item.end, item.surface),
    )
    .map((item) => selectionFromSuggestion(item));
}

export function selectionFromSuggestion(
  suggestion: VocabularySuggestion,
): VocabularySelection {
  return {
    id: createId('vsel'),
    surface: suggestion.surface,
    start: suggestion.start,
    end: suggestion.end,
    expression: suggestion.expression,
    reading: suggestion.reading,
    english: suggestion.english,
    pos: suggestion.pos,
    source: 'suggestion',
    suggestionIds: [suggestion.id],
  };
}

/**
 * Combine adjacent suggestions into one selection.
 * Expression/reading default to the joined surfaces; the user can edit them.
 */
export function combineSuggestions(
  suggestions: VocabularySuggestion[],
  japanese: string,
): VocabularySelection | null {
  if (suggestions.length < 2) return null;
  const ordered = [...suggestions].sort((a, b) => a.start - b.start);
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i].start !== ordered[i - 1].end) return null;
  }
  const start = ordered[0].start;
  const end = ordered[ordered.length - 1].end;
  const surface = japanese.slice(start, end);
  if (!validateSpan(japanese, start, end, surface)) return null;
  const expression = ordered.map((item) => item.expression).join('');
  const reading = ordered.map((item) => item.reading).join('');
  return {
    id: createId('vsel'),
    surface,
    start,
    end,
    expression,
    reading,
    pos: ordered.map((item) => item.pos).filter(Boolean).join('+'),
    source: 'combined',
    suggestionIds: ordered.map((item) => item.id),
  };
}

export function mergeVocabularySuggestions(
  existing: VocabularySuggestion[],
  incoming: VocabularySuggestion[],
): VocabularySuggestion[] {
  if (!incoming.length) return existing;
  if (!existing.length) return incoming;
  const bySpan = new Map(
    existing.map((item) => [`${item.start}:${item.end}:${item.surface}`, item]),
  );
  for (const item of incoming) {
    const key = `${item.start}:${item.end}:${item.surface}`;
    const previous = bySpan.get(key);
    if (!previous) {
      bySpan.set(key, item);
      continue;
    }
    bySpan.set(key, {
      ...previous,
      expression: item.expression || previous.expression,
      reading: item.reading || previous.reading,
      pos: item.pos || previous.pos,
      english: item.english || previous.english,
      selectedByDefault: item.selectedByDefault,
      source: item.source,
    });
  }
  return [...bySpan.values()].sort((a, b) => a.start - b.start);
}
