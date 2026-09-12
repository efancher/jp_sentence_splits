/**
 * Predicts a conjugated occurrence's pitch-accent downstep position, for
 * the `pitch_accent` review card (see getPitchAccentReviewCandidates in
 * ReviewPage.tsx) — never guesses: returns null for any (word class, form)
 * combination not yet confidently covered, same "stay silent rather than
 * assert something false" stance pitchAccentRules.ts already takes.
 *
 * Formulas below are ported from Wiktionary's `Module:ja-acc-table`
 * (en.wiktionary.org, CC-BY-SA/GFDL) — a real, audited rule engine used to
 * generate the accent tables shown on live Wiktionary entries, not a
 * from-scratch derivation. That module was consulted specifically because
 * this feature's first cut (v1, since revised) assumed an accented godan
 * verb's downstep simply "carries forward unchanged" (same absolute mora
 * index as the citation form) across negative/past-negative/ba-conditional —
 * reasoning from conjugation.ts's stem-preservation alone, without an
 * independent check. That assumption was **wrong**: per Wiktionary's
 * module, an accented verb's negative-form downstep actually lands one
 * mora *later* than the citation position (right before ない, not at the
 * old stem boundary), and an *unaccented* (heiban) verb's ba-form and
 * negative-past (なかった) forms are not flat — they acquire their own
 * downstep. See docs/STATUS.md for the correction and what shipped wrong
 * in the interim.
 *
 * Scope: GODAN VERBS ONLY, and only the three forms below whose accent is
 * a pure function of the citation accent per Wiktionary's own module.
 * Notably **te-form/past-tense (た) are excluded even for godan** — the
 * module doesn't compute their accent from a formula at all; it takes an
 * explicit, separately-sourced `te_form_accs` parameter, meaning even this
 * audited rule engine doesn't trust "same mora as citation" as safe to
 * assert without real per-word data. tara-form (which the module derives
 * from ta) is excluded for the same reason. Ichidan and i-adjectives are
 * excluded because their conjugation-accent rules involve additional
 * phonological conditioning (ichidan's て/た family retracts the accent one
 * mora earlier, with devoicing/moraic-ん exceptions; i-adjective negative/
 * past forms have their own documented exceptions) not yet ported here.
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

const SUPPORTED_GODAN_FORMS: ConjugationFormKey[] = [
  'plain_negative',
  'plain_past_negative',
  'ba_form',
];

export function predictInflectedPitchAccentPosition(
  input: PitchAccentShiftInput,
): number | null {
  if (input.wordClass !== 'godan' || !SUPPORTED_GODAN_FORMS.includes(input.formKey)) {
    return null;
  }

  const accentClass = classifyVerbAdjectiveAccent(input.citationPosition, input.citationMoraCount);
  if (accentClass === 'irregular') return null;
  const isUnaccented = accentClass === 'unaccented';

  switch (input.formKey) {
    case 'plain_negative':
      // ない always attaches with its own atamadaka accent: an accented
      // verb's downstep lands right before ない (one mora past the citation
      // stem boundary — citationMoraCount, not citationPosition), an
      // unaccented verb stays flat.
      return isUnaccented ? 0 : input.citationMoraCount;
    case 'ba_form':
      // ば induces an accent right before itself on an otherwise-heiban
      // verb (citationMoraCount = the mora right before ば); an accented
      // verb's downstep is unaffected — same absolute index as citation.
      return isUnaccented ? input.citationMoraCount : input.citationPosition;
    case 'plain_past_negative':
      // なかった, built from the negative form above: an unaccented verb's
      // negative was flat, but なかった still isn't — the downstep sits a
      // fixed 3 morae from the end (…な↓かった), independent of stem
      // length. An accented verb's negative was already downstepped right
      // before ない (citationMoraCount) and that carries straight through.
      return isUnaccented ? input.conjugatedMoraCount - 3 : input.citationMoraCount;
    default:
      return null;
  }
}
