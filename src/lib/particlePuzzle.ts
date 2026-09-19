import type { EffectiveGameSignal, GameRound, Sentence } from '../domain/types';
import type { PickerStats } from './gamePicker';
import { seededShuffle } from './seededShuffle';

/**
 * Particle Puzzle (docs/ROADMAP.md "Short games"): a real sentence from the
 * learner's books with 2–4 of its case/binding particles pulled out into a
 * shared chip bank (plus 1–2 confusable decoys). Tap a chip, tap a blank.
 *
 * Why it isn't trivially gameable: the bank is *shared*, so every placement
 * constrains the others; the translation stays hidden until the check (it
 * would let meaning eliminate options); and preceding sentences supply the
 * は/が context a bare sentence lacks.
 *
 * Deliberately conservative about what it blanks, because a "wrong" that is
 * really a different-but-grammatical sentence is worse than no puzzle:
 *  - only 格助詞 + 係助詞 in `BLANKABLE_PARTICLES` — no の (nominaliser vs.
 *    genitive), へ (interchangeable with に), sentence-final ね/よ, or
 *    conjunctive て/ば;
 *  - never a particle touching another particle (には, からも, での…): the
 *    compound reads as one unit and blanking half of it is ambiguous;
 *  - a swap among は/が/も is flagged as often-grammatical instead of "wrong".
 * Pure: takes Sentence rows already fetched from Dexie.
 */
export const PARTICLE_PUZZLE_GAME_ID = 'particle-puzzle';
export const PARTICLE_PUZZLE_ROUND_SIZE = 5;

export const BLANKABLE_PARTICLES: readonly string[] = [
  'が', 'を', 'に', 'と', 'で', 'から', 'は', 'も', 'まで', 'より',
];
const BLANKABLE_POS_PREFIXES = ['助詞/格助詞', '助詞/係助詞'];
export const MIN_BLANKS = 2;
export const MAX_BLANKS = 4;
/** Long caption-style sentences make the chip bank a chore, not a game. */
export const MAX_SENTENCE_LENGTH = 60;
/** How many recent rounds of this game feed the per-particle weakness history. */
export const PARTICLE_HISTORY_ROUNDS = 60;

/** What a learner tends to mix each particle up with — decoys come from here. */
const CONFUSABLE: Record<string, readonly string[]> = {
  は: ['が', 'も'],
  が: ['は', 'を'],
  を: ['が', 'に'],
  に: ['で', 'を'],
  で: ['に', 'と'],
  と: ['に', 'も'],
  も: ['は', 'と'],
  から: ['まで', 'で'],
  まで: ['から', 'に'],
  より: ['から', 'で'],
};

/** Swaps among these are frequently both grammatical — reported as "different", not "wrong". */
const OFTEN_INTERCHANGEABLE = new Set(['は', 'が', 'も']);

export interface ParticleToken {
  start: number;
  end: number;
  surface: string;
}

/**
 * The particle tokens of a sentence that can safely be blanked: known
 * particles whose stored span really matches the text, minus any that touch
 * another particle token (blankable or not).
 */
export function findBlankableParticles(
  sentence: Pick<Sentence, 'japanese' | 'vocabularySuggestions'>,
): ParticleToken[] {
  const particleTokens = (sentence.vocabularySuggestions ?? [])
    .filter((token) => typeof token.pos === 'string' && token.pos.startsWith('助詞'))
    .filter((token) => sentence.japanese.slice(token.start, token.end) === token.surface)
    .sort((a, b) => a.start - b.start);

  const touches = (a: { start: number; end: number }, b: { start: number; end: number }) =>
    a.end === b.start || b.end === a.start;

  return particleTokens
    .filter((token) => BLANKABLE_POS_PREFIXES.some((prefix) => token.pos.startsWith(prefix)))
    .filter((token) => BLANKABLE_PARTICLES.includes(token.surface))
    .filter((token) => !particleTokens.some((other) => other !== token && touches(token, other)))
    .map((token) => ({ start: token.start, end: token.end, surface: token.surface }));
}

export function isParticlePuzzleEligible(
  sentence: Pick<Sentence, 'japanese' | 'translation' | 'vocabularySuggestions'>,
): boolean {
  return (
    sentence.japanese.length <= MAX_SENTENCE_LENGTH &&
    !!sentence.translation?.trim() &&
    findBlankableParticles(sentence).length >= MIN_BLANKS
  );
}

export type PuzzleSegment = { kind: 'text'; text: string } | { kind: 'blank'; blank: number };
export interface PuzzleChip {
  id: string;
  text: string;
}
export interface ParticlePuzzle {
  sentenceId: string;
  segments: PuzzleSegment[];
  /** `answers[i]` is the particle that belongs in blank `i`. */
  answers: string[];
  bank: PuzzleChip[];
}

/**
 * Build a puzzle from an eligible sentence, or null. When more than
 * `MAX_BLANKS` particles are blankable, the ones the learner has missed most
 * (`focus`: particle → recent misses) are blanked first, so a "weak spots"
 * round actually drills them; ties break by `seed`.
 */
