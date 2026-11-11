import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  createBook,
  ensureStudyItem,
  getDb,
  mergeAdjacentSentences,
} from '../src/db/repository';
import type { Sentence, SentenceAudio } from '../src/domain/types';
import { createId, sentenceIdFromNormalizedKey } from '../src/lib/ids';
import {
  suggestMergedJapanese,
  validateMergedJapanese,
} from '../src/lib/mergeSentences';
import { nowIso, normalizeSentenceKey } from '../src/lib/normalize';

vi.mock('../src/sync/track', () => ({
  // Unknown sign-in state: repository falls back to the post-commit trackLocalMutation path.
  trackLocalMutationsInTransaction: async () => false,
  requestSyncAfterCommit: () => {},
  trackLocalMutation: vi.fn().mockResolvedValue(undefined),
}));

function makeSentence(japanese: string, index: number): Sentence {
  const normalizedKey = normalizeSentenceKey(japanese);
  return {
    id: sentenceIdFromNormalizedKey(normalizedKey),
    normalizedKey,
    japanese,
    readingOnly: `r${index}`,
    inlineReading: `i${index}`,
    translation: `T${index}`,
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [
      {
        cardId: `src-VID:sentence-${index}`,
        cardType: 'SHADOWING',
        contextNumber: 1,
        userNotes: 'Video position: 1.0–2.0 seconds',
        importBatchId: 'batch_old',
      },
    ],
    conflicts: [],
    firstOccurrenceIndex: index,
    importBatchIds: ['batch_old'],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function audioFor(sentenceId: string, startMs: number, endMs: number): SentenceAudio {
  return {
    id: createId('audio'),
    sentenceId,
    sourceId: 'src-VID',
    sourceSentenceId: `src-VID:${sentenceId}`,
    sourceTitle: 'Drama',
    sourceUrl: 'https://example.test/video',
    mimeType: 'audio/mp4',
    durationMs: endMs - startMs,
    startMs,
    endMs,
    blob: new Blob(['x']),
    importedAt: nowIso(),
  };
}

async function seed(withAudio = true) {
  const db = getDb();
  const book = await createBook({ title: 'Drama' });
  const before = makeSentence('前の文です。', 0);
  const a = makeSentence('今日は寒かったです。', 1);
  const b = makeSentence('でも楽しかった。', 2);
  const after = makeSentence('後の文です。', 3);
  await db.sentences.bulkPut([before, a, b, after]);
  const rows = [before, a, b, after].map((s, position) => ({
    id: createId('bs'),
    bookId: book.id,
    sentenceId: s.id,
    position,
    status: s === a ? ('complete' as const) : ('unstarted' as const),
    addedAt: nowIso(),
  }));
  await db.bookSentences.bulkPut(rows);
  if (withAudio) {
    await db.sentenceAudio.bulkPut([audioFor(a.id, 1000, 2000), audioFor(b.id, 2100, 3000)]);
  }
  return { book, before, a, b, after };
}

const noAnnotate = async () => {
  throw new Error('mining service down');
};
const cutClip = async (_url: string, cuts: { startMs: number; endMs: number }[]) =>
  cuts.map((cut) => ({ blob: new Blob(['merged']), durationMs: cut.endMs - cut.startMs }));

describe('merge text helpers', () => {
  it('drops the first full stop and joins with a comma', () => {
    expect(suggestMergedJapanese('今日は寒かったです。', 'でも楽しかった。')).toBe(
      '今日は寒かったです、でも楽しかった。',
    );
  });

  it('rejects text that rewrites either sentence', () => {
    expect(validateMergedJapanese('今日は寒い。', '楽しい。', '今日は寒いが、楽しい。').ok).toBe(true);
    expect(validateMergedJapanese('今日は寒い。', '楽しい。', '昨日は寒いが、楽しい。').ok).toBe(false);
    expect(validateMergedJapanese('今日は寒い。', '楽しい。', '今日は寒い、と思ったけど全然楽しい。').ok).toBe(false);
  });
});

describe('mergeAdjacentSentences', () => {
  beforeEach(() => {
    resetDbForTests(`merge-${createId('db')}`);
  });

  it('replaces the pair in place, keeps the better card, and re-cuts audio', async () => {
    const { book, before, a, b, after } = await seed();
    const db = getDb();
    const aCard = await ensureStudyItem('sentence', a.id, 'reading_in_context');
    const bCard = await ensureStudyItem('sentence', b.id, 'reading_in_context');
    await db.studyItems.put({ ...bCard, fsrsState: { ...bCard.fsrsState, reps: 6 } });
    for (let i = 0; i < 3; i += 1) {
      await db.reviews.put({ id: createId('review'), studyItemId: bCard.id, timestamp: nowIso(), rating: 'good' });
    }

    const result = await mergeAdjacentSentences(book.id, a.id, b.id, {
      japanese: '今日は寒かったですが、でも楽しかった。',
      translation: 'It was cold today but fun.',
      annotate: noAnnotate,
      clipFromSource: cutClip,
    });

    expect(result.annotated).toBe(false);
    expect(result.audioRecut).toBe(true);
    expect(await db.sentences.get(a.id)).toBeUndefined();
    expect(await db.sentences.get(b.id)).toBeUndefined();
    const merged = (await db.sentences.get(result.sentenceId))!;
    expect(merged.translation).toBe('It was cold today but fun.');
    expect(merged.sourceReferences[0]!.userNotes).toContain('Video position: 1.000–3.000');

    // Book order: before, merged, after — contiguous positions, status kept.
    const members = await db.bookSentences.where('bookId').equals(book.id).sortBy('position');
    expect(members.map((m) => m.sentenceId)).toEqual([before.id, result.sentenceId, after.id]);
    expect(members.map((m) => m.position)).toEqual([0, 1, 2]);
    expect(members[1]!.status).toBe('complete');

    // The more-reviewed card moved over with its FSRS history; the other is gone.
    expect(await db.studyItems.get(aCard.id)).toBeUndefined();
    const moved = (await db.studyItems.get(bCard.id))!;
    expect(moved.subjectId).toBe(result.sentenceId);
    expect(moved.fsrsState.reps).toBe(6);

    // One clip spanning both, old clips retired.
    const clips = await db.sentenceAudio.toArray();
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({ sentenceId: result.sentenceId, startMs: 1000, endMs: 3000 });
  });

  it('refuses a merge whose audio cannot be re-cut, changing nothing', async () => {
    const { book, a, b } = await seed();
    await expect(
      mergeAdjacentSentences(book.id, a.id, b.id, {
        annotate: noAnnotate,
        clipFromSource: async () => {
          throw new Error('offline');
        },
      }),
    ).rejects.toThrow(/re-cut the audio/);
    const db = getDb();
    expect(await db.sentences.get(a.id)).toBeDefined();
    expect(await db.sentenceAudio.count()).toBe(2);
  });

  it('refuses sentences that are not neighbours or whose text was rewritten', async () => {
    const { book, before, a, b, after } = await seed(false);
    await expect(mergeAdjacentSentences(book.id, before.id, b.id)).rejects.toThrow(/neighbouring/);
    await expect(mergeAdjacentSentences(book.id, b.id, a.id)).rejects.toThrow(/neighbouring/);
    await expect(
      mergeAdjacentSentences(book.id, a.id, b.id, { japanese: '全然違う文です。', annotate: noAnnotate }),
    ).rejects.toThrow(/must start with/);
    expect(await getDb().sentences.get(after.id)).toBeDefined();
  });

  it('merges audio-less sentences without the mining service', async () => {
    const { book, a, b } = await seed(false);
    const result = await mergeAdjacentSentences(book.id, a.id, b.id, { annotate: noAnnotate });
    expect(result.audioRecut).toBe(false);
    const merged = (await getDb().sentences.get(result.sentenceId))!;
    expect(merged.japanese).toBe('今日は寒かったです、でも楽しかった。');
    expect(merged.readingOnly).toBe('r1r2');
  });
});
