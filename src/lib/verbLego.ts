import type { EffectiveGameSignal, GameRound, Sentence } from '../domain/types';
import { conjugate, inferConjugationWordClass, type ConjugationFormKey } from './conjugation';
import type { PickerStats, SignalCopy } from './gamePicker';
import { seededShuffle } from './seededShuffle';

/**
 * Verb Lego (docs/ROADMAP.md "Short games"): build the stacked verb forms the
 * learner has actually met — 聞か+れ+た, 考え+て+ない, 思わ+れ+たい — from
 * snap-together pieces. A chain is a verb stem plus the contiguous run of
 * auxiliary tokens after it, read straight out of the sentence's stored UniDic
 * tokens (so the answer is what the sentence really says, validated against the
 * text span). The learner sees the dictionary form and the ordered function
 * labels ("passive → past"), then taps pieces into slots left to right. Each
 * tap is judged immediately (right locks green, wrong flashes red and costs a
 * point), like Particle Puzzle.
 *
 * What it drills that nothing else does: which stem attaches to which suffix,
 * and the allomorphs (れ/られ, せ/させ, なかっ/ない, ませ/まし) — the
 * conjugation card skips stacked forms entirely.
 *
 * Deliberately conservative, because a decoy that is really valid is worse than
 * no decoy:
 *  - only a whitelisted set of auxiliaries (`AUX_TABLE`); a chain stops at the
 *    first one outside it, and する/来る (irregular stems) are skipped;
 *  - stem decoys come from the verb's own `conjugate()` outputs, and only when
 *    the real stem is among them (else class inference is suspect → no stem decoy);
 *  - never offers れ/せ as a decoy for られ/させ (ら抜き 食べれる is real
 *    speech), only the reverse; だ/た and で/て decoys only when the preceding
 *    piece makes them certainly wrong.
 * Pure: takes Sentence rows already fetched from Dexie.
 */
export const VERB_LEGO_GAME_ID = 'verb-lego';
export const VERB_LEGO_ROUND_SIZE = 6;
export const MIN_AUX = 2;
export const MAX_AUX = 4;
export const VERB_LEGO_HISTORY_ROUNDS = 60;

export const VERB_LEGO_COPY: SignalCopy = {
  anyPool: 'the verb forms you have met and the verbs you know',
  blurbs: {
    weak: "Suffix pieces you've mixed up before.",
    stale: 'Verb forms that need another look.',
    strong: 'Forms whose pieces you reliably get right — a relaxed round.',
  },
};

interface AuxEntry {
  lemma: string;
  surface: string;
  /** What this piece *does*, shown under its slot. */
  label: string;
}

/** Every auxiliary (lemma, surface) this game understands, with a learner-facing label. Also the source of same-lemma decoys. */
export const AUX_TABLE: readonly AuxEntry[] = [
  { lemma: 'ます', surface: 'ます', label: 'polite' },
  { lemma: 'ます', surface: 'まし', label: 'polite (before past た)' },
  { lemma: 'ます', surface: 'ませ', label: 'polite (before negative ん)' },
  { lemma: 'ます', surface: 'ましょう', label: 'polite “let’s”' },
  { lemma: 'ぬ', surface: 'ん', label: 'negative (as in ません)' },
  { lemma: 'た', surface: 'た', label: 'past' },
  { lemma: 'た', surface: 'だ', label: 'past (after ん)' },
  { lemma: 'た', surface: 'たら', label: 'conditional (〜たら)' },
  { lemma: 'ない', surface: 'ない', label: 'negative' },
  { lemma: 'ない', surface: 'なかっ', label: 'negative (before past た)' },
  { lemma: 'ない', surface: 'なく', label: 'negative (adverbial 〜なく)' },
  { lemma: 'ない', surface: 'なけれ', label: 'negative (before ば)' },
  { lemma: 'れる', surface: 'れ', label: 'passive / potential (before another suffix)' },
  { lemma: 'れる', surface: 'れる', label: 'passive / potential' },
  { lemma: 'られる', surface: 'られ', label: 'passive / potential (before another suffix)' },
  { lemma: 'られる', surface: 'られる', label: 'passive / potential' },
  { lemma: 'せる', surface: 'せ', label: 'causative (before another suffix)' },
  { lemma: 'せる', surface: 'せる', label: 'causative' },
  { lemma: 'させる', surface: 'させ', label: 'causative (before another suffix)' },
  { lemma: 'させる', surface: 'させる', label: 'causative' },
  { lemma: 'たい', surface: 'たい', label: 'want to' },
  { lemma: 'たい', surface: 'たかっ', label: 'want to (before past た)' },
  { lemma: 'てる', surface: 'て', label: '〜ている, い dropped (ongoing / resulting state)' },
  { lemma: 'てる', surface: 'てる', label: '〜ている, contracted (ongoing / resulting state)' },
  { lemma: 'でる', surface: 'で', label: '〜ている after ん/ぐ, い dropped (ongoing / resulting state)' },
  { lemma: 'でる', surface: 'でる', label: '〜ている after ん/ぐ, contracted (ongoing / resulting state)' },
];

