/**
 * Apply curated Anki vocabulary picks for known immersion books.
 * Picks are authored offline (surface spans + dictionary expressions).
 */

import { AFTER_WORK_VOCAB_CURATED } from '../data/afterWorkVocabCurated';
import type {
  VocabularySelection,
  VocabularySuggestion,
} from '../domain/types';
import { createId } from './ids';
import {
  combineSuggestions,
  selectionFromSuggestion,
  validateSpan,
} from './vocabularySuggestions';

export interface CuratedVocabPick {
  surface: string;
  start: number;
  end: number;
  expression: string;
  reading: string;
  pos?: string;
}

export interface CuratedVocabBook {
  sourceKey: string;
  title: string;
  picksByJapanese: Record<string, CuratedVocabPick[]>;
}

export const CURATED_VOCAB_BOOKS: CuratedVocabBook[] = [
  {
    sourceKey: 'shadowing:source-FkX4A-ZLBrc',
    title: 'Easy Japanese Drama: After Work',
    picksByJapanese: AFTER_WORK_VOCAB_CURATED as Record<
      string,
      CuratedVocabPick[]
    >,
  },
];

export function curatedVocabForSourceKey(
  sourceKey: string | undefined,
): CuratedVocabBook | undefined {
  if (!sourceKey) return undefined;
  return CURATED_VOCAB_BOOKS.find((book) => book.sourceKey === sourceKey);
}

function coveringSuggestions(
  suggestions: VocabularySuggestion[],
  start: number,
  end: number,
): VocabularySuggestion[] {
  return [...suggestions]
    .filter((item) => item.start >= start && item.end <= end)
    .sort((a, b) => a.start - b.start);
}

function areContiguous(suggestions: VocabularySuggestion[]): boolean {
  if (!suggestions.length) return false;
  for (let i = 1; i < suggestions.length; i += 1) {
    if (suggestions[i]!.start !== suggestions[i - 1]!.end) return false;
  }
  return true;
}

/**
 * Resolve a curated pick against live morphology suggestions when possible so
 * suggestionIds stay linked; otherwise create a manual span selection.
 */
export function selectionFromCuratedPick(
  japanese: string,
  pick: CuratedVocabPick,
  suggestions: VocabularySuggestion[],
): VocabularySelection | null {
  let start = pick.start;
  let end = pick.end;
  const surface = pick.surface;

  if (!validateSpan(japanese, start, end, surface)) {
    const found = japanese.indexOf(surface);
    if (found < 0) return null;
    start = found;
    end = found + surface.length;
  }
  if (!validateSpan(japanese, start, end, surface)) return null;

  const covered = coveringSuggestions(suggestions, start, end);
  if (
    covered.length &&
    covered[0]!.start === start &&
    covered[covered.length - 1]!.end === end &&
    areContiguous(covered)
  ) {
    if (covered.length === 1) {
      const base = selectionFromSuggestion(covered[0]!);
      return {
        ...base,
        expression: pick.expression || base.expression,
        reading: pick.reading || base.reading,
      };
    }
    const combined = combineSuggestions(covered, japanese);
    if (combined) {
      return {
        ...combined,
        expression: pick.expression || combined.expression,
        reading: pick.reading || combined.reading,
      };
    }
  }

  return {
    id: createId('vsel'),
    surface,
    start,
    end,
    expression: pick.expression || surface,
    reading: pick.reading || '',
    pos: pick.pos,
    source: 'manual',
  };
}

export function selectionsFromCuratedPicks(
  japanese: string,
  picks: CuratedVocabPick[],
  suggestions: VocabularySuggestion[],
): VocabularySelection[] {
  const out: VocabularySelection[] = [];
  for (const pick of picks) {
    const selection = selectionFromCuratedPick(japanese, pick, suggestions);
    if (!selection) continue;
    const overlaps = out.some(
      (item) =>
        !(selection.end <= item.start || selection.start >= item.end),
    );
    if (overlaps) continue;
    out.push(selection);
  }
  return out.sort((a, b) => a.start - b.start);
}
