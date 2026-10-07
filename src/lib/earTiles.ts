import type { EffectiveGameSignal, Sentence } from '../domain/types';
import { seededShuffle } from './seededShuffle';

/**
 * Ear Tiles (docs/ROADMAP.md "Short games"): hear a real sentence from the
 * learner's books, then rebuild it from shuffled phrase tiles by ear. The
 * audio — not grammar — is the answer key, so a scrambling-tolerant
 * alternative order ("昨日私は" vs "私は昨日") still counts as wrong: the game
 * tests what was *said*, which is the point of a listening game.
 *
 * Tiles are approximate bunsetsu built from the stored UniDic tokens: a
 * content word plus the particles / auxiliaries / suffixes that ride on it.
 * Splitting a bunsetsu too finely is harmless (one more tile); merging two
 * separately-orderable phrases would make the tile order ambiguous, so the
 * chunker only glues what UniDic marks as dependent, and refuses sentences whose
 * tokens don't tile the text cleanly rather than guessing.
 *
 * Each placement is judged the moment it's made (right locks green; wrong
 * flashes red, returns to the bank and costs a point), like Particle Puzzle.
 * Pure: takes Sentence rows already fetched from Dexie.
 */
export const EAR_TILES_GAME_ID = 'ear-tiles';
export const EAR_TILES_ROUND_SIZE = 4;

/** Fewer tiles is a trivial ordering; more is a memory test, not a listening one. */
export const MIN_TILES = 4;
export const MAX_TILES = 7;
/** Long caption-style sentences make the tile bank a chore. */
export const MAX_SENTENCE_LENGTH = 45;
/** A clip longer than this is more of a working-memory test than a listening one. */
export const MAX_CLIP_MS = 10_000;

/** Punctuation / spacing tokens: dropped from tiles, they carry no order information. */
const DROPPED_POS_PREFIXES = ['補助記号', '空白'];
/** Tokens that always ride on the phrase before them instead of starting a new one. */
const DEPENDENT_POS_PREFIXES = ['助詞', '助動詞', '接尾辞'];
/**
 * UniDic tags 見る / 来る / いる / なる … 非自立可能 even when they are the main
 * verb (ニュースを**見**ました), so that tag alone can't glue a token on. It is a
 * bound auxiliary only straight after a て/で (見**てい**ます, 食べ**てみ**たい).
 */
const BOUND_AUXILIARY_POS_PREFIXES = ['動詞/非自立可能', '形容詞/非自立可能'];

export interface TileToken {
  start: number;
  end: number;
  surface: string;
  /** Dictionary form (UniDic lemma), used to recognise する. */
  expression: string;
  pos: string;
}

const startsWithAny = (pos: string, prefixes: readonly string[]) =>
  prefixes.some((prefix) => pos.startsWith(prefix));

const isNominal = (pos: string) => pos.startsWith('名詞') || pos.startsWith('代名詞');

/**
 * The sentence's tiles, in spoken order, or null when the stored tokens can't
 * be trusted to tile the text (a token whose span doesn't match its surface, a
 * gap or overlap between tokens, or no tokens at all).
 */
export function chunkSentenceIntoTiles(
  sentence: Pick<Sentence, 'japanese' | 'vocabularySuggestions'>,
): string[] | null {
  return chunkSentenceIntoTileDetails(sentence)?.map((chunk) => chunk.text) ?? null;
}

interface TileDetail {
  text: string;
  /** POS and surface of the tile's final token, which decides what can be swapped for a distractor. */
  lastPos: string;
  lastSurface: string;
}

