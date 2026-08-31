import { describe, expect, it } from 'vitest';

import {
  editTranscriptSegText,
  mergeTranscriptSegDown,
  splitTranscriptSeg,
  type WizardTranscriptSeg,
} from '../src/lib/miningTranscript';

const seg = (over: Partial<WizardTranscriptSeg> = {}): WizardTranscriptSeg => ({
  text: 'あいう',
  startMs: 0,
  endMs: 1000,
  isAuto: false,
  lowConfidence: false,
  ...over,
});

describe('mergeTranscriptSegDown', () => {
  it('joins the next segment in and unions span + flags', () => {
    const out = mergeTranscriptSegDown(
      [
        seg({ text: '今日は', startMs: 0, endMs: 900, isAuto: true }),
        seg({ text: '晴れ。', startMs: 900, endMs: 2000, lowConfidence: true }),
        seg({ text: 'いいね。', startMs: 2000, endMs: 3000 }),
      ],
      0,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      text: '今日は晴れ。',
      startMs: 0,
      endMs: 2000,
      isAuto: true,
      lowConfidence: true,
    });
  });

  it('is a no-op on the last segment or out of range', () => {
    const segs = [seg(), seg()];
    expect(mergeTranscriptSegDown(segs, 1)).toBe(segs);
    expect(mergeTranscriptSegDown(segs, -1)).toBe(segs);
  });
});

describe('splitTranscriptSeg', () => {
  it('splits on sentence enders with proportional timing, carrying flags', () => {
    const out = splitTranscriptSeg(
      [seg({ text: 'そうですね。行きましょう。', startMs: 2000, endMs: 3200, lowConfidence: true })],
      0,
    );
    expect(out.map((s) => s.text)).toEqual(['そうですね。', '行きましょう。']);
    expect(out[0]!.startMs).toBe(2000);
    expect(out[0]!.endMs).toBe(out[1]!.startMs);
    expect(out[1]!.endMs).toBe(3200);
    expect(out.every((s) => s.lowConfidence)).toBe(true);
  });

  it('is a no-op when there is nothing to split', () => {
    const segs = [seg({ text: '一文だけ。' })];
    expect(splitTranscriptSeg(segs, 0)).toBe(segs);
  });
});

describe('editTranscriptSegText', () => {
  it('changes one segment only', () => {
    const out = editTranscriptSegText([seg({ text: 'a' }), seg({ text: 'b' })], 1, 'B');
    expect(out.map((s) => s.text)).toEqual(['a', 'B']);
  });
});
