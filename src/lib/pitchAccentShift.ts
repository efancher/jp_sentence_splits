/**
 * Predicts a conjugated occurrence's pitch-accent downstep position, for
 * the `pitch_accent` review card and the ambient "H/L marks" display
 * (see resolveInflectedPitchAccent below and getPitchAccentReviewCandidates
 * in ReviewPage.tsx) — never guesses: returns null for any (word class,
 * form) combination not yet confidently covered, same "stay silent rather
 * than assert something false" stance pitchAccentRules.ts already takes.
 *
 * Formulas below are ported from Wiktionary's `Module:ja-acc-table`
 * (en.wiktionary.org, CC-BY-SA/GFDL) — a real, audited rule engine used to
 * generate the accent tables shown on live Wiktionary entries — and each
 * one is independently verified against that module's own *live rendered
 * output* for at least one heiban and one accented real word per word
 * class (fetched with `curl`, not `WebFetch` — see docs/STATUS.md for why
 * that distinction mattered here). Words used: 走る/買う (godan),
 * 食べる/開ける (ichidan), 高い/甘い (i-adjective). See
 * fixtures/pitch-accent-shift-fixtures.json for the exact verified rows.
 *
 * Coverage is deliberately narrow and asymmetric between word classes —
 * each gap below is a real limit of what's *safely derivable from the
 * citation accent alone*, not an oversight:
 *
 * - **-masu family (polite_present/polite_past/polite_negative), godan
 *   and ichidan**: the one case that doesn't even need to know whether
 *   the citation form is heiban or accented — ます/ました/ません always
 *   land at a fixed offset from the stem's own mora count. Verified
 *   identical across both accent classes for both word classes.
 *   `polite_past_negative` (ませんでした) isn't built by Wiktionary's
 *   module at all — excluded.
 * - **godan plain_negative/ba_form/plain_past_negative**: shipped first
 *   (see the two-round correction in docs/STATUS.md 2026-09-12). An
 *   accented verb's negative lands one mora *past* the citation position
 *   (right before ない); an unaccented verb's ba-form/past-negative are
 *   *not* flat.
 * - **ichidan plain_negative/ba_form**: same shape as godan's ba_form,
 *   but plain_negative differs — an accented ichidan verb's negative
 *   downstep stays at the *unchanged* citation position (not +1 like
 *   godan). `plain_past_negative` isn't verified for ichidan and stays
 *   excluded. te-form/plain-past/tara-form are excluded for every word
 *   class including godan — Wiktionary's own module sources those from
 *   external per-word data, not a formula, meaning even this audited
 *   engine doesn't trust "same mora as citation" as safe to assert.
 * - **i-adjective polite (〜いです)**: a full, clean, dual-branch formula
 *   like godan/ichidan ba_form.
 * - **i-adjective plain_negative/plain_past_negative, HEIBAN ONLY**: an
 *   accented i-adjective's negative is a genuine *two-accent*
 *   realization (the く-stem's own downstep plus ない's own atamadaka
 *   accent, independently) — not representable as a single position
 *   number. Confirmed by inspecting Wiktionary's own module: its code
 *   for exactly this case is a broken placeholder (string concatenation
 *   where a number belongs), not a working formula. Excluding it isn't
 *   just caution — the "correct" single answer doesn't exist in this
 *   model.
 * - **い-adjective te_form/plain_past/ba_form (kute/katta/kereba)**:
 *   external per-word data only, for every accent class including
 *   heiban — same reason as verb te-form.
 * - Irregular いい/よい, suru, kuru, na_adjective, potential/passive/
 *   causative (derive a new verb with its own accent): not attempted.
 */

import type { ConjugationFormKey, ConjugationWordClass } from './conjugation';
import { classifyVerbAdjectiveAccent } from './pitchAccentRules';

export interface PitchAccentShiftInput {
  wordClass: ConjugationWordClass;
  formKey: ConjugationFormKey;
  /** Dictionary reading — checked against the irregular いい/よい closed class, which conjugates via wholesale irregular forms rather than a formula. */
  citationReading: string;
  /** Dictionary accent nucleus: 0 = heiban, N = downstep after mora N. */
  citationPosition: number;
  citationMoraCount: number;
  /** The conjugated reading's own mora count — the prediction is expressed in this space. */
  conjugatedMoraCount: number;
}

