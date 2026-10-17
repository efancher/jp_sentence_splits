import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { getDb, getSentenceGrowthCandidates, logSentenceLearningEvent } from '../src/db/repository';
import type { VocabularySuggestion } from '../src/domain/types';
import { buildGrowthPlan, growthRejection } from '../src/lib/sentenceGrowth';

const T = '2026-10-17T00:00:00.000Z';
const N = '名詞/普通名詞';
const CASE = '助詞/格助詞';
const VERB = '動詞/一般';

type Seg = [string, string];

function tokens(segments: Seg[]): VocabularySuggestion[] {
  let at = 0;
  return segments.map(([surface, pos], i) => {
    const token = {
      id: `t${i}`, surface, start: at, end: at + surface.length, expression: surface, reading: surface,
      pos, source: 'morphology' as const, selectedByDefault: false,
    };
    at += surface.length;
    return token;
  });
}

const text = (segments: Seg[]) => segments.map(([s]) => s).join('');

// 親鳥がひなに巣を作りました。
const NEST: Seg[] = [
  ['親', N], ['鳥', N], ['が', CASE], ['ひな', N], ['に', CASE], ['巣', N], ['を', CASE],
  ['作り', VERB], ['まし', '助動詞'], ['た', '助動詞'], ['。', '補助記号'],
];

describe('buildGrowthPlan', () => {
  it('lays a sentence out as chunks + core and asks who, then what, then where/to whom', () => {
    const plan = buildGrowthPlan({ japanese: text(NEST), vocabularySuggestions: tokens(NEST) });
    expect(plan).not.toBeNull();
    expect(plan!.chunks.map((c) => c.text)).toEqual(['親鳥が', 'ひなに', '巣を']);
    expect(plan!.verbText).toBe('作りました。');
    // が (who) → を (what) → に (to whom), not the order spoken.
    expect(plan!.promptOrder.map((i) => plan!.chunks[i]!.particle)).toEqual(['が', 'を', 'に']);
    // Concatenation reproduces the native sentence exactly: nothing generated, nothing dropped.
    expect(plan!.chunks.map((c) => c.text).join('') + plan!.verbText).toBe(text(NEST));
    for (const chunk of plan!.chunks) expect(chunk.question).not.toBe('');
  });

  it('folds an adverb or の-modifier into the chunk it precedes, so nothing is left unasked', () => {
    const segs: Seg[] = [
      ['親', N], ['が', CASE], ['ひな', N], ['に', CASE], ['ゆっくり', '副詞'], ['巣', N], ['を', CASE],
      ['作り', VERB], ['まし', '助動詞'], ['た', '助動詞'], ['。', '補助記号'],
    ];
    const plan = buildGrowthPlan({ japanese: text(segs), vocabularySuggestions: tokens(segs) });
    expect(plan?.chunks.map((c) => c.text)).toEqual(['親が', 'ひなに', 'ゆっくり巣を']);
    expect(plan!.chunks.map((c) => c.text).join('') + plan!.verbText).toBe(text(segs));
  });

  it('refuses a leading connective and a clause break inside a gap', () => {
    const connective: Seg[] = [
      ['そして', '接続詞'], ['親', N], ['が', CASE], ['ひな', N], ['に', CASE], ['巣', N], ['を', CASE],
      ['作り', VERB], ['まし', '助動詞'], ['た', '助動詞'], ['。', '補助記号'],
    ];
    expect(buildGrowthPlan({ japanese: text(connective), vocabularySuggestions: tokens(connective) })).toBeNull();
    const vocative: Seg[] = [
      ['みなさん', N], ['、', '補助記号'], ['親', N], ['が', CASE], ['ひな', N], ['に', CASE], ['巣', N], ['を', CASE],
      ['作り', VERB], ['まし', '助動詞'], ['た', '助動詞'], ['。', '補助記号'],
    ];
    expect(buildGrowthPlan({ japanese: text(vocative), vocabularySuggestions: tokens(vocative) })).toBeNull();
  });

  it('refuses a repeated particle (the question could not say which chunk is meant)', () => {
    const segs: Seg[] = [
      ['親', N], ['が', CASE], ['ひな', N], ['が', CASE], ['巣', N], ['を', CASE],
      ['作り', VERB], ['まし', '助動詞'], ['た', '助動詞'], ['。', '補助記号'],
    ];
    expect(buildGrowthPlan({ japanese: text(segs), vocabularySuggestions: tokens(segs) })).toBeNull();
  });

  it('refuses a chunk that contains its own clause (a verb folded in before the noun)', () => {
    // 親が卵にひなが作った巣を食べました — 作った is a relative clause folded into 巣を
    const segs: Seg[] = [
      ['親', N], ['が', CASE], ['卵', N], ['に', CASE], ['ひな', N], ['が', CASE], ['作っ', VERB], ['た', '助動詞'],
      ['巣', N], ['を', CASE], ['食べ', VERB], ['まし', '助動詞'], ['た', '助動詞'], ['。', '補助記号'],
    ];
    expect(buildGrowthPlan({ japanese: text(segs), vocabularySuggestions: tokens(segs) })).toBeNull();
    // Adjective modifier inside a chunk is likewise a clause.
    const adj: Seg[] = [
      ['親', N], ['が', CASE], ['ひな', N], ['に', CASE], ['大きい', '形容詞/一般'], ['巣', N], ['を', CASE],
      ['作り', VERB], ['まし', '助動詞'], ['た', '助動詞'], ['。', '補助記号'],
    ];
    expect(buildGrowthPlan({ japanese: text(adj), vocabularySuggestions: tokens(adj) })).toBeNull();
  });

  it('refuses a sentence with fewer than two chunks, or no tokens at all', () => {
    const one: Seg[] = [['巣', N], ['を', CASE], ['作り', VERB], ['た', '助動詞'], ['。', '補助記号']];
    expect(buildGrowthPlan({ japanese: text(one), vocabularySuggestions: tokens(one) })).toBeNull();
    expect(buildGrowthPlan({ japanese: '巣を作った。', vocabularySuggestions: [] })).toBeNull();
  });
});