/** A one-or-two-word name for what a piece does, for the "Build: passive → past" prompt. */
export function functionName(piece: Pick<ChainPiece, 'lemma' | 'text'>): string {
  switch (piece.lemma) {
    case 'ます':
      return 'polite';
    case 'ぬ':
    case 'ない':
      return 'negative';
    case 'た':
      return piece.text === 'たら' ? 'conditional' : 'past';
    case 'れる':
    case 'られる':
      return 'passive';
    case 'せる':
    case 'させる':
      return 'causative';
    case 'たい':
      return 'want to';
    case 'てる':
    case 'でる':
      return 'ongoing (〜ている)';
    default:
      return piece.lemma ?? '';
  }
}

function auxEntry(lemma: string, surface: string): AuxEntry | undefined {
  return AUX_TABLE.find((entry) => entry.lemma === lemma && entry.surface === surface);
}

export interface ChainPiece {
  /** The piece's own text as it appears in the sentence. */
  text: string;
  /** Shown under the slot. For the stem: what it has to attach to. */
  label: string;
  /** Stable key for weakness history, e.g. `れる|れ` or `stem:れる`. */
  key: string;
  kind: 'stem' | 'aux';
  /** UniDic lemma, for aux pieces. */
  lemma?: string;
}

export interface VerbChain {
  /** Stable id: `<sentenceId>:<start>` for a real chain, `built:<lemma>:<recipe>` for a composed one. */
  id: string;
  /** `sentence`: read from a real sentence's tokens. `built`: composed from a verb you know (see `BUILT_RECIPES`). */
  source: 'sentence' | 'built';
  sentenceId: string;
  japanese: string;
  translation: string;
  start: number;
  end: number;
  /** Dictionary form and its reading (`vocabularySuggestions` carry the lemma). */
  lemma: string;
  lemmaReading: string;
  /** English gloss when the suggestion has one. */
  english: string;
  /** Stem then each auxiliary, in order; `text` concatenates to the sentence span. */
  pieces: ChainPiece[];
}

interface RawToken {
  start: number;
  end: number;
  surface: string;
  expression: string;
  reading: string;
  pos: string;
  english?: string;
}