function chunkSentenceIntoTileDetails(
  sentence: Pick<Sentence, 'japanese' | 'vocabularySuggestions'>,
): TileDetail[] | null {
  const tokens: TileToken[] = (sentence.vocabularySuggestions ?? [])
    .filter((token) => typeof token.pos === 'string' && token.pos !== '')
    .map((token) => ({
      start: token.start,
      end: token.end,
      surface: token.surface,
      expression: token.expression,
      pos: token.pos,
    }))
    .sort((a, b) => a.start - b.start);
  if (tokens.length === 0) return null;

  let cursor = tokens[0]!.start;
  for (const token of tokens) {
    if (token.start !== cursor) return null;
    if (sentence.japanese.slice(token.start, token.end) !== token.surface) return null;
    cursor = token.end;
  }
  // Tokens must cover the whole sentence (only leading/trailing spacing may be missing).
  if (
    sentence.japanese.slice(0, tokens[0]!.start).trim() !== '' ||
    sentence.japanese.slice(cursor).trim() !== ''
  ) {
    return null;
  }

  const chunks: TileDetail[] = [];
  let prefixPending = '';
  // Punctuation is a phrase boundary even though it isn't a tile: 揺れた。だけど
  // must not glue into 揺れただけど.
  let afterBoundary = false;
  for (const token of tokens) {
    if (startsWithAny(token.pos, DROPPED_POS_PREFIXES)) {
      afterBoundary = true;
      continue;
    }
    const previous = chunks[chunks.length - 1];
    if (token.pos.startsWith('接頭辞')) {
      // お/ご/未… belong to the word that follows.
      prefixPending += token.surface;
      continue;
    }
    const joinsPrevious =
      previous !== undefined &&
      !afterBoundary &&
      prefixPending === '' &&
      (startsWithAny(token.pos, DEPENDENT_POS_PREFIXES) ||
        (startsWithAny(token.pos, BOUND_AUXILIARY_POS_PREFIXES) &&
          previous.lastPos.startsWith('助詞/接続助詞') &&
          (previous.lastSurface === 'て' || previous.lastSurface === 'で')) ||
        // 勉強+する, チェック+する: the noun and its light verb are one phrase.
        (token.pos.startsWith('動詞') &&
          token.expression === 'する' &&
          previous.lastPos.startsWith('名詞')) ||
        // Adjacent nouns are a compound (日本語, 東京大学), not two phrases.
        (isNominal(token.pos) && isNominal(previous.lastPos)));
    if (joinsPrevious) {
      previous.text += token.surface;
      previous.lastPos = token.pos;
      previous.lastSurface = token.surface;
    } else {
      chunks.push({ text: prefixPending + token.surface, lastPos: token.pos, lastSurface: token.surface });
      prefixPending = '';
    }
    afterBoundary = false;
  }
  if (prefixPending !== '') return null;
  return chunks;
}

/** Why a sentence can't be a round, or null when it can. Exposed so the feasibility script can bucket the rejects. */
export function earTilesRejection(
  sentence: Pick<Sentence, 'japanese' | 'translation' | 'vocabularySuggestions'>,
  audioDurationMs: number,
): 'no-translation' | 'too-long' | 'clip-too-long' | 'bad-tokens' | 'too-few-tiles' | 'too-many-tiles' | null {
  if (!sentence.translation?.trim()) return 'no-translation';
  if (sentence.japanese.length > MAX_SENTENCE_LENGTH) return 'too-long';
  if (audioDurationMs > MAX_CLIP_MS) return 'clip-too-long';
  const tiles = chunkSentenceIntoTiles(sentence);
  if (!tiles) return 'bad-tokens';
  if (tiles.length < MIN_TILES) return 'too-few-tiles';
  if (tiles.length > MAX_TILES) return 'too-many-tiles';
  return null;
}

/** A tile that was never said: a real tile with one particle or polite/negative ending swapped. */
export interface EarTilesDistractor {
  kind: 'particle' | 'ending';
  /** The real tile it was made from. */
  from: string;
  /** The particle that was swapped out (particle kind only), e.g. は. */
  particle?: string;
}
export interface EarTilesTile {
  id: string;
  text: string;
  distractor?: EarTilesDistractor;
}
export interface EarTilesPuzzle {
  sentenceId: string;
  /** The tile texts in spoken order. */
  answer: string[];
  /** The tiles (plus any distractors), shuffled so the bank never starts in spoken order. */
  bank: EarTilesTile[];
}

/** Particles easily confused by ear or by habit; each maps to the swaps that make a plausible-looking wrong tile. */
const PARTICLE_SWAPS: Record<string, readonly string[]> = {
  は: ['が', 'も'],
  が: ['は', 'を'],
  を: ['が', 'に'],
  に: ['で', 'へ'],
  で: ['に', 'を'],
  へ: ['に'],
  も: ['は', 'が'],
  と: ['に', 'も'],
};
const SWAPPABLE_PARTICLE_POS = ['助詞/格助詞', '助詞/係助詞', '助詞/副助詞'];

