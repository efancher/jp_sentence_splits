import { toHiragana } from 'wanakana';

import type { EffectiveGameSignal, Sentence, VocabularyItem } from '../domain/types';
import { chunkSentenceIntoTiles } from './earTiles';
import { seededShuffle } from './seededShuffle';

/**
 * Remix (docs/ROADMAP.md "Possibilities (active sentence-production bridge)",
 * scope A): the step between hearing a known native sentence and producing one.
 * The learner hears a real clip, sees its skeleton — `[親鳥]が [えさ]を 運んで来ました`
 * with a plain-English hint per slot — then swaps ONE noun slot for a word of
 * their own, then TWO. They are given the *English* of the replacement noun and
 * type the Japanese, so the check is "did you produce the word you know for
 * this meaning", not "did you pick from a list".
 *
 * Anchored and conservative, like Particle Puzzle / Ear Tiles:
 *  - only native sentences the learner has met (introduced, with native audio);
 *    nothing is generated and there are no made-up Japanese distractors. Fixed text and
 *    particles are copied from the sentence; replacements are the learner's own
 *    own nouns;
 *  - only predicate-final sentences (one verb or adjective, optionally with one
 *    earlier clause linked by て/から/の) with 2–4 plain "noun + case particle"
 *    slots, so a swap replaces a noun and nothing around it;
 *  - the replacement's English is its first gloss, and a noun is offered only
 *    if no other pool noun shares that gloss (the "reverse English → Japanese"
 *    ambiguity rule). Synonyms the learner might type are accepted by reading;
 *  - the swapped sentence is grammatical but may be silly ("eat the house").
 *    That is allowed and said so — it is checked structurally, not for sense;
 *  - the verb is never swapped here (rung 3 needs verb→particle data the app
 *    does not have) and free remix (rung 4) is deliberately not built.
 * Pure: takes Sentence / VocabularyItem rows already fetched from Dexie.
 */
export const REMIX_GAME_ID = 'remix';
export const REMIX_ROUND_SIZE = 3;
export const MIN_SLOTS = 2;
export const MAX_SLOTS = 4;
export const MAX_SENTENCE_LENGTH = 45;
export const MAX_CLIP_MS = 10_000;
/** A puzzle swaps up to three distinct nouns; needs a few more to choose among. */
export const MIN_POOL_NOUNS = 6;
/** A swap is worth this many points: clean, one miss, two misses or a reveal. */
export const POINTS_PER_SWAP = 2;

/** Case particles whose noun can be replaced without touching anything else. */
const SWAPPABLE_PARTICLES = ['が', 'を', 'に', 'で', 'から', 'まで', 'は'] as const;

/** Plain-English meaning of each slot's particle (wording follows glossSkill's relations). */
export const SLOT_HINTS: Record<string, string> = {
  が: 'who or what does it',
  は: 'what we are talking about',
  を: 'what the action is done to',
  に: 'where to / when / to whom',
  で: 'where it happens / how or by what',
  から: 'the starting point',
  まで: 'the end point',
};

/** Formal, time-like and pronoun-ish nouns: poor swap targets whichever way round. */
const NOT_A_SLOT_NOUN = new Set([
  'こと', 'もの', 'ところ', 'とき', 'ため', 'ほう', 'わけ', 'はず', 'つもり', 'よう', 'そう', 'うち',
  'の', 'ん', '時', '事', '物', '所', '為', '方', '訳', '内', '中', '前', '後', '上', '下', '間',
  '今', '今日', '昨日', '明日', '今年', '去年', '来年', '毎日', '毎朝', '毎晩', '一緒', '全部',
  'みんな', '皆', '自分', '何', 'なん', '他', 'ほか', '一番', '以上', '以下', '以外', '以前', '以後',
  'これ', 'それ', 'あれ', 'どれ', 'ここ', 'そこ', 'あそこ', 'どこ', 'だれ', '誰', 'いつ', 'どう',
]);

const SWAP_WORD = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]{1,6}$/u;

interface Token {
  start: number;
  end: number;
  surface: string;
  pos: string;
  english?: string;
}

export interface RemixSlot {
  /** The noun's span in the sentence (the particle is not part of it). */
  start: number;
  end: number;
  noun: string;
  particle: string;
  /** Plain-English role, from the particle. */
  hint: string;
  /** English for the original noun when it is a single token with a stored gloss. */
  gloss?: string;
}

export interface RemixSkeleton {
  slots: RemixSlot[];
  /** The fixed predicate (everything after the last slot's particle). */
  verbText: string;
}

const isNounToken = (pos: string) => pos.startsWith('名詞/普通名詞');
const isNounTail = (pos: string) => pos.startsWith('名詞/普通名詞') || pos.startsWith('接尾辞/名詞的');

