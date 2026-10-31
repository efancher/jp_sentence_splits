import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { commitSeriesEpisodeImport, ensureGrammarPattern, ensureSentenceGrammar, getDb } from '../src/db/repository';
import { buildExtraPrompt, validateExtraReply } from '../src/lib/assistExtras';
import {
  loadLinkableGrammarPatterns,
  planBookAssistExtras,
  saveBookAssistExtras,
  type BookExtrasRunSnapshot,
} from '../src/lib/bookAssistExtras';
import { planBookExtraTasks } from '../src/lib/bookAssistRun';
import { NO_AUTO_LINK_FAMILY } from '../src/lib/grammarLinkReply';
import { buildShadowingPreview } from '../src/lib/shadowingImport';
import { remoteToSentenceExtras, sentenceExtrasToRemote } from '../src/sync/mappers';

const NOW = '2026-10-31T00:00:00.000Z';
const LINES = ['昨日は二つ持ってきました。', 'もう一つは紙です。', '便利ですよ。'];

const REPLY = [
  '=== Sentence 1 ===',
  'PATTERN: 〜てくる',
  'TEMPLATE: V-て + くる',
  'MEANING: bring / come having done',
  'SPAN: 持ってきました',
  'NOTE: brought them along',
  '=== Sentence 2 ===',
  'NONE',
  '=== Sentence 3 ===',
  'PATTERN: 〜ですよ',
  'SPAN: ですよ',
  'NOTE: friendly emphasis',
].join('\n');

describe('book assistant grammar links', () => {
  let bookId = '';
  let ids: string[] = [];
  const snapshot = (handles = [1, 2, 3]): BookExtrasRunSnapshot => ({
    bookId,
    sentenceIds: ids,
    kinds: { grammar: { handles, replaceHandles: [] } },
  });

  beforeEach(async () => {
    await resetDbForTests();
    const preview = buildShadowingPreview(
      { id: 'ep', type: 'other', title: 'Ep' },
      { format: 'japanese-shadowing-package', version: 2 as const, createdAt: NOW, generator: { name: 't', version: '1' } },
      LINES.map((japanese, index) => ({ id: `ep-${index}`, japanese, startMs: 0, endMs: 1000, tags: [], transcriptStatus: 'verified' as const })),
      [],
      [],
    );
    ({ bookId } = await commitSeriesEpisodeImport({ seriesId: 'se', seriesTitle: 'S', episodeTitle: 'Ep', sourceId: 'src', sourceDate: NOW, preview }));
    ids = (await planBookAssistExtras(bookId)).sentences.map((s) => s.id);
  });

  it('starts with every sentence missing grammar links', async () => {
    expect((await planBookAssistExtras(bookId)).kinds.grammar.missing).toEqual([1, 2, 3]);
  });

  it('saves unconfirmed links with spans, creates a hidden-by-provenance new pattern, and marks answered sentences checked', async () => {
    const known = await ensureGrammarPattern('～ですよ', { aliases: [] });
    const result = await saveBookAssistExtras(snapshot(), { 'grammar:1-3': REPLY });
    expect(result.saved.grammar).toBe(2);

    const db = getDb();
    const created = await db.grammarPatterns.where('normalizedKey').equals('てくる').first();
    expect(created).toMatchObject({ provenance: 'ai_suggested', structuralTemplate: 'V-て + くる', shortMeaning: 'bring / come having done' });
    expect(await db.grammarPatterns.count()).toBe(2);

    const first = await db.sentenceGrammar.where('sentenceId').equals(ids[0]!).first();
    expect(first).toMatchObject({
      grammarPatternId: created!.id,
      surfaceForm: '持ってきました',
      start: 5,
      end: 12,
      confirmedByLearner: false,
      source: 'ai_suggested',
      occurrenceExplanation: 'brought them along',
    });
    const third = await db.sentenceGrammar.where('sentenceId').equals(ids[2]!).first();
    expect(third).toMatchObject({ grammarPatternId: known.id, surfaceForm: 'ですよ' });
    expect(await db.sentenceGrammar.where('sentenceId').equals(ids[1]!).count()).toBe(0);

    const plan = await planBookAssistExtras(bookId);
    expect(plan.kinds.grammar.missing).toEqual([]);
    expect(plan.kinds.grammar.existing.map((e) => e.summary)).toEqual(['1 pattern', 'checked, nothing to link', '1 pattern']);
  });

  it('leaves a sentence the reply did not answer unchecked so the next run retries it', async () => {
    const partial = REPLY.split('=== Sentence 2 ===')[0]!;
    await saveBookAssistExtras(snapshot(), { 'grammar:1-3': partial });
    expect((await planBookAssistExtras(bookId)).kinds.grammar.missing).toEqual([2, 3]);
  });

  it('does not overwrite an occurrence the learner already confirmed, and a repeated save adds nothing', async () => {
    const pattern = await ensureGrammarPattern('～ですよ');
    await ensureSentenceGrammar(ids[2]!, pattern.id, { confirmedByLearner: true, source: 'manual', surfaceForm: '便利ですよ', start: 0, end: 5 });
    await saveBookAssistExtras(snapshot(), { 'grammar:1-3': REPLY });
    const kept = await getDb().sentenceGrammar.where('sentenceId').equals(ids[2]!).toArray();
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ confirmedByLearner: true, source: 'manual', surfaceForm: '便利ですよ', start: 0, end: 5 });

    await saveBookAssistExtras(snapshot(), { 'grammar:1-3': REPLY });
    expect(await getDb().sentenceGrammar.count()).toBe(2);
    expect(await getDb().grammarPatterns.count()).toBe(2);
  });

  it('drops a link whose quoted text is not in the sentence and reports it', async () => {
    const reply = ['=== Sentence 1 ===', 'PATTERN: 〜ている', 'SPAN: 走っている', 'NOTE: n'].join('\n');
    const result = await saveBookAssistExtras(snapshot([1]), { 'grammar:1-1': reply });
    expect(result.saved.grammar ?? 0).toBe(0);
    expect(result.problems.join(' ')).toMatch(/not in the sentence/);
    expect(await getDb().sentenceGrammar.count()).toBe(0);
  });

  it('offers the assistant every pattern except those tagged no-auto-link', async () => {
    await ensureGrammarPattern('～ている', { aliases: ['～てる'], structuralTemplate: 'V-て + いる' });
    await ensureGrammarPattern('すごい', { family: NO_AUTO_LINK_FAMILY });
    expect(await loadLinkableGrammarPatterns()).toEqual([
      expect.objectContaining({ name: '～ている', template: 'V-て + いる', aliases: ['～てる'] }),
    ]);
  });
});

