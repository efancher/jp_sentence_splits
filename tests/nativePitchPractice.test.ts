import { describe, expect, it } from 'vitest';
import { buildNativePractice, nativePitchRuns } from '../src/lib/nativePitchPractice';
import type { WordAlignment } from '../src/domain/types';
import type { PitchAnalysisPayload } from '../src/lib/pitch';

const word = (text: string, start: number, vowels: string[]): WordAlignment => ({
  text, start, end: start + vowels.length * 0.1,
  phones: vowels.map((text, i) => ({ text, start: start + i * 0.1, end: start + (i + 1) * 0.1 })),
});
const pitch: PitchAnalysisPayload = {
  durationSeconds: 2, medianHz: 150, voicedRatio: 1,
  frames: Array.from({ length: 200 }, (_, i) => ({
    timeSeconds: i * 0.01 + 0.005, hz: 150, confidence: 1, voiced: true, relativeSemitones: i < 10 ? 0 : 4,
  })),
};

describe('native rehearsal model', () => {
  it('groups by pauses, keeping consecutive verb tokens together', () => {
    const chunks = buildNativePractice([word('あなたは', 0, ['a', 'a']), word('ペットを', 0.5, ['e', 'o']),
      word('飼って', 1, ['a', 'e']), word('います', 1.25, ['i', 'a']), word('か', 1.45, ['a'])], pitch);
    expect(chunks.map(c => c.text)).toEqual(['あなたは', 'ペットを', '飼っていますか']);
    expect(chunks[0]!.morae.map(m => m.pitch)).toEqual([0, 4]);
  });
  it('retains unreadable tokens without shifting the later kana', () => {
    const chunks = buildNativePractice([{ text: '不明', start: 0, end: 0.2, phones: [] }, word('い', 0.2, ['i'])], pitch);
    expect(chunks[0]!.incomplete).toBe(true);
    expect(chunks[0]!.morae.map(m => [m.kana, m.start, m.pitch])).toEqual([['不明', 0, null], ['い', 0.2, 4]]);
  });
  it('leaves unvoiced morae without a target and breaks the raw curve', () => {
    const unvoiced = { ...pitch, frames: pitch.frames.map(f => f.timeSeconds >= 0.1 && f.timeSeconds < 0.2 ? { ...f, voiced: false } : f) };
    expect(buildNativePractice([word('あい', 0, ['a', 'i'])], unvoiced)[0]!.morae[1]!.pitch).toBeNull();
    const runs = nativePitchRuns(unvoiced, 0, 0.3);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.at(-1)!.time).toBeLessThan(0.1);
    expect(runs[1]![0]!.time).toBeGreaterThan(0.2);
  });
});