export function buildParticlePuzzle(
  sentence: Pick<Sentence, 'id' | 'japanese' | 'vocabularySuggestions'>,
  options: { seed: string; focus?: ReadonlyMap<string, number> },
): ParticlePuzzle | null {
  const tokens = findBlankableParticles(sentence);
  if (tokens.length < MIN_BLANKS) return null;

  const focus = options.focus ?? new Map<string, number>();
  const chosen = seededShuffle(tokens, (t) => String(t.start), options.seed)
    .sort((a, b) => (focus.get(b.surface) ?? 0) - (focus.get(a.surface) ?? 0))
    .slice(0, MAX_BLANKS)
    .sort((a, b) => a.start - b.start);

  const segments: PuzzleSegment[] = [];
  let cursor = 0;
  chosen.forEach((token, blank) => {
    if (token.start > cursor) {
      segments.push({ kind: 'text', text: sentence.japanese.slice(cursor, token.start) });
    }
    segments.push({ kind: 'blank', blank });
    cursor = token.end;
  });
  if (cursor < sentence.japanese.length) {
    segments.push({ kind: 'text', text: sentence.japanese.slice(cursor) });
  }

  const answers = chosen.map((token) => token.surface);
  const answerSet = new Set(answers);
  const decoyCount = answers.length >= 3 ? 2 : 1;
  const confusable = [...new Set(answers.flatMap((answer) => CONFUSABLE[answer] ?? []))].filter(
    (particle) => !answerSet.has(particle),
  );
  const others = BLANKABLE_PARTICLES.filter(
    (particle) => !answerSet.has(particle) && !confusable.includes(particle),
  );
  const shuffled = (list: string[], tag: string) =>
    seededShuffle(list, (particle) => particle, `${options.seed}:${tag}`);
  // Confusable particles first (they make the puzzle a real test), filler only if short.
  const decoys = [...shuffled(confusable, 'decoy'), ...shuffled(others, 'filler')].slice(
    0,
    decoyCount,
  );

  const bank = seededShuffle(
    [...answers, ...decoys].map((text, index) => ({ id: `chip-${index}`, text })),
    (chip) => chip.id,
    `${options.seed}:bank`,
  );
  return { sentenceId: sentence.id, segments, answers, bank };
}

export interface BlankGrade {
  expected: string;
  chosen: string;
  correct: boolean;
  /** A wrong answer that may well be a grammatical alternative (は/が/も). */
  plausibleAlternative: boolean;
}

/** Grade a filled puzzle. `placements[i]` is the particle text placed in blank `i`. */
export function gradePuzzle(
  puzzle: Pick<ParticlePuzzle, 'answers'>,
  placements: readonly string[],
): { blanks: BlankGrade[]; correctCount: number; allCorrect: boolean } {
  const blanks = puzzle.answers.map((expected, index) => {
    const chosen = placements[index] ?? '';
    const correct = chosen === expected;
    return {
      expected,
      chosen,
      correct,
      plausibleAlternative:
        !correct && OFTEN_INTERCHANGEABLE.has(expected) && OFTEN_INTERCHANGEABLE.has(chosen),
    };
  });
  const correctCount = blanks.filter((blank) => blank.correct).length;
  return { blanks, correctCount, allCorrect: correctCount === blanks.length };
}

export interface ParticleHistoryEntry {
  attempts: number;
  misses: number;
}

/** Per-particle attempts/misses over the most recent rounds of this game. */
export function buildParticleHistory(
  rounds: readonly Pick<GameRound, 'timestamp' | 'items'>[],
  limit: number = PARTICLE_HISTORY_ROUNDS,
): Map<string, ParticleHistoryEntry> {
  const history = new Map<string, ParticleHistoryEntry>();
  const recent = [...rounds].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
  for (const round of recent) {
    for (const item of round.items) {
      for (const part of item.parts ?? []) {
        const entry = history.get(part.key) ?? { attempts: 0, misses: 0 };
        entry.attempts += 1;
        if (!part.correct) entry.misses += 1;
        history.set(part.key, entry);
      }
    }
  }
  return history;
}

/** Particle → recent misses, only for particles actually missed. Drives which blanks a weak round prefers. */
export function missFocus(history: ReadonlyMap<string, ParticleHistoryEntry>): Map<string, number> {
  const focus = new Map<string, number>();
  for (const [particle, entry] of history) if (entry.misses > 0) focus.set(particle, entry.misses);
  return focus;
}

/** Attempts needed across a sentence's particles before it can count as a "strong" round. */
const MATURE_ATTEMPTS = 8;

/**
 * Map a sentence's particle history onto the shared picker's `PickerStats`.
 * The picker's fields were named for FSRS, so read them as: `lapses` = recent
 * misses on this sentence's particles, `retrievability` = recent accuracy on
 * them, `matureCards` = enough attempts to trust that accuracy. With no
 * history every sentence is `hasCard: false` and the picker falls back to `any`.
 */
export function particleSentenceStats(
  tokens: readonly ParticleToken[],
  history: ReadonlyMap<string, ParticleHistoryEntry>,
): PickerStats {
  let attempts = 0;
  let misses = 0;
  for (const particle of new Set(tokens.map((token) => token.surface))) {
    const entry = history.get(particle);
    if (!entry) continue;
    attempts += entry.attempts;
    misses += entry.misses;
  }
  return {
    hasCard: attempts > 0,
    lapses: misses,
    retrievability: attempts > 0 ? 1 - misses / attempts : null,
    matureCards: attempts >= MATURE_ATTEMPTS,
  };
}

/** One-line "why this sentence" for the result screen. */
export function describeParticlePick(
  signal: EffectiveGameSignal,
  particles: readonly string[],
  focus: ReadonlyMap<string, number>,
): string {
  const missed = [...new Set(particles)].filter((particle) => focus.has(particle));
  if (signal === 'weak' && missed.length > 0) {
    return `Includes particles you've missed before (${missed.join('・')}).`;
  }
  if (signal === 'strong') return "Particles you've been getting right.";
  return 'From your confirmed sentences.';
}
