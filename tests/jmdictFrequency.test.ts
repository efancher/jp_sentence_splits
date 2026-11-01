import { describe, expect, it } from 'vitest';

import { lookupFrequency, parseJmdictFrequency } from '../scripts/lib/jmdictFrequency';
import { frequencyBandPrior, rankAtRiskWords, wordStrength } from '../src/lib/wordStrength';

const XML = `
<entry>
<k_ele><keb>日本</keb><ke_pri>news1</ke_pri><ke_pri>nf02</ke_pri></k_ele>
<r_ele><reb>にほん</reb><re_pri>news1</re_pri><re_pri>nf02</re_pri></r_ele>
<r_ele><reb>にっぽん</reb></r_ele>
<sense><gloss>Japan</gloss></sense>
</entry>
<entry>
<k_ele><keb>怪我</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>けが</reb><re_pri>ichi1</re_pri></r_ele>
<sense><gloss>injury</gloss></sense>
</entry>
<entry>
<k_ele><keb>草むら</keb></k_ele>
<r_ele><reb>くさむら</reb></r_ele>
<sense><gloss>thicket</gloss></sense>
</entry>
<entry>
<r_ele><reb>ええと</reb><re_pri>nf30</re_pri></r_ele>
<sense><gloss>um</gloss></sense>
</entry>`;

describe('parseJmdictFrequency', () => {
  const index = parseJmdictFrequency(XML);

  it('reads nf bands and bare priority tags', () => {
    expect(lookupFrequency(index, '日本', 'にほん')).toBe(2);
    expect(lookupFrequency(index, '怪我', 'けが')).toBe('priority');
  });

  it('gives kana-only entries a band and untagged words none', () => {
    expect(lookupFrequency(index, 'ええと')).toBe(30);
    expect(lookupFrequency(index, '草むら', 'くさむら')).toBeNull();
    expect(lookupFrequency(index, '無い')).toBeNull();
  });

  it('falls back from a missing reading to the expression', () => {
    expect(lookupFrequency(index, '日本', 'にっぽん')).toBe(2);
    expect(lookupFrequency(index, '日本')).toBe(2);
  });
});

describe('frequency prior', () => {
  it('is larger for more frequent bands and zero without a tag', () => {
    expect(frequencyBandPrior(1)).toBeGreaterThan(frequencyBandPrior(24));
    expect(frequencyBandPrior(24)).toBeGreaterThan(frequencyBandPrior(48));
    expect(frequencyBandPrior(null)).toBe(0);
    expect(frequencyBandPrior('priority')).toBe(0.3);
    expect(frequencyBandPrior(1)).toBeLessThan(1);
  });

  it('starts a common word stronger, but one failed recall outweighs it', () => {
    const now = Date.UTC(2026, 10, 1);
    const prior = frequencyBandPrior(1);
    expect(wordStrength([], 'reading', now, { prior })).toBeGreaterThan(wordStrength([], 'reading', now));
    const failed = [{ wordId: 'w', facet: 'reading' as const, kind: 'recall' as const, at: now, success: false }];
    expect(wordStrength(failed, 'reading', now, { prior })).toBeCloseTo(0.0, 0);
  });

  it('ranks a rare word with no evidence below a common one', () => {
    const now = Date.UTC(2026, 10, 1);
    const ranked = rankAtRiskWords(['rare', 'common'], new Map(), now, {
      facets: ['reading'],
      priorByWord: new Map([['common', frequencyBandPrior(2)], ['rare', frequencyBandPrior(null)]]),
    });
    expect(ranked.map((entry) => entry.wordId)).toEqual(['rare', 'common']);
  });
});