describe('growthRejection', () => {
  const sentence = (translation: string | undefined) => ({
    japanese: text(NEST), translation, vocabularySuggestions: tokens(NEST),
  });
  it('needs a translation (it is shown at the reveal) and a short clip', () => {
    expect(growthRejection(sentence('The parent bird made a nest.'), 3000)).toBeNull();
    expect(growthRejection(sentence(''), 3000)).toBe('no-translation');
    expect(growthRejection(sentence('x'), 60_000)).toBe('clip-too-long');
  });
});

describe('getSentenceGrowthCandidates', () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  async function seed(id: string, segs: Seg[], walked: boolean) {
    const db = getDb();
    await db.sentences.put({
      id, normalizedKey: id, japanese: text(segs), readingOnly: '', inlineReading: '',
      translation: `tr ${id}`, targetVocabulary: [], vocabularySuggestions: tokens(segs),
      sourceReferences: [], conflicts: [], firstOccurrenceIndex: 0, importBatchIds: [],
      createdAt: T, updatedAt: T,
    });
    await db.sentenceAudio.put({
      id: `a-${id}`, sentenceId: id, sourceId: 's', sourceSentenceId: id, sourceTitle: 's',
      mimeType: 'audio/mpeg', durationMs: 3000, startMs: 0, endMs: 3000, blob: new Blob(['x']), importedAt: T,
    });
    if (walked) {
      await logSentenceLearningEvent({ id: `w-${id}`, visitId: 'v', action: 'walkthrough_completed', sentenceId: id });
    }
  }

  it('offers a met, plannable sentence with no vocabulary cards, confirmed vocabulary or swap-noun pool', async () => {
    await seed('met', NEST, true);
    const before = await getDb().studyItems.count();
    const candidates = await getSentenceGrowthCandidates();
    expect(candidates.map((c) => c.id)).toEqual(['met']);
    // Read-only, and no vocabulary study items exist to gate on.
    expect(await getDb().studyItems.count()).toBe(before);
    expect(await getDb().studyItems.where('subjectType').equals('vocabularyItem').count()).toBe(0);
  });

  it('skips sentences the learner has not met, and ones that cannot be laid out', async () => {
    await seed('unmet', NEST, false);
    await seed('single', [['巣', N], ['を', CASE], ['作り', VERB], ['た', '助動詞'], ['。', '補助記号']], true);
    expect(await getSentenceGrowthCandidates()).toEqual([]);
  });
});