/** Stacked verb chains in a sentence, straight from its stored UniDic tokens. */
export function findVerbChains(
  sentence: Pick<Sentence, 'id' | 'japanese' | 'translation' | 'vocabularySuggestions'>,
): VerbChain[] {
  const tokens = [...((sentence.vocabularySuggestions ?? []) as RawToken[])]
    .filter((token) => sentence.japanese.slice(token.start, token.end) === token.surface)
    .sort((a, b) => a.start - b.start);

  const chains: VerbChain[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const verb = tokens[i]!;
    if (!verb.pos?.startsWith('動詞')) continue;
    if (verb.expression === 'する' || verb.expression === '来る' || verb.expression === 'くる') continue;

    const aux: { token: RawToken; entry: AuxEntry }[] = [];
    let cursor = verb.end;
    for (let j = i + 1; j < tokens.length && aux.length < MAX_AUX; j += 1) {
      const token = tokens[j]!;
      if (token.start !== cursor || !token.pos?.startsWith('助動詞')) break;
      const entry = auxEntry(token.expression, token.surface);
      if (!entry) break;
      aux.push({ token, entry });
      cursor = token.end;
    }
    if (aux.length < MIN_AUX) continue;

    const first = aux[0]!.entry;
    chains.push({
      id: `${sentence.id}:${verb.start}`,
      source: 'sentence',
      sentenceId: sentence.id,
      japanese: sentence.japanese,
      translation: sentence.translation ?? '',
      start: verb.start,
      end: cursor,
      lemma: verb.expression,
      lemmaReading: verb.reading,
      english: verb.english ?? '',
      pieces: [
        {
          text: verb.surface,
          label: `stem (before ${first.surface})`,
          key: `stem:${first.lemma}`,
          kind: 'stem',
        },
        ...aux.map(({ token, entry }) => ({
          text: token.surface,
          label: entry.label,
          key: `${entry.lemma}|${entry.surface}`,
          kind: 'aux' as const,
          lemma: entry.lemma,
        })),
      ],
    });
    // Resume after this chain so overlapping sub-chains aren't emitted.
    i += aux.length;
  }
  return chains;
}

export function isVerbLegoEligible(
  sentence: Pick<Sentence, 'id' | 'japanese' | 'translation' | 'vocabularySuggestions'>,
): boolean {
  return !!sentence.translation?.trim() && findVerbChains(sentence).length > 0;
}

export interface VerbStemSet {
  wordClass: 'godan' | 'ichidan';
  /** Dictionary form. */
  dictionary: string;
  /** Before ない/せる/れる (godan 聞か; ichidan = the plain stem). */
  a: string;
  /** Before ます/たい (godan 聞き; ichidan = the plain stem). */
  i: string;
  /** Before て/た (godan onbin 聞い; ichidan = the plain stem). */
  te: string;
}

/**
 * Kana-only verbs (できる, あそぶ) make the ported conjugator decline — it
 * treats the whole trailing kana run as okurigana. Conjugating a stand-in
 * (`仮` + the verb's last kana) with the *real* reading works, and the stems
 * are then read from the conjugated reading instead of the expression.
 */
const KANA_ONLY_STAND_IN = '仮';

function stripSuffix(text: string, suffixes: readonly string[]): string | null {
  const suffix = suffixes.find((candidate) => text.endsWith(candidate));
  return suffix ? text.slice(0, -suffix.length) : null;
}

/**
 * The verb's stems (a / i / te and the dictionary form), read off its own
 * `conjugate()` outputs by stripping the known suffix. Deliberately **no**
 * e-stem (聞け, 食べれ): 聞けない / 食べれない are real potential forms, so it
 * isn't certainly wrong before the suffixes we test. `null` when the verb
 * isn't a plain godan/ichidan verb or the conjugator declines any form.
 */
export function verbStemSet(
  lemma: string,
  lemmaReading: string,
  /** JMdict tags (`v5r; vt`). When given they decide the class; shape alone mislabels godan 切る/走る/入る as ichidan. */
  partOfSpeech?: string,
): VerbStemSet | null {
  const wordClass = inferConjugationWordClass(lemma, lemmaReading, partOfSpeech || '動詞/一般');
  if (wordClass !== 'godan' && wordClass !== 'ichidan') return null;
  const kanaOnly = /^[ぁ-んー]+$/.test(lemma);
  const expression = kanaOnly ? KANA_ONLY_STAND_IN + lemma.slice(-1) : lemma;
  const part = (form: ConjugationFormKey, strip: readonly string[]): string | null => {
    const conjugated = conjugate(expression, lemmaReading, wordClass, form);
    if (!conjugated) return null;
    return stripSuffix(kanaOnly ? conjugated.reading : conjugated.expression, strip);
  };
  const i = part('polite_present', ['ます']);
  const a = part('plain_negative', ['ない']);
  const te = part('te_form', ['て', 'で']);
  if (!i || !a || !te) return null;
  return { wordClass, dictionary: lemma, a, i, te };
}

