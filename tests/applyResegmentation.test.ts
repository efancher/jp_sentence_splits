import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  applyResegmentation,
  createBook,
  deleteBookCascade,
  deleteSentenceCascade,
  ensureStudyItem,
  getDb,
} from '../src/db/repository';
import { createId, sentenceIdFromNormalizedKey } from '../src/lib/ids';
import { nowIso, normalizeSentenceKey } from '../src/lib/normalize';
import { buildResegmentPlan } from '../src/lib/resegmentPlan';
import type { Sentence } from '../src/domain/types';

vi.mock('../src/sync/track', () => ({
  trackLocalMutation: vi.fn().mockResolvedValue(undefined),
}));

function shadowingSentence(japanese: string, index: number): Sentence {
  const normalizedKey = normalizeSentenceKey(japanese);
  return {
    id: sentenceIdFromNormalizedKey(normalizedKey),
    normalizedKey,
    japanese,
    readingOnly: '',
    inlineReading: '',
    translation: `T${index}`,
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [
      {
        cardId: `source-VID:sentence-${String(index).padStart(3, '0')}`,
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

async function seedSource() {
  const db = getDb();
  const book = await createBook({ title: 'After Work' });
  // Two fragmented sentences that should merge/re-split into three clean ones.
  const a = shadowingSentence('さすがです。水希。たったの', 0);
  const b = shadowingSentence('1ヶ月だよ。変わんないじゃん。', 1);
  await db.sentences.bulkPut([a, b]);
  await db.bookSentences.bulkPut([
    { id: createId('bs'), bookId: book.id, sentenceId: a.id, position: 0, status: 'unstarted', addedAt: nowIso() },
    { id: createId('bs'), bookId: book.id, sentenceId: b.id, position: 1, status: 'unstarted', addedAt: nowIso() },
  ]);
  return { book, a, b };
}

async function bumpReviews(studyItemId: string, count: number) {
  const db = getDb();
  for (let i = 0; i < count; i += 1) {
    await db.reviews.put({
      id: createId('review'),
      studyItemId,
      timestamp: nowIso(),
      rating: 'good',
    });
  }
  const item = await db.studyItems.get(studyItemId);
  if (item) {
    await db.studyItems.put({
      ...item,
      fsrsState: { ...item.fsrsState, reps: count, state: 'review', stability: 5 },
    });
  }
}

async function planFor(
  oldIds: string[],
  segments: string[],
  timings?: [number, number][],
) {
  const db = getDb();
  const olds = await Promise.all(
    oldIds.map(async (id) => {
      const sentence = (await db.sentences.get(id))!;
      const studyItems = (await db.studyItems.where('subjectId').equals(id).toArray()).filter(
        (si) => si.subjectType === 'sentence',
      );
      return {
        id,
        japanese: sentence.japanese,
        translation: sentence.translation,
        studyItems: await Promise.all(
          studyItems.map(async (si) => ({
            id: si.id,
            activityType: si.activityType,
            fsrsReps: si.fsrsState.reps,
            reviewCount: await db.reviews.where('studyItemId').equals(si.id).count(),
          })),
        ),
      };
    }),
  );
  return buildResegmentPlan(
    olds,
    segments.map((japanese, i) => ({
      japanese,
      translation: '',
      readingOnly: '',
      inlineReading: '',
      tokens: [],
      startMs: timings?.[i]?.[0],
      endMs: timings?.[i]?.[1],
    })),
  );
}

describe('applyResegmentation', () => {
  beforeEach(() => {
    resetDbForTests(`reseg-${createId('db')}`);
  });

  it('replaces fragments with clean sentences and carries study progress', async () => {
    const { book, a, b } = await seedSource();
    const aStudy = await ensureStudyItem('sentence', a.id, 'comprehension');
    const bStudy = await ensureStudyItem('sentence', b.id, 'comprehension');
    await bumpReviews(aStudy.id, 4);
    await bumpReviews(bStudy.id, 9);

    const segments = ['さすがです。', '水希。', 'たったの1ヶ月だよ。', '変わんないじゃん。'];
    const plan = await planFor([a.id, b.id], segments);
    const { newSentenceIds } = await applyResegmentation(book.id, plan);

    const db = getDb();
    // Old sentences gone, new ones present.
    expect(await db.sentences.get(a.id)).toBeUndefined();
    expect(await db.sentences.get(b.id)).toBeUndefined();
    expect(newSentenceIds).toHaveLength(4);
    const fresh = (await db.sentences.bulkGet(newSentenceIds)).filter(Boolean);
    expect(fresh.map((s) => s!.japanese)).toEqual(segments);

    // Book order is the four new sentences, in segment order.
    const membership = await db.bookSentences.where('bookId').equals(book.id).sortBy('position');
    expect(membership.map((m) => m.sentenceId)).toEqual(newSentenceIds);

    // Study progress followed the best-overlap segment, FSRS state intact.
    const studyItems = await db.studyItems.toArray();
    expect(studyItems).toHaveLength(2);
    const aMoved = studyItems.find((si) => si.id === aStudy.id)!;
    const bMoved = studyItems.find((si) => si.id === bStudy.id)!;
    expect(aMoved.subjectId).toBe(sentenceIdFromNormalizedKey(normalizeSentenceKey('さすがです。')));
    expect(bMoved.subjectId).toBe(
      sentenceIdFromNormalizedKey(normalizeSentenceKey('変わんないじゃん。')),
    );
    expect(bMoved.fsrsState.reps).toBe(9);
  });

  it('retires the losing card when two fragments collapse into one sentence', async () => {
    const { book, a, b } = await seedSource();
    const aStudy = await ensureStudyItem('sentence', a.id, 'comprehension');
    const bStudy = await ensureStudyItem('sentence', b.id, 'comprehension');
    await bumpReviews(aStudy.id, 2);
    await bumpReviews(bStudy.id, 15);

    // One merged segment — both old sentences map to it.
    const plan = await planFor([a.id, b.id], ['さすがです。水希。たったの1ヶ月だよ。変わんないじゃん。']);
    await applyResegmentation(book.id, plan);

    const db = getDb();
    const studyItems = await db.studyItems.toArray();
    expect(studyItems).toHaveLength(1);
    expect(studyItems[0]!.id).toBe(bStudy.id);
    expect(studyItems[0]!.fsrsState.reps).toBe(15);
  });

  it('repoints a surviving vocabulary link and drops a vanished one', async () => {
    const db = getDb();
    const book = await createBook({ title: 'After Work' });
    // One bundled cue that splits into three sentences.
    const s = shadowingSentence('さすがです。水希。たったの1ヶ月だよ。', 0);
    await db.sentences.put(s);
    await db.bookSentences.put({
      id: createId('bs'),
      bookId: book.id,
      sentenceId: s.id,
      position: 0,
      status: 'unstarted',
      addedAt: nowIso(),
    });
    await db.sentenceVocabulary.bulkPut([
      { id: 'sv_keep', sentenceId: s.id, vocabularyItemId: 'vocab_1', surfaceForm: 'たったの', createdAt: nowIso() },
      { id: 'sv_drop', sentenceId: s.id, vocabularyItemId: 'vocab_2', surfaceForm: '水希', createdAt: nowIso() },
    ]);

    const plan = await planFor([s.id], ['さすがです。', '水希。', 'たったの1ヶ月だよ。']);
    await applyResegmentation(book.id, plan);

    // The whole old sentence maps to its largest piece ("たったの1ヶ月だよ。"),
    // so the surviving "たったの" link follows it and the "水希" link is dropped.
    const links = await db.sentenceVocabulary.toArray();
    expect(links).toHaveLength(1);
    expect(links[0]!.id).toBe('sv_keep');
    expect(links[0]!.sentenceId).toBe(
      sentenceIdFromNormalizedKey(normalizeSentenceKey('たったの1ヶ月だよ。')),
    );
  });

  it('re-cuts reference audio onto the new sentences and retires the old clip', async () => {
    const db = getDb();
    const book = await createBook({ title: 'After Work' });
    const s = shadowingSentence('さすがです。水希。たったの1ヶ月だよ。', 0);
    await db.sentences.put(s);
    await db.bookSentences.put({
      id: createId('bs'),
      bookId: book.id,
      sentenceId: s.id,
      position: 0,
      status: 'unstarted',
      addedAt: nowIso(),
    });
    await db.sentenceAudio.put({
      id: 'audio_old',
      sentenceId: s.id,
      sourceId: 'source-VID',
      sourceSentenceId: 'source-VID:sentence-000',
      sourceTitle: 'After Work',
      mimeType: 'audio/mp4',
      durationMs: 3000,
      startMs: 1000,
      endMs: 4000,
      blob: new Blob(['parent-audio'], { type: 'audio/mp4' }),
      importedAt: nowIso(),
    });

    const reclip = vi
      .fn()
      .mockImplementation(async (_clips: Blob[], cuts: { startMs: number; endMs: number }[]) =>
        cuts.map(() => ({ blob: new Blob(['cut'], { type: 'audio/mp4' }), durationMs: 900 })),
      );

    const plan = await planFor(
      [s.id],
      ['さすがです。', '水希。', 'たったの1ヶ月だよ。'],
      [
        [1000, 1800],
        [1800, 2400],
        [2400, 4000],
      ],
    );
    await applyResegmentation(book.id, plan, { reclip });

    expect(reclip).toHaveBeenCalledTimes(3);
    expect(await db.sentenceAudio.get('audio_old')).toBeUndefined();
    const clips = await db.sentenceAudio.toArray();
    expect(clips).toHaveLength(3);
    expect(new Set(clips.map((c) => c.sentenceId))).toEqual(
      new Set(
        ['さすがです。', '水希。', 'たったの1ヶ月だよ。'].map((j) =>
          sentenceIdFromNormalizedKey(normalizeSentenceKey(j)),
        ),
      ),
    );
    expect(clips.every((c) => c.durationMs === 900 && c.sourceId === 'source-VID')).toBe(true);
  });

  it('still applies when audio re-cutting throws (mining service down)', async () => {
    const { book, a, b } = await seedSource();
    const db = getDb();
    await db.sentenceAudio.put({
      id: 'audio_a',
      sentenceId: a.id,
      sourceId: 'source-VID',
      sourceSentenceId: 'x',
      sourceTitle: 'After Work',
      mimeType: 'audio/mp4',
      durationMs: 1000,
      startMs: 0,
      endMs: 1000,
      blob: new Blob(['x'], { type: 'audio/mp4' }),
      importedAt: nowIso(),
    });
    const reclip = vi.fn().mockRejectedValue(new Error('unreachable'));
    const plan = await planFor(
      [a.id, b.id],
      ['さすがです。', '水希。', 'たったの1ヶ月だよ。', '変わんないじゃん。'],
      [[0, 500], [500, 1000], [1000, 1500], [1500, 2000]],
    );
    const { newSentenceIds } = await applyResegmentation(book.id, plan, { reclip });
    expect(newSentenceIds).toHaveLength(4);
    // Old clip untouched, no new clips — re-segmentation itself still landed.
    expect(await db.sentenceAudio.get('audio_a')).toBeDefined();
    expect(await db.sentenceAudio.count()).toBe(1);
  });
});

describe('deleteSentenceCascade', () => {
  beforeEach(() => {
    resetDbForTests(`reseg-del-${createId('db')}`);
  });

  it('removes the sentence and everything hanging off it', async () => {
    const db = getDb();
    const book = await createBook({ title: 'B' });
    const s = shadowingSentence('これはテストです。', 0);
    await db.sentences.put(s);
    await db.bookSentences.put({
      id: createId('bs'),
      bookId: book.id,
      sentenceId: s.id,
      position: 0,
      status: 'unstarted',
      addedAt: nowIso(),
    });
    const study = await ensureStudyItem('sentence', s.id, 'comprehension');
    await db.analyses.put({
      sentenceId: s.id,
      chunks: [],
      notes: '',
      status: 'draft',
      formatVersion: 1,
      vocabularyReviewStatus: 'unreviewed',
      vocabularySelections: [],
      grammarSuggestions: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });

    await deleteSentenceCascade(s.id);

    expect(await db.sentences.get(s.id)).toBeUndefined();
    expect(await db.analyses.get(s.id)).toBeUndefined();
    expect(await db.studyItems.get(study.id)).toBeUndefined();
    expect(await db.bookSentences.where('sentenceId').equals(s.id).count()).toBe(0);
  });
});

describe('deleteBookCascade', () => {
  beforeEach(() => {
    resetDbForTests(`book-cascade-del-${createId('db')}`);
  });

  it('deletes the book and its orphaned sentences but keeps shared ones', async () => {
    const db = getDb();
    const bookA = await createBook({ title: 'A' });
    const bookB = await createBook({ title: 'B' });
    const orphan = shadowingSentence('これは孤立です。', 0);
    const shared = shadowingSentence('これは共有です。', 1);
    await db.sentences.bulkPut([orphan, shared]);
    await db.bookSentences.bulkPut([
      { id: createId('bs'), bookId: bookA.id, sentenceId: orphan.id, position: 0, status: 'unstarted', addedAt: nowIso() },
      { id: createId('bs'), bookId: bookA.id, sentenceId: shared.id, position: 1, status: 'unstarted', addedAt: nowIso() },
      { id: createId('bs'), bookId: bookB.id, sentenceId: shared.id, position: 0, status: 'unstarted', addedAt: nowIso() },
    ]);
    const orphanStudy = await ensureStudyItem('sentence', orphan.id, 'comprehension');

    await deleteBookCascade(bookA.id);

    expect(await db.books.get(bookA.id)).toBeUndefined();
    expect(await db.sentences.get(orphan.id)).toBeUndefined();
    expect(await db.studyItems.get(orphanStudy.id)).toBeUndefined();
    expect(await db.sentences.get(shared.id)).toBeDefined();
    expect(await db.bookSentences.where('bookId').equals(bookA.id).count()).toBe(0);
    expect(await db.bookSentences.where('bookId').equals(bookB.id).count()).toBe(1);
  });
});