describe('grammar extra prompt and reply check', () => {
  const sentences = [
    { handle: 1, japanese: '猫が好き。', translation: 'I like cats.' },
    { handle: 2, japanese: '食べてしまった。', translation: 'I ate it all.' },
  ];

  it('lists the known patterns before the sentences', () => {
    const [task] = planBookExtraTasks(sentences, { grammar: [1, 2] });
    const prompt = buildExtraPrompt(task!, sentences, [], {
      grammarPatterns: [{ id: 'a', name: '～ている', template: 'V-て + いる', aliases: ['～てる'] }],
    });
    expect(prompt).toContain('TASK — GRAMMAR.');
    expect(prompt.indexOf('--- known patterns ---')).toBeLessThan(prompt.indexOf('--- sentences ---'));
    expect(prompt).toContain('～ている | V-て + いる | also: ～てる');
    expect(prompt).toContain('S2 食べてしまった。');
  });

  it('only shows the pattern section for the grammar extra', () => {
    const [task] = planBookExtraTasks(sentences, { particles: [1, 2] });
    expect(buildExtraPrompt(task!, sentences, [], { grammarPatterns: [] })).not.toContain('known patterns');
  });

  it('accepts a reply that reaches the last sentence and rejects one cut off before it', () => {
    const [task] = planBookExtraTasks(sentences, { grammar: [1, 2] });
    expect(validateExtraReply(task!, '=== Sentence 1 ===\nNONE\n=== Sentence 2 ===\nNONE')).toBeNull();
    expect(validateExtraReply(task!, '=== Sentence 1 ===\nNONE')).toMatch(/cut off/);
  });
});

describe('sentence extras grammarChecked sync mapping', () => {
  const base = { id: 's1', createdAt: NOW, updatedAt: NOW };

  it('only sends grammar_checked when set, so an unmigrated database still accepts the push', () => {
    expect(sentenceExtrasToRemote({ ...base }, 'owner', 1)).not.toHaveProperty('grammar_checked');
    expect(sentenceExtrasToRemote({ ...base, grammarChecked: true }, 'owner', 1)).toMatchObject({ grammar_checked: true });
  });

  it('reads the flag back, and treats null or absent as unchecked', () => {
    const row = { id: 's1', created_at: NOW, updated_at: NOW };
    expect(remoteToSentenceExtras({ ...row, grammar_checked: true }).grammarChecked).toBe(true);
    expect(remoteToSentenceExtras({ ...row, grammar_checked: null }).grammarChecked).toBeUndefined();
    expect(remoteToSentenceExtras(row).grammarChecked).toBeUndefined();
  });
});