/** Every distinct stem of the verb — the pool a stem decoy is drawn from. */
export function verbStems(lemma: string, lemmaReading: string): string[] | null {
  const set = verbStemSet(lemma, lemmaReading);
  return set ? [...new Set([set.dictionary, set.a, set.i, set.te])] : null;
}

/** Voiced て/た (で/だ) follows ん and the い of ぐ-verbs; the plain forms follow everything else. */
function endsVoicingContext(previous: string): boolean {
  return previous.endsWith('ん') || previous.endsWith('い');
}

/**
 * Certainly-wrong alternatives for one aux piece: other forms of the same
 * lemma (they carry a different label), the allomorph that can't follow a
 * godan a-stem (られ after 聞か — never the reverse, ら抜き exists), and the
 * voiced/unvoiced twin only where the preceding piece rules it out.
 */
export function auxDecoys(piece: ChainPiece, previousText: string): string[] {
  const lemma = piece.lemma!;
  const decoys = new Set<string>();
  for (const entry of AUX_TABLE) {
    if (entry.lemma === lemma && entry.surface !== piece.text) decoys.add(entry.surface);
  }
  if (lemma === 'れる') {
    decoys.add(piece.text === 'れ' ? 'られ' : 'られる');
  }
  if (lemma === 'せる') {
    decoys.add(piece.text === 'せ' ? 'させ' : 'させる');
  }
  // た/だ and て/で twins live in different lemmas (た vs た-だ share a lemma; て vs で don't).
  if (lemma === 'てる') {
    if (!endsVoicingContext(previousText)) decoys.add('で');
  } else if (lemma === 'でる') {
    if (endsVoicingContext(previousText)) decoys.add('て');
  }
  if (lemma === 'た') {
    if (piece.text === 'た' && endsVoicingContext(previousText)) decoys.delete('だ');
    if (piece.text === 'だ' && !endsVoicingContext(previousText)) decoys.delete('た');
  }
  return [...decoys];
}

export interface LegoChip {
  id: string;
  text: string;
}
export interface VerbLegoPuzzle {
  chain: VerbChain;
  /** `answers[i]` is the piece that belongs in slot `i` (0 = stem). */
  answers: string[];
  labels: string[];
  bank: LegoChip[];
}

/** Build a puzzle: the chain's pieces plus 2–3 certainly-wrong decoys, shuffled into one bank. */
export function buildVerbLegoPuzzle(chain: VerbChain, seed: string): VerbLegoPuzzle {
  const answers = chain.pieces.map((piece) => piece.text);
  const answerSet = new Set(answers);
  const decoyTarget = chain.pieces.length >= 4 ? 3 : 2;

  const candidates: string[][] = []; // one list per slot, so decoys spread across slots
  const stems = verbStems(chain.lemma, chain.lemmaReading);
  // Only trust the stem decoys when the real stem is among the derived ones.
  candidates.push(stems && stems.includes(answers[0]!) ? stems.filter((s) => s !== answers[0]) : []);
  for (let i = 1; i < chain.pieces.length; i += 1) {
    candidates.push(auxDecoys(chain.pieces[i]!, answers[i - 1]!));
  }

  const perSlot = candidates.map((list, i) =>
    seededShuffle(
      list.filter((text) => !answerSet.has(text)),
      (text) => text,
      `${seed}:d${i}`,
    ),
  );
  // Round-robin across slots (in a seeded order) so decoys spread over the chain.
  const slotOrder = seededShuffle(
    perSlot.map((_, i) => i),
    (i) => String(i),
    `${seed}:slots`,
  );
  const decoys: string[] = [];
  for (let round = 0; decoys.length < decoyTarget; round += 1) {
    let added = false;
    for (const slot of slotOrder) {
      const next = perSlot[slot]![round];
      if (next && !decoys.includes(next) && decoys.length < decoyTarget) {
        decoys.push(next);
        added = true;
      }
    }
    if (!added) break;
  }

  const bank = seededShuffle(
    [...answers, ...decoys].map((text, index) => ({ id: `chip-${index}`, text })),
    (chip) => chip.id,
    `${seed}:bank`,
  );
  return { chain, answers, labels: chain.pieces.map((p) => p.label), bank };
}