/**
 * Endings that swap cleanly onto any stem because they attach to the same stem form
 * (食べ+ます / 食べ+ました, 行か+ない / 行か+なかった). た→ない is deliberately absent:
 * 行った→行っない is not Japanese, and a distractor must look plausible.
 * Longest suffix first so ませんでした is not read as でした.
 */
const ENDING_SWAPS: readonly (readonly [suffix: string, swaps: readonly string[]])[] = [
  ['ませんでした', ['ません']],
  ['なかった', ['ない']],
  ['ました', ['ます']],
  ['ません', ['ます']],
  ['でした', ['です']],
  ['ない', ['なかった']],
  ['ます', ['ました']],
  ['です', ['でした']],
];

function distractorCandidates(detail: TileDetail): { text: string; distractor: EarTilesDistractor }[] {
  const out: { text: string; distractor: EarTilesDistractor }[] = [];
  const { text, lastPos, lastSurface } = detail;
  if (
    startsWithAny(lastPos, SWAPPABLE_PARTICLE_POS) &&
    text.length > lastSurface.length &&
    text.endsWith(lastSurface)
  ) {
    const stem = text.slice(0, -lastSurface.length);
    for (const swap of PARTICLE_SWAPS[lastSurface] ?? []) {
      out.push({ text: stem + swap, distractor: { kind: 'particle', from: text, particle: lastSurface } });
    }
  }
  if (lastPos.startsWith('助動詞')) {
    const rule = ENDING_SWAPS.find(([suffix]) => text.endsWith(suffix) && text.length > suffix.length);
    if (rule) {
      const stem = text.slice(0, -rule[0].length);
      for (const swap of rule[1]) out.push({ text: stem + swap, distractor: { kind: 'ending', from: text } });
    }
  }
  return out;
}

export function buildEarTilesPuzzle(
  sentence: Pick<Sentence, 'id' | 'japanese' | 'vocabularySuggestions'>,
  options: { seed: string; distractors?: number },
): EarTilesPuzzle | null {
  const details = chunkSentenceIntoTileDetails(sentence);
  if (!details) return null;
  const tiles = details.map((detail) => detail.text);
  const tagged: EarTilesTile[] = tiles.map((text, index) => ({ id: `tile-${index}`, text }));

  // At most one fake per source tile; particle and ending swaps alternate so a round isn't two of a kind.
  const wanted = options.distractors ?? 0;
  const taken = new Set(tiles);
  const usedSources = new Set<number>();
  const fakes: EarTilesTile[] = [];
  if (wanted > 0) {
    const pool = seededShuffle(
      details.flatMap((detail, index) =>
        distractorCandidates(detail).map((candidate, variant) => ({
          ...candidate,
          id: `fake-${index}-${variant}`,
          source: index,
        })),
      ),
      (candidate) => candidate.id,
      `${options.seed}:fakes`,
    );
    const take = (candidate: (typeof pool)[number]) => {
      usedSources.add(candidate.source);
      taken.add(candidate.text);
      fakes.push({ id: candidate.id, text: candidate.text, distractor: candidate.distractor });
    };
    const available = (candidate: (typeof pool)[number]) =>
      !usedSources.has(candidate.source) && !taken.has(candidate.text);
    for (const wantKind of ['particle', 'ending', 'particle', 'ending'] as const) {
      if (fakes.length >= wanted) break;
      const next = pool.find((candidate) => candidate.distractor.kind === wantKind && available(candidate));
      if (next) take(next);
    }
    for (const candidate of pool) {
      if (fakes.length >= wanted) break;
      if (available(candidate)) take(candidate);
    }
  }

  let bank = seededShuffle([...tagged, ...fakes], (tile) => tile.id, options.seed);
  // A bank whose real tiles already read in spoken order would hand the answer over; swap the first two real tiles if the shuffle landed there.
  const realAt = bank.flatMap((tile, index) => (tile.distractor ? [] : [index]));
  if (realAt.length > 1 && realAt.every((at, index) => bank[at]!.text === tiles[index])) {
    bank = [...bank];
    [bank[realAt[0]!], bank[realAt[1]!]] = [bank[realAt[1]!]!, bank[realAt[0]!]!];
  }
  return { sentenceId: sentence.id, answer: tiles, bank };
}

