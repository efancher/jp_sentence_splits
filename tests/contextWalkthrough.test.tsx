import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { SentenceWalkthrough } from '../src/components/SentenceWalkthrough';
import { resetDbForTests } from '../src/db/database';
import { commitSeriesEpisodeImport, getDb, getEpisodePreparationContext, saveEpisodePackReply } from '../src/db/repository';
import type { ContextWalkthrough, Sentence } from '../src/domain/types';
import {
  WALKTHROUGH_SHAPE,
  highlightSegments,
  parseWalkthroughs,
  sentencesNeedingWalkthrough,
  validWalkthroughFor,
  walkthroughContextLines,
} from '../src/lib/contextWalkthrough';
import { formatCombinedPromptForAI } from '../src/lib/combinedImportPrompt';
import { buildEpisodePackPrompts, parseEpisodePackReply, planEpisodePack } from '../src/lib/episodePack';
import type { PreparationContext } from '../src/lib/episodePreparation';
import { buildShadowingPreview } from '../src/lib/shadowingImport';

const NOW = '2026-10-05T00:00:00.000Z';
const BENCHMARK = 'もう一つは紙、何かを書いたりするやつですね。';

const context: PreparationContext = {
  title: 'Ep',
  sentences: [
    { id: 's1', japanese: '昨日は二つ持ってきました。', translation: 'I brought two yesterday.' },
    { id: 's2', japanese: 'ひとつはペンです。', translation: '' },
    { id: 's3', japanese: BENCHMARK, translation: '' },
    { id: 's4', japanese: '便利ですよ。', translation: '' },
    { id: 's5', japanese: 'また明日。', translation: '' },
    { id: 's6', japanese: 'じゃあね。', translation: '' },
    { id: 's7', japanese: 'はい。', translation: '' },
  ],
  vocabulary: [],
  grammar: [],
};