/** A chain is worth one point per slot; each wrong tap costs one, never below 0. */
export function verbLegoPointsAvailable(slotCount: number, wrongCount: number): number {
  return Math.max(0, slotCount - wrongCount);
}

export interface SlotScore {
  key: string;
  expected: string;
  wrongTries: string[];
  correct: boolean;
}

export function scoreVerbLego(
  puzzle: Pick<VerbLegoPuzzle, 'answers'> & { chain: Pick<VerbChain, 'pieces'> },
  wrongTries: readonly (readonly string[])[],
): { slots: SlotScore[]; wrongCount: number; points: number; maxPoints: number; allCorrect: boolean } {
  const slots = puzzle.answers.map((expected, index) => {
    const tries = [...(wrongTries[index] ?? [])];
    return { key: puzzle.chain.pieces[index]!.key, expected, wrongTries: tries, correct: tries.length === 0 };
  });
  const wrongCount = slots.reduce((sum, slot) => sum + slot.wrongTries.length, 0);
  return {
    slots,
    wrongCount,
    points: verbLegoPointsAvailable(slots.length, wrongCount),
    maxPoints: slots.length,
    allCorrect: wrongCount === 0,
  };
}

/** The pattern of a chain — used to keep a round from repeating the same shape (まし+た five times). */
export function chainSignature(chain: Pick<VerbChain, 'pieces'>): string {
  return chain.pieces
    .slice(1)
    .map((piece) => piece.key)
    .join('>');
}

export interface VerbLegoHistoryEntry {
  attempts: number;
  misses: number;
}

