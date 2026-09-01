import { describe, expect, it } from 'vitest';

import {
  editTranscriptSegText,
  formatTranscriptForAI,
  formatWizardTimestamp,
  mergeTranscriptSegDown,
  parseAiSegmentedTranscript,
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

describe('formatWizardTimestamp', () => {
  it('renders whole-second m:ss', () => {
    expect(formatWizardTimestamp(0)).toBe('0:00');
    expect(formatWizardTimestamp(3_000)).toBe('0:03');
    expect(formatWizardTimestamp(123_400)).toBe('2:03');
    expect(formatWizardTimestamp(-50)).toBe('0:00');
  });
});

describe('formatTranscriptForAI / parseAiSegmentedTranscript round-trip', () => {
  const source: WizardTranscriptSeg[] = [
    seg({ text: 'どうなった事項ですさぁ今日も早速参り', startMs: 240, endMs: 2450, isAuto: true }),
    seg({ text: 'ましょうエクストリーム現代社会説明が', startMs: 2460, endMs: 5030, isAuto: true }),
    seg({ text: '上手い人下手な人', startMs: 5040, endMs: 7850, isAuto: true }),
  ];

  it('emits one [m:ss] line per fragment plus instructions', () => {
    const prompt = formatTranscriptForAI(source);
    expect(prompt).toContain('One sentence per line.');
    expect(prompt).toContain('[0:00] どうなった事項ですさぁ今日も早速参り');
    expect(prompt).toContain('[0:05] 上手い人下手な人');
  });

  it('parses an assistant reply back into timestamped sentences', () => {
    const reply = [
      '[0:00] どうなった次第です。',
      '[0:00] さぁ、今日も早速参りましょう。',
      '[0:02] エクストリーム現代社会、説明が上手い人・下手な人。',
    ].join('\n');
    const out = parseAiSegmentedTranscript(reply, 7850);
    expect(out.map((s) => s.text)).toEqual([
      'どうなった次第です。',
      'さぁ、今日も早速参りましょう。',
      'エクストリーム現代社会、説明が上手い人・下手な人。',
    ]);
    expect(out[0]!.startMs).toBe(0);
    expect(out[1]!.startMs).toBe(0);
    expect(out[0]!.endMs).toBe(1); // same start as next → +1ms
    expect(out[2]!.startMs).toBe(2000);
    expect(out[2]!.endMs).toBe(7850); // last runs to fallback end
    expect(out.every((s) => s.isAuto && !s.lowConfidence)).toBe(true);
  });

  it('tolerates 00:03 padding, missing space, and folds untagged wrapped lines up', () => {
    const reply = ['[00:03]今日は晴れです。', 'とても気持ちがいい。', '[1:07] 出かけましょう。'].join('\n');
    const out = parseAiSegmentedTranscript(reply, 90_000);
    expect(out).toHaveLength(2);
    expect(out[0]!.text).toBe('今日は晴れです。とても気持ちがいい。');
    expect(out[0]!.startMs).toBe(3000);
    expect(out[1]!.startMs).toBe(67_000);
  });

  it('returns [] when the reply has no parseable timestamped lines', () => {
    expect(parseAiSegmentedTranscript('just some prose\nwith no timestamps', 5000)).toEqual([]);
    expect(parseAiSegmentedTranscript('', 5000)).toEqual([]);
  });

  it('sorts out-of-order lines by timestamp', () => {
    const out = parseAiSegmentedTranscript(['[0:10] B。', '[0:02] A。'].join('\n'), 20_000);
    expect(out.map((s) => s.text)).toEqual(['A。', 'B。']);
    expect(out[0]!.endMs).toBe(10_000);
  });
});
