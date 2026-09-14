import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { conjugate, type ConjugationFormKey, type ConjugationWordClass } from '../src/lib/conjugation';
import { segmentIntoMorae } from '../src/lib/mora';
import {
  predictInflectedPitchAccentPosition,
  resolveInflectedPitchAccent,
} from '../src/lib/pitchAccentShift';

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
// CC-BY-SA/GFDL) — a real, audited rule engine — and each row's
// expectedPosition is independently cross-checked against that module's
// own live-rendered romaji for the real word (fetched with `curl`, not
// re-derived from the Lua source or from search). Covers godan (走る/買う),
// ichidan (食べる/開ける), and i-adjective (高い/甘い). See
// pitchAccentShift.ts's doc comment for exactly what's excluded and why.
const fixtures = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../fixtures/pitch-accent-shift-fixtures.json'), 'utf8'),
) as PitchAccentShiftFixture[];

describe('predictInflectedPitchAccentPosition (fixtures, verified against Module:ja-acc-table)', () => {
  it('has the expected fixture count', () => {
    expect(fixtures).toHaveLength(26);
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
        citationReading: reading,
        citationPosition,
        citationMoraCount,
        conjugatedMoraCount,
      });
      expect(predicted).toBe(expectedPosition);
    },
  );
});

describe('predictInflectedPitchAccentPosition (te-form override, from VocabularyItem.teFormAccentPosition)', () => {
  // Real per-word data, not a formula — 走る does not retract, 食べる does.
  // Verified against Wiktionary's live "Extended conjugation" table
  // (docs/STATUS.md 2026-09-13): 走って keeps 走る's citation downstep
  // (mora 2); 食べて retracts one mora earlier than 食べる's (mora 2 -> 1).
  it('te_form: uses the stored per-word value directly, not the citation position', () => {
    expect(
      predictInflectedPitchAccentPosition({
        wordClass: 'godan',
        formKey: 'te_form',
        citationReading: 'はしる',
        citationPosition: 2,
        citationMoraCount: 3,
        conjugatedMoraCount: 4, // はしって
        teFormAccentPosition: 2,
      }),
    ).toBe(2);

    expect(
      predictInflectedPitchAccentPosition({
        wordClass: 'ichidan',
        formKey: 'te_form',
        citationReading: 'たべる',
        citationPosition: 2,
        citationMoraCount: 3,
        conjugatedMoraCount: 3, // たべて
        teFormAccentPosition: 1, // retracted from citation's 2
      }),
    ).toBe(1);
  });

  it('plain_past: reuses the te-form value directly (て/で vs た/だ is always a same-mora swap)', () => {
    expect(
      predictInflectedPitchAccentPosition({
        wordClass: 'godan',
        formKey: 'plain_past',
        citationReading: 'かう',
        citationPosition: 0,
        citationMoraCount: 2,
        conjugatedMoraCount: 3, // かった
        teFormAccentPosition: 0,
      }),
    ).toBe(0);
  });

  it('tara_form: heiban te gains its own accent right before the added ら (mora count of the ta-form itself)', () => {
    // 買ったら [kàttáꜜrà] — real data: drop after mora 3 (た), i.e.
    // conjugatedMoraCount(かったら=4) - 1 = 3.
    expect(
      predictInflectedPitchAccentPosition({
        wordClass: 'godan',
        formKey: 'tara_form',
        citationReading: 'かう',
        citationPosition: 0,
        citationMoraCount: 2,
        conjugatedMoraCount: 4, // かったら
        teFormAccentPosition: 0,
      }),
    ).toBe(3);
  });

  it('tara_form: an accented te-form carries its downstep straight through unchanged', () => {
    // 走ったら [hàshíꜜttàrà] — real data: drop after mora 2 (し), same as
    // citation and te-form, not shifted by the added ら.
    expect(
      predictInflectedPitchAccentPosition({
        wordClass: 'godan',
        formKey: 'tara_form',
        citationReading: 'はしる',
        citationPosition: 2,
        citationMoraCount: 3,
        conjugatedMoraCount: 5, // はしったら
        teFormAccentPosition: 2,
      }),
    ).toBe(2);
  });

  it('without a stored value, te_form/plain_past/tara_form keep returning null exactly as before', () => {
    for (const formKey of ['te_form', 'plain_past', 'tara_form'] as const) {
      expect(
        predictInflectedPitchAccentPosition({
          wordClass: 'godan',
          formKey,
          citationReading: 'かう',
          citationPosition: 0,
          citationMoraCount: 2,
          conjugatedMoraCount: 3,
          // teFormAccentPosition omitted
        }),
      ).toBeNull();
    }
  });
});

