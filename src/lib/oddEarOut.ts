import type { EffectiveGameSignal, GameRound } from '../domain/types';
import type { PickerCandidate, PickerStats, SignalCopy } from './gamePicker';
import { segmentIntoMorae } from './mora';
import { expectedPitchShape } from './pitchAccentShape';
import type { PitchAnalysisPayload } from './pitch';
import type { TimeRangeMs } from './recording';
import { seededShuffle } from './seededShuffle';

/**
 * Odd Ear Out (docs/ROADMAP.md "Short games"): four real native clips of
 * words of the same length, three sharing an accent shape and one that
 * doesn't. Tap the odd one; each wrong tap costs a point. The reveal shows all
 * four words with their *measured* pitch contour (cropped to the word), so the
 * difference between the shapes is something you can see, not just a label.
 *
 * Words are grouped by their **in-word** shape (`expectedPitchShape` without a
 * following mora), not their dictionary pattern: heiban and odaka are
 * identical inside the word and differ only on a following particle, so a
 * round that mixed them would have two audibly-different clips in the "same"
 * group. Clips are cut to the word alone (the strict `wordOnly` span) for the
 * same reason. Only words with a pitch position, citation form, and an
 * isolatable span get in — the repository gates that before this module sees a
 * clip.
 *
 * `bookId` stands in for "same speaker" (a book is normally one narrator or
 * cast — an approximation, as in the minimal-pair warm-up); the builder prefers
 * an all-same-book round so a voice change isn't the giveaway.
 *
 * Pure: the repository hands in clips and `gameRounds`.
 */
export const ODD_EAR_OUT_GAME_ID = 'odd-ear-out';
export const ODD_EAR_OUT_ROUND_SIZE = 5;

export const ODD_EAR_COPY: SignalCopy = {
  anyPool: 'contrasts among your own words',
  blurbs: {
    weak: "Accent shapes you've mixed up before.",
    stale: 'Accent contrasts that need another listen.',
    strong: "Contrasts you've been hearing reliably — a relaxed round.",
  },
};
/** Clips per trial: `MAJORITY_SIZE` alike plus one odd. */
export const MAJORITY_SIZE = 3;
/** A trial starts worth this many points and loses one per wrong tap (there are only three wrong clips). */
export const ODD_EAR_TRIAL_POINTS = 3;
/**
 * Sanity bounds on an isolated (padded) word clip, in ms — outside them the alignment is
 * probably off. The aligner span carries ~180 ms of padding, so 300 ms means a word of
 * at least ~120 ms; real 2-mora words run longer than that.
 */
export const MIN_CLIP_MS = 300;
export const MAX_CLIP_MS = 3000;
export const ODD_EAR_HISTORY_ROUNDS = 60;

export interface OddEarClip {
  vocabularyItemId: string;
  expression: string;
  reading: string;
  meaning: string;
  /** Dictionary accent position (`pitchAccentPositions[0]`). */
  position: number;
  moraCount: number;
  /** In-word high/low string, one char per mora, e.g. `lhh`. */
  shape: string;
  bookId: string;
  /** The word's own span in its reference recording. */
  span: TimeRangeMs;
}

/** A clip's mora count and in-word shape, or null for words too short (<2 morae) to have a contrast. */
export function inWordShape(
  reading: string,
  position: number,
): { moraCount: number; shape: string } | null {
  const moraCount = segmentIntoMorae(reading).length;
  if (moraCount < 2) return null;
  return { moraCount, shape: expectedPitchShape(moraCount, position).join('') };
}

export function isPlausibleClipSpan(span: TimeRangeMs): boolean {
  const length = span.endMs - span.startMs;
  return length >= MIN_CLIP_MS && length <= MAX_CLIP_MS;
}

/** Plain-language description of an in-word shape (heiban and odaka share one — see module doc). */
export function shapeLabel(shape: string): string {
  if (shape.startsWith('h')) return 'starts high, drops after the 1st mora (atamadaka)';
  const lastHigh = shape.lastIndexOf('h');
  if (lastHigh === shape.length - 1) return 'starts low, then stays up (heiban / odaka)';
  return `starts low, rises, drops after mora ${lastHigh + 1} (nakadaka)`;
}