describe('parseWalkthroughs', () => {
  it('accepts the benchmark sentence from the prompt example, anchoring every span locally', () => {
    const { drafts, rejected } = parseWalkthroughs({ S3: WALKTHROUGH_SHAPE.S4 }, context);
    expect(rejected).toEqual([]);
    const walkthrough = drafts.get('s3')!;
    expect(walkthrough.steps.map((step) => step.text)).toEqual(['もう一つは紙', '何かを', '書いたりする', '何かを書いたりするやつ', 'ですね']);
    for (const step of walkthrough.steps) expect(BENCHMARK.slice(step.start, step.end)).toBe(step.text);
    // The key teaching connection: the whole relative phrase attaches to やつ -> 紙, across existing chunk boundaries.
    const relative = walkthrough.steps[3]!;
    expect(relative.connects).toMatchObject({ text: '紙' });
    expect(BENCHMARK.slice(relative.connects!.start, relative.connects!.end)).toBe('紙');
    expect(relative.implicit).toMatch(/on/);
    // Nested step spans the earlier 何かを + 書いたりする steps.
    expect(relative.start).toBe(walkthrough.steps[1]!.start);
    expect(relative.end).toBeGreaterThan(walkthrough.steps[2]!.end - 1);
    expect(walkthrough.caveat).toMatch(/another one/);
    expect(walkthrough.steps[2]!.mechanics).toMatch(/not a past-tense/);
  });

  it('handles structurally different sentences: relative clause, te-form helper, dropped subject, sentence-final particle', () => {
    const sentences = [
      { id: 'a', japanese: '昨日友達が買ってきた本を、もう読んでしまいました。' },
      { id: 'b', japanese: '母に野菜を食べさせられた。' },
      { id: 'c', japanese: 'だって、知らなかったんだもん。' },
    ];
    const reply = {
      S1: {
        natural: 'I have already finished reading the book my friend bought yesterday.',
        steps: [
          { text: '昨日友達が買ってきた', gloss: 'that my friend bought and brought yesterday', explanation: '友達が is the doer of 買ってきた; the whole clause describes 本.', connects: { to: '本を', how: 'the clause says which book' }, mechanics: '買って + きた: buy and come back with it' },
          { text: '本を', gloss: 'the book (object)', explanation: 'を makes 本 the thing being read.', connects: { to: '読んで', how: '本 is what gets read' } },
          { text: '読んでしまいました', gloss: 'ended up reading it all / have finished', explanation: '読んで + しまう stresses completion.', implicit: 'English needs "I" as the subject.', nuance: 'しまう can also carry a note of regret.' },
        ],
      },
      S2: {
        natural: 'I was made to eat vegetables by my mother.',
        steps: [
          { text: '母に', gloss: 'by my mother', explanation: 'に marks who made me do it.', connects: { to: '食べさせられた', how: 'the person causing the action' } },
          { text: '食べさせられた', gloss: 'was made to eat', explanation: 'させ (make someone do) + られ (it happened to me) + た.', mechanics: 'Causative then passive: the speaker is the one pressured.', implicit: 'The speaker is the one who ate.' },
        ],
      },
      S3: {
        natural: "Well, it's because I didn't know!",
        caveat: 'Who is being answered is not stated here.',
        steps: [
          { text: 'だって', gloss: 'but / because', explanation: 'Introduces an excuse.', nuance: 'Childlike or defensive.' },
          { text: '知らなかったんだもん', gloss: "I just didn't know", explanation: 'んだ explains; もん gives a pouty reason.', inferred: 'That this answers an accusation rests on the previous line, which was not provided.' },
        ],
      },
    };
    const { drafts, rejected } = parseWalkthroughs(reply, { sentences });
    expect(rejected).toEqual([]);
    expect([...drafts.keys()]).toEqual(['a', 'b', 'c']);
    expect(drafts.get('a')!.steps[0]!.connects!.text).toBe('本を');
    expect(drafts.get('c')!.steps[1]!.inferred).toMatch(/previous line/);
  });

  it('drops only bad steps and bad connections, never the whole sentence for one slip', () => {
    const { drafts, rejected } = parseWalkthroughs(
      {
        S3: {
          natural: 'x',
          steps: [
            { text: '紙', gloss: 'paper', explanation: 'noun', connects: { to: '存在しない', how: 'nothing' } },
            { text: '嘘の文', gloss: 'g', explanation: 'e' },
            { text: '何かを書いたり', gloss: 'g', explanation: 'overlaps next' },
            { text: 'りするやつ', gloss: 'g', explanation: 'partial overlap with the previous step' },
            { text: '、', gloss: 'g', explanation: 'punctuation only' },
          ],
        },
        S99: { natural: 'x', steps: [] },
        S1: { natural: '', steps: [] },
      },
      context,
    );
    const kept = drafts.get('s3')!;
    expect(kept.steps.map((step) => step.text)).toEqual(['紙', '何かを書いたり']);
    expect(kept.steps[0]!.connects).toBeUndefined();
    expect(rejected.map((item) => item.handle).sort()).toEqual(['S1', 'S3', 'S99']);
  });

  it('assigns repeated quotes to successive occurrences and rejects a non-object block', () => {
    const sentences = [{ id: 'r', japanese: '行く行く。' }];
    const parsed = parseWalkthroughs({ S1: { natural: 'Go, go.', steps: [{ text: '行く', gloss: 'go', explanation: 'a' }, { text: '行く', gloss: 'go', explanation: 'b' }, { text: '行く', gloss: 'go', explanation: 'c' }] } }, { sentences });
    expect(parsed.drafts.get('r')!.steps.map((step) => step.start)).toEqual([0, 2]);
    expect(parseWalkthroughs([], { sentences }).rejected).toHaveLength(1);
  });
});

describe('validWalkthroughFor', () => {
  const stored = parseWalkthroughs({ S3: WALKTHROUGH_SHAPE.S4 }, context).drafts.get('s3')!;

  it('keeps a walkthrough that still matches and ignores one whose sentence text changed', () => {
    expect(validWalkthroughFor(BENCHMARK, stored)?.steps).toHaveLength(5);
    expect(validWalkthroughFor('全然違う文です。', stored)).toBeUndefined();
    expect(validWalkthroughFor(BENCHMARK, undefined)).toBeUndefined();
  });

  it('drops a stale connection but keeps its step', () => {
    const shifted = '。' + BENCHMARK;
    expect(validWalkthroughFor(shifted, stored)).toBeUndefined();
    const broken: ContextWalkthrough = { ...stored, steps: stored.steps.map((step) => (step.connects ? { ...step, connects: { ...step.connects, start: 0, end: 1 } } : step)) };
    const result = validWalkthroughFor(BENCHMARK, broken)!;
    expect(result.steps).toHaveLength(5);
    expect(result.steps.every((step) => !step.connects)).toBe(true);
  });

  it('lists sentences still needing one', () => {
    expect(sentencesNeedingWalkthrough(context.sentences, { s3: stored })).toEqual(['s1', 's2', 's4', 's5', 's6', 's7']);
    expect(sentencesNeedingWalkthrough([{ id: 's3', japanese: '変わった。' }], { s3: stored })).toEqual(['s3']);
  });
});

