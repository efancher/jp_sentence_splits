import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { conjugate, type ConjugationFormKey, type ConjugationWordClass } from '../src/lib/conjugation';
import { segmentIntoMorae } from '../src/lib/mora';
import { predictInflectedPitchAccentPosition } from '../src/lib/pitchAccentShift';

interface PitchAccentShiftFixture {
  expression: string;
  reading: string;
  wordClass: ConjugationWordClass;
  citationPosition: number;
  formKey: ConjugationFormKey;
  expectedReading: string;
  expectedPosition: number;
  note: string;
}

// Hand-curated against Wiktionary's Module:ja-acc-table (en.wiktionary.org,
// CC-BY-SA/GFDL) — a real, audited rule engine, not derived from the code
// under test. Godan-only scope, and only plain_negative/ba_form/
// plain_past_negative — see pitchAccentShift.ts's doc comment for why
// te-form/plain-past/tara-form and ichidan/i-adjective aren't covered
// (the module itself doesn't trust a formula for those without real
// per-word data).
const fixtures = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../fixtures/pitch-accent-shift-fixtures.json'), 'utf8'),
) as PitchAccentShiftFixture[];

describe('predictInflectedPitchAccentPosition (godan fixtures, verified against Module:ja-acc-table)', () => {
  it('has the expected fixture count', () => {
    expect(fixtures).toHaveLength(6);
  });

  it.each(fixtures)(
    '$wordClass $formKey: $expression ($reading, pos $citationPosition) -> $expectedReading (pos $expectedPosition) [$note]',
    ({ expression, reading, wordClass, citationPosition, formKey, expectedReading, expectedPosition }) => {
      // Cross-check the fixture's own expectedReading against the
      // already-trusted conjugation engine, so a stale/typo'd fixture
      // reading can't silently validate the wrong mora count.
      const conjugated = conjugate(expression, reading, wordClass, formKey);
      expect(conjugated?.reading).toBe(expectedReading);

      const citationMoraCount = segmentIntoMorae(reading).length;
      const conjugatedMoraCount = segmentIntoMorae(expectedReading).length;
      const predicted = predictInflectedPitchAccentPosition({
        wordClass,
        formKey,
        citationPosition,
        citationMoraCount,
        conjugatedMoraCount,
      });
      expect(predicted).toBe(expectedPosition);
    },
  );
});

describe('predictInflectedPitchAccentPosition (excluded combinations stay silent)', () => {
  it('returns null for godan -masu forms (a real neutralizing shift, not a carry-forward)', () => {
    expect(
      predictInflectedPitchAccentPosition({
        wordClass: 'godan',
        formKey: 'polite_present',
        citationPosition: 0,
        citationMoraCount: 2,
        conjugatedMoraCount: 4,
      }),
    ).toBeNull();
  });

  it('returns null for ichidan (retraction rule not yet implemented)', () => {
    expect(
      predictInflectedPitchAccentPosition({
        wordClass: 'ichidan',
        formKey: 'te_form',
        citationPosition: 2,
        citationMoraCount: 3,
        conjugatedMoraCount: 3,
      }),
    ).toBeNull();
  });

  it('returns null for i_adjective (negative/past exceptions not yet implemented)', () => {
    expect(
      predictInflectedPitchAccentPosition({
        wordClass: 'i_adjective',
        formKey: 'plain_negative',
        citationPosition: 2,
        citationMoraCount: 3,
        conjugatedMoraCount: 5,
      }),
    ).toBeNull();
  });

  it('returns null for na_adjective/suru/kuru (no two-class system to build on)', () => {
    expect(
      predictInflectedPitchAccentPosition({
        wordClass: 'na_adjective',
        formKey: 'plain_negative',
        citationPosition: 0,
        citationMoraCount: 2,
        conjugatedMoraCount: 5,
      }),
    ).toBeNull();
    expect(
      predictInflectedPitchAccentPosition({
        wordClass: 'suru',
        formKey: 'te_form',
        citationPosition: 0,
        citationMoraCount: 2,
        conjugatedMoraCount: 2,
      }),
    ).toBeNull();
  });

  it('returns null for potential/passive/causative (derive a new verb with its own accent)', () => {
    expect(
      predictInflectedPitchAccentPosition({
        wordClass: 'godan',
        formKey: 'potential',
        citationPosition: 2,
        citationMoraCount: 3,
        conjugatedMoraCount: 5,
      }),
    ).toBeNull();
  });

  it('returns null for a godan word whose citation accent is neither heiban nor edge-accented (irregular)', () => {
    expect(
      predictInflectedPitchAccentPosition({
        wordClass: 'godan',
        formKey: 'ba_form',
        citationPosition: 1,
        citationMoraCount: 3,
        conjugatedMoraCount: 4,
      }),
    ).toBeNull();
  });

  it('returns null for godan te-form/plain-past/tara-form (Module:ja-acc-table sources these from real per-word data, not a formula)', () => {
    for (const formKey of ['te_form', 'plain_past', 'tara_form'] as const) {
      expect(
        predictInflectedPitchAccentPosition({
          wordClass: 'godan',
          formKey,
          citationPosition: 0,
          citationMoraCount: 2,
          conjugatedMoraCount: 3,
        }),
      ).toBeNull();
    }
  });
});
