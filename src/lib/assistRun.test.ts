import { describe, expect, it, vi } from 'vitest';

import { CHUNK_FRAGMENTS } from './assistChunks';
import { emptyAssistRunState, runAssistPipeline } from './assistRun';

const seg = (startS: number) => ({
  text: 'あ',
  startMs: startS * 1000,
  endMs: (startS + 5) * 1000,
  isAuto: false,
  lowConfidence: false,
});
const sentencesReply = '=== SENTENCES ===\n[0:00] あ。 || Ah.\n=== END ===';
const structureReply = 'S1 | あ / interjection / ah';

const base = { transcript: [seg(0)], options: {} };

describe('runAssistPipeline', () => {
  it('finishes with just sentences when no extras are ticked', async () => {
    const run = vi.fn().mockResolvedValue({ reply: sentencesReply, backend: 'codex' });
    const state = await runAssistPipeline({
      spec: base,
      state: emptyAssistRunState(),
      run,
      save: () => {},
      isCancelled: () => false,
    });
    expect(state.status).toBe('done');
    expect(state.sentencesReply).toContain('[0:00] あ。 || Ah.');
    expect(state.extras).toBeNull();
    // one recognition-fix call, then the sentences call
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('chains the ticked extras after the sentences and merges them', async () => {
    const run = vi.fn(async (prompt: string) => ({
      reply: prompt.includes('STRUCTURE') && prompt.includes('--- sentences ---') ? structureReply : sentencesReply,
      backend: 'codex',
    }));
    const saves: string[] = [];
    const state = await runAssistPipeline({
      spec: { ...base, options: { structure: true } },
      state: emptyAssistRunState(),
      run,
      save: (s) => saves.push(s.status),
      isCancelled: () => false,
    });
    expect(state.status).toBe('done');
    expect(state.extras?.structure).toBe(structureReply);
    expect(saves.at(-1)).toBe('done');
  });

  it('stops after the retry cap, keeps finished parts, and resumes without redoing them', async () => {
    const transcript = Array.from({ length: CHUNK_FRAGMENTS + 1 }, (_, i) => seg(i * 6));
    const line = (i: number) => {
      const total = i * 6;
      return `[${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}] あ。 || Ah.`;
    };
    const reply = (from: number, to: number) =>
      ['=== SENTENCES ===', ...Array.from({ length: to - from }, (_, k) => line(from + k)), '=== END ==='].join('\n');
    const partOneReply = reply(0, CHUNK_FRAGMENTS);
    const partTwoReply = reply(CHUNK_FRAGMENTS, CHUNK_FRAGMENTS + 1);

    let failSecondPart = true;
    const run = vi.fn(async (prompt: string) => {
      if (prompt.includes('excerpt 2 of 2')) {
        if (failSecondPart) throw new Error('rate limited');
        return { reply: partTwoReply, backend: 'claude' };
      }
      return { reply: partOneReply, backend: 'codex' };
    });
    const spec = { transcript, options: {} };
    const state = emptyAssistRunState();
    const first = await runAssistPipeline({ spec, state, run, save: () => {}, isCancelled: () => false });
    expect(first.status).toBe('failed');
    expect(first.failure).toMatch(/part 2 of 2.*rate limited/);
    expect(first.segmentReplies[0]).toBe(partOneReply);
    const callsAfterFirst = run.mock.calls.length;

    failSecondPart = false;
    const second = await runAssistPipeline({ spec, state: first, run, save: () => {}, isCancelled: () => false });
    expect(second.status).toBe('done');
    expect(second.failure).toBeNull();
    expect(run.mock.calls.length - callsAfterFirst).toBe(1);
  });

  it('applies logged recognition fixes before segmentation and tells PART 1 the text is final', async () => {
    const segs = [
      { ...seg(0), text: 'タウンワークって電話帳あるじゃん' },
      { ...seg(6), text: 'うん' },
    ];
    const calls: string[] = [];
    const run = vi.fn(async (prompt: string) => {
      calls.push(prompt);
      if (prompt.includes('CORRECTIONS ONLY')) {
        return {
          reply: '[{"seg":0,"original":"タウンワーク","replacement":"タウンページ","reason":"brand name","confidence":"high"}]',
          backend: 'claude',
        };
      }
      return {
        reply:
          '=== SENTENCES ===\n[0:00] タウンページって電話帳あるじゃん。 || There is the TownPages phone book.\n[0:06] うん。 || Yeah.\n=== END ===',
        backend: 'claude',
      };
    });
    const state = await runAssistPipeline({
      spec: { transcript: segs, options: {} },
      state: emptyAssistRunState(),
      run,
      save: () => {},
      isCancelled: () => false,
    });
    expect(state.status).toBe('done');
    expect(state.corrections).toHaveLength(1);
    expect(state.corrections[0]).toMatchObject({ seg: 0, replacement: 'タウンページ', startMs: 0 });
    const sentencesPrompt = calls[calls.length - 1]!;
    expect(sentencesPrompt).toContain('タウンページって電話帳あるじゃん');
    expect(sentencesPrompt).toContain('fixed and logged');
    expect(sentencesPrompt).not.toContain('Fix obvious mis-recognitions');
    expect(state.log?.some((entry) => entry.text.includes('Recognition fixes: 1 applied'))).toBe(true);
  });

  it('a failing or nonsense correction reply never stops the run', async () => {
    const run = vi.fn(async (prompt: string) => {
      if (prompt.includes('CORRECTIONS ONLY')) throw new Error('backend down');
      return { reply: sentencesReply, backend: 'codex' };
    });
    const state = await runAssistPipeline({
      spec: base,
      state: emptyAssistRunState(),
      run,
      save: () => {},
      isCancelled: () => false,
    });
    expect(state.status).toBe('done');
    expect(state.corrections).toEqual([]);
    expect(state.log?.some((entry) => entry.text.includes('corrections part 1'))).toBe(true);
  });

  it('reports cancelled when asked to stop', async () => {
    const state = await runAssistPipeline({
      spec: base,
      state: emptyAssistRunState(),
      run: vi.fn(),
      save: () => {},
      isCancelled: () => true,
    });
    expect(state.status).toBe('cancelled');
  });
});
