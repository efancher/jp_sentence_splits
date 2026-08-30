import { describe, expect, it } from 'vitest';

import {
  accentFor,
  type Item,
  type ResegCue,
} from '../scripts/backfill-vocabulary-pitch-accent-unidic';

const item = (expression: string, reading: string): Item => ({
  id: 'v1',
  expression,
  reading,
});

const cue = (
  tokens: ResegCue['tokens'],
  japanese = 'x',
): ResegCue => ({ japanese, tokens });

const tok = (over: Partial<NonNullable<ResegCue['tokens']>[number]>) => ({
  surface: '先生',
  lemma: '先生',
  lemmaReading: 'せんせい',
  pos: '名詞/普通名詞',
  accentType: '3',
  ...over,
});

describe('accentFor', () => {
  it('takes a single dictionary-form content token with an integer aType', () => {
    expect(accentFor(cue([tok({})]), item('先生', 'せんせい'))).toBe(3);
    expect(
      accentFor(
        cue([tok({ surface: '東京', lemma: '東京', lemmaReading: 'とうきょう', accentType: '0' })]),
        item('東京', 'とうきょう'),
      ),
    ).toBe(0);
  });

  it('rejects a compound (more than one token)', () => {
    expect(
      accentFor(
        cue([
          tok({ surface: '図書', lemma: '図書', lemmaReading: 'としょ', accentType: '1' }),
          tok({ surface: '館', lemma: '館', lemmaReading: 'かん', pos: '接尾辞/名詞的', accentType: '' }),
        ]),
        item('図書館', 'としょかん'),
      ),
    ).toBeNull();
  });

  it('rejects a proper noun', () => {
    expect(
      accentFor(
        cue([tok({ surface: '水希', lemma: '水希', lemmaReading: 'みずき', pos: '名詞/固有名詞', accentType: '1' })]),
        item('水希', 'みずき'),
      ),
    ).toBeNull();
  });

  it('rejects a conjugated form whose lemma differs from the expression', () => {
    expect(
      accentFor(
        cue([tok({ surface: '仲良く', lemma: '仲良い', lemmaReading: 'なかよい', pos: '形容詞/一般', accentType: '1' })]),
        item('仲良く', 'なかよく'),
      ),
    ).toBeNull();
  });

  it('rejects a reading the tokenizer disagrees with (homograph)', () => {
    expect(
      accentFor(
        cue([tok({ surface: '今日', lemma: '今日', lemmaReading: 'こんにち', accentType: '1' })]),
        item('今日', 'きょう'),
      ),
    ).toBeNull();
  });

  it('rejects a non-integer aType', () => {
    expect(accentFor(cue([tok({ accentType: '' })]), item('先生', 'せんせい'))).toBeNull();
    expect(accentFor(cue([tok({ accentType: '1,3' })]), item('先生', 'せんせい'))).toBeNull();
    expect(accentFor(cue([tok({ accentType: 'C2' })]), item('先生', 'せんせい'))).toBeNull();
  });

  it('rejects a non-content POS', () => {
    expect(
      accentFor(
        cue([tok({ surface: 'から', lemma: 'から', lemmaReading: 'から', pos: '助詞/接続助詞', accentType: '0' })]),
        item('から', 'から'),
      ),
    ).toBeNull();
  });
});
