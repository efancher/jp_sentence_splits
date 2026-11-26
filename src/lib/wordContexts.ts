import { contextSignature, type LemmaSource } from './unknownLemmas';

/** Another sentence the learner has already studied that carries a word, offered as a fresh context for it. */
export interface WordContext {
  sentenceId: string;
  japanese: string;
  translation: string;
}

export interface ContextCandidate extends WordContext {
  suggestions: readonly LemmaSource[] | undefined;
}

/** Other contexts offered per word. */
export const WORD_CONTEXTS_PER_WORD = 2;

function normalizedText(japanese: string): string {
  return japanese.replace(/[\s、。，．,.!?！？「」『』…・ー〜~]/g, '');
}

/**
 * Up to `limit` already-studied sentences that carry `expression` in a context unlike the current sentence's and
 * unlike each other: a repeat of the same line (same content words, or same text apart from punctuation) is no new
 * context. Shorter sentences go first (an easier read). Pure; `candidates` should be introduced sentences only.
 */
export function pickOtherContexts(
  expression: string,
  current: ContextCandidate,
  candidates: readonly ContextCandidate[],
  limit: number = WORD_CONTEXTS_PER_WORD,
): WordContext[] {
  const taken = new Set([contextSignature(current.suggestions)]);
  const takenText = new Set([normalizedText(current.japanese)]);
  const picked: WordContext[] = [];
  const carrying = candidates
    .filter(
      (candidate) =>
        candidate.sentenceId !== current.sentenceId &&
        (candidate.suggestions ?? []).some((item) => item.selectedByDefault && item.expression === expression),
    )
    .sort((a, b) => a.japanese.length - b.japanese.length);
  for (const candidate of carrying) {
    if (picked.length >= limit) break;
    const signature = contextSignature(candidate.suggestions);
    const text = normalizedText(candidate.japanese);
    if (taken.has(signature) || takenText.has(text)) continue;
    taken.add(signature);
    takenText.add(text);
    picked.push({ sentenceId: candidate.sentenceId, japanese: candidate.japanese, translation: candidate.translation });
  }
  return picked;
}