export interface OddEarContrast {
  /** Stable id: `<moraCount>:<majorityShape>><oddShape>`. */
  id: string;
  moraCount: number;
  majorityShape: string;
  oddShape: string;
  /** Unordered, so "A among Bs" and "B among As" count as one weakness. */
  pairKey: string;
}

export function pairKeyFor(moraCount: number, a: string, b: string): string {
  return `${moraCount}m ${[a, b].sort().join('/')}`;
}

function distinctReadings(clips: readonly OddEarClip[]): number {
  return new Set(clips.map((clip) => clip.reading)).size;
}

/** Every ordered (majority, odd) shape pair among same-length words that can fill a 3+1 trial. */
export function findContrasts(clips: readonly OddEarClip[]): OddEarContrast[] {
  const groups = new Map<string, OddEarClip[]>(); // `${moraCount}:${shape}`
  for (const clip of clips) {
    const key = `${clip.moraCount}:${clip.shape}`;
    const list = groups.get(key) ?? [];
    list.push(clip);
    groups.set(key, list);
  }
  const contrasts: OddEarContrast[] = [];
  for (const [majorityKey, majority] of groups) {
    if (distinctReadings(majority) < MAJORITY_SIZE) continue;
    const { moraCount, shape: majorityShape } = majority[0]!;
    for (const [oddKey, odd] of groups) {
      if (oddKey === majorityKey || odd[0]!.moraCount !== moraCount) continue;
      const oddShape = odd[0]!.shape;
      contrasts.push({
        id: `${moraCount}:${majorityShape}>${oddShape}`,
        moraCount,
        majorityShape,
        oddShape,
        pairKey: pairKeyFor(moraCount, majorityShape, oddShape),
      });
    }
  }
  return contrasts.sort((a, b) => a.id.localeCompare(b.id));
}

export interface OddEarTrial<T extends OddEarClip> {
  id: string;
  contrast: OddEarContrast;
  /** The four clips in display order. */
  clips: T[];
  /** Index into `clips` of the odd one. */
  oddIndex: number;
  /** All four clips come from one book — the "same speaker" round. */
  sameBook: boolean;
}

/** Pick `count` clips of distinct words *and* readings, in seeded order, avoiding `takenReadings`. */
function pickDistinct<T extends OddEarClip>(
  pool: readonly T[],
  count: number,
  takenReadings: ReadonlySet<string>,
  seed: string,
): T[] | null {
  const picked: T[] = [];
  const readings = new Set(takenReadings);
  const words = new Set<string>();
  for (const clip of seededShuffle(pool, (c) => `${c.vocabularyItemId}:${c.bookId}`, seed)) {
    if (readings.has(clip.reading) || words.has(clip.vocabularyItemId)) continue;
    readings.add(clip.reading);
    words.add(clip.vocabularyItemId);
    picked.push(clip);
    if (picked.length === count) return picked;
  }
  return null;
}

/**
 * Build one trial for `contrast`: three majority-shape clips and one odd clip
 * of distinct words with distinct readings (two identical-sounding clips would
 * make the odd one a guess). Prefers all four from a single book; falls back to
 * any mix. Null when the pool can't supply a valid four.
 */
export function buildOddEarTrial<T extends OddEarClip>(
  clips: readonly T[],
  contrast: OddEarContrast,
  seed: string,
): OddEarTrial<T> | null {
  const inGroup = (shape: string) =>
    clips.filter((clip) => clip.moraCount === contrast.moraCount && clip.shape === shape);
  const majorityPool = inGroup(contrast.majorityShape);
  const oddPool = inGroup(contrast.oddShape);

  const attempt = (
    majority: readonly T[],
    odd: readonly T[],
  ): { majority: T[]; odd: T } | null => {
    const three = pickDistinct(majority, MAJORITY_SIZE, new Set(), `${seed}:maj`);
    if (!three) return null;
    const one = pickDistinct(odd, 1, new Set(three.map((clip) => clip.reading)), `${seed}:odd`);
    return one ? { majority: three, odd: one[0]! } : null;
  };

  let chosen: { majority: T[]; odd: T } | null = null;
  let sameBook = false;
  const bookIds = seededShuffle(
    [...new Set([...majorityPool, ...oddPool].map((clip) => clip.bookId))],
    (id) => id,
    `${seed}:book`,
  );
  for (const bookId of bookIds) {
    chosen = attempt(
      majorityPool.filter((clip) => clip.bookId === bookId),
      oddPool.filter((clip) => clip.bookId === bookId),
    );
    if (chosen) {
      sameBook = true;
      break;
    }
  }
  if (!chosen) chosen = attempt(majorityPool, oddPool);
  if (!chosen) return null;

  const shuffled = seededShuffle(
    [...chosen.majority, chosen.odd],
    (clip) => `${clip.vocabularyItemId}:${clip.bookId}`,
    `${seed}:order`,
  );
  return {
    id: `${contrast.id}:${seed}`,
    contrast,
    clips: shuffled,
    oddIndex: shuffled.indexOf(chosen.odd),
    sameBook,
  };
}

