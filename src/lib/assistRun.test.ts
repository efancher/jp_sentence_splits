import { describe, expect, it, vi } from 'vitest';

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
    expect(run).toHaveBeenCalledTimes(1);
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
    const transcript = Array.from({ length: 41 }, (_, i) => seg(i * 6));
    const line = (i: number) => {
      const total = i * 6;
      return `[${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}] あ。 || Ah.`;
    };
    const reply = (from: number, to: number) =>
      ['=== SENTENCES ===', ...Array.from({ length: to - from }, (_, k) => line(from + k)), '=== END ==='].join('\n');
    const partOneReply = reply(0, 40);
    const partTwoReply = reply(40, 41);

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