/** A token's stored English without leading "(animal)"-style qualifiers, or undefined when nothing is left. */
function cleanGloss(english: string | undefined): string | undefined {
  const gloss = (english ?? '').replace(/^(\([^)]*\)\s*)+/, '').trim();
  return gloss || undefined;
}

function tokensOf(sentence: Pick<Sentence, 'vocabularySuggestions'>): Token[] {
  return (sentence.vocabularySuggestions ?? [])
    .filter((token) => typeof token.pos === 'string' && token.pos !== '')
    .map((token) => ({
      start: token.start,
      end: token.end,
      surface: token.surface,
      pos: token.pos,
      english: token.english,
    }))
    .sort((a, b) => a.start - b.start);
}

/** Knobs for what counts as a clean skeleton; `REMIX_RULES` is what ships. */
export interface RemixRules {
  /** Accept an adjective predicate (形容詞 / 形状詞+だ・です) in place of a single verb. */
  adjectivePredicates: boolean;
  /** How many clause-linking particles (て/で/から/の-nominaliser) may appear before the final predicate. */
  linkingParticles: number;
  /** Allow two slots to share a particle (the prompt then names the original noun). */
  repeatedParticles: boolean;
  maxLength: number;
}

/**
 * Measured on 2,896 production sentences (2026-10-17): the original strict rule
 * (one verb, no linking particle, distinct particles) left 20 audio-backed
 * skeletons; adjectives + one linking particle + repeated particles gives ~100.
 * Raising the length cap added only 3, so it stays at 45. Every setting keeps
 * noun-only swap slots and a predicate-final sentence.
 */
export const REMIX_RULES: RemixRules = {
  adjectivePredicates: true,
  linkingParticles: 1,
  repeatedParticles: true,
  maxLength: MAX_SENTENCE_LENGTH,
};

/** The pre-2026-10-17 strict rule, kept for the feasibility script and tests. */
export const STRICT_REMIX_RULES: RemixRules = {
  adjectivePredicates: false,
  linkingParticles: 0,
  repeatedParticles: false,
  maxLength: MAX_SENTENCE_LENGTH,
};

/**
 * What to call a slot in a prompt: the original noun + particle ("巣を"), with
 * "(1st)"/"(2nd)" when the same text appears twice (声が … 声が).
 */
export function slotLabel(skeleton: RemixSkeleton, index: number): string {
  const slot = skeleton.slots[index]!;
  const text = `${slot.noun}${slot.particle}`;
  const same = skeleton.slots.flatMap((other, i) => (`${other.noun}${other.particle}` === text ? [i] : []));
  return same.length > 1 ? `${text} (${same.indexOf(index) + 1 === 1 ? '1st' : '2nd'})` : text;
}

/**
 * The sentence's swappable slots and fixed predicate, or null when it is not a
 * clean "noun + particle … predicate-final" sentence (see `RemixRules`).
 */