describe('highlightSegments', () => {
  it('keeps the whole sentence and marks the explained span and the connected span', () => {
    const segments = highlightSegments(BENCHMARK, { start: 7, end: 18 }, { start: 5, end: 6 });
    expect(segments.map((segment) => segment.text).join('')).toBe(BENCHMARK);
    expect(segments.filter((segment) => segment.kind === 'connect').map((segment) => segment.text)).toEqual(['紙']);
    expect(segments.filter((segment) => segment.kind === 'main').map((segment) => segment.text).join('')).toBe(BENCHMARK.slice(7, 18));
  });

  it('marks overlap as both and tolerates no highlight', () => {
    expect(highlightSegments('あいう', { start: 0, end: 2 }, { start: 1, end: 3 }).map((s) => s.kind)).toEqual(['main', 'both', 'connect']);
    expect(highlightSegments('あいう')).toEqual([{ text: 'あいう', kind: 'plain' }]);
  });
});

const buildCombined = (options: { walkthroughs?: boolean }) =>
  formatCombinedPromptForAI([{ startMs: 0, endMs: 1000, text: BENCHMARK }] as never, options);

describe('prompts', () => {
  it('gives the walkthrough prompt the surrounding sentences, skipping far-away ones, and asks for the evidence split', () => {
    const lines = walkthroughContextLines(context, ['S3']);
    expect(lines[0]).toContain('S1:');
    expect(lines[0]).toContain('(English: I brought two yesterday.)');
    expect(lines.some((line) => line.startsWith('S5:'))).toBe(true);
    expect(lines.some((line) => line.startsWith('S7:'))).toBe(false);

    const plan = planEpisodePack(context, undefined, { forceTargets: false, walkthroughSentenceIds: new Set(['s3']) });
    expect(plan.walkthroughHandles).toEqual(['S3']);
    const prompts = buildEpisodePackPrompts(context, { ...plan, wantsTargets: false });
    const prompt = prompts.find((text) => text.includes('SURROUNDING SENTENCES'))!;
    expect(prompt).toBeDefined();
    expect(prompt).toContain('SURROUNDING SENTENCES');
    expect(prompt).toContain('EXPLAIN THESE:\nS3: ' + BENCHMARK);
    expect(prompt).toContain('"inferred"');
    expect(prompt).toContain('"caveat"');
    expect(prompt).toContain('Never invent context');
    expect(prompt).toContain('"walkthroughs"');
  });

  it('is part of the quick-import combined prompt by default and can be switched off', () => {
    expect(buildCombined({})).toContain('"walkthroughs"');
    expect(buildCombined({ walkthroughs: false })).not.toContain('"walkthroughs"');
  });

  it('is accepted by the pack reply parser alongside other parts', () => {
    const parsed = parseEpisodePackReply(JSON.stringify({ walkthroughs: { S3: WALKTHROUGH_SHAPE.S4 } }), context, NOW);
    expect(parsed.error).toBeUndefined();
    expect(parsed.walkthroughs?.drafts.size).toBe(1);
    expect(parseEpisodePackReply('{"nonsense": 1}', context, NOW).error).toMatch(/walkthroughs/);
  });
});

describe('saveEpisodePackReply with walkthroughs', () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it('stores walkthroughs on the chapter, preserves existing drafts and analyses, and marks the sentence as no longer needing one', async () => {
    const preview = buildShadowingPreview(
      { id: 'ep', type: 'other', title: 'Ep' },
      { format: 'japanese-shadowing-package', version: 2 as const, createdAt: NOW, generator: { name: 't', version: '1' } },
      ['昨日は二つ持ってきました。', BENCHMARK].map((japanese, index) => ({
        id: `ep-${index}`, japanese, startMs: 0, endMs: 1000, tags: [], transcriptStatus: 'verified' as const,
      })),
      [],
      [],
    );
    const { bookId, chapterId } = await commitSeriesEpisodeImport({ seriesId: 'se', seriesTitle: 'S', episodeTitle: 'Ep', sourceId: 'src', sourceDate: NOW, preview });
    const db = getDb();
    const book = (await db.books.get(bookId))!;
    const existingDraft = [{ japanese: BENCHMARK, role: 'engine' }];
    const rows = await db.bookSentences.where('bookId').equals(bookId).sortBy('position');
    await db.books.put({
      ...book,
      chapters: book.chapters.map((chapter) => (chapter.id === chapterId ? { ...chapter, structureDrafts: { [rows[1]!.sentenceId]: existingDraft } } : chapter)),
    });

    const before = await getEpisodePreparationContext(bookId, chapterId);
    expect(before.needsWalkthroughIds).toHaveLength(2);

    const result = await saveEpisodePackReply(bookId, chapterId, JSON.stringify({ walkthroughs: { S2: WALKTHROUGH_SHAPE.S4, S9: WALKTHROUGH_SHAPE.S4 } }));
    expect(result.error).toBeUndefined();
    expect(result.walkthroughsSaved).toBe(1);
    expect(result.rejectedWalkthroughs).toEqual([{ handle: 'S9', reason: 'Unknown sentence handle.' }]);

    const saved = (await db.books.get(bookId))!.chapters.find((chapter) => chapter.id === chapterId)!;
    expect(saved.contextWalkthroughs?.[rows[1]!.sentenceId]?.steps).toHaveLength(5);
    expect(saved.structureDrafts?.[rows[1]!.sentenceId]).toEqual(existingDraft);
    const after = await getEpisodePreparationContext(bookId, chapterId);
    expect(after.needsWalkthroughIds).toEqual([rows[0]!.sentenceId]);

    // A chapter saved before this feature existed has no field at all and still loads.
    const legacy = (await db.books.get(bookId))!;
    await db.books.put({ ...legacy, chapters: legacy.chapters.map(({ contextWalkthroughs: _drop, ...chapter }) => chapter) });
    expect((await getEpisodePreparationContext(bookId, chapterId)).needsWalkthroughIds).toHaveLength(2);
  });
});

