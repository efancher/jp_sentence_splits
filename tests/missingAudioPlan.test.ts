import { describe, expect, it } from 'vitest';

import { parseVideoSpanMs, sourceKeyOfCardId } from '../scripts/lib/missingAudioPlan';

describe('missing-audio backfill parsing', () => {
  it('reads the video span from source-reference notes', () => {
    const notes = 'Shadowing project: Episode #7\nVideo position: 189.000–197.000 seconds\nTranscript status: manually-corrected';
    expect(parseVideoSpanMs(notes)).toEqual({ startMs: 189000, endMs: 197000 });
    expect(parseVideoSpanMs('Video position: 80.900-89.800 seconds')).toEqual({ startMs: 80900, endMs: 89800 });
  });

  it('rejects missing, empty and inverted spans', () => {
    expect(parseVideoSpanMs('no span here')).toBeNull();
    expect(parseVideoSpanMs('Video position: 5.000–5.000 seconds')).toBeNull();
    expect(parseVideoSpanMs('Video position: 9.000–5.000 seconds')).toBeNull();
  });

  it('takes the source id before the colon', () => {
    expect(sourceKeyOfCardId('source-55d1de96:sentence-020-ceb553')).toBe('source-55d1de96');
    expect(sourceKeyOfCardId('anki-123:456')).toBeNull();
  });
});
