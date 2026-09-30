import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  clearEpisodePreparation,
  commitSeriesEpisodeImport,
  getDb,
  getEpisodePreparationContext,
  saveEpisodePreparationReply,
  updatePreparedTarget,
} from '../src/db/repository';
import {
  buildPreparationPrompt,
  episodeFingerprint,
  isPreparationStale,
  MAX_PREPARED_TARGETS,
  parsePreparationReply,
  type PreparationContext,
} from '../src/lib/episodePreparation';
import { createId } from '../src/lib/ids';
import { buildShadowingPreview } from '../src/lib/shadowingImport';
import { parseBackupJson } from '../src/lib/backup';
import { exportFullBackup } from '../src/db/repository';

const NOW = '2026-09-30T00:00:00.000Z';

const context: PreparationContext = {
  title: 'Episode 1',
  sentences: [
    { id: 's-a', japanese: '本を読みます。' },
    { id: 's-b', japanese: '本を買いました。' },
    { id: 's-c', japanese: 'ええと、電気を消しました。' },
  ],
  vocabulary: [{ id: 'v-book', expression: '本', reading: 'ほん', meaning: 'book' }],
  grammar: [{ id: 'g-mashita', canonicalName: '〜ました', shortMeaning: 'polite past' }],
};

const good = {
  version: 1,
  targets: [
    {
      kind: 'vocabulary',
      ref: 'V1',
      label: '本',
      treatment: 'recall',
      reason: 'Recurs across the episode.',
      occurrences: [{ sentence: 'S1', text: '本' }, { sentence: 'S2', text: '本' }],
    },
    {
      kind: 'expression',
      label: 'ええと',
      treatment: 'gloss_only',
      reason: 'Filler.',
      occurrences: [{ sentence: 'S3', text: 'ええと' }],
    },
  ],
};

describe('parsePreparationReply', () => {
  it('accepts a valid reply and computes offsets locally', () => {
    const result = parsePreparationReply(JSON.stringify(good), context, NOW);
    expect(result.status).toBe('ready');
    expect(result.targets).toHaveLength(2);
    expect(result.targets[0]).toMatchObject({
      vocabularyItemId: 'v-book',
      decision: 'suggested',
      occurrences: [
        { sentenceId: 's-a', start: 0, end: 1, text: '本' },
        { sentenceId: 's-b', start: 0, end: 1, text: '本' },
      ],
    });
    expect(result.targets[1]!.treatment).toBe('gloss_only');
  });

  it('reads JSON out of a fenced, chatty reply', () => {
    const reply = `Sure! Here you go:\n\`\`\`json\n${JSON.stringify(good)}\n\`\`\`\nHope that helps.`;
    expect(parsePreparationReply(reply, context, NOW).status).toBe('ready');
  });

  it('rejects invented sentences, refs and quoted text but keeps valid targets (partial)', () => {
    const reply = JSON.stringify({
      version: 1,
      targets: [
        good.targets[0],
        { kind: 'vocabulary', ref: 'V9', label: '幻', occurrences: [{ sentence: 'S1', text: '本' }] },
        { kind: 'expression', label: '存在しない', occurrences: [{ sentence: 'S1', text: '存在しない' }] },
        { kind: 'expression', label: '別文', occurrences: [{ sentence: 'S99', text: '本' }] },
        { kind: 'grammar', label: '〜ました', occurrences: [{ sentence: 'S2', text: 'ました' }] },
        { kind: 'expression', ref: 'V1', label: '本を', occurrences: [{ sentence: 'S1', text: '本を' }] },
      ],
    });
    const result = parsePreparationReply(reply, context, NOW);
    expect(result.status).toBe('partial');
    expect(result.targets.map((t) => t.label)).toEqual(['本']);
    expect(result.rejected.map((r) => r.reason)).toEqual([
      'Unknown vocabulary ref "V9".',
      'No quoted occurrence matched a real sentence.',
      'No quoted occurrence matched a real sentence.',
      'A grammar target needs a ref from the supplied list.',
      'An expression target must not carry a ref.',
    ]);
  });

  it('drops only the bad occurrences of an otherwise valid target', () => {
    const reply = JSON.stringify({
      version: 1,
      targets: [
        { kind: 'vocabulary', ref: 'V1', label: '本', occurrences: [{ sentence: 'S1', text: '本' }, { sentence: 'S3', text: '本' }] },
      ],
    });
    const result = parsePreparationReply(reply, context, NOW);
    expect(result.status).toBe('ready');
    expect(result.targets[0]!.occurrences).toHaveLength(1);
  });

  it('fails cleanly on unparseable, wrong-shaped or all-invalid replies', () => {
    expect(parsePreparationReply('I cannot help with that.', context, NOW)).toMatchObject({ status: 'failed', targets: [] });
    expect(parsePreparationReply('{"foo": 1}', context, NOW).error).toMatch(/targets/);
    expect(parsePreparationReply('{"targets": [', context, NOW).status).toBe('failed');
    const allBad = parsePreparationReply(
      JSON.stringify({ targets: [{ kind: 'vocabulary', ref: 'V7', label: 'x', occurrences: [] }] }),
      context,
      NOW,
    );
    expect(allBad.status).toBe('failed');
    expect(allBad.rejected).toHaveLength(1);
  });

  it('caps the number of targets and rejects duplicates of one ref', () => {
    const many = Array.from({ length: MAX_PREPARED_TARGETS + 2 }, () => ({
      kind: 'expression', label: '本', occurrences: [{ sentence: 'S1', text: '本' }],
    }));
    const capped = parsePreparationReply(JSON.stringify({ targets: many }), context, NOW);
    expect(capped.targets).toHaveLength(MAX_PREPARED_TARGETS);
    expect(capped.rejected).toHaveLength(2);
    const duplicate = parsePreparationReply(JSON.stringify({ targets: [good.targets[0], good.targets[0]] }), context, NOW);
    expect(duplicate.rejected[0]!.reason).toMatch(/Duplicate ref/);
  });
});

