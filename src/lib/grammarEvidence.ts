import type { SentenceLearningEvent } from '../domain/types';
import { wordStrength, type WordEvidence } from './wordStrength';

/**
 * Evidence about grammar patterns from the learner's own "did you know it" taps in the reader. Same shape and
 * weights as word evidence (recall when the pattern was not explained on screen, recognition when it was) so the
 * two stay comparable; the facets are reused: `reading` stands for *spotting* the pattern as a construction and
 * `meaning` for understanding what it does in this sentence. Evidence steers selection only; it never grades a card.
 */
export type GrammarFacet = 'spot' | 'use';

export const GRAMMAR_SPOT_KEY_PREFIX = 'grammar-spot:';
export const GRAMMAR_USE_KEY_PREFIX = 'grammar-use:';

export function grammarFeedbackTargetKey(patternId: string, facet: GrammarFacet): string {
  return `${facet === 'spot' ? GRAMMAR_SPOT_KEY_PREFIX : GRAMMAR_USE_KEY_PREFIX}${patternId}`;
}

function parseKey(key: string | undefined): { patternId: string; facet: GrammarFacet } | undefined {
  if (!key) return undefined;
  if (key.startsWith(GRAMMAR_SPOT_KEY_PREFIX)) return { patternId: key.slice(GRAMMAR_SPOT_KEY_PREFIX.length), facet: 'spot' };
  if (key.startsWith(GRAMMAR_USE_KEY_PREFIX)) return { patternId: key.slice(GRAMMAR_USE_KEY_PREFIX.length), facet: 'use' };
  return undefined;
}

/** Evidence per grammar pattern id, from reader taps only. */
export function buildGrammarEvidence(
  events: readonly (Pick<SentenceLearningEvent, 'timestamp' | 'action'> & Partial<Pick<SentenceLearningEvent, 'target' | 'support' | 'outcome'>>)[],
): Map<string, WordEvidence[]> {
  const out = new Map<string, WordEvidence[]>();
  for (const event of events) {
    if (event.action !== 'target_practice' || !event.outcome) continue;
    const parsed = parseKey(event.target?.key);
    const at = Date.parse(event.timestamp);
    if (!parsed || Number.isNaN(at)) continue;
    const kind = event.support === 'target_masked' ? 'recall' : event.support === 'explanation_hidden' ? 'recognition' : undefined;
    if (!kind) continue;
    const evidence: WordEvidence = {
      wordId: parsed.patternId,
      facet: parsed.facet === 'spot' ? 'reading' : 'meaning',
      kind,
      at,
      success: event.outcome === 'got_it',
    };
    const list = out.get(parsed.patternId);
    if (list) list.push(evidence);
    else out.set(parsed.patternId, [evidence]);
  }
  return out;
}

/** Strength in [0, 1) of one facet of one pattern; 0 is no evidence. */
export function grammarStrength(evidence: readonly WordEvidence[], facet: GrammarFacet, now: number): number {
  return wordStrength(evidence, facet === 'spot' ? 'reading' : 'meaning', now);
}
