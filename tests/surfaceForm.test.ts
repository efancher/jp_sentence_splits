import { describe, expect, it } from 'vitest';

import { splitOnSurfaceForm } from '../src/lib/surfaceForm';

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
