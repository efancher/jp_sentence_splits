import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  conjugate,
  conjugationFormsForWordClass,
  conjugationWordClassFromPartOfSpeech,
  identifyConjugationForm,
  type ConjugationFormKey,
  type ConjugationWordClass,
} from '../src/lib/conjugation';

interface ConjugationFixture {
  expression: string;
  reading: string;
  wordClass: ConjugationWordClass;
  formKey: ConjugationFormKey;
  expectedExpression: string;
  expectedReading: string;
  note: string;
}

// Ported directly from ~/projects/anki/conjugation_fixtures.json (86 rows,
// the same fixture set that repo's conjugate_vocab_form() was validated
// against) — see docs/STATUS.md Phase 7.9.
const fixtures = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../fixtures/conjugation-fixtures.json'), 'utf8'),
) as ConjugationFixture[];

describe('conjugate (Phase 7.9, ported anki/wk_decks.py fixtures)', () => {
  it('has the expected fixture count', () => {
    expect(fixtures).toHaveLength(86);
  });

  it.each(fixtures)(
    '$wordClass $formKey: $expression ($reading) -> $expectedExpression ($expectedReading) [$note]',
    ({ expression, reading, wordClass, formKey, expectedExpression, expectedReading }) => {
      const result = conjugate(expression, reading, wordClass, formKey);
      expect(result).toEqual({ expression: expectedExpression, reading: expectedReading });
    },
  );
});

describe('conjugationWordClassFromPartOfSpeech (Phase 7.9)', () => {
  it('maps JMDict verb/adjective tags to a word class', () => {
    expect(conjugationWordClassFromPartOfSpeech('adj-i')).toBe('i_adjective');
    expect(conjugationWordClassFromPartOfSpeech('adj-na')).toBe('na_adjective');
    expect(conjugationWordClassFromPartOfSpeech('vk')).toBe('kuru');
    expect(conjugationWordClassFromPartOfSpeech('vs-i')).toBe('suru');
    expect(conjugationWordClassFromPartOfSpeech('v1; vt')).toBe('ichidan');
    expect(conjugationWordClassFromPartOfSpeech('v5r; vt')).toBe('godan');
    expect(conjugationWordClassFromPartOfSpeech('v5u; vi')).toBe('godan');
  });

  it('handles comma-separated tags (real production data uses both delimiters)', () => {
    expect(conjugationWordClassFromPartOfSpeech('n,vs,vi')).toBe('suru');
  });

  it('returns null for non-conjugable or missing tags', () => {
    expect(conjugationWordClassFromPartOfSpeech('n')).toBeNull();
    expect(conjugationWordClassFromPartOfSpeech('adv')).toBeNull();
    expect(conjugationWordClassFromPartOfSpeech(undefined)).toBeNull();
  });
});

describe('conjugationFormsForWordClass (Phase 7.9)', () => {
  it('returns the 13 verb forms for godan/ichidan/suru/kuru', () => {
    for (const wordClass of ['godan', 'ichidan', 'suru', 'kuru'] as const) {
      expect(conjugationFormsForWordClass(wordClass)).toHaveLength(13);
    }
  });

  it('returns the 10 adjective forms for i_adjective/na_adjective', () => {
    for (const wordClass of ['i_adjective', 'na_adjective'] as const) {
      expect(conjugationFormsForWordClass(wordClass)).toHaveLength(10);
    }
  });
});

describe('conjugate edge cases (Phase 7.9)', () => {
  it('returns null for a form not offered by the word class', () => {
    // 'potential'/'passive'/'causative' aren't in the adjective form set.
    expect(conjugate('大きい', 'おおきい', 'i_adjective', 'potential')).toBeNull();
  });

  it('returns null for an empty expression or reading', () => {
    expect(conjugate('', 'おおきい', 'i_adjective', 'plain_past')).toBeNull();
    expect(conjugate('大きい', '', 'i_adjective', 'plain_past')).toBeNull();
  });

  it('returns null when the word class does not match the actual word shape', () => {
    // Not a verb/adjective at all — no godan-style okurigana to split on.
    expect(conjugate('学校', 'がっこう', 'godan', 'plain_past')).toBeNull();
  });
});

describe('identifyConjugationForm (contextual conjugation card)', () => {
  it('identifies the form a surface occurrence is in', () => {
    expect(identifyConjugationForm('話す', 'はなす', 'godan', '話して')?.form.key).toBe('te_form');
    expect(identifyConjugationForm('食べる', 'たべる', 'ichidan', '食べた')?.form.key).toBe('plain_past');
    expect(identifyConjugationForm('する', 'する', 'suru', 'すれば')?.form.key).toBe('ba_form');
    expect(identifyConjugationForm('行く', 'いく', 'godan', '行かない')?.form.key).toBe('plain_negative');
    expect(identifyConjugationForm('大きい', 'おおきい', 'i_adjective', '大きかった')?.form.key).toBe(
      'plain_past',
    );
  });

  it('matches on reading when the sentence writes a kanji verb in kana', () => {
    expect(identifyConjugationForm('話す', 'はなす', 'godan', 'はなして', 'はなして')?.form.key).toBe(
      'te_form',
    );
  });

  it('returns null for a stacked/compound surface this engine does not produce', () => {
    expect(identifyConjugationForm('話す', 'はなす', 'godan', '話している')).toBeNull();
    expect(identifyConjugationForm('食べる', 'たべる', 'ichidan', '食べられなかった')).toBeNull();
    expect(identifyConjugationForm('話す', 'はなす', 'godan', '話してしまった')).toBeNull();
  });

  it('returns null when the surface is just the dictionary form', () => {
    expect(identifyConjugationForm('話す', 'はなす', 'godan', '話す')).toBeNull();
  });

  it('picks the first matching form when several produce the same string', () => {
    // ichidan potential and passive are both 食べられる — canonical order lists
    // potential first.
    expect(identifyConjugationForm('食べる', 'たべる', 'ichidan', '食べられる')?.form.key).toBe(
      'potential',
    );
  });
});