/** The pre-walkthrough check takes shorter and longer sentences than the game: it is one warm-up, not a round. */
export const CHECK_MIN_TILES = 3;
export const CHECK_MAX_TILES = 8;
export const CHECK_DISTRACTORS = 2;

/** The tile check shown before a sentence's walkthrough, or null when the sentence doesn't split cleanly into 3–8 tiles. */
export function buildCheckPuzzle(
  sentence: Pick<Sentence, 'id' | 'japanese' | 'vocabularySuggestions'>,
  seed: string,
): EarTilesPuzzle | null {
  const puzzle = buildEarTilesPuzzle(sentence, { seed, distractors: CHECK_DISTRACTORS });
  if (!puzzle) return null;
  return puzzle.answer.length >= CHECK_MIN_TILES && puzzle.answer.length <= CHECK_MAX_TILES ? puzzle : null;
}

export interface ParticleOutcome {
  /** The real tile the particle distractor was made from. */
  tile: string;
  particle: string;
  /** The learner tapped the fake before settling on the real tile. */
  fellFor: boolean;
}

/** One outcome per particle distractor in the bank; `wrongTaps` is every wrong tile text tapped, in any slot. */
export function particleOutcomes(puzzle: Pick<EarTilesPuzzle, 'bank'>, wrongTaps: readonly string[]): ParticleOutcome[] {
  return puzzle.bank.flatMap((tile) =>
    tile.distractor?.kind === 'particle' && tile.distractor.particle
      ? [{ tile: tile.distractor.from, particle: tile.distractor.particle, fellFor: wrongTaps.includes(tile.text) }]
      : [],
  );
}

/**
 * Whether tapping `tileText` is right for slot `slot`. Judged on text, not tile
 * id, so two identical tiles (a repeated phrase) are interchangeable.
 */
export function isCorrectTile(puzzle: Pick<EarTilesPuzzle, 'answer'>, slot: number, tileText: string): boolean {
  return puzzle.answer[slot] === tileText;
}

/** A sentence is worth one point per tile; each wrong tap and peeking at the translation each cost one, never below 0. */
export function earTilesPointsAvailable(tileCount: number, wrongCount: number, translationShown: boolean): number {
  return Math.max(0, tileCount - wrongCount - (translationShown ? 1 : 0));
}

export interface EarTilesScore {
  /** Wrong tiles tried at each slot before the right one, in order. */
  wrongTries: string[][];
  wrongCount: number;
  translationShown: boolean;
  points: number;
  maxPoints: number;
  /** No wrong taps and no translation peek. */
  clean: boolean;
}

/** Score a finished puzzle. `wrongTries[i]` is what was tried (and rejected) at slot `i`. */
export function scoreEarTiles(
  puzzle: Pick<EarTilesPuzzle, 'answer'>,
  wrongTries: readonly (readonly string[])[],
  translationShown: boolean,
): EarTilesScore {
  const tries = puzzle.answer.map((_, index) => [...(wrongTries[index] ?? [])]);
  const wrongCount = tries.reduce((sum, list) => sum + list.length, 0);
  return {
    wrongTries: tries,
    wrongCount,
    translationShown,
    points: earTilesPointsAvailable(puzzle.answer.length, wrongCount, translationShown),
    maxPoints: puzzle.answer.length,
    clean: wrongCount === 0 && !translationShown,
  };
}

/** One-line "why this sentence" for the result screen. */
export function describeEarTilesPick(
  signal: EffectiveGameSignal,
  weakWords: readonly string[],
): string {
  if (signal === 'weak' && weakWords.length > 0) {
    return `Has words you've lapsed on in review (${weakWords.slice(0, 3).join('・')}).`;
  }
  if (signal === 'strong') return 'Words you know solidly — a relaxed listen.';
  if (signal === 'stale') return 'Has words whose recall has faded.';
  return 'From your confirmed sentences.';
}

export const EAR_TILES_COPY = {
  anyPool: 'your confirmed sentences with native audio',
  blurbs: {
    weak: "Sentences containing words you've forgotten before — hearing them in flow.",
    stale: 'Sentences containing words whose recall has faded.',
    strong: 'Sentences made of words you know solidly — a relaxed listening round.',
  },
};
