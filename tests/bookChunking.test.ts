import { describe, expect, it } from 'vitest';

import { formatBookChunkingPrompt, parseBookChunkingReply, type ChunkingCandidate } from '../src/lib/bookChunking';

const batch: ChunkingCandidate[] = [
  { sentenceId: 's1', chapterId: 'c1', japanese: '私は本を読みます。', translation: 'I read a book.', context: [] },
  { sentenceId: 's2', chapterId: 'c2', japanese: '紙です。', context: ['私は本を読みます。'] },
];

describe('book chunking batch', () => {
  it('numbers sentences S1.. and includes the English meaning', () => {
    const prompt = formatBookChunkingPrompt(batch);
    expect(prompt).toContain('=== S1 ===');
    expect(prompt).toContain('sentence: 紙です。');
    expect(prompt).toContain('English: I read a book.');
  });

  it('groups valid drafts by chapter and rejects chunks that do not rebuild the sentence', () => {
    const reply = [
      'S1 | 私は | topic は | as for me',
      'S1 | 本を | object を | the book (object)',
      'S1 | 読みます。 | engine: verb | read',
      'S2 | 紙 | noun | paper',
    ].join('\n');
    const parsed = parseBookChunkingReply(reply, batch);
    expect(parsed.saved).toBe(1);
    expect(parsed.byChapter.get('c1')?.s1?.map((chunk) => chunk.japanese)).toEqual(['私は', '本を', '読みます。']);
    expect(parsed.byChapter.has('c2')).toBe(false);
    expect(parsed.rejected.map((item) => item.handle)).toContain('S2');
  });
});
