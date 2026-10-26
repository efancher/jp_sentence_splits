import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { commitSeriesEpisodeImport, getDb, setSentenceComprehensionCheck } from '../src/db/repository';
import { planBookAssistExtras, saveBookAssistExtras, type BookExtrasRunSnapshot } from '../src/lib/bookAssistExtras';
import { buildExtraPrompt } from '../src/lib/assistExtras';
import { planBookExtraTasks } from '../src/lib/bookAssistRun';
import { buildShadowingPreview } from '../src/lib/shadowingImport';

const NOW = '2026-10-12T00:00:00.000Z';
const LINES = ['昨日は二つ持ってきました。', 'もう一つは紙です。', '便利ですよ。'];

const sentences = (n: number) => Array.from({ length: n }, (_, i) => ({ handle: i + 1, japanese: `文${i + 1}`, translation: `S${i + 1}` }));
const section = (n: number, correct: string) =>
  [`=== Sentence ${n} ===`, '1. wrong a', `*2. ${correct}`, '3. wrong b', '4. wrong c'].join('\n');

describe('planBookExtraTasks', () => {
  it('batches selected sentences in book order, gaps included, capped by range size', () => {
    const tasks = planBookExtraTasks(sentences(10), { walkthroughs: [1, 2, 3, 7, 9, 10], particles: [4, 5, 6] }, 4);
    expect(tasks.map((t) => [t.kind, t.from, t.to, t.handles])).toEqual([
      ['walkthroughs', 1, 7, [1, 2, 3, 7]],
      ['walkthroughs', 9, 10, undefined],
      ['particles', 4, 6, undefined],
    ]);
    expect(tasks[0]!.id).toMatch(/^walkthroughs:1-7~/);
    expect(tasks[1]!.id).toBe('walkthroughs:9-10');
  });

  it('uses smaller calls for walkthroughs than for other extras', () => {
    const all = Array.from({ length: 100 }, (_, i) => i + 1);
    const tasks = planBookExtraTasks(sentences(100), { walkthroughs: all, structure: all });
    expect(tasks.filter((t) => t.kind === 'walkthroughs')).toHaveLength(4);
    expect(tasks.filter((t) => t.kind === 'structure')).toHaveLength(1);
  });

  it('prompts only for the chosen sentences, each with neighbours as context', () => {
    const [task] = planBookExtraTasks(sentences(30), { structure: [5, 20] });
    const prompt = buildExtraPrompt(task!, sentences(30));
    expect(prompt).toContain('S5, S20');
    expect(prompt).toContain('\nS5 文5');
    expect(prompt).toContain('(context) S2 文2');
    expect(prompt).toContain('(context) S7 文7');
    expect(prompt).not.toContain('S10 文10');
    expect(prompt).toContain('\n...\n');
  });

  it('ignores handles outside the book and keeps neighbours as context', () => {
    const [task] = planBookExtraTasks(sentences(5), { structure: [3, 99] });
    expect(task).toMatchObject({ id: 'structure:3-3', shownFrom: 0, shownTo: 4, coveredFrom: 2, coveredTo: 2 });
  });
});

