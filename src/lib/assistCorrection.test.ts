import { describe, expect, it, vi } from 'vitest';

import {
  applyCorrections,
  applyCorrectionsToTranscript,
  buildCorrectionPrompt,
  parseCorrections,
  runCorrectionChunks,
} from './assistCorrection';
import type { WizardTranscriptSeg } from './miningTranscript';

const s = (text: string, startS = 0, low = false): WizardTranscriptSeg => ({
  text,
  startMs: startS * 1000,
  endMs: startS * 1000 + 4000,
  isAuto: true,
  lowConfidence: low,
});

describe('buildCorrectionPrompt', () => {
  it('numbers segments globally and marks low-confidence lines', () => {
    const prompt = buildCorrectionPrompt([s('タウンワークって', 120, true), s('うん', 126)], 2, 1, 3);
    expect(prompt).toContain('F2 [2:00]! タウンワークって');
    expect(prompt).toContain('F3 [2:06] うん');
    expect(prompt).toContain('part 2 of 3');
    expect(prompt).toContain('CORRECTIONS ONLY');
  });
});

describe('parseCorrections', () => {
  const chunk = [s('汗だくりになって帰ってきた', 0), s('うん', 5)];
  const off = 40;

  it('accepts a fenced substring-validated proposal', () => {
    const reply = '```json\n[{"seg":40,"original":"汗だくり","replacement":"汗だく","reason":"stray mora","confidence":"med"}]\n```';
    const { accepted, rejected } = parseCorrections(reply, chunk, off);
    expect(accepted).toEqual([
      { seg: 40, original: '汗だくり', replacement: '汗だく', reason: 'stray mora', confidence: 'med' },
    ]);
    expect(rejected).toBe(0);
  });

  it('rejects out-of-range segments, missing originals, no-ops and garbage', () => {
    const reply = JSON.stringify([
      { seg: 99, original: '汗だくり', replacement: '汗だく', reason: 'x', confidence: 'high' },
      { seg: 40, original: '存在しない', replacement: '汗だく', reason: 'x', confidence: 'high' },
      { seg: 40, original: '汗だくり', replacement: '汗だくり', reason: 'x', confidence: 'high' },
      { seg: 41, original: 'うん', replacement: 'うんうん', reason: 'x', confidence: 'weird' },
    ]);
    const { accepted, rejected } = parseCorrections(reply, chunk, off);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ seg: 41, confidence: 'med' });
    expect(rejected).toBe(3);
  });

  it('treats a non-JSON reply as no corrections, not an error', () => {
    expect(parseCorrections('I could not find any issues.', chunk, off)).toEqual({ accepted: [], rejected: 0 });
    expect(parseCorrections('[not, json', chunk, off)).toEqual({ accepted: [], rejected: 0 });
  });
});

describe('applyCorrections', () => {
  it('replaces the first occurrence in order, skipping proposals whose original vanished', () => {
    const segs = [s('満目の了解という慣用句', 0)];
    const { segs: out, applied } = applyCorrections(segs, [
      { seg: 0, original: '満目の了解', replacement: '暗黙の了解', reason: 'idiom', confidence: 'high' },
      { seg: 0, original: '満目', replacement: '誤目', reason: 'stale', confidence: 'high' },
    ]);
    expect(out[0]!.text).toBe('暗黙の了解という慣用句');
    expect(applied).toHaveLength(1);
    expect(applied[0]!.startMs).toBe(0);
    expect(segs[0]!.text).toBe('満目の了解という慣用句');
  });

  it('applyCorrectionsToTranscript is a no-op when originals no longer match', () => {
    const segs = [s('もう直っています', 0)];
    const fixed = applyCorrectionsToTranscript(segs, [
      { seg: 0, startMs: 0, original: '直', replacement: '治', reason: '', confidence: 'high' },
    ]);
    expect(fixed[0]!.text).toBe('もう治っています');
    const again = applyCorrectionsToTranscript(fixed, [
      { seg: 0, startMs: 0, original: '直', replacement: '治', reason: '', confidence: 'high' },
    ]);
    expect(again[0]!.text).toBe('もう治っています');
  });
});

describe('runCorrectionChunks', () => {
  const chunks = [[s('サバティカルの機関', 0)], [s('キラキラ', 60)]];

  it('saves replies per part, notes counts, and re-derives proposals on resume without new calls', async () => {
    const saved: Record<number, string> = {};
    let failSecond = true;
    const run = vi.fn().mockImplementation((prompt: string) => {
      if (prompt.includes('part 2 of 2')) {
        if (failSecond) return Promise.reject(new Error('backend down'));
        return Promise.resolve({ reply: '[{"seg":1,"original":"キラキラ","replacement":"きらきら","reason":"kana","confidence":"low"}]', backend: 'codex' });
      }
      return Promise.resolve({
        reply: '[{"seg":0,"original":"機関","replacement":"期間","reason":"homophone","confidence":"high"}]',
        backend: 'claude',
      });
    });
    const notes: string[] = [];
    const first = await runCorrectionChunks({
      chunks,
      replies: [],
      run,
      onChunkDone: (i, r) => (saved[i] = r),
      onProgress: () => {},
      onNote: (t) => notes.push(t),
      isCancelled: () => false,
    });
    expect(first.replies[0]).toContain('期間');
    expect(first.replies[1]).toBeNull();
    expect(first.corrections[0]).toHaveLength(1);
    expect(first.corrections[1]).toEqual([]);
    expect(notes.some((n) => n.includes('1 fix(es) proposed'))).toBe(true);
    expect(notes.some((n) => n.includes('skipped (backend down)'))).toBe(true);

    run.mockClear();
    failSecond = false;
    const resumed = await runCorrectionChunks({
      chunks,
      replies: first.replies,
      run,
      onChunkDone: () => {},
      onProgress: () => {},
      isCancelled: () => false,
    });
    expect(run).toHaveBeenCalledTimes(1); // only the unfinished part is re-asked
    expect(resumed.corrections[0][0]).toMatchObject({ seg: 0, replacement: '期間' });
    expect(resumed.corrections[1][0]).toMatchObject({ seg: 1, replacement: 'きらきら' });
  });
});