export function findRemixSkeleton(
  sentence: Pick<Sentence, 'japanese' | 'vocabularySuggestions'>,
  rules: RemixRules = REMIX_RULES,
): RemixSkeleton | null {
  if (sentence.japanese.length > rules.maxLength) return null;
  // Quoted speech: the verb that ends the quote is not this sentence's predicate.
  if (/[「」『』]/.test(sentence.japanese)) return null;
  // Tokens must tile the text exactly, so every slice below is trustworthy.
  if (!chunkSentenceIntoTiles(sentence)) return null;
  const tokens = tokensOf(sentence);

  // The sentence ends on its one main predicate; earlier clauses (if allowed) are joined by a linking particle.
  const linking = tokens.filter((t) => t.pos.startsWith('助詞/接続助詞') || t.pos.startsWith('助詞/準体助詞'));
  if (linking.length > rules.linkingParticles) return null;
  const fullVerbs = tokens.filter((t) => t.pos.startsWith('動詞') && !t.pos.startsWith('動詞/非自立可能'));
  const body = tokens.filter((t) => !/^(補助記号|空白|助動詞|助詞|接尾辞)/.test(t.pos));
  const finalPos = body[body.length - 1]?.pos ?? '';
  if (finalPos.startsWith('動詞')) {
    if (fullVerbs.length < 1 || fullVerbs.length > 1 + linking.length) return null;
  } else if (rules.adjectivePredicates && /^(形容詞|形状詞)/.test(finalPos)) {
    // Adjective predicate: no full verb anywhere unless a linking particle introduces an earlier clause.
    if (fullVerbs.length > linking.length) return null;
  } else {
    return null;
  }

  const slots: RemixSlot[] = [];
  for (let k = 1; k < tokens.length; k += 1) {
    const particle = tokens[k]!;
    if (
      !(particle.pos.startsWith('助詞/格助詞') || particle.pos.startsWith('助詞/係助詞')) ||
      !(SWAPPABLE_PARTICLES as readonly string[]).includes(particle.surface)
    ) {
      continue;
    }
    // Walk back over the noun run (compound / suffix) that carries this particle.
    let first = k - 1;
    if (!isNounTail(tokens[first]!.pos)) continue;
    while (first > 0 && isNounTail(tokens[first - 1]!.pos)) first -= 1;
    if (!isNounToken(tokens[first]!.pos)) continue;
    // お/ご… prefixes belong to the noun and would be left dangling; an adjacent particle makes the slot a compound (には).
    if (first > 0 && tokens[first - 1]!.pos.startsWith('接頭辞')) continue;
    // A noun the run does not absorb (proper noun, numeral: スウェーデン+語) would be left dangling by a swap.
    if (first > 0 && /^(名詞|代名詞)/.test(tokens[first - 1]!.pos)) continue;
    if (tokens[k + 1]?.pos.startsWith('助詞')) continue;
    const run = tokens.slice(first, k);
    const noun = run.map((t) => t.surface).join('');
    if (NOT_A_SLOT_NOUN.has(noun)) continue;
    slots.push({
      start: run[0]!.start,
      end: run[run.length - 1]!.end,
      noun,
      particle: particle.surface,
      hint: SLOT_HINTS[particle.surface]!,
      gloss: run.length === 1 ? cleanGloss(run[0]!.english) : undefined,
    });
  }
  if (slots.length < MIN_SLOTS || slots.length > MAX_SLOTS) return null;
  // Two slots sharing a particle (羽を … 真似を) make "which one" ambiguous in the prompt.
  if (!rules.repeatedParticles && new Set(slots.map((s) => s.particle)).size !== slots.length) return null;
  const last = slots[slots.length - 1]!;
  const lastParticle = tokens.find((t) => t.start >= last.end && t.surface === last.particle)!;
  return { slots, verbText: sentence.japanese.slice(lastParticle.end) };
}

/** Why a sentence can't be a Remix round, or null when it can. */
export function remixRejection(
  sentence: Pick<Sentence, 'japanese' | 'translation' | 'vocabularySuggestions'>,
  audioDurationMs: number,
): 'no-translation' | 'clip-too-long' | 'no-skeleton' | null {
  if (!sentence.translation?.trim()) return 'no-translation';
  if (audioDurationMs > MAX_CLIP_MS) return 'clip-too-long';
  return findRemixSkeleton(sentence) ? null : 'no-skeleton';
}

// ---- the learner's noun pool -------------------------------------------------

export interface RemixNoun {
  id: string;
  expression: string;
  /** Hiragana reading. */
  reading: string;
  /** First English gloss, lower-cased: the prompt the learner answers. */
  gloss: string;
}

