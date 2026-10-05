import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  commitSeriesEpisodeImport,
  getDb,
  getEpisodePreparationContext,
  saveEpisodePackReply,
} from '../src/db/repository';
import {
  buildEpisodePackPrompts,
  longReplyWarning,
  PACK_TRANSLATIONS_PER_PART,
  parseEpisodePackReply,
  planEpisodePack,
} from '../src/lib/episodePack';
import type { PreparationContext } from '../src/lib/episodePreparation';
import { buildShadowingPreview } from '../src/lib/shadowingImport';

const NOW = '2026-09-30T00:00:00.000Z';

const context: PreparationContext = {
  title: 'Episode 1',
  sentences: [
    { id: 's-a', japanese: '本を読みます。', translation: '' },
    { id: 's-b', japanese: '本を買いました。', translation: 'I bought a book.' },
    { id: 's-c', japanese: '電気を消しました。', translation: '' },
  ],
  vocabulary: [{ id: 'v-book', expression: '本', reading: 'ほん', meaning: 'book' }],
  grammar: [],
};

describe('episode pack prompts', () => {
  it('asks for targets and only the missing translations in one prompt', () => {
    const plan = planEpisodePack(context, undefined);
    expect(plan).toEqual({ wantsTargets: true, missingTranslationHandles: ['S1', 'S3'], structureHandles: [], constructionHandles: [], walkthroughHandles: [] });
    const prompts = buildEpisodePackPrompts(context, plan);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('S2: 本を買いました。');
    expect(prompts[0]).toContain('TRANSLATE THESE:\nS1: 本を読みます。\nS3: 電気を消しました。');
    expect(prompts[0]!.split('TRANSLATE THESE:')[1]).not.toContain('S2:');
    expect(prompts[0]).toContain('"targets"');
    expect(prompts[0]).toContain('"translations"');
  });

  it('is translation-only when targets are already fresh, and empty when nothing is left', () => {
    const preparation = {
      version: 1,
      status: 'ready' as const,
      preparedAt: NOW,
      provenance: 'pasted_ai_reply' as const,
      sentenceFingerprint: '',
      targets: [],
      rejected: [],
    };
    // Empty targets never count as fresh targets.
    expect(planEpisodePack(context, preparation).wantsTargets).toBe(true);
    const done = { ...context, sentences: context.sentences.map((s) => ({ ...s, translation: 'x' })) };
    expect(buildEpisodePackPrompts(done, { wantsTargets: false, missingTranslationHandles: [], structureHandles: [], constructionHandles: [], walkthroughHandles: [] })).toEqual([]);
    const only = buildEpisodePackPrompts(context, { wantsTargets: false, missingTranslationHandles: ['S1', 'S3'], structureHandles: [], constructionHandles: [], walkthroughHandles: [] });
    expect(only[0]).not.toContain('"targets"');
    expect(only[0]).not.toContain('KNOWN VOCABULARY');
  });

  it('keeps targets, translations, structure and constructions in one prompt', () => {
    const all = new Set(context.sentences.map((x) => x.id));
    const plan = planEpisodePack(context, undefined, { structureSentenceIds: all, constructionSentenceIds: all });
    const prompts = buildEpisodePackPrompts(context, plan);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('EXPLAIN THESE:');
    expect(prompts[0]).toContain('"constructions"');
    expect(prompts[0]).toContain('STRUCTURE THESE:');
  });

  it('stays a single prompt for a long episode unless splitting is on, and warns', () => {
    const sentences = Array.from({ length: PACK_TRANSLATIONS_PER_PART * 2 + 5 }, (_, i) => ({ id: `s${i}`, japanese: `文${i}。`, translation: '' }));
    const long = { ...context, sentences };
    const plan = planEpisodePack(long, undefined);
    expect(buildEpisodePackPrompts(long, plan)).toHaveLength(1);
    expect(longReplyWarning(plan)).toMatch(/cut off/);
    expect(longReplyWarning(planEpisodePack(context, undefined))).toBeUndefined();
  });

  it('splits a long episode into ordered parts, targets only in the first', () => {
    const sentences = Array.from({ length: PACK_TRANSLATIONS_PER_PART * 2 + 5 }, (_, i) => ({
      id: `s${i}`, japanese: `文${i}。`, translation: '',
    }));
    const long = { ...context, sentences };
    const prompts = buildEpisodePackPrompts(long, planEpisodePack(long, undefined), { splitIntoParts: true });
    expect(prompts).toHaveLength(3);
    expect(prompts[0]).toContain('part 1 of 3');
    expect(prompts[0]).toContain('"targets"');
    expect(prompts[1]).not.toContain('"targets"');
    expect(prompts[1]).toContain(`S${PACK_TRANSLATIONS_PER_PART + 1}: 文${PACK_TRANSLATIONS_PER_PART}。`);
    expect(prompts[2]).toContain(`S${PACK_TRANSLATIONS_PER_PART * 2 + 5}:`);
  });
});

