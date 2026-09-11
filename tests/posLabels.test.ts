import { describe, expect, it } from 'vitest';

import { describePos, posTopLevelJa } from '../src/lib/posLabels';

describe('posLabels', () => {
  it('describes an exact UniDic tag with dictionary term + subcategory nuance', () => {
    expect(describePos('助詞/格助詞')).toEqual({
      ja: '助詞（格助詞）',
      en: 'particle (case-marking, e.g. を・に・で)',
    });
  });

  it('falls back to the top-level tag when the exact subcategory is unknown', () => {
    expect(describePos('名詞/謎のタグ')).toEqual({ ja: '名詞', en: 'noun' });
  });

  it('returns null for blank or unrecognized input', () => {
    expect(describePos(undefined)).toBeNull();
    expect(describePos('')).toBeNull();
    expect(describePos('   ')).toBeNull();
    expect(describePos('完全に謎')).toBeNull();
  });

  it('posTopLevelJa gives just the compact dictionary term', () => {
    expect(posTopLevelJa('名詞/普通名詞')).toBe('名詞');
    expect(posTopLevelJa('動詞/非自立可能')).toBe('動詞');
    expect(posTopLevelJa(undefined)).toBeNull();
  });

  it('covers every pos value seen in prod as of 2026-09-11', () => {
    const seen = [
      '名詞/普通名詞',
      '助動詞',
      '助詞/格助詞',
      '補助記号/読点',
      '補助記号/句点',
      '動詞/一般',
      '動詞/非自立可能',
      '助詞/終助詞',
      '助詞/接続助詞',
      '助詞/係助詞',
      '副詞',
      '代名詞',
      '助詞/副助詞',
      '助詞/準体助詞',
      '接尾辞/名詞的',
      '補助記号/括弧閉',
      '補助記号/括弧開',
      '形容詞/非自立可能',
      '接頭辞',
      '形容詞/一般',
      '連体詞',
      '形状詞/一般',
      '感動詞/一般',
      '名詞/数詞',
      '接続詞',
      '形状詞/助動詞語幹',
      '感動詞/フィラー',
      '名詞/固有名詞',
      '接尾辞/形状詞的',
      '補助記号/一般',
      '接尾辞/形容詞的',
      '接尾辞/動詞的',
    ];
    for (const pos of seen) {
      expect(describePos(pos), pos).not.toBeNull();
    }
  });
});
