/**
 * Word strength: a per-word, per-facet estimate of how well a learner can
 * recall a word's reading or meaning, built from evidence of different
 * quality. It never produces due dates — the sentence FSRS schedule stays the
 * only "when". The estimate only answers "which words are weak" and "which
 * sentences cover the most weak words", so surfaces (planner, reader) can
 * choose what to show without a second scheduler.
 *
 * Weights come from the 2026-11-01 read-only review history check (3,960
 * reviews): reading recall failed far less for words seen in many sentences
 * (about 34% again in one sentence, 15% in five or more), so distinct-sentence
 * exposure counts for readings with diminishing returns. Meaning recall did
 * not improve with exposure and a right multiple-choice pick did not predict
 * the next review, so meaning only learns from recall, and recognition counts
 * for almost nothing. These are tunable defaults, not measured constants.
 *
 * Pure: takes already-fetched evidence. Ratings stay explicit learner choices;
 * evidence here steers selection and never grades a card.
 */

export type WordFacet = 'reading' | 'meaning';

/**
 * `exposure`: the word was seen/heard in a sentence (needs `sentenceId`).
 * `recognition`: picked from options (multiple choice) — easy to guess.
 * `recall`: produced from memory (typed reading/meaning, hidden-furigana recall).
 */
export type EvidenceKind = 'exposure' | 'recognition' | 'recall';

export interface WordEvidence {
  wordId: string;
  facet: WordFacet;
  kind: EvidenceKind;
  /** Epoch milliseconds. */
  at: number;
  /** Required for `exposure`; used to count distinct sentences. Ignored otherwise. */
  sentenceId?: string;
  /** Outcome for `recognition` and `recall`. Ignored for `exposure`. */
  success?: boolean;
}

export const WORD_STRENGTH_CONFIG = {
  /** Strength from a successful recall. */
  recallSuccess: 1,
  /** A failed recall subtracts this much. */
  recallFailure: 1,
  /** A right multiple-choice pick barely counts. */
  recognitionSuccess: 0.1,
  /** A wrong pick is informative: it tracked the learner's own "again" 76% of the time. */
  recognitionFailure: 0.5,
  /** Each distinct sentence adds this to a word's reading strength... */
  readingExposurePerSentence: 0.25,
  /** ...up to this many sentences (diminishing returns past it). */
  readingExposureSentenceCap: 5,
  /** Half-lives in days; older evidence counts for less. */
  halfLifeDays: { exposure: 21, recognition: 7, recall: 30 } as Record<EvidenceKind, number>,
  /**
   * Failures are remembered for a shorter time than successes, and the total
   * penalty is capped, so a word failed many times long ago recovers toward
   * its prior instead of staying pinned at zero (the clamp would hide the
   * recovery otherwise). Recent failures still weigh in full.
   */
  failureHalfLifeDays: 14,
  failurePenaltyCap: 1.5,
} as const;

/**
 * Reading strength at which the reader treats a word as known: it drops the
 * word's furigana and its word-help entry. About two recent successful recalls,
 * or a very common word that has been met and not failed. Below it the word
 * keeps its scaffolding, so help fades as a word strengthens and returns after
 * failures or long gaps.
 */
export const READER_KNOWN_STRENGTH = 0.6;

/** How much evidence there is on an item: none yet, some but below the known line, or at/above it. */
export type EvidenceLevel = 'unchecked' | 'shaky' | 'solid';

export function evidenceLevel(strength: number | undefined): EvidenceLevel {
  if (strength === undefined) return 'unchecked';
  return strength >= READER_KNOWN_STRENGTH ? 'solid' : 'shaky';
}

const DAY_MS = 86_400_000;

function decay(ageMs: number, halfLifeDays: number): number {
  if (ageMs <= 0) return 1;
  return Math.pow(0.5, ageMs / (halfLifeDays * DAY_MS));
}

/**
 * Strength in [0, 1) of one facet of one word. 0 is no usable evidence;
 * a single recent successful recall gives about 0.63, two about 0.86.
 */
export function wordStrength(
  evidence: readonly WordEvidence[],
  facet: WordFacet,
  now: number,
  options: { config?: typeof WORD_STRENGTH_CONFIG; prior?: number } = {},
): number {
  const config = options.config ?? WORD_STRENGTH_CONFIG;
  // The prior is a starting score that never decays; evidence moves the word away from it.
  let score = options.prior ?? 0;
  let failurePenalty = 0;
  // Exposure counts distinct sentences, each at its most recent sighting.
  const exposureBySentence = new Map<string, number>();
  for (const item of evidence) {
    if (item.facet !== facet) continue;
    if (item.kind === 'exposure') {
      if (facet !== 'reading' || !item.sentenceId) continue;
      const seen = exposureBySentence.get(item.sentenceId);
      if (seen === undefined || item.at > seen) exposureBySentence.set(item.sentenceId, item.at);
      continue;
    }
    if (item.success) {
      const weight = item.kind === 'recall' ? config.recallSuccess : config.recognitionSuccess;
      score += weight * decay(now - item.at, config.halfLifeDays[item.kind]);
    } else {
      const weight = item.kind === 'recall' ? config.recallFailure : config.recognitionFailure;
      failurePenalty += weight * decay(now - item.at, config.failureHalfLifeDays);
    }
  }
  score -= Math.min(failurePenalty, config.failurePenaltyCap);
  const newestFirst = [...exposureBySentence.values()].sort((a, b) => b - a);
  for (const at of newestFirst.slice(0, config.readingExposureSentenceCap)) {
    score += config.readingExposurePerSentence * decay(now - at, config.halfLifeDays.exposure);
  }
  return 1 - Math.exp(-Math.max(0, score));
}