describe('SentenceWalkthrough', () => {
  const sentence = { id: 's3', japanese: BENCHMARK, translation: 'The other one is paper.', vocabularySuggestions: [] } as unknown as Sentence;
  const walkthrough = parseWalkthroughs({ S3: WALKTHROUGH_SHAPE.S4 }, context).drafts.get('s3')!;
  const base = { sentence, focusTargets: [], quietMode: false, onQuietModeChange: () => undefined, onClose: () => undefined };

  it('leads with the contextual explanation, keeps the sentence visible with the span highlighted, and ends with the natural meaning', async () => {
    const user = userEvent.setup();
    render(<SentenceWalkthrough {...base} contextWalkthrough={walkthrough} />);
    const panel = screen.getByRole('region', { name: 'Sentence walkthrough' });
    expect(panel).toHaveTextContent('Step 1 of 5');
    expect(panel).toHaveTextContent('As for the other one, it is paper.');
    expect(panel.querySelector('mark')?.textContent).toBe('もう一つは紙');
    expect(panel).not.toHaveTextContent('No contextual explanation is saved');

    for (let i = 0; i < 3; i += 1) await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(panel).toHaveTextContent('Step 4 of 5');
    expect(panel).toHaveTextContent('Connects to 紙');
    expect(panel).toHaveTextContent('Left unsaid in Japanese');
    const marked = [...panel.querySelectorAll('mark')];
    expect(marked.find((node) => node.getAttribute('data-kind') === 'connect')?.textContent).toBe('紙');
    expect(marked.filter((node) => node.getAttribute('data-kind') === 'main').map((node) => node.textContent).join('')).toBe('何かを書いたりするやつ');
    expect(panel).toHaveTextContent(BENCHMARK);

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Finish' }));
    expect(panel).toHaveTextContent('Putting it together');
    expect(panel).toHaveTextContent('the stuff you write things on, you know');
    expect(panel).toHaveTextContent('Depends on context');
  });

  it('falls back to generic role guidance for an older sentence and says so', () => {
    render(<SentenceWalkthrough {...base} />);
    const panel = screen.getByRole('region', { name: 'Sentence walkthrough' });
    expect(panel).toHaveTextContent('No contextual explanation is saved for this sentence');
    expect(panel).toHaveTextContent('Automatic draft');
  });

  it('ignores a stored walkthrough whose sentence text has since changed', () => {
    render(<SentenceWalkthrough {...base} sentence={{ ...sentence, japanese: '全然違う文です。' }} contextWalkthrough={walkthrough} />);
    expect(screen.getByRole('region', { name: 'Sentence walkthrough' })).toHaveTextContent('No contextual explanation is saved');
  });

  it('hides the explanation until asked at minimal help', async () => {
    window.localStorage.setItem('glossbook.walkthroughSupport', 'minimal');
    const user = userEvent.setup();
    render(<SentenceWalkthrough {...base} contextWalkthrough={walkthrough} />);
    const panel = screen.getByRole('region', { name: 'Sentence walkthrough' });
    expect(panel).not.toHaveTextContent('introduces one more item');
    await user.click(screen.getByRole('button', { name: 'Explain this part' }));
    expect(panel).toHaveTextContent('introduces one more item');
    window.localStorage.removeItem('glossbook.walkthroughSupport');
  });
});