/** Per piece-key attempts/misses over the most recent Verb Lego rounds. */
export function buildVerbLegoHistory(
  rounds: readonly Pick<GameRound, 'timestamp' | 'items'>[],
  limit: number = VERB_LEGO_HISTORY_ROUNDS,
): Map<string, VerbLegoHistoryEntry> {
  const history = new Map<string, VerbLegoHistoryEntry>();
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

/** Particle → misses style focus: piece key → recent misses (only missed pieces). */
export function verbLegoMissFocus(
  history: ReadonlyMap<string, VerbLegoHistoryEntry>,
): Map<string, number> {
  const focus = new Map<string, number>();
  for (const [key, entry] of history) if (entry.misses > 0) focus.set(key, entry.misses);
  return focus;
}

const MATURE_ATTEMPTS = 8;

/** Map a chain's piece history onto picker stats (same reading as Particle Puzzle: lapses = misses, retrievability = accuracy). */
export function chainStats(
  chain: Pick<VerbChain, 'pieces'>,
  history: ReadonlyMap<string, VerbLegoHistoryEntry>,
): PickerStats {
  let attempts = 0;
  let misses = 0;
  for (const key of new Set(chain.pieces.map((piece) => piece.key))) {
    const entry = history.get(key);
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

/** One-line "why this chain" for the result screen. */
export function describeChainPick(
  signal: EffectiveGameSignal,
  chain: Pick<VerbChain, 'pieces' | 'source'>,
  focus: ReadonlyMap<string, number>,
): string {
  const missed = chain.pieces.filter((piece) => focus.has(piece.key));
  if (signal === 'weak' && missed.length > 0) {
    return `Includes pieces you've missed before (${missed.map((p) => p.text).join('・')}).`;
  }
  if (signal === 'strong') return "Pieces you've been getting right.";
  return chain.source === 'built' ? 'Built from a verb you know.' : 'From one of your own sentences.';
}

// ---------------------------------------------------------------------------
// Built chains — composed from a verb the learner knows, for the "monster"
// forms real sentences almost never contain (the corpus is ~85% 〜ました).
// ---------------------------------------------------------------------------

type Step = 'causative' | 'passive' | 'negative' | 'past' | 'want';

export interface BuiltRecipe {
  id: string;
  steps: readonly Step[];
}

/** The function stacks a learner can be asked to build, shortest first. */
export const BUILT_RECIPES: readonly BuiltRecipe[] = [
  { id: 'causative-past', steps: ['causative', 'past'] },
  { id: 'passive-past', steps: ['passive', 'past'] },
  { id: 'want-past', steps: ['want', 'past'] },
  { id: 'causative-negative', steps: ['causative', 'negative'] },
  { id: 'passive-negative', steps: ['passive', 'negative'] },
  { id: 'causative-passive', steps: ['causative', 'passive'] },
  { id: 'causative-negative-past', steps: ['causative', 'negative', 'past'] },
  { id: 'passive-negative-past', steps: ['passive', 'negative', 'past'] },
  { id: 'causative-passive-past', steps: ['causative', 'passive', 'past'] },
  { id: 'causative-passive-negative-past', steps: ['causative', 'passive', 'negative', 'past'] },
];

/** Verbs whose passive/causative is odd, irregular, or a different verb altogether — never composed. */
const NEVER_BUILT = new Set([
  'ある', 'いる', '居る', 'できる', '出来る', '分かる', 'わかる', '解る', '見える', '聞こえる', '要る',
  'いらっしゃる', 'くださる', '下さる', 'おっしゃる', '仰る', 'なさる', 'ござる', 'くれる', '呉れる',
  'やる', '来る', 'くる', 'する',
  // Potential forms of another verb — 行けさせた is nonsense.
  '行ける', 'しれる', '知れる',
]);

export interface BuildableVerb {
  expression: string;
  reading: string;
  /** JMdict tags, e.g. `v5r; vt`. */
  partOfSpeech?: string;
}

/** Recipes a verb can safely be composed into; empty when it can't be (irregular, stative, class unclear). */
export function recipesForVerb(verb: BuildableVerb): BuiltRecipe[] {
  if (NEVER_BUILT.has(verb.expression)) return [];
  // Particle + verb phrases (ことになる, 気にする) are expressions, not verbs to conjugate stem-by-stem.
  if (/[にをがでとは](なる|する|ある|いる|くる|できる)$/.test(verb.expression)) return [];
  const tags = verb.partOfSpeech ?? '';
  // Only words JMdict explicitly tags as a godan/ichidan verb — never guess a verb from shape alone.
  if (!/\bv(1|5[a-z-]*)\b/.test(tags)) return [];
  if (tags.includes('v5aru')) return []; // honorific i-stem irregularity
  const wordClass = inferConjugationWordClass(verb.expression, verb.reading, tags);
  if (wordClass !== 'godan' && wordClass !== 'ichidan') return [];
  // A passive needs an agent-y verb: require an explicit transitive tag.
  const transitive = /\bvt\b/.test(tags);
  return BUILT_RECIPES.filter((recipe) => transitive || !recipe.steps.includes('passive'));
}

/**
 * Compose a chain for `recipe` from the verb's stems by fixed rules —
 * causative godan+せ / ichidan+させ; passive godan+れ / else られ (after a
 * causative the verb is ichidan-like); negative ない (なかっ before past);
 * want たい (たかっ before past); past た — validated by construction against
 * `AUX_TABLE` (every piece must have a label) and by tests against known forms.
 */
export function buildBuiltChain(verb: BuildableVerb & { english?: string }, recipe: BuiltRecipe): VerbChain | null {
  const stems = verbStemSet(verb.expression, verb.reading, verb.partOfSpeech);
  if (!stems) return null;

  const surfaces: { lemma: string; text: string }[] = [];
  recipe.steps.forEach((step, index) => {
    const next = recipe.steps[index + 1];
    const last = index === recipe.steps.length - 1;
    // Godan only until a causative/passive has turned the verb ichidan-like.
    const plainGodan = stems.wordClass === 'godan' && index === 0;
    switch (step) {
      case 'causative': {
        const lemma = plainGodan ? 'せる' : 'させる';
        surfaces.push({ lemma, text: last ? lemma : lemma.slice(0, -1) });
        break;
      }
      case 'passive': {
        const lemma = plainGodan ? 'れる' : 'られる';
        surfaces.push({ lemma, text: last ? lemma : lemma.slice(0, -1) });
        break;
      }
      case 'negative':
        surfaces.push({ lemma: 'ない', text: next === 'past' ? 'なかっ' : 'ない' });
        break;
      case 'want':
        surfaces.push({ lemma: 'たい', text: next === 'past' ? 'たかっ' : 'たい' });
        break;
      case 'past':
        surfaces.push({ lemma: 'た', text: 'た' });
        break;
    }
  });

  const aux = surfaces.map((piece) => ({ piece, entry: auxEntry(piece.lemma, piece.text) }));
  if (aux.some(({ entry }) => !entry)) return null;

  const first = aux[0]!.entry!;
  const stemText = recipe.steps[0] === 'want' ? stems.i : stems.a;
  const pieces: ChainPiece[] = [
    { text: stemText, label: `stem (before ${first.surface})`, key: `stem:${first.lemma}`, kind: 'stem' },
    ...aux.map(({ entry }) => ({
      text: entry!.surface,
      label: entry!.label,
      key: `${entry!.lemma}|${entry!.surface}`,
      kind: 'aux' as const,
      lemma: entry!.lemma,
    })),
  ];
  const form = pieces.map((piece) => piece.text).join('');
  return {
    id: `built:${verb.expression}:${recipe.id}`,
    source: 'built',
    sentenceId: '',
    japanese: form,
    translation: '',
    start: 0,
    end: form.length,
    lemma: verb.expression,
    lemmaReading: verb.reading,
    english: verb.english ?? '',
    pieces,
  };
}

export interface VerbLegoCandidate {
  /** The chain's suffix pattern — the picker's unit, so a round never repeats a pattern. */
  id: string;
  /** Every chain (real or built) that has this pattern; one is chosen when the round is built. */
  chains: VerbChain[];
  stats: PickerStats;
}

/** Group real and built chains by pattern, each carrying its history-derived picker stats. */
export function buildVerbLegoCandidates(
  chains: readonly VerbChain[],
  history: ReadonlyMap<string, VerbLegoHistoryEntry>,
): VerbLegoCandidate[] {
  const bySignature = new Map<string, VerbChain[]>();
  for (const chain of chains) {
    const signature = chainSignature(chain);
    const list = bySignature.get(signature) ?? [];
    list.push(chain);
    bySignature.set(signature, list);
  }
  return [...bySignature]
    .map(([id, group]) => ({ id, chains: group, stats: chainStats(group[0]!, history) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Pick one chain of a candidate — seeded, preferring a real one (`source: 'sentence'`) about half the time when both exist. */
export function chooseChain(candidate: VerbLegoCandidate, seed: string): VerbChain {
  const real = candidate.chains.filter((chain) => chain.source === 'sentence');
  const built = candidate.chains.filter((chain) => chain.source === 'built');
  const preferReal = real.length > 0 && (built.length === 0 || seededShuffle(['r', 'b'], (x) => x, `${seed}:src`)[0] === 'r');
  const pool = preferReal ? real : built.length > 0 ? built : real;
  return seededShuffle(pool, (chain) => chain.id, `${seed}:chain`)[0]!;
}
