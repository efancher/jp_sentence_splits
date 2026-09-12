/**
 * Predicts a conjugated occurrence's pitch-accent downstep position, for
 * the `pitch_accent` review card (see getPitchAccentReviewCandidates in
 * ReviewPage.tsx) — never guesses: returns null for any (word class, form)
 * combination not yet confidently covered, same "stay silent rather than
 * assert something false" stance pitchAccentRules.ts already takes.
 *
 * Scope is deliberately narrow — GODAN VERBS ONLY. The original v1 design
 * assumed a uniform "the stem is reproduced verbatim, so an accented word's
 * downstep just carries forward at the same absolute mora index" rule for
 * godan, ichidan, and i-adjectives alike. Cross-checking that against real
 * pitch-accent references (OJAD-derived conjugation rules) before shipping
 * — per this module's own "verify before trusting" mandate — surfaced that
 * it's wrong for the other two:
 *
 * - Ichidan's て/た/ば/たら family actually RETRACTS the accent one mora
 *   earlier than the dictionary form (たべ↓る → た↓べて, not たべ↓て), with
 *   further exceptions when the retracted mora would be devoiced or moraic
 *   ん (つけ↓る/つけ↓て doesn't move; ぞんじ↓る/ぞ↓んじて moves back two).
 *   Getting this right needs the actual retraction+exception rules, not the
 *   "stays put" formula below.
 * - I-adjective negative/past forms have their own well-documented
 *   exceptions to the "once accented, always accented on the same mora"
 *   generalization.
 *
 * Godan is the one case multiple independent sources agree on without
 * caveats: an accented godan verb's downstep stays on the same mora
 * (relative to the unchanged stem) straight through negative, past,
 * te-form (even though te-form itself undergoes euphonic sound change —
 * 買う→買って — the *accent* isn't affected by that), and the ba/tara
 * conditionals built the same way. Ichidan and i-adjective support is
 * deferred to a follow-up that can properly source the retraction and
 * exception rules (docs/ROADMAP.md).
 *
 * Deliberately NOT attempted: ichidan/i-adjective (see above), godan -masu
 * forms (a real neutralizing shift — always accented right before ます
 * regardless of lexical class), potential/passive/causative (derive a new
 * verb with its own accent), suru, kuru, na_adjective (no two-class system
 * to build on).
 */

import type { ConjugationFormKey, ConjugationWordClass } from './conjugation';
import { classifyVerbAdjectiveAccent } from './pitchAccentRules';

export interface PitchAccentShiftInput {
  wordClass: ConjugationWordClass;
  formKey: ConjugationFormKey;
  /** Dictionary accent nucleus: 0 = heiban, N = downstep after mora N. */
  citationPosition: number;
  citationMoraCount: number;
  /** The conjugated reading's own mora count — the prediction is expressed in this space. */
  conjugatedMoraCount: number;
}

const GODAN_STEM_PRESERVED_FORMS: ConjugationFormKey[] = [
  'plain_negative',
  'plain_past',
  'plain_past_negative',
  'te_form',
  'ba_form',
  'tara_form',
];

export function predictInflectedPitchAccentPosition(
  input: PitchAccentShiftInput,
): number | null {
  if (input.wordClass !== 'godan' || !GODAN_STEM_PRESERVED_FORMS.includes(input.formKey)) {
    return null;
  }

  const accentClass = classifyVerbAdjectiveAccent(input.citationPosition, input.citationMoraCount);
  if (accentClass === 'irregular') return null;
  if (accentClass === 'unaccented') return 0;
  return Math.min(input.citationPosition, input.conjugatedMoraCount);
}