describe('predictInflectedPitchAccentPosition (excluded combinations stay silent)', () => {
  it('returns null for polite_past_negative on any word class (Module:ja-acc-table does not build this node at all)', () => {
    for (const wordClass of ['godan', 'ichidan'] as const) {
      expect(
        predictInflectedPitchAccentPosition({
          wordClass,
          formKey: 'polite_past_negative',
          citationReading: 'x',
          citationPosition: 0,
          citationMoraCount: 2,
          conjugatedMoraCount: 6,
        }),
      ).toBeNull();
    }
  });

  it('returns null for ichidan plain_past_negative (not verified this pass)', () => {
    expect(
      predictInflectedPitchAccentPosition({
        wordClass: 'ichidan',
        formKey: 'plain_past_negative',
        citationReading: 'x',
        citationPosition: 2,
        citationMoraCount: 3,
        conjugatedMoraCount: 7,
      }),
    ).toBeNull();
  });

  it('returns null for accented i_adjective plain_negative/plain_past_negative (a genuine two-accent realization, not one position)', () => {
    for (const formKey of ['plain_negative', 'plain_past_negative'] as const) {
      expect(
        predictInflectedPitchAccentPosition({
          wordClass: 'i_adjective',
          formKey,
          citationReading: 'たかい',
          citationPosition: 2,
          citationMoraCount: 3,
          conjugatedMoraCount: 5,
        }),
      ).toBeNull();
    }
  });

  it('returns null for i_adjective te_form/plain_past/ba_form (external per-word data only, every accent class)', () => {
    for (const formKey of ['te_form', 'plain_past', 'ba_form'] as const) {
      expect(
        predictInflectedPitchAccentPosition({
          wordClass: 'i_adjective',
          formKey,
          citationReading: 'あまい',
          citationPosition: 0,
          citationMoraCount: 3,
          conjugatedMoraCount: 4,
        }),
      ).toBeNull();
    }
  });

  it('returns null for irregular いい/よい regardless of form', () => {
    for (const citationReading of ['いい', 'よい']) {
      expect(
        predictInflectedPitchAccentPosition({
          wordClass: 'i_adjective',
          formKey: 'polite',
          citationReading,
          citationPosition: 0,
          citationMoraCount: 2,
          conjugatedMoraCount: 4,
        }),
      ).toBeNull();
    }
  });

  it('returns null for na_adjective/suru/kuru (no two-class system to build on)', () => {
    expect(
      predictInflectedPitchAccentPosition({
        wordClass: 'na_adjective',
        formKey: 'plain_negative',
        citationReading: 'x',
        citationPosition: 0,
        citationMoraCount: 2,
        conjugatedMoraCount: 5,
      }),
    ).toBeNull();
    expect(
      predictInflectedPitchAccentPosition({
        wordClass: 'suru',
        formKey: 'te_form',
        citationReading: 'x',
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
        citationReading: 'x',
        citationPosition: 2,
        citationMoraCount: 3,
        conjugatedMoraCount: 5,
      }),
    ).toBeNull();
  });

  it('returns null for a verb whose citation accent is neither heiban nor edge-accented (irregular)', () => {
    expect(
      predictInflectedPitchAccentPosition({
        wordClass: 'godan',
        formKey: 'ba_form',
        citationReading: 'x',
        citationPosition: 1,
        citationMoraCount: 3,
        conjugatedMoraCount: 4,
      }),
    ).toBeNull();
  });

  it('returns null for godan/ichidan te-form/plain-past/tara-form (Module:ja-acc-table sources these from real per-word data, not a formula)', () => {
    for (const wordClass of ['godan', 'ichidan'] as const) {
      for (const formKey of ['te_form', 'plain_past', 'tara_form'] as const) {
        expect(
          predictInflectedPitchAccentPosition({
            wordClass,
            formKey,
            citationReading: 'x',
            citationPosition: 0,
            citationMoraCount: 2,
            conjugatedMoraCount: 3,
          }),
        ).toBeNull();
      }
    }
  });
});

describe('resolveInflectedPitchAccent surfaceForm (user report, 2026-09-14)', () => {
  // The stored sentence_vocabulary.surfaceForm for a -masu occurrence is
  // sometimes truncated to the bare stem (言い for 言います) — reported via
  // the pitch_accent card's native-audio loop stopping right at いい, before
  // ます, even though the -masu family's pitch shift (see pitchAccentShift.ts
  // doc comment) is a property of the whole conjugated word. The resolver
  // must return the full conjugated surface so callers isolating/
  // highlighting the word cover the same span reading/position describe.
  const iu = {
    expression: '言う',
    reading: 'いう',
    partOfSpeech: 'v5u',
    pitchAccentPositions: [0],
    teFormAccentPosition: undefined,
  };
  const sentence = {
    japanese: '地震で「揺れる」と言いますね。',
    inlineReading: '地震[じしん]で「揺れる[ゆれる]」と言い[いい]ますね。',
  };

  it('returns the full conjugated surface (言います), not the truncated stored stem (言い)', () => {
    const resolved = resolveInflectedPitchAccent({
      vocabularyItem: iu,
      sentence,
      surfaceForm: '言い',
    });
    expect(resolved).not.toBeNull();
    expect(resolved?.surfaceForm).toBe('言います');
    expect(resolved?.reading).toBe('いいます');
    expect(resolved?.isCitationForm).toBe(false);
  });

  it('citation-form occurrences resolve surfaceForm to vocabularyItem.expression', () => {
    const resolved = resolveInflectedPitchAccent({
      vocabularyItem: iu,
      sentence: { japanese: '言うとおりです。', inlineReading: '言う[いう]とおりです。' },
      surfaceForm: '言う',
    });
    expect(resolved?.surfaceForm).toBe('言う');
    expect(resolved?.isCitationForm).toBe(true);
  });
});
