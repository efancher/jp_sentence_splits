import type { Sentence, VocabularySuggestion } from '../domain/types';
import { conjugationTagFromWordClass, inferConjugationWordClass } from './conjugation';
import { resolveInflectedPitchAccent } from './pitchAccentShift';
import type { SentencePitchAccentTarget } from './sentencePitchAccent';

/**
 * Dictionary accent for words in a sentence that have no vocabulary link, from the Kanjium table
 * (`public/kanjiumPitch.json`, built by `npm run build:kanjium-pitch-data`). Linked words keep using their
 * own backfilled `pitchAccentPositions`; this only fills the words the ambient H/L row would otherwise skip.
 *
 * Deliberately narrow, matching the "skip, don't guess" stance of the rest of the feature:
 *  - only content tokens the vocab picker would check by default;
 *  - citation forms (surface equals the lemma or its reading) directly; inflected verbs and i-adjectives only
 *    when the word class can be inferred from the surface and the shift resolver covers that form;
 *  - an exact expression+reading match first; otherwise, for a kana-written lemma, a reading-only match, but only when every Kanjium
 *    entry with that reading agrees (covers kana-written lemmas such as ある・その・いい).
 */
export interface KanjiumPitchLookup {
  /**
   * Accent nuclei for an expression+reading (all that Kanjium lists, first = marked), or for the reading
   * alone when unambiguous.
   */
  find(expression: string, reading: string): number[] | undefined;
}

export function katakanaToHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** Pure: builds the lookup from the raw `{ "expression|reading": "0,2" }` table. */
export function buildKanjiumPitchLookup(table: Record<string, string>): KanjiumPitchLookup {
  const exact = new Map<string, number[]>();
  const readingOnly = new Map<string, Set<number>>();
  for (const [key, value] of Object.entries(table)) {
    const positions = value.split(',').map(Number).filter(Number.isFinite);
    const position = positions[0];
    if (position === undefined) continue;
    exact.set(key, positions);
    const reading = key.slice(key.indexOf('|') + 1);
    // Agreement is judged on the first position only (the one the UI uses).
    const seen = readingOnly.get(reading) ?? new Set<number>();
    seen.add(position);
    readingOnly.set(reading, seen);
  }
  return {
    find(expression, reading) {
      const normalized = katakanaToHiragana(reading);
      const hit = exact.get(`${expression}|${normalized}`);
      if (hit !== undefined) return hit;
      // Only for kana-written lemmas: a kanji name or compound that merely shares a reading must not borrow it.
      if (katakanaToHiragana(expression) !== normalized) return undefined;
      const agreed = readingOnly.get(normalized);
      return agreed?.size === 1 ? [[...agreed][0]!] : undefined;
    },
  };
}

/**
 * An inflected verb / i-adjective token: the word class is inferred by conjugating the lemma each plausible way
 * and keeping the one that reproduces the surface, then the shared resolver predicts the shifted accent. Forms
 * the resolver does not cover (te-form without a stored position, i-adjective negatives, ...) stay unmarked.
 */
function inflectedTarget(
  suggestion: VocabularySuggestion,
  positions: number[],
  sentence: Pick<Sentence, 'japanese' | 'inlineReading'>,
): SentencePitchAccentTarget | null {
  if (!suggestion.pos.startsWith('動詞') && !suggestion.pos.startsWith('形容詞')) return null;
  const wordClass = inferConjugationWordClass(
    suggestion.expression,
    suggestion.reading,
    suggestion.pos,
    suggestion.surface,
    sentence.japanese,
  );
  if (!wordClass) return null;
  const resolved = resolveInflectedPitchAccent({
    vocabularyItem: {
      expression: suggestion.expression,
      reading: suggestion.reading,
      partOfSpeech: conjugationTagFromWordClass(wordClass, suggestion.expression),
      pitchAccentPositions: positions,
    },
    sentence,
    surfaceForm: suggestion.surface,
  });
  if (!resolved || resolved.isCitationForm) return null;
  return {
    surfaceForm: resolved.surfaceForm,
    reading: resolved.reading,
    pitchAccentPositions: [resolved.position],
  };
}

/**
 * Targets for the content tokens of a sentence that no existing target already covers.
 * `covered` holds the surface forms already marked via vocabulary links.
 */
export function kanjiumTargetsForSuggestions(
  suggestions: readonly VocabularySuggestion[],
  lookup: KanjiumPitchLookup,
  covered: ReadonlySet<string>,
  sentence: Pick<Sentence, 'japanese' | 'inlineReading'>,
): SentencePitchAccentTarget[] {
  const targets: SentencePitchAccentTarget[] = [];
  for (const suggestion of suggestions) {
    if (!suggestion.selectedByDefault || !suggestion.reading) continue;
    if (covered.has(suggestion.surface) || covered.has(suggestion.expression)) continue;
    const positions = lookup.find(suggestion.expression, suggestion.reading);
    if (!positions?.length) continue;
    const isCitationForm =
      suggestion.surface === suggestion.expression || suggestion.surface === suggestion.reading;
    if (!isCitationForm) {
      const inflected = inflectedTarget(suggestion, positions, sentence);
      if (inflected) targets.push(inflected);
      continue;
    }
    targets.push({
      surfaceForm: suggestion.surface,
      reading: suggestion.reading,
      pitchAccentPositions: positions,
    });
  }
  return targets;
}

let cached: Promise<KanjiumPitchLookup | null> | undefined;
const FETCH_TIMEOUT_MS = 15_000;

/** Forgets the loaded table so the next load fetches again (tests). */
export function resetKanjiumPitchCache(): void {
  cached = undefined;
}

/**
 * Loads the table once per session (served from `public/`, fetched on demand, ~4 MB raw). Offline or failed
 * loads resolve to `null` (no extra marks) and are retried next time.
 */
export function loadKanjiumPitchLookup(): Promise<KanjiumPitchLookup | null> {
  cached ??= fetch(`${import.meta.env.BASE_URL}kanjiumPitch.json`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
    .then((response) => {
      if (!response.ok) throw new Error(`kanjiumPitch.json: ${response.status}`);
      return response.json() as Promise<Record<string, string>>;
    })
    .then(buildKanjiumPitchLookup)
    .catch(() => {
      cached = undefined;
      return null;
    });
  return cached;
}
