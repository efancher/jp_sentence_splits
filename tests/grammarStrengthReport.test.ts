import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { getDb, getGrammarStrengthReport, resetWordStrengthCache } from '../src/db/repository';
import { grammarFeedbackTargetKey } from '../src/lib/grammarEvidence';
import { createId } from '../src/lib/ids';

describe('getGrammarStrengthReport', () => {
  beforeEach(() => {
    resetDbForTests(`grammar-strength-${createId('db')}`);
    resetWordStrengthCache();
  });

  async function tap(patternId: string, outcome: 'got_it' | 'needed_help') {
    await getDb().sentenceLearningEvents.put({
      id: createId('sle'), sentenceId: 's1', bookId: 'b1', action: 'target_practice', timestamp: new Date().toISOString(),
      target: { kind: 'grammar', key: grammarFeedbackTargetKey(patternId, 'use'), label: patternId },
      support: 'target_masked', outcome,
    } as never);
  }

  async function link(patternId: string, name: string, sentenceId: string) {
    const now = new Date().toISOString();
    const db = getDb();
    await db.grammarPatterns.put({ id: patternId, canonicalName: name, normalizedKey: patternId, aliases: [], shortMeaning: '', provenance: 'manual', createdAt: now, updatedAt: now } as never);
    await db.sentenceGrammar.put({ id: createId('sg'), sentenceId, grammarPatternId: patternId, surfaceForm: name, start: 0, end: 1, confirmedByLearner: true, source: 'manual', createdAt: now, updatedAt: now } as never);
  }

  it('is empty with no linked patterns', async () => {
    const report = await getGrammarStrengthReport();
    expect(report.counts).toEqual({ unchecked: 0, shaky: 0, solid: 0 });
    expect(report.weakest).toEqual([]);
  });

  it('counts linked patterns by level and lists the shaky ones weakest first', async () => {
    await link('p-none', '〜が', 's1');
    await link('p-shaky', '〜ながら', 's1');
    await link('p-shaky', '〜ながら', 's2');
    await link('p-solid', '〜ました', 's1');
    await tap('p-shaky', 'needed_help');
    for (let i = 0; i < 3; i += 1) await tap('p-solid', 'got_it');
    const report = await getGrammarStrengthReport();
    expect(report.counts).toEqual({ unchecked: 1, shaky: 1, solid: 1 });
    expect(report.weakest).toHaveLength(1);
    expect(report.weakest[0]).toMatchObject({ patternId: 'p-shaky', name: '〜ながら', sentences: 2 });
  });
});