/**
 * A starting score from a word's general-language frequency, so common words
 * begin stronger than rare ones before any of the learner's own evidence
 * exists. `band` is a JMdict `nf` band (1 = the ~500 most frequent words ...
 * 48 = ~24,000th), `'priority'` is a JMdict priority tag without a band
 * (news1/ichi1/spec1/gai1 and similar), and null/undefined is no tag at all.
 * Kept small on purpose: a single failed recall (-1) outweighs the largest
 * prior (0.8), so the learner's own history wins.
 */
export function frequencyBandPrior(band: number | 'priority' | null | undefined): number {
  if (band === 'priority') return 0.3;
  if (band === null || band === undefined || band < 1) return 0;
  if (band > 48) return 0;
  return (0.8 * (49 - band)) / 48;
}

export interface AtRiskWord {
  wordId: string;
  facet: WordFacet;
  strength: number;
}

/**
 * Weakest word/facet pairs first. Words with no evidence at all rank as
 * strength 0 so newly introduced words are surfaced too.
 */
export function rankAtRiskWords(
  wordIds: readonly string[],
  evidenceByWord: ReadonlyMap<string, readonly WordEvidence[]>,
  now: number,
  options: {
    facets?: readonly WordFacet[];
    limit?: number;
    /** Starting score per word, e.g. from `frequencyBandPrior`; missing words start at 0. */
    priorByWord?: ReadonlyMap<string, number>;
  } = {},
): AtRiskWord[] {
  const facets = options.facets ?? (['reading', 'meaning'] as const);
  const ranked: AtRiskWord[] = [];
  for (const wordId of wordIds) {
    const evidence = evidenceByWord.get(wordId) ?? [];
    for (const facet of facets) {
      const prior = options.priorByWord?.get(wordId);
      ranked.push({ wordId, facet, strength: wordStrength(evidence, facet, now, { prior }) });
    }
  }
  ranked.sort((a, b) => a.strength - b.strength || a.wordId.localeCompare(b.wordId) || a.facet.localeCompare(b.facet));
  return options.limit === undefined ? ranked : ranked.slice(0, options.limit);
}

export interface SentenceWords {
  sentenceId: string;
  wordIds: readonly string[];
}

/**
 * Greedily picks up to `count` sentences that together cover the most weak
 * words. A word's weight is `1 - strength` (its weakest facet), counted once
 * across the whole pick, so ten sentences sharing one weak word do not crowd
 * out sentences with other weak words. Sentences that add no weight are not
 * returned. Ties break by sentence id for stable output.
 */
export function chooseSentencesForWeakWords(
  sentences: readonly SentenceWords[],
  weakness: ReadonlyMap<string, number>,
  count: number,
): string[] {
  const covered = new Set<string>();
  const chosen: string[] = [];
  const remaining = [...sentences].sort((a, b) => a.sentenceId.localeCompare(b.sentenceId));
  while (chosen.length < count && remaining.length > 0) {
    let bestIndex = -1;
    let bestGain = 0;
    for (let i = 0; i < remaining.length; i += 1) {
      let gain = 0;
      for (const wordId of new Set(remaining[i]!.wordIds)) {
        if (!covered.has(wordId)) gain += weakness.get(wordId) ?? 0;
      }
      if (gain > bestGain) {
        bestGain = gain;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) break;
    const [pick] = remaining.splice(bestIndex, 1);
    chosen.push(pick!.sentenceId);
    for (const wordId of pick!.wordIds) covered.add(wordId);
  }
  return chosen;
}

export interface WeakWordSentencePlan {
  /** Sentence ids in pick order: the first covers the most weakness, each next adds the most still-uncovered. */
  order: string[];
  /** For each picked sentence, its weak word ids, weakest first, capped at `maxWordsListed`. */
  weakWordsBySentence: Map<string, string[]>;
}

/**
 * Chooses which of `sentences` to surface for their weak words. Only words at
 * or above `minWeakness` (`1 - strength`) count, so a sentence of mostly known
 * words is never picked just because one is slightly shaky. Selection only: it
 * says nothing about when a sentence is due.
 */
export function planWeakWordSentences(
  sentences: readonly SentenceWords[],
  strengthByWord: ReadonlyMap<string, number>,
  options: { limit?: number; minWeakness?: number; maxWordsListed?: number } = {},
): WeakWordSentencePlan {
  const minWeakness = options.minWeakness ?? 0.7;
  const maxWordsListed = options.maxWordsListed ?? 3;
  const weakness = new Map<string, number>();
  for (const [wordId, strength] of strengthByWord) {
    if (1 - strength >= minWeakness) weakness.set(wordId, 1 - strength);
  }
  const order = chooseSentencesForWeakWords(sentences, weakness, options.limit ?? sentences.length);
  const bySentence = new Map(sentences.map((sentence) => [sentence.sentenceId, sentence]));
  const weakWordsBySentence = new Map<string, string[]>();
  for (const sentenceId of order) {
    const words = [...new Set(bySentence.get(sentenceId)!.wordIds)]
      .filter((wordId) => weakness.has(wordId))
      .sort((a, b) => weakness.get(b)! - weakness.get(a)! || a.localeCompare(b));
    weakWordsBySentence.set(sentenceId, words.slice(0, maxWordsListed));
  }
  return { order, weakWordsBySentence };
}