const IRREGULAR_I_ADJECTIVE_READINGS = new Set(['いい', 'よい']);

/** ます/ました's own downstep — independent of the citation form's accent class, only its stem mora count. */
function politeStemPosition(wordClass: 'godan' | 'ichidan', citationMoraCount: number): number {
  return wordClass === 'godan' ? citationMoraCount + 1 : citationMoraCount;
}

/** ば's own induced accent on an otherwise-heiban word; unaffected (same absolute index) for an accented one. Shared shape across godan and ichidan. */
function baFormPosition(isUnaccented: boolean, citationPosition: number, citationMoraCount: number): number {
  return isUnaccented ? citationMoraCount : citationPosition;
}

function predictVerbPosition(
  wordClass: 'godan' | 'ichidan',
  formKey: ConjugationFormKey,
  citationPosition: number,
  citationMoraCount: number,
  conjugatedMoraCount: number,
): number | null {
  const accentClass = classifyVerbAdjectiveAccent(citationPosition, citationMoraCount);
  if (accentClass === 'irregular') return null;
  const isUnaccented = accentClass === 'unaccented';

  switch (formKey) {
    case 'polite_present':
    case 'polite_past':
      return politeStemPosition(wordClass, citationMoraCount);
    case 'polite_negative':
      return politeStemPosition(wordClass, citationMoraCount) + 1;
    case 'ba_form':
      return baFormPosition(isUnaccented, citationPosition, citationMoraCount);
    case 'plain_negative':
      if (wordClass === 'godan') {
        // ない always attaches with its own atamadaka accent: an accented
        // verb's downstep lands right before ない (one mora past the
        // citation stem boundary), an unaccented verb stays flat.
        return isUnaccented ? 0 : citationMoraCount;
      }
      // Ichidan: the downstep stays at the unchanged citation position —
      // different from godan's +1 shift.
      return isUnaccented ? 0 : citationMoraCount - 1;
    case 'plain_past_negative':
      if (wordClass !== 'godan') return null; // not verified for ichidan
      // なかった, built from the negative form above: an unaccented verb's
      // negative was flat, but なかった still isn't — the downstep sits a
      // fixed 3 morae from the end. An accented verb's negative was
      // already downstepped right before ない and that carries straight through.
      return isUnaccented ? conjugatedMoraCount - 3 : citationMoraCount;
    default:
      return null;
  }
}

function predictIAdjectivePosition(
  formKey: ConjugationFormKey,
  citationPosition: number,
  citationMoraCount: number,
): number | null {
  const accentClass = classifyVerbAdjectiveAccent(citationPosition, citationMoraCount);
  if (accentClass === 'irregular') return null;
  const isUnaccented = accentClass === 'unaccented';

  switch (formKey) {
    case 'polite':
      return isUnaccented ? citationMoraCount - 1 : citationPosition;
    case 'plain_negative':
    case 'plain_past_negative':
      // Accented i-adjectives realize this as two independent downsteps
      // (the く-stem's own plus ない's atamadaka) — not one position.
      return isUnaccented ? citationMoraCount + 1 : null;
    default:
      return null;
  }
}

export function predictInflectedPitchAccentPosition(
  input: PitchAccentShiftInput,
): number | null {
  if (input.wordClass === 'i_adjective' && IRREGULAR_I_ADJECTIVE_READINGS.has(input.citationReading)) {
    return null;
  }
  if (input.wordClass === 'godan' || input.wordClass === 'ichidan') {
    return predictVerbPosition(
      input.wordClass,
      input.formKey,
      input.citationPosition,
      input.citationMoraCount,
      input.conjugatedMoraCount,
    );
  }
  if (input.wordClass === 'i_adjective') {
    return predictIAdjectivePosition(input.formKey, input.citationPosition, input.citationMoraCount);
  }
  return null;
}
