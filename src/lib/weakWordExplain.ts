/**
 * Why a walked-through sentence is or is not being brought back for its weak
 * words (and so given a Word check). Read-only; mirrors the rules in
 * `findWeakWordRevisits` / `planWeakWordSentences` so the Home planner can show
 * the learner what stands between a sentence and a revisit.
 */
export interface WeakWordExplainInput {
  sentences: ReadonlyArray<{ sentenceId: string; preview: string; lastWalkedAt: string }>;
  wordsBySentence: ReadonlyMap<string, readonly string[]>;
  strengthByWord: ReadonlyMap<string, number>;
  expressionOf: (wordId: string) => string | undefined;
  now: Date;
  minGapDays: number;
  /** A word counts as weak at or above this weakness (`1 - strength`). */
  minWeakness: number;
}

export type WeakWordVerdict = 'eligible' | 'too_soon' | 'no_weak_word' | 'no_words';

export interface WeakWordExplanation {
  sentenceId: string;
  preview: string;
  daysSinceWalk: number;
  verdict: WeakWordVerdict;
  /** The weakest linked word and its strength (0–1), when the sentence has linked words. */
  weakest?: { expression: string; strength: number };
  /** One line saying what decides this sentence. */
  detail: string;
}

const VERDICT_ORDER: Record<WeakWordVerdict, number> = { eligible: 0, too_soon: 1, no_weak_word: 2, no_words: 3 };

export function explainWeakWordSentences(input: WeakWordExplainInput): WeakWordExplanation[] {
  const maxStrength = 1 - input.minWeakness;
  const rows = input.sentences.map((sentence): WeakWordExplanation => {
    const daysSinceWalk = (input.now.getTime() - Date.parse(sentence.lastWalkedAt)) / 86_400_000;
    const scored = [...new Set(input.wordsBySentence.get(sentence.sentenceId) ?? [])]
      .map((id) => ({ id, strength: input.strengthByWord.get(id) }))
      .filter((entry): entry is { id: string; strength: number } => entry.strength !== undefined)
      .sort((a, b) => a.strength - b.strength || a.id.localeCompare(b.id));
    const first = scored[0];
    const weakest = first ? { expression: input.expressionOf(first.id) ?? '?', strength: first.strength } : undefined;
    const base = { sentenceId: sentence.sentenceId, preview: sentence.preview, daysSinceWalk, ...(weakest ? { weakest } : {}) };
    if (!weakest) return { ...base, verdict: 'no_words', detail: 'No linked words with a strength yet.' };
    const weak = weakest.strength <= maxStrength;
    if (!weak) {
      return {
        ...base,
        verdict: 'no_weak_word',
        detail: `Weakest word ${weakest.expression} is at ${weakest.strength.toFixed(2)}; it needs to be at or below ${maxStrength.toFixed(2)}.`,
      };
    }
    if (daysSinceWalk < input.minGapDays) {
      const wait = Math.ceil(input.minGapDays - daysSinceWalk);
      return {
        ...base,
        verdict: 'too_soon',
        detail: `${weakest.expression} is weak (${weakest.strength.toFixed(2)}), but it was walked through ${Math.floor(daysSinceWalk)}d ago; eligible in ${wait}d.`,
      };
    }
    return {
      ...base,
      verdict: 'eligible',
      detail: `${weakest.expression} is weak (${weakest.strength.toFixed(2)}) and the walkthrough was ${Math.floor(daysSinceWalk)}d ago. Brought back when the book is in rotation, under its per-book cap and the plan has glossing time.`,
    };
  });
  return rows.sort(
    (a, b) =>
      VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] ||
      (a.weakest?.strength ?? 2) - (b.weakest?.strength ?? 2) ||
      a.sentenceId.localeCompare(b.sentenceId),
  );
}
