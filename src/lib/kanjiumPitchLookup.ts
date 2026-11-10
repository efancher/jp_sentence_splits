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
  /** The only Kanjium entry for an expression (any reading); undefined when it has none or several. */
  findByExpression(expression: string): { reading: string; positions: number[] } | undefined;
}

export function katakanaToHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** Pure: builds the lookup from the raw `{ "expression|reading": "0,2" }` table. */
export function buildKanjiumPitchLookup(table: Record<string, string>): KanjiumPitchLookup {
  const exact = new Map<string, number[]>();
  const readingOnly = new Map<string, Set<number>>();
  const byExpression = new Map<string, Array<{ reading: string; positions: number[] }>>();
  for (const [key, value] of Object.entries(table)) {
    const positions = value.split(',').map(Number).filter(Number.isFinite);
    const position = positions[0];
    if (position === undefined) continue;
    exact.set(key, positions);
    const expression = key.slice(0, key.indexOf('|'));
    byExpression.set(expression, [
      ...(byExpression.get(expression) ?? []),
      { reading: key.slice(key.indexOf('|') + 1), positions },
    ]);
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
    findByExpression(expression) {
      const entries = byExpression.get(expression);
      return entries?.length === 1 ? entries[0] : undefined;
    },
  };
}

/**
 * Light and auxiliary verbs the tokenizer writes in kana (or with a stored inflected reading). Their kana
 * spelling is a homophone of many Kanjium headwords, so the lookup would (rightly) refuse it; these map to
 * the headword of the verb meant in running text.
 */
const LIGHT_VERB_HEADWORDS: Record<string, { headword: string; reading: string }> = {
  する: { headword: '為る', reading: 'する' },
  いる: { headword: '居る', reading: 'いる' },
  ある: { headword: '有る', reading: 'ある' },
  なる: { headword: '成る', reading: 'なる' },
  できる: { headword: '出来る', reading: 'できる' },
  いう: { headword: '言う', reading: 'いう' },
  言う: { headword: '言う', reading: 'いう' },
};

const KANA_ONLY = /^[぀-ゟ゠-ヿー]+$/u;

/**
 * Accents and the dictionary reading for a suggestion. The stored `reading` of a verb or i-adjective is
 * sometimes the inflected reading (する→し, 来る→き, 言う→いい), which Kanjium has no entry for. When the exact
 * lookup misses on such a word, the lemma's own reading is tried: the expression itself when it is written in
 * kana (する, いる), otherwise the expression's only Kanjium entry (来る). Expressions with several readings (言う) stay unmarked.
 */
export function findLemmaPitch(
  lookup: KanjiumPitchLookup,
  suggestion: Pick<VocabularySuggestion, 'expression' | 'reading' | 'pos'>,
): { positions: number[]; reading: string } | undefined {
  const exact = lookup.find(suggestion.expression, suggestion.reading);
  if (exact) return { positions: exact, reading: suggestion.reading };
  if (!suggestion.pos.startsWith('動詞') && !suggestion.pos.startsWith('形容詞')) return undefined;
  const light = LIGHT_VERB_HEADWORDS[suggestion.expression];
  if (light) {
    const positions = lookup.find(light.headword, light.reading);
    return positions ? { positions, reading: light.reading } : undefined;
  }
  if (KANA_ONLY.test(suggestion.expression)) {
    const reading = katakanaToHiragana(suggestion.expression);
    const positions = lookup.find(suggestion.expression, reading);
    return positions ? { positions, reading } : undefined;
  }
  return lookup.findByExpression(suggestion.expression);
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
    // Kanjium first; UniDic's lemma accent only when it has nothing.
    const found =
      findLemmaPitch(lookup, suggestion) ??
      (suggestion.accentType !== undefined
        ? { positions: [suggestion.accentType], reading: suggestion.reading }
        : undefined);
    if (!found?.positions.length) continue;
    const { positions } = found;
    const lemma = { ...suggestion, reading: found.reading };
    const isCitationForm = suggestion.surface === suggestion.expression || suggestion.surface === lemma.reading;
    if (!isCitationForm) {
      const inflected = inflectedTarget(lemma, positions, sentence);
      if (inflected) targets.push(inflected);
      continue;
    }
    targets.push({
      surfaceForm: suggestion.surface,
      reading: lemma.reading,
      pitchAccentPositions: positions,
    });
  }
  return targets;
}