function firstGloss(meaning: string): string {
  const gloss = (meaning.split(/[;,(\n]/)[0] ?? '').trim().toLowerCase();
  return gloss.startsWith('to ') ? '' : gloss;
}

const isPlainNounPos = (pos: string | undefined) =>
  !!pos && (pos.startsWith('名詞/普通名詞') || pos === 'n');

/**
 * The learner's usable swap nouns, from vocabulary linked to sentences they
 * have met (cards are paused under the sentence-led flow): plain nouns, short and written in kanji/kana, with a reading and an English gloss
 * that no other candidate shares (so the English prompt has one intended
 * answer).
 */
export function buildRemixNounPool(items: readonly VocabularyItem[]): RemixNoun[] {
  const nouns: RemixNoun[] = [];
  for (const item of items) {
    if (!isPlainNounPos(item.partOfSpeech)) continue;
    const expression = item.expression.trim();
    const reading = toHiragana(item.reading.trim(), { convertLongVowelMark: false });
    const gloss = firstGloss(item.meaning ?? '');
    if (!SWAP_WORD.test(expression) || NOT_A_SLOT_NOUN.has(expression)) continue;
    if (!reading || !gloss || gloss.length > 28) continue;
    nouns.push({ id: item.id, expression, reading, gloss });
  }
  const glossCount = new Map<string, number>();
  const expressionCount = new Map<string, number>();
  for (const noun of nouns) {
    glossCount.set(noun.gloss, (glossCount.get(noun.gloss) ?? 0) + 1);
    expressionCount.set(noun.expression, (expressionCount.get(noun.expression) ?? 0) + 1);
  }
  return nouns.filter(
    (noun) => glossCount.get(noun.gloss) === 1 && expressionCount.get(noun.expression) === 1,
  );
}

/** Is `typed` the noun the English prompt asked for? Kanji form or reading, any kana script. */
export function isCorrectNoun(typed: string, noun: Pick<RemixNoun, 'expression' | 'reading'>): boolean {
  const fold = (text: string) =>
    toHiragana(text.normalize('NFKC').replace(/\s+/g, ''), { convertLongVowelMark: false });
  const answer = fold(typed);
  return answer !== '' && (answer === fold(noun.expression) || answer === noun.reading);
}

// ---- building a puzzle -------------------------------------------------------

export interface RemixSwap {
  slot: number;
  noun: RemixNoun;
}
export interface RemixStage {
  swaps: RemixSwap[];
}
export interface RemixPuzzle {
  sentenceId: string;
  skeleton: RemixSkeleton;
  /** Stage 1 swaps one slot; stage 2 swaps two (never stage 1's slot when a third exists). */
  stages: [RemixStage, RemixStage];
}

/**
 * Build the two-rung ladder for a sentence, or null when its skeleton or the
 * learner's pool cannot support it. The replacements are drawn from the pool
 * excluding the sentence's own nouns, each used once.
 */
export function buildRemixPuzzle(
  sentence: Pick<Sentence, 'id' | 'japanese' | 'vocabularySuggestions'>,
  pool: readonly RemixNoun[],
  seed: string,
): RemixPuzzle | null {
  const skeleton = findRemixSkeleton(sentence);
  if (!skeleton || pool.length < MIN_POOL_NOUNS) return null;
  const own = new Set(skeleton.slots.map((slot) => slot.noun));
  const originalGlosses = new Set(skeleton.slots.flatMap((slot) => (slot.gloss ? [slot.gloss.toLowerCase()] : [])));
  const usable = seededShuffle(
    pool.filter((noun) => !own.has(noun.expression) && !originalGlosses.has(noun.gloss)),
    (noun) => noun.id,
    `${seed}:nouns`,
  );

  const order = seededShuffle(
    skeleton.slots.map((_, index) => index),
    (index) => String(index),
    `${seed}:slots`,
  );
  const stage1Slot = order[0]!;
  const rest = order.slice(1);
  const stage2Slots = (rest.length >= 2 ? rest.slice(0, 2) : [stage1Slot, ...rest]).sort((a, b) => a - b);
  const needed = 1 + stage2Slots.length;
  if (usable.length < needed) return null;

  const [n1, ...others] = usable;
  return {
    sentenceId: sentence.id,
    skeleton,
    stages: [
      { swaps: [{ slot: stage1Slot, noun: n1! }] },
      { swaps: stage2Slots.map((slot, i) => ({ slot, noun: others[i]! })) },
    ],
  };
}

/** The sentence with the given slots replaced by the given nouns; everything else is copied from the native text. */
export function remixedSentence(
  sentence: Pick<Sentence, 'japanese'>,
  skeleton: RemixSkeleton,
  replacements: ReadonlyMap<number, string>,
): string {
  let out = '';
  let cursor = 0;
  skeleton.slots.forEach((slot, index) => {
    out += sentence.japanese.slice(cursor, slot.start);
    out += replacements.get(index) ?? slot.noun;
    cursor = slot.end;
  });
  return out + sentence.japanese.slice(cursor);
}

// ---- scoring -----------------------------------------------------------------

export interface RemixSwapScore {
  slot: number;
  wrong: number;
  revealed: boolean;
  points: number;
}

/** Two points for a clean swap, one after a single miss, none after two or a reveal. */
export function swapPoints(wrong: number, revealed: boolean): number {
  return revealed ? 0 : Math.max(0, POINTS_PER_SWAP - wrong);
}

export function maxRemixPoints(puzzle: RemixPuzzle): number {
  return puzzle.stages.reduce((sum, stage) => sum + stage.swaps.length * POINTS_PER_SWAP, 0);
}

/** One-line "why this sentence" for the result screen. */
export function describeRemixPick(signal: EffectiveGameSignal, weakWords: readonly string[]): string {
  if (signal === 'weak' && weakWords.length > 0) {
    return `Has words you've lapsed on in review (${weakWords.slice(0, 3).join('・')}).`;
  }
  if (signal === 'strong') return 'Words you know solidly — a relaxed remix.';
  if (signal === 'stale') return 'Has words whose recall has faded.';
  return 'From sentences you have met.';
}

export const REMIX_COPY = {
  anyPool: 'your sentences with native audio',
  blurbs: {
    weak: "Sentences containing words you've forgotten before — reused in new combinations.",
    stale: 'Sentences containing words whose recall has faded.',
    strong: 'Sentences made of words you know solidly — a relaxed remix.',
  },
};