describe('book extras plan + save', () => {
  let bookId = '';
  let ids: string[] = [];

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

  it('marks omitted constructions checked and survives a repeated save', async () => {
    const snapshot: BookExtrasRunSnapshot = { bookId, sentenceIds: ids,
      kinds: { constructions: { handles: [1, 2, 3], replaceHandles: [] } } };
    const replies = { 'constructions:1-3': JSON.stringify({ version: 2, constructions: {} }) };
    await saveBookAssistExtras(snapshot, replies);
    await saveBookAssistExtras(snapshot, replies);
    const plan = await planBookAssistExtras(bookId);
    expect(plan.kinds.constructions.missing).toEqual([]);
    expect(plan.kinds.constructions.existing.map((entry) => entry.summary)).toEqual(Array(3).fill('checked, nothing to build'));
    expect(await getDb().sentenceExtras.count()).toBe(3);
  });

  it('reports which sentences already have a meaning check', async () => {
    await setSentenceComprehensionCheck(ids[1]!, { options: ['a', 'keep me', 'b', 'c'], correctIndex: 1, provenance: 'manual', createdAt: NOW });
    const plan = await planBookAssistExtras(bookId);
    expect(plan.kinds.comprehension.missing).toEqual([1, 3]);
    expect(plan.kinds.comprehension.existing).toEqual([{ handle: 2, summary: 'keep me' }]);
  });

  it('saves only missing sentences by default and replaces an existing one only when approved', async () => {
    await setSentenceComprehensionCheck(ids[1]!, { options: ['a', 'old', 'b', 'c'], correctIndex: 1, provenance: 'manual', createdAt: NOW });
    await setSentenceComprehensionCheck(ids[2]!, { options: ['a', 'old3', 'b', 'c'], correctIndex: 1, provenance: 'manual', createdAt: NOW });
    const replies = { 'comprehension:1-3': [section(1, 'new one'), section(2, 'new two'), section(3, 'new three')].join('\n\n') };
    const snapshot: BookExtrasRunSnapshot = {
      bookId,
      sentenceIds: ids,
      kinds: { comprehension: { handles: [1, 2, 3], replaceHandles: [2] } },
    };
    const result = await saveBookAssistExtras(snapshot, replies);
    expect(result.saved.comprehension).toBe(2);

    const correct = async (index: number) => {
      const check = (await getDb().analyses.get(ids[index]!))!.comprehensionCheck!;
      return check.options[check.correctIndex];
    };
    expect(await correct(0)).toBe('new one');
    expect(await correct(1)).toBe('new two');
    // Sentence 3 had a check but was not approved for replacement: kept even though it was sent.
    expect(await correct(2)).toBe('old3');
    expect(result.keptExisting.comprehension).toBe(1);
  });

  it('keeps a check that appeared while the run was going', async () => {
    const snapshot: BookExtrasRunSnapshot = { bookId, sentenceIds: ids, kinds: { comprehension: { handles: [1], replaceHandles: [] } } };
    await setSentenceComprehensionCheck(ids[0]!, { options: ['a', 'worker made me', 'b', 'c'], correctIndex: 1, provenance: 'ai_suggested', createdAt: NOW });
    const result = await saveBookAssistExtras(snapshot, { 'comprehension:1-1': section(1, 'late arrival') });
    expect(result.saved.comprehension ?? 0).toBe(0);
    const check = (await getDb().analyses.get(ids[0]!))!.comprehensionCheck!;
    expect(check.options[check.correctIndex]).toBe('worker made me');
  });

  it('saves walkthroughs onto the right chapter and leaves unselected sentences alone', async () => {
    const reply = JSON.stringify({
      version: 2,
      walkthroughs: { S2: { natural: 'The other one is paper.', steps: [{ text: '紙', gloss: 'paper', explanation: 'the item' }] } },
    });
    const snapshot: BookExtrasRunSnapshot = { bookId, sentenceIds: ids, kinds: { walkthroughs: { handles: [2], replaceHandles: [] } } };
    const result = await saveBookAssistExtras(snapshot, { 'walkthroughs:2-2': reply });
    expect(result.saved.walkthroughs).toBe(1);
    const plan = await planBookAssistExtras(bookId);
    expect(plan.kinds.walkthroughs.existing.map((e) => e.handle)).toEqual([2]);
    expect(plan.kinds.walkthroughs.missing).toEqual([1, 3]);
    expect(plan.kinds.walkthroughs.outdated).toEqual([]);
  });

  it('flags an existing walkthrough saved in an older format as outdated', async () => {
    const reply = JSON.stringify({
      walkthroughs: { S2: { natural: 'The other one is paper.', steps: [{ text: '紙', gloss: 'paper', explanation: 'the item' }] } },
    });
    await saveBookAssistExtras({ bookId, sentenceIds: ids, kinds: { walkthroughs: { handles: [2], replaceHandles: [] } } }, { 'walkthroughs:2-2': reply });
    const row = (await getDb().sentenceExtras.get(ids[1]!))!;
    await getDb().sentenceExtras.put({ ...row, contextWalkthrough: { ...row.contextWalkthrough!, version: 2 } });
    const plan = await planBookAssistExtras(bookId);
    expect(plan.kinds.walkthroughs.outdated).toEqual([2]);
    expect(plan.kinds.walkthroughs.existing[0]!.summary).toMatch(/^older format/);
  });
});

describe('constructionChecked', () => {
  it('counts an empty draft as looked at, but not a missing or all-invalid one', async () => {
    const { constructionChecked } = await import('../src/lib/phraseConstruction');
    const layer = { text: '好きです', start: 0, end: 4 } as never;
    const stale = { text: '嫌いです', start: 0, end: 4 } as never;
    expect(constructionChecked('好きです', undefined)).toBe(false);
    expect(constructionChecked('好きです', [])).toBe(true);
    expect(constructionChecked('好きです', [layer])).toBe(true);
    expect(constructionChecked('好きです', [stale])).toBe(false);
  });
});

describe('describeRejections', () => {
  it('groups skipped entries by kind and reason, most common first', async () => {
    const { describeRejections } = await import('../src/lib/quickImportExtras');
    expect(
      describeRejections([
        { kind: 'constructions', reason: '“N” is not in the sentence.' },
        { kind: 'structure', reason: 'The chunks do not rebuild the sentence exactly (cut off?).' },
        { kind: 'structure', reason: 'The chunks do not rebuild the sentence exactly (cut off?).' },
      ]),
    ).toBe('2 × Structure: The chunks do not rebuild the sentence exactly (cut off?).; 1 × Construction: “N” is not in the sentence.');
  });
});