describe('parseEpisodePackReply', () => {
  it('accepts targets and translations together, resolving handles to ids', () => {
    const result = parseEpisodePackReply(
      JSON.stringify({
        targets: [{ kind: 'vocabulary', ref: 'V1', label: '本', occurrences: [{ sentence: 'S1', text: '本' }] }],
        translations: { S1: ' I read a book. ', S3: 'I turned off the lights.' },
      }),
      context,
      NOW,
    );
    expect(result.error).toBeUndefined();
    expect(result.preparation?.targets).toHaveLength(1);
    expect(result.translations).toEqual([
      { sentenceId: 's-a', translation: 'I read a book.' },
      { sentenceId: 's-c', translation: 'I turned off the lights.' },
    ]);
  });

  it('rejects unknown handles, empty text, and never overwrites an existing translation', () => {
    const result = parseEpisodePackReply(
      JSON.stringify({ translations: { S2: 'Something else', S9: 'ghost', S1: '  ' } }),
      context,
      NOW,
    );
    expect(result.translations).toEqual([]);
    expect(result.preparation).toBeUndefined();
    expect(result.rejectedTranslations.map((r) => r.handle).sort()).toEqual(['S1', 'S2', 'S9']);
  });

  it('errors on non-JSON, on an unrelated object, and on a malformed translations value', () => {
    expect(parseEpisodePackReply('sure! here you go', context, NOW).error).toBeTruthy();
    expect(parseEpisodePackReply('{"foo":1}', context, NOW).error).toMatch(/none of/);
    expect(parseEpisodePackReply('{"translations":["a"]}', context, NOW).error).toMatch(/keyed by sentence handle/);
  });
});