describe('prompt and staleness', () => {
  it('uses handles, never database ids, and lists the episode text', () => {
    const prompt = buildPreparationPrompt(context);
    expect(prompt).toContain('S1: 本を読みます。');
    expect(prompt).toContain('V1: 本（ほん） — book');
    expect(prompt).toContain('G1: 〜ました');
    expect(prompt).not.toContain('s-a');
    expect(prompt).not.toContain('v-book');
  });

  it('is stale once the episode text changes, but not for identical text', () => {
    const prep = parsePreparationReply(JSON.stringify(good), context, NOW);
    expect(isPreparationStale(prep, context.sentences)).toBe(false);
    expect(isPreparationStale(prep, [...context.sentences, { id: 's-d', japanese: '追加。' }])).toBe(true);
    expect(isPreparationStale(prep, [{ id: 's-a', japanese: '本を読みました。' }, ...context.sentences.slice(1)])).toBe(true);
    expect(episodeFingerprint(context.sentences)).toBe(episodeFingerprint([...context.sentences]));
  });
});

describe('episode preparation persistence', () => {
  beforeEach(() => {
    resetDbForTests(`prep-${createId('db')}`);
  });

  async function seedEpisode() {
    const preview = buildShadowingPreview(
      { id: 'ep', type: 'other', title: 'Episode 1' },
      { format: 'japanese-shadowing-package', version: 2 as const, createdAt: NOW, generator: { name: 't', version: '1' } },
      ['本を読みます。', '本を買いました。'].map((japanese, index) => ({
        id: `ep-${index}`, japanese, startMs: 0, endMs: 1000, tags: [], transcriptStatus: 'verified' as const,
      })),
      [],
      [],
    );
    const { bookId, chapterId } = await commitSeriesEpisodeImport({
      seriesId: 'series', seriesTitle: 'Series', episodeTitle: 'Episode 1', sourceId: 'src', sourceDate: NOW, preview,
    });
    const rows = await getDb().bookSentences.where('bookId').equals(bookId).sortBy('position');
    const now = NOW;
    await getDb().vocabularyItems.put({ id: 'w', expression: '本', reading: 'ほん', meaning: 'book', createdAt: now, updatedAt: now });
    for (const row of rows) {
      await getDb().sentenceVocabulary.put({ id: `sv-${row.sentenceId}`, sentenceId: row.sentenceId, vocabularyItemId: 'w', surfaceForm: '本', createdAt: now, updatedAt: now });
    }
    return { bookId, chapterId, sentenceIds: rows.map((row) => row.sentenceId) };
  }

  const reply = (handles: string[]) =>
    JSON.stringify({
      targets: [{ kind: 'vocabulary', ref: 'V1', label: '本', reason: 'Recurs.', occurrences: handles.map((sentence) => ({ sentence, text: '本' })) }],
    });

  it('stores a validated result on the chapter, with provenance', async () => {
    const { bookId, chapterId, sentenceIds } = await seedEpisode();
    const saved = await saveEpisodePreparationReply(bookId, chapterId, reply(['S1', 'S2']));
    expect(saved.status).toBe('ready');
    const { preparation, context: ctx } = await getEpisodePreparationContext(bookId, chapterId);
    expect(preparation?.provenance).toBe('pasted_ai_reply');
    expect(preparation?.targets[0]?.vocabularyItemId).toBe('w');
    expect(preparation?.targets[0]?.occurrences.map((o) => o.sentenceId)).toEqual(sentenceIds);
    expect(ctx.vocabulary).toEqual([{ id: 'w', expression: '本', reading: 'ほん', meaning: 'book' }]);
    expect(isPreparationStale(preparation!, ctx.sentences)).toBe(false);
  });

  it('does not touch sentences, study items or reviews', async () => {
    const { bookId, chapterId } = await seedEpisode();
    const before = { sentences: await getDb().sentences.count(), studyItems: await getDb().studyItems.count(), reviews: await getDb().reviews.count() };
    await saveEpisodePreparationReply(bookId, chapterId, reply(['S1']));
    expect({ sentences: await getDb().sentences.count(), studyItems: await getDb().studyItems.count(), reviews: await getDb().reviews.count() }).toEqual(before);
  });

  it('a failed reply is stored when nothing usable exists, but never replaces a usable result', async () => {
    const { bookId, chapterId } = await seedEpisode();
    const failed = await saveEpisodePreparationReply(bookId, chapterId, 'not json');
    expect(failed.status).toBe('failed');
    expect((await getEpisodePreparationContext(bookId, chapterId)).preparation?.status).toBe('failed');

    await saveEpisodePreparationReply(bookId, chapterId, reply(['S1']));
    const again = await saveEpisodePreparationReply(bookId, chapterId, 'still not json');
    expect(again.status).toBe('failed');
    const kept = (await getEpisodePreparationContext(bookId, chapterId)).preparation;
    expect(kept?.status).toBe('ready');
    expect(kept?.targets).toHaveLength(1);
  });

  it('keeps learner decisions and notes when a fresh reply proposes the same target', async () => {
    const { bookId, chapterId } = await seedEpisode();
    const first = await saveEpisodePreparationReply(bookId, chapterId, reply(['S1']));
    const targetId = first.targets[0]!.id;
    await updatePreparedTarget(bookId, chapterId, targetId, { decision: 'dismissed', learnerNote: '  too basic  ' });
    let stored = (await getEpisodePreparationContext(bookId, chapterId)).preparation!;
    expect(stored.targets[0]).toMatchObject({ decision: 'dismissed', learnerNote: 'too basic', reason: 'Recurs.' });

    await saveEpisodePreparationReply(bookId, chapterId, reply(['S1', 'S2']));
    stored = (await getEpisodePreparationContext(bookId, chapterId)).preparation!;
    expect(stored.targets[0]).toMatchObject({ decision: 'dismissed', learnerNote: 'too basic' });
    expect(stored.targets[0]!.occurrences).toHaveLength(2);
  });

  it('goes stale when an episode sentence is added, and can be cleared', async () => {
    const { bookId, chapterId } = await seedEpisode();
    await saveEpisodePreparationReply(bookId, chapterId, reply(['S1']));
    const now = NOW;
    await getDb().sentences.put({
      id: 's-new', normalizedKey: 's-new', japanese: '新しい文。', readingOnly: '', inlineReading: '', translation: '',
      targetVocabulary: [], vocabularySuggestions: [], sourceReferences: [], conflicts: [], firstOccurrenceIndex: 9,
      importBatchIds: [], createdAt: now, updatedAt: now,
    });
    await getDb().bookSentences.put({ id: 'bs-new', bookId, sentenceId: 's-new', position: 9, status: 'unstarted', addedAt: now, chapterId });
    const { preparation, context: ctx } = await getEpisodePreparationContext(bookId, chapterId);
    expect(isPreparationStale(preparation!, ctx.sentences)).toBe(true);
    await clearEpisodePreparation(bookId, chapterId);
    expect((await getEpisodePreparationContext(bookId, chapterId)).preparation).toBeUndefined();
  });

  it('survives a backup round trip', async () => {
    const { bookId, chapterId } = await seedEpisode();
    await saveEpisodePreparationReply(bookId, chapterId, reply(['S1', 'S2']));
    const parsed = parseBackupJson(JSON.stringify(await exportFullBackup()));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const chapter = parsed.data.books.find((book) => book.id === bookId)?.chapters.find((c) => c.id === chapterId);
      expect(chapter?.preparation?.targets[0]?.occurrences).toHaveLength(2);
    }
  });
});
