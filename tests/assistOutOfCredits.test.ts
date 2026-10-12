import { describe, expect, it } from 'vitest';

import { isOutOfCreditsError } from '../src/lib/assistChunks';
import type { AssistRunState } from '../src/lib/assistRun';
import { runBookExtrasPipeline } from '../src/lib/bookAssistRun';

const BOTH_OUT = 'codex: exit 1: You have hit your usage limit; claude: exit 1: Credit balance is too low';

describe('out-of-credits stop', () => {
  it('recognises when every backend is out of usage', () => {
    expect(isOutOfCreditsError(BOTH_OUT)).toBe(true);
    expect(isOutOfCreditsError('codex: exit 1: usage limit reached; claude: exit 1: parse error')).toBe(false);
    expect(isOutOfCreditsError('empty reply')).toBe(false);
  });

  it('stops after one attempt and says the assistants are out of credits', async () => {
    let calls = 0;
    const state = { status: 'running', phase: null, progress: '', failure: null, extraReplies: {}, updatedAt: 0 } as unknown as AssistRunState;
    await runBookExtrasPipeline({
      spec: { sentences: [{ handle: 1, japanese: '猫がいる。', translation: 'There is a cat.' }], selection: { walkthroughs: [1] } },
      state,
      run: async () => {
        calls += 1;
        throw new Error(BOTH_OUT);
      },
      save: () => {},
      isCancelled: () => false,
    });
    expect(calls).toBe(1);
    expect(state.status).toBe('failed');
    expect(state.failure).toMatch(/out of credits/);
  });
});
