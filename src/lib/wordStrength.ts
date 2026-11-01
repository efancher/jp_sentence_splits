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
} as const;

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
  config = WORD_STRENGTH_CONFIG,
): number {
  let score = 0;
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
    const weight =
      item.kind === 'recall'
        ? item.success
          ? config.recallSuccess
          : -config.recallFailure
        : item.success
          ? config.recognitionSuccess
          : -config.recognitionFailure;
    score += weight * decay(now - item.at, config.halfLifeDays[item.kind]);
  }
  const newestFirst = [...exposureBySentence.values()].sort((a, b) => b - a);
  for (const at of newestFirst.slice(0, config.readingExposureSentenceCap)) {
    score += config.readingExposurePerSentence * decay(now - at, config.halfLifeDays.exposure);
  }
  return 1 - Math.exp(-Math.max(0, score));
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
  options: { facets?: readonly WordFacet[]; limit?: number } = {},
): AtRiskWord[] {
  const facets = options.facets ?? (['reading', 'meaning'] as const);
  const ranked: AtRiskWord[] = [];
  for (const wordId of wordIds) {
    const evidence = evidenceByWord.get(wordId) ?? [];
    for (const facet of facets) {
      ranked.push({ wordId, facet, strength: wordStrength(evidence, facet, now) });
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
