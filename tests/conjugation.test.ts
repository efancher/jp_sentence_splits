import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  conjugate,
  conjugationFormsForWordClass,
  conjugationTagFromWordClass,
  conjugationWordClassFromPartOfSpeech,
  findInflectedSurfaceInSentence,
  identifyConjugationForm,
  inferConjugationWordClass,
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

  it('maps the AI glosser English tags and UniDic adjective POS', () => {
    expect(conjugationWordClassFromPartOfSpeech('godan verb')).toBe('godan');
    expect(conjugationWordClassFromPartOfSpeech('ichidan verb')).toBe('ichidan');
    expect(conjugationWordClassFromPartOfSpeech('suru verb')).toBe('suru');
    expect(conjugationWordClassFromPartOfSpeech('i-adjective')).toBe('i_adjective');
    expect(conjugationWordClassFromPartOfSpeech('na-adjective')).toBe('na_adjective');
    expect(conjugationWordClassFromPartOfSpeech('形容詞/一般')).toBe('i_adjective');
    expect(conjugationWordClassFromPartOfSpeech('形状詞/一般')).toBe('na_adjective');
  });

  it('does not classify a bare UniDic verb POS (godan/ichidan unknown)', () => {
    expect(conjugationWordClassFromPartOfSpeech('動詞/一般')).toBeNull();
  });
});

describe('inferConjugationWordClass', () => {
  it('decides godan vs ichidan from an inflected surface, no POS needed', () => {
    expect(inferConjugationWordClass('話す', 'はなす', '動詞/一般', '話して')).toBe('godan');
    expect(inferConjugationWordClass('食べる', 'たべる', '動詞/一般', '食べた')).toBe('ichidan');
    expect(inferConjugationWordClass('帰る', 'かえる', undefined, '帰って')).toBe('godan');
    expect(inferConjugationWordClass('見る', 'みる', undefined, '見て')).toBe('ichidan');
  });

  it('falls back to the sentence when the stored surface is a bare stem', () => {
    expect(
      inferConjugationWordClass('言う', 'いう', '動詞/一般', '言っ', '大声で言ってください。'),
    ).toBe('godan');
  });

  it('uses word shape when there is no inflected evidence', () => {
    expect(inferConjugationWordClass('する', 'する', '動詞/非自立可能')).toBe('suru');
    expect(inferConjugationWordClass('来る', 'くる', '動詞/非自立可能')).toBe('kuru');
    expect(inferConjugationWordClass('食べる', 'たべる', '動詞/一般')).toBe('ichidan');
    expect(inferConjugationWordClass('走る', 'はしる', '動詞/一般')).toBe('godan');
  });

  it('returns null for a non-verb', () => {
    expect(inferConjugationWordClass('本', 'ほん', '名詞/普通名詞', '本')).toBeNull();
    expect(inferConjugationWordClass('学校', 'がっこう', undefined)).toBeNull();
  });
});

describe('conjugationTagFromWordClass', () => {
  it('produces a tag conjugationWordClassFromPartOfSpeech round-trips', () => {
    const cases: [ConjugationWordClass, string][] = [
      ['godan', '話す'],
      ['ichidan', '食べる'],
      ['suru', '勉強する'],
      ['kuru', '来る'],
      ['i_adjective', '高い'],
      ['na_adjective', '静か'],
    ];
    for (const [wordClass, expression] of cases) {
      const tag = conjugationTagFromWordClass(wordClass, expression);
      expect(conjugationWordClassFromPartOfSpeech(tag)).toBe(wordClass);
    }
    expect(conjugationTagFromWordClass('godan', '話す')).toBe('v5s');
    expect(conjugationTagFromWordClass('godan', '書く')).toBe('v5k');
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

describe('findInflectedSurfaceInSentence (truncated surface_form recovery)', () => {
  it('recovers the full inflected word the picker truncated to a stem', () => {
    expect(
      findInflectedSurfaceInSentence('大声で言ってください。', '言う', 'いう', 'godan'),
    ).toEqual({ surface: '言って', form: expect.objectContaining({ key: 'te_form' }) });
    expect(
      findInflectedSurfaceInSentence('そうは思わない。', '思う', 'おもう', 'godan'),
    ).toEqual({ surface: '思わない', form: expect.objectContaining({ key: 'plain_negative' }) });
    expect(
      findInflectedSurfaceInSentence('声が大きかったです。', '大きい', 'おおきい', 'i_adjective'),
    ).toEqual({ surface: '大きかった', form: expect.objectContaining({ key: 'plain_past' }) });
  });

  it('returns null when only a stacked/compound surface is present', () => {
    expect(
      findInflectedSurfaceInSentence('まだ食べられなかった。', '食べる', 'たべる', 'ichidan'),
    ).toBeNull();
  });

  it('does not recover a te-form that continues into an auxiliary verb', () => {
    // 待って here is 待っている, not a standalone te-form — must not become a card.
    expect(
      findInflectedSurfaceInSentence('お父さんの帰りを待っていました。', '待つ', 'まつ', 'godan'),
    ).toBeNull();
    // 与えて + くれました
    expect(
      findInflectedSurfaceInSentence('勇気を与えてくれました。', '与える', 'あたえる', 'ichidan'),
    ).toBeNull();
  });

  it('still recovers a te-form used as a plain connective', () => {
    expect(
      findInflectedSurfaceInSentence('「えい！」と言って巣から飛び出した。', '言う', 'いう', 'godan'),
    ).toEqual({ surface: '言って', form: expect.objectContaining({ key: 'te_form' }) });
  });

  it('returns null when the word only appears in its dictionary form', () => {
    expect(
      findInflectedSurfaceInSentence('毎日走る。', '走る', 'はしる', 'godan'),
    ).toBeNull();
  });
});