/** A trial is worth `ODD_EAR_TRIAL_POINTS` minus one per wrong tap, never below 0. */
export function oddEarPointsAvailable(wrongCount: number): number {
  return Math.max(0, ODD_EAR_TRIAL_POINTS - wrongCount);
}

export interface OddEarHistoryEntry {
  attempts: number;
  misses: number;
}

/** Per shape-pair attempts/misses over the most recent Odd Ear Out rounds. */
export function buildOddEarHistory(
  rounds: readonly Pick<GameRound, 'timestamp' | 'items'>[],
  limit: number = ODD_EAR_HISTORY_ROUNDS,
): Map<string, OddEarHistoryEntry> {
  const history = new Map<string, OddEarHistoryEntry>();
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

/** Attempts on a shape pair before it can count as a "strong" contrast. */
const MATURE_ATTEMPTS = 4;

/**
 * Map a contrast's history onto the shared picker's `PickerStats` — same
 * reading as Particle Puzzle: `lapses` = recent misses, `retrievability` =
 * recent accuracy, `matureCards` = enough attempts to trust it.
 */
export function contrastStats(
  contrast: OddEarContrast,
  history: ReadonlyMap<string, OddEarHistoryEntry>,
): PickerStats {
  const entry = history.get(contrast.pairKey);
  if (!entry || entry.attempts === 0) {
    return { hasCard: false, lapses: 0, retrievability: null, matureCards: false };
  }
  return {
    hasCard: true,
    lapses: entry.misses,
    retrievability: 1 - entry.misses / entry.attempts,
    matureCards: entry.attempts >= MATURE_ATTEMPTS,
  };
}

export interface OddEarCandidate extends PickerCandidate {
  contrast: OddEarContrast;
}

export function buildContrastCandidates(
  clips: readonly OddEarClip[],
  history: ReadonlyMap<string, OddEarHistoryEntry>,
): OddEarCandidate[] {
  return findContrasts(clips).map((contrast) => ({
    id: contrast.id,
    contrast,
    stats: contrastStats(contrast, history),
  }));
}

/** The pitch payload cropped to a word's span and re-based to t=0, for drawing just that word's contour. */
export function cropPitchPayload(
  payload: PitchAnalysisPayload,
  span: TimeRangeMs,
): PitchAnalysisPayload {
  const start = span.startMs / 1000;
  const end = span.endMs / 1000;
  return {
    frames: payload.frames
      .filter((frame) => frame.timeSeconds >= start && frame.timeSeconds <= end)
      .map((frame) => ({ ...frame, timeSeconds: frame.timeSeconds - start })),
    medianHz: payload.medianHz,
    voicedRatio: payload.voicedRatio,
    durationSeconds: end - start,
  };
}

/** One-line "why this contrast" for the result screen. */
export function describeOddEarPick(
  signal: EffectiveGameSignal,
  contrast: OddEarContrast,
  history: ReadonlyMap<string, OddEarHistoryEntry>,
): string {
  const missed = history.get(contrast.pairKey)?.misses ?? 0;
  if (signal === 'weak' && missed > 0) {
    return `You've mixed these two shapes up before (${missed} miss${missed === 1 ? '' : 'es'}).`;
  }
  if (signal === 'strong') return "A contrast you've been hearing reliably.";
  return `A ${contrast.moraCount}-mora contrast.`;
}
