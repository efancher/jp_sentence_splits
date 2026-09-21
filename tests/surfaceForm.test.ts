import { describe, expect, it } from 'vitest';

import { splitOnSurfaceForm, surfaceFormFromReading } from '../src/lib/surfaceForm';

describe('splitOnSurfaceForm', () => {
  it('splits around the first occurrence', () => {
    expect(splitOnSurfaceForm('りんごを食べる。', '食べる')).toEqual(['りんごを', '食べる', '。']);
  });

  it('splits at the very start and end', () => {
    expect(splitOnSurfaceForm('食べる。', '食べる')).toEqual(['', '食べる', '。']);
    expect(splitOnSurfaceForm('りんごを食べる', '食べる')).toEqual(['りんごを', '食べる', '']);
  });

  it('returns the whole string unsplit when the surface form is absent or empty', () => {
    expect(splitOnSurfaceForm('りんごを食べる。', '飲む')).toEqual(['りんごを食べる。', '', '']);
    expect(splitOnSurfaceForm('りんごを食べる。', '')).toEqual(['りんごを食べる。', '', '']);
  });
});

describe('surfaceFormFromReading', () => {
  it('finds a word spelled phonetically in hiragana or katakana (the real backfill cases)', () => {
    expect(surfaceFormFromReading('空は青くて、木々の緑がきれいでした。', 'きれい')).toBe('きれい');
    expect(surfaceFormFromReading('親鳥がえさを運んで来ました。', 'えさ')).toBe('えさ');
    expect(surfaceFormFromReading('「外の世界には、怖いワシやタカもいるの。', 'わし')).toBe('ワシ');
    expect(surfaceFormFromReading('「外の世界には、怖いワシやタカもいるの。', 'たか')).toBe('タカ');
    expect(surfaceFormFromReading('なんとか飛ぶことができました。', 'なんとか')).toBe('なんとか');
  });

  it('refuses an ambiguous or too-short reading, and an inflected occurrence', () => {
    expect(surfaceFormFromReading('たかいたかい山', 'たか')).toBeNull(); // twice
    expect(surfaceFormFromReading('の', 'の')).toBeNull(); // one kana
    expect(surfaceFormFromReading('ひなはおいしそうに食べた', 'おいしい')).toBeNull(); // inflected
    expect(surfaceFormFromReading('最初は下手でしたが', 'です')).toBeNull(); // でした, not です
  });
});
