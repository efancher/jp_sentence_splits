import type { Sentence } from '../domain/types';
import { findRemixSkeleton, MAX_CLIP_MS, SLOT_HINTS } from './remix';

/**
 * Sentence Growth (docs/ROADMAP.md "Possibilities (active sentence-production
 * bridge)", first slice): a native sentence is rebuilt around its verb. The
 * learner hears the clip, sees only the core (the predicate), then is asked for
 * one chunk at a time — who? what? where/when? — picking each from the
 * sentence's OWN chunks, and finally says the whole sentence against the clip
 * and self-rates.
 *
 * Deliberately narrow: every chunk shown is copied from the native sentence —
 * no new vocabulary, no substitute words, no generated Japanese, nothing tied
 * to vocabulary proficiency. The chunks and their roles come from the same
 * UniDic "noun + case particle" skeleton Remix uses (`findRemixSkeleton`), not
 * from saved Cure-Dolly analyses (only ~3% of sentences have those).
 *
 * A sentence that cannot be laid out unambiguously is not offered at all
 * (`growthRejection`), so no item can ever be unfinishable. Pure.
 */
export const SENTENCE_GROWTH_GAME_ID = 'sentence-growth';
export const SENTENCE_GROWTH_ROUND_SIZE = 3;

export type GrowthSelfRating = 'hard' | 'ok' | 'easy';

/** Self-rating options with plain-English meaning; the learner picks, nothing is derived. */
export const GROWTH_RATINGS: readonly { value: GrowthSelfRating; label: string; hint: string }[] = [
  { value: 'hard', label: 'Hard', hint: 'I stumbled or needed the clip to get through it' },
  { value: 'ok', label: 'Okay', hint: 'I got there, a little slowly' },
  { value: 'easy', label: 'Easy', hint: 'I said it smoothly' },
];

/** The order prompts are asked in: who/what-we-discuss, then what it is done to, then where/how, when/whom, from, until. */
const PROMPT_ORDER = ['が', 'は', 'を', 'で', 'に', 'から', 'まで'] as const;

/** The question asked for a chunk, from its particle. Plain English first, particle pairing shown beside it. */
export const GROWTH_QUESTIONS: Record<string, string> = {
  が: 'Who or what does it?',
  は: 'What are we talking about?',
  を: 'What is the action done to?',
  で: 'Where does it happen, or by what means?',
  に: 'Where to, when, or to whom?',
  から: 'Where does it start from?',
  まで: 'Where does it go up to?',
};

export interface GrowthChunk {
  /** The chunk as spoken: noun + its particle, e.g. 巣を. */
  text: string;
  particle: string;
  /** Plain-English role of the particle (same wording as Remix). */
  hint: string;
  question: string;
  /** English for the noun when it is one token with a stored gloss — shown with the question, not as a pick. */
  gloss?: string;
}

export interface GrowthPlan {
  /** Chunks in spoken order; concatenated with `verbText` they equal the sentence. */
  chunks: GrowthChunk[];
  /** Indices into `chunks` in the order the learner is asked for them. */
  promptOrder: number[];
  /** The core shown from the start: everything after the last chunk. */
  verbText: string;
}

/** A clause break inside the text before a chunk means it is a separate phrase, not part of this chunk. */
const CLAUSE_BREAK = /[、，,。！？!?「」]/;
/** Sentence-opening connectives/adverbs that answer none of the questions. */
const CONNECTIVES = ['そして', 'でも', 'しかし', 'だから', 'それで', 'それから', 'また', 'ところで', 'すると', 'さらに', '実は'];

/** Token kinds that mean a chunk contains its own clause: verbs, adjectives, clause-linking / nominalising particles. */
const EMBEDDED_CLAUSE_POS = /^(動詞|形容詞|形状詞|助詞\/接続助詞|助詞\/準体助詞)/;

/**
 * The sentence's chunk layout, or null when it can't be laid out as
 * `chunk chunk … core` with nothing left over. Text before a chunk's noun
 * (の-modifiers, an adverb: 私の|母は, ゆっくり|巣を) belongs to that chunk, and a
 * comma after a chunk stays with it; but a leading connective or any other
 * clause break means the text is not part of a chunk the learner could be asked
 * about, so the sentence is refused rather than guessed.
 */
export function buildGrowthPlan(
  sentence: Pick<Sentence, 'japanese' | 'vocabularySuggestions'>,
): GrowthPlan | null {
  const skeleton = findRemixSkeleton(sentence);
  if (!skeleton) return null;
  const text = sentence.japanese;

  const chunks: GrowthChunk[] = [];
  let cursor = 0;
  for (const slot of skeleton.slots) {
    let before = text.slice(cursor, slot.start);
    const comma = before.match(/^[、，,\s]+/)?.[0] ?? '';
    if (comma) {
      const previous = chunks[chunks.length - 1];
      if (!previous) return null;
      previous.text += comma;
      before = before.slice(comma.length);
    }
    if (CLAUSE_BREAK.test(before) || CONNECTIVES.some((word) => before.startsWith(word))) return null;
    const particleEnd = slot.end + slot.particle.length;
    // A verb/adjective/linking particle inside the chunk (学生の時にハマった|バンドは) is a whole clause, not a piece to ask for.
    const chunkStart = slot.start - before.length;
    if (
      (sentence.vocabularySuggestions ?? []).some(
        (token) =>
          token.start >= chunkStart && token.end <= particleEnd && EMBEDDED_CLAUSE_POS.test(token.pos ?? ''),
      )
    ) {
      return null;
    }
    if (text.slice(slot.end, particleEnd) !== slot.particle) return null;
    const question = GROWTH_QUESTIONS[slot.particle];
    if (!question) return null;
    chunks.push({
      text: before + text.slice(slot.start, particleEnd),
      particle: slot.particle,
      hint: SLOT_HINTS[slot.particle] ?? slot.hint,
      question,
      // The noun's English only describes the noun itself, not a modifier glued in front of it.
      gloss: before === '' ? slot.gloss : undefined,
    });
    cursor = particleEnd;
  }
  const verbText = text.slice(cursor);
  if (verbText.trim() === '') return null;
  // Two chunks sharing a particle make "which が?" unanswerable from the question alone.
  if (new Set(chunks.map((chunk) => chunk.particle)).size !== chunks.length) return null;

  const rank = (particle: string) => PROMPT_ORDER.indexOf(particle as (typeof PROMPT_ORDER)[number]);
  const promptOrder = chunks
    .map((_, index) => index)
    .sort((a, b) => rank(chunks[a]!.particle) - rank(chunks[b]!.particle));
  return { chunks, promptOrder, verbText };
}

/** Why a sentence can't be a Sentence Growth item, or null when it can. */
export function growthRejection(
  sentence: Pick<Sentence, 'japanese' | 'translation' | 'vocabularySuggestions'>,
  audioDurationMs: number,
): 'no-translation' | 'clip-too-long' | 'no-plan' | null {
  if (!sentence.translation?.trim()) return 'no-translation';
  if (audioDurationMs > MAX_CLIP_MS) return 'clip-too-long';
  return buildGrowthPlan(sentence) ? null : 'no-plan';
}
