import { describe, expect, it } from 'vitest';

import {
  COMBINED_REPLY_FILENAME,
  checkCombinedReply,
  formatCombinedPromptForAI,
  remapSentenceHandles,
  splitCombinedReply,
} from './combinedImportPrompt';
import { parseAiCombinedReply } from './miningQuickImport';

const segs = [{ text: 'こんにちは', startMs: 0, endMs: 2000, isAuto: true, lowConfidence: false }];

describe('formatCombinedPromptForAI', () => {
  it('asks for every part and a downloadable file by default', () => {
    const prompt = formatCombinedPromptForAI(segs);
    for (const heading of ['SENTENCES', 'EPISODE PACK', 'STRUCTURE', 'COMPREHENSION', 'PARTICLES']) {
      expect(prompt).toContain(`=== ${heading} ===`);
    }
    expect(prompt).toContain(COMBINED_REPLY_FILENAME);
    expect(prompt).toContain('[0:00] こんにちは');
  });

  it('omits unrequested parts', () => {
    const prompt = formatCombinedPromptForAI(segs, {
      targets: false,
      constructions: false,
      structure: false,
      comprehension: false,
      particles: false,
      walkthroughs: false,
    });
    expect(prompt).toContain('=== SENTENCES ===');
    expect(prompt).not.toContain('=== EPISODE PACK ===');
    expect(prompt).not.toContain('=== PARTICLES ===');
  });
});

describe('splitCombinedReply', () => {
  it('splits headed parts and ignores code fences', () => {
    const reply = [
      '```',
      '=== SENTENCES ===',
      '[0:00] こんにちは。 || Hello.',
      '=== STRUCTURE ===',
      'S1 | こんにちは。 | expression | hello',
      '=== COMPREHENSION ===',
      '=== Sentence 1 ===',
      '1. a',
      '```',
    ].join('\n');
    const sections = splitCombinedReply(reply);
    expect(sections.sentences).toBe('[0:00] こんにちは。 || Hello.');
    expect(sections.structure).toContain('S1 |');
    expect(sections.comprehension).toContain('=== Sentence 1 ===');
    expect(parseAiCombinedReply(sections.sentences, 2000)).toHaveLength(1);
  });

  it('accepts sentence lines prefixed with an S-number', () => {
    const sections = splitCombinedReply('=== SENTENCES ===\nS1: [0:17] スロージャパニーズ。 || Slow Japanese.\nS2: [0:43] 家。 || Home.');
    const rows = parseAiCombinedReply(sections.sentences, 60000);
    expect(rows.map((row) => row.japanese)).toEqual(['スロージャパニーズ。', '家。']);
    expect(rows[1]!.translation).toBe('Home.');
  });

  it('treats a headerless reply as plain sentence lines', () => {
    const reply = '[0:00] こんにちは。 || Hello.';
    expect(splitCombinedReply(reply).sentences).toBe(reply);
  });
});

describe('remapSentenceHandles', () => {
  it('rewrites mapped handles and zeroes unmapped ones', () => {
    const map = new Map([[1, 3]]);
    expect(remapSentenceHandles('S1 | a\nS2 | b\n"sentence": "S1"', map)).toBe('S3 | a\nS0 | b\n"sentence": "S3"');
  });
});

describe('END marker', () => {
  it('is requested by the prompt and does not leak into the last section', () => {
    expect(formatCombinedPromptForAI(segs, { structure: false })).toContain('=== END ===');
    const sections = splitCombinedReply('=== SENTENCES ===\n[0:00] こんにちは。 || Hello.\n=== END ===');
    expect(sections.sentences).toBe('[0:00] こんにちは。 || Hello.');
  });
});

describe('checkCombinedReply', () => {
  const transcript = [0, 60, 120, 180, 240, 300].map((s) => ({ startMs: s * 1000, endMs: (s + 55) * 1000 }));
  const row = (startS: number, endS: number) => ({
    startMs: startS * 1000,
    endMs: endS * 1000,
    japanese: 'あいうえおかきくけこ'.repeat(12),
  });
  const none = { targets: false, constructions: false, walkthroughs: false, structure: false, comprehension: false, particles: false };
  const empty = { sentences: 'x', pack: '', structure: '', comprehension: '', particles: '' };
  const end = '=== END ===';

  it('is quiet for a complete reply', () => {
    const rows = [0, 60, 120, 180, 240, 300].map((s) => row(s, s + 55));
    expect(
      checkCombinedReply({ reply: end, sections: empty, rows, transcript, options: none }),
    ).toEqual([]);
  });

  it('flags a reply that stops early and a missing END marker', () => {
    const rows = [row(0, 60), row(60, 120), row(120, 360)];
    const warnings = checkCombinedReply({ reply: 'x', sections: empty, rows, transcript, options: none });
    expect(warnings.some((w) => w.includes('stops at 2:00'))).toBe(true);
    expect(warnings.some((w) => w.includes('END'))).toBe(true);
  });

  it('flags a skipped middle stretch', () => {
    const rows = [row(0, 60), row(60, 120), row(240, 300), row(300, 360)];
    const warnings = checkCombinedReply({ reply: end, sections: empty, rows, transcript, options: none });
    expect(warnings.some((w) => w.includes('No sentences between 1:00 and 4:00'))).toBe(true);
  });

  it('flags a ticked extra whose section is missing', () => {
    const rows = [0, 60, 120, 180, 240, 300].map((s) => row(s, s + 55));
    const warnings = checkCombinedReply({
      reply: end,
      sections: empty,
      rows,
      transcript,
      options: { ...none, structure: true },
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('STRUCTURE');
  });
});
