import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { commitSeriesEpisodeImport, getDb, saveContextWalkthroughsByChapter } from '../src/db/repository';
import {
  formatBookWalkthroughPrompt,
  parseBookWalkthroughReply,
  planBookWalkthroughs,
} from '../src/lib/bookWalkthroughs';
import { buildShadowingPreview } from '../src/lib/shadowingImport';

const NOW = '2026-10-05T00:00:00.000Z';
const LINES = ['昨日は二つ持ってきました。', 'もう一つは紙、何かを書いたりするやつですね。', '便利ですよ。'];

function reply(handle: string, text: string, natural: string) {
  return { natural, steps: [{ text, gloss: 'g', explanation: 'e' }] };
}

describe('book-wide walkthrough import', () => {
  let bookId = '';
  let chapterId = '';

  beforeEach(async () => {
    await resetDbForTests();
    const preview = buildShadowingPreview(
      { id: 'ep', type: 'other', title: 'Ep' },
      { format: 'japanese-shadowing-package', version: 2 as const, createdAt: NOW, generator: { name: 't', version: '1' } },
      LINES.map((japanese, index) => ({ id: `ep-${index}`, japanese, startMs: 0, endMs: 1000, tags: [], transcriptStatus: 'verified' as const })),
      [],
      [],
    );
    ({ bookId, chapterId } = await commitSeriesEpisodeImport({ seriesId: 'se', seriesTitle: 'S', episodeTitle: 'Ep', sourceId: 'src', sourceDate: NOW, preview }));
  });

  it('plans book-position handles, builds a prompt with context, and merges replies applied one after another', async () => {
    const plan = await planBookWalkthroughs(bookId);
    expect(plan.pending).toEqual(['S1', 'S2', 'S3']);
    const prompt = formatBookWalkthroughPrompt(plan, ['S2']);
    expect(prompt).toContain('EXPLAIN THESE:\nS2: ' + LINES[1]);
    expect(prompt).toContain('S1: ' + LINES[0]);
    expect(prompt).toContain('S3: ' + LINES[2]);

    const first = parseBookWalkthroughReply(JSON.stringify({ walkthroughs: { S2: reply('S2', '紙', 'paper') } }), plan);
    expect(first.error).toBeUndefined();
    expect(first.saved).toBe(1);
    await saveContextWalkthroughsByChapter(bookId, first.byChapter);

    // Bare handle-keyed object is accepted, and the second reply merges rather than replaces.
    const second = parseBookWalkthroughReply(JSON.stringify({ S3: reply('S3', '便利', 'handy'), S9: reply('S9', 'x', 'x') }), plan);
    expect(second.saved).toBe(1);
    expect(second.rejected.map((item) => item.handle)).toEqual(['S9']);
    await saveContextWalkthroughsByChapter(bookId, second.byChapter);

    const chapter = (await getDb().books.get(bookId))!.chapters.find((c) => c.id === chapterId)!;
    expect(Object.keys(chapter.contextWalkthroughs ?? {})).toHaveLength(2);
    expect((await planBookWalkthroughs(bookId)).pending).toEqual(['S1']);
  });

  it('refuses an unreadable reply without changing anything', async () => {
    const plan = await planBookWalkthroughs(bookId);
    const result = parseBookWalkthroughReply('not json at all', plan);
    expect(result.error).toBeTruthy();
    expect(result.byChapter.size).toBe(0);
  });
});
