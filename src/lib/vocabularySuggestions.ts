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

/**
 * True when two spans touch directly, or the only text between them is
 * whitespace (e.g. a readability space some sources insert between clauses).
 * Punctuation and other characters still count as a real gap.
 */
function isAdjacentAcrossWhitespace(
  japanese: string,
  earlierEnd: number,
  laterStart: number,
): boolean {
  if (earlierEnd > laterStart) return false;
  return /^\s*$/.test(japanese.slice(earlierEnd, laterStart));
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
    if (!isAdjacentAcrossWhitespace(japanese, ordered[i - 1].end, ordered[i].start)) {
      return null;
    }
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

/** True when a selection already covers this suggestion's span. */
export function selectionCoversSuggestion(
  selection: VocabularySelection,
  suggestion: VocabularySuggestion,
): boolean {
  if (selection.suggestionIds?.includes(suggestion.id)) return true;
  return (
    selection.start <= suggestion.start && selection.end >= suggestion.end
  );
}

/**
 * True when the suggestion can be merged into the selection: already covered,
 * or immediately adjacent on either side (no gap).
 */
export function canMergeSuggestionIntoSelection(
  suggestion: VocabularySuggestion,
  selection: VocabularySelection,
  japanese: string,
): boolean {
  if (!validateSpan(japanese, suggestion.start, suggestion.end, suggestion.surface)) {
    return false;
  }
  if (!validateSpan(japanese, selection.start, selection.end, selection.surface)) {
    return false;
  }
  if (selectionCoversSuggestion(selection, suggestion)) return true;
  return (
    isAdjacentAcrossWhitespace(japanese, suggestion.end, selection.start) ||
    isAdjacentAcrossWhitespace(japanese, selection.end, suggestion.start)
  );
}

/**
 * Merge a morphology suggestion into an existing selection when adjacent.
 * Returns null when the spans are not mergeable. Preserves the selection id.
 */
export function mergeSuggestionIntoSelection(
  suggestion: VocabularySuggestion,
  selection: VocabularySelection,
  japanese: string,
): VocabularySelection | null {
  if (!canMergeSuggestionIntoSelection(suggestion, selection, japanese)) {
    return null;
  }
  if (selectionCoversSuggestion(selection, suggestion)) {
    return selection;
  }

  const start = Math.min(selection.start, suggestion.start);
  const end = Math.max(selection.end, suggestion.end);
  const surface = japanese.slice(start, end);
  if (!validateSpan(japanese, start, end, surface)) return null;

  const suggestionBefore = suggestion.end <= selection.start;
  const expression = suggestionBefore
    ? `${suggestion.expression}${selection.expression}`
    : `${selection.expression}${suggestion.expression}`;
  const reading = suggestionBefore
    ? `${suggestion.reading}${selection.reading}`
    : `${selection.reading}${suggestion.reading}`;
  const posParts = suggestionBefore
    ? [suggestion.pos, selection.pos]
    : [selection.pos, suggestion.pos];
  const suggestionIds = [
    ...(selection.suggestionIds ?? []),
    suggestion.id,
  ].filter((id, index, all) => all.indexOf(id) === index);

  return {
    ...selection,
    surface,
    start,
    end,
    expression,
    reading,
    pos: posParts.filter(Boolean).join('+'),
    source: 'combined',
    suggestionIds,
  };
}

/**
 * True when two selections are adjacent (no gap, no overlap) and can be
 * merged into one, e.g. two already-selected cards dropped onto each other.
 */
export function canMergeSelections(
  a: VocabularySelection,
  b: VocabularySelection,
  japanese: string,
): boolean {
  if (a.id === b.id) return false;
  if (!validateSpan(japanese, a.start, a.end, a.surface)) return false;
  if (!validateSpan(japanese, b.start, b.end, b.surface)) return false;
  return (
    isAdjacentAcrossWhitespace(japanese, a.end, b.start) ||
    isAdjacentAcrossWhitespace(japanese, b.end, a.start)
  );
}

/**
 * Merge two adjacent selections into one. Preserves `target`'s id so the
 * merged card keeps its identity (e.g. stays open for editing).
 */
export function mergeSelections(
  dragged: VocabularySelection,
  target: VocabularySelection,
  japanese: string,
): VocabularySelection | null {
  if (!canMergeSelections(dragged, target, japanese)) return null;
  const draggedBefore = dragged.end <= target.start;
  const start = Math.min(dragged.start, target.start);
  const end = Math.max(dragged.end, target.end);
  const surface = japanese.slice(start, end);
  if (!validateSpan(japanese, start, end, surface)) return null;
  const expression = draggedBefore
    ? `${dragged.expression}${target.expression}`
    : `${target.expression}${dragged.expression}`;
  const reading = draggedBefore
    ? `${dragged.reading}${target.reading}`
    : `${target.reading}${dragged.reading}`;
  const posParts = draggedBefore
    ? [dragged.pos, target.pos]
    : [target.pos, dragged.pos];
  const suggestionIds = [
    ...(target.suggestionIds ?? []),
    ...(dragged.suggestionIds ?? []),
  ].filter((id, index, all) => all.indexOf(id) === index);

  return {
    ...target,
    surface,
    start,
    end,
    expression,
    reading,
    pos: posParts.filter(Boolean).join('+'),
    source: 'combined',
    suggestionIds,
  };
}

/**
 * Build an in-order morph strip over the full sentence: morphology tokens plus
 * any uncovered character gaps (so the strip always reads as the Japanese).
 */
export type MorphStripPiece =
  | { kind: 'token'; suggestion: VocabularySuggestion }
  | { kind: 'gap'; start: number; end: number; surface: string };

export function buildMorphStrip(
  japanese: string,
  suggestions: VocabularySuggestion[],
): MorphStripPiece[] {
  const ordered = [...suggestions].sort((a, b) => a.start - b.start);
  const pieces: MorphStripPiece[] = [];
  let cursor = 0;
  for (const suggestion of ordered) {
    if (suggestion.start < cursor) continue;
    if (suggestion.start > cursor) {
      pieces.push({
        kind: 'gap',
        start: cursor,
        end: suggestion.start,
        surface: japanese.slice(cursor, suggestion.start),
      });
    }
    pieces.push({ kind: 'token', suggestion });
    cursor = suggestion.end;
  }
  if (cursor < japanese.length) {
    pieces.push({
      kind: 'gap',
      start: cursor,
      end: japanese.length,
      surface: japanese.slice(cursor),
    });
  }
  return pieces;
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
