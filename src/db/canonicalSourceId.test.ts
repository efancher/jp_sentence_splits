import { describe, expect, it } from 'vitest';

import { canonicalSourceId } from './repository';

const mp3 = 'https://d3ctxlq1ktw2nl.cloudfront.net/staging/2021-8-9/abc.mp3';

describe('canonicalSourceId', () => {
  it('unwraps the anchor.fm play wrapper to the media URL', () => {
    expect(
      canonicalSourceId(`https://anchor.fm/s/6ad2a4a0/podcast/play/40237376/${encodeURIComponent(mp3)}`),
    ).toBe(mp3);
  });
  it('leaves other URLs untouched', () => {
    expect(canonicalSourceId(mp3)).toBe(mp3);
  });
});