describe('saveEpisodePackReply', () => {
  beforeEach(async () => {
    await resetDbForTests();
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
    return { bookId, chapterId, sentenceIds: rows.map((row) => row.sentenceId) };
  }

  it('fills empty translations and stores focus targets from one reply', async () => {
    const { bookId, chapterId, sentenceIds } = await seedEpisode();
    await getDb().sentences.update(sentenceIds[0]!, { translation: '' });
    await getDb().sentences.update(sentenceIds[1]!, { translation: 'Mine.' });
    await getDb().vocabularyItems.put({ id: 'w', expression: '本', reading: 'ほん', meaning: 'book', createdAt: NOW, updatedAt: NOW });
    await getDb().sentenceVocabulary.put({ id: 'sv', sentenceId: sentenceIds[0]!, vocabularyItemId: 'w', surfaceForm: '本', createdAt: NOW, updatedAt: NOW });

    const result = await saveEpisodePackReply(
      bookId,
      chapterId,
      JSON.stringify({
        targets: [{ kind: 'vocabulary', ref: 'V1', label: '本', occurrences: [{ sentence: 'S1', text: '本' }] }],
        translations: { S1: 'I read a book.', S2: 'overwrite attempt' },
      }),
    );
    expect(result.error).toBeUndefined();
    expect(result.translationsSaved).toBe(1);
    expect(result.rejectedTranslations).toEqual([{ handle: 'S2', reason: 'Already has a translation; kept yours.' }]);
    expect(result.preparation?.targets).toHaveLength(1);
    expect((await getDb().sentences.get(sentenceIds[0]!))?.translation).toBe('I read a book.');
    expect((await getDb().sentences.get(sentenceIds[1]!))?.translation).toBe('Mine.');
    const { preparation } = await getEpisodePreparationContext(bookId, chapterId);
    expect(preparation?.status).toBe('ready');
  });

  it('stores structure drafts on the chapter, never over a saved analysis, and stops asking for them', async () => {
    const { bookId, chapterId, sentenceIds } = await seedEpisode();
    expect((await getEpisodePreparationContext(bookId, chapterId)).needsStructureIds).toEqual(sentenceIds);
    const chunks = [{ text: '本を', role: 'object' }, { text: '読みます。', role: 'engine' }];
    const result = await saveEpisodePackReply(bookId, chapterId, JSON.stringify({ structure: { S1: chunks, S2: [{ text: 'x', role: 'engine' }] } }));
    expect(result.structureSaved).toBe(1);
    expect(result.rejectedStructure.map((item) => item.handle)).toEqual(['S2']);
    const book = await getDb().books.get(bookId);
    expect(book!.chapters.find((chapter) => chapter.id === chapterId)!.structureDrafts![sentenceIds[0]!]![0]!.role).toBe('object');
    expect((await getEpisodePreparationContext(bookId, chapterId)).needsStructureIds).toEqual([sentenceIds[1]]);
    expect(await getDb().analyses.count()).toBe(0);
    expect(await getDb().studyItems.count()).toBe(0);
  });

  it('stores construction drafts without creating study items, and stops asking for them', async () => {
    const { bookId, chapterId, sentenceIds } = await seedEpisode();
    expect((await getEpisodePreparationContext(bookId, chapterId)).needsConstructionIds).toEqual(sentenceIds);
    const good = { text: '買いました', key: 'masu_form', operation: 'inflection', attach: 'stem + ました', contribution: 'polite past' };
    const result = await saveEpisodePackReply(
      bookId,
      chapterId,
      JSON.stringify({ constructions: { S2: [good, { ...good, text: '存在しない' }], S9: [good] } }),
    );
    expect(result.error).toBeUndefined();
    expect(result.constructionsSaved).toBe(1);
    expect(result.rejectedConstructions.length).toBe(2);
    const book = await getDb().books.get(bookId);
    expect(book!.chapters.find((chapter) => chapter.id === chapterId)!.constructionDrafts![sentenceIds[1]!]).toHaveLength(1);
    expect((await getEpisodePreparationContext(bookId, chapterId)).needsConstructionIds).toEqual([sentenceIds[0]]);
    expect(await getDb().studyItems.count()).toBe(0);
    expect(await getDb().reviews.count()).toBe(0);
  });

  it('changes nothing when the reply cannot be parsed', async () => {
    const { bookId, chapterId, sentenceIds } = await seedEpisode();
    await getDb().sentences.update(sentenceIds[0]!, { translation: '' });
    const result = await saveEpisodePackReply(bookId, chapterId, 'not json');
    expect(result.error).toBeTruthy();
    expect(result.translationsSaved).toBe(0);
    expect((await getDb().sentences.get(sentenceIds[0]!))?.translation).toBe('');
    expect((await getEpisodePreparationContext(bookId, chapterId)).preparation).toBeUndefined();
  });

  it('a translation-only reply leaves an existing preparation untouched', async () => {
    const { bookId, chapterId, sentenceIds } = await seedEpisode();
    await getDb().sentences.update(sentenceIds[0]!, { translation: '' });
    const first = await saveEpisodePackReply(
      bookId,
      chapterId,
      JSON.stringify({ targets: [{ kind: 'expression', label: '本', occurrences: [{ sentence: 'S1', text: '本' }] }] }),
    );
    expect(first.preparation?.status).toBe('ready');
    const second = await saveEpisodePackReply(bookId, chapterId, JSON.stringify({ translations: { S1: 'Read.' } }));
    expect(second.preparation).toBeUndefined();
    const { preparation } = await getEpisodePreparationContext(bookId, chapterId);
    expect(preparation?.targets).toHaveLength(1);
  });
});
