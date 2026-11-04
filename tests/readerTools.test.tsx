import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import { getDb, getWordMeaningCheckTarget } from '../src/db/repository';
import type { Sentence, VocabularySuggestion } from '../src/domain/types';
import { buildCheckPuzzle } from '../src/lib/earTiles';
import { createId } from '../src/lib/ids';
import { grammarFeedbackTargetKey } from '../src/lib/grammarEvidence';
import { buildWordEvidence, meaningCheckTargetKey, readingFeedbackTargetKey } from '../src/lib/wordEvidence';
import { ReaderPage } from '../src/pages/ReaderPage';
import { withAppProviders } from '../src/test/providers';

const NOUN = '名詞/普通名詞/一般';
const KAKU = '助詞/格助詞';
const pieces: [string, string, boolean?][] = [
  ['私', '代名詞'],
  ['は', '助詞/係助詞'],
  ['猫', NOUN, true],
  ['が', KAKU],
  ['魚', NOUN, true],
  ['を', KAKU],
  ['食べ', '動詞/一般'],
  ['ました', '助動詞'],
  ['。', '補助記号/句点'],
];

function sentenceRow(now: string): Sentence {
  let cursor = 0;
  const suggestions: VocabularySuggestion[] = pieces.map(([surface, pos, content], i) => {
    const suggestion: VocabularySuggestion = {
      id: `sg-${i}`,
      surface,
      start: cursor,
      end: cursor + surface.length,
      expression: surface,
      reading: surface,
      pos,
      english: surface === '猫' ? 'cat' : surface === '魚' ? 'fish' : undefined,
      source: 'morphology',
      selectedByDefault: Boolean(content),
    };
    cursor += surface.length;
    return suggestion;
  });
  return {
    id: 'sent-1',
    normalizedKey: 'sent-1',
    japanese: pieces.map((p) => p[0]).join(''),
    readingOnly: '',
    inlineReading: '',
    translation: 'I ate the cat’s fish.',
    targetVocabulary: [],
    vocabularySuggestions: suggestions,
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

async function seed() {
  const db = getDb();
  const now = new Date().toISOString();
  await db.books.add({ id: 'book-1', title: 'Test Book', archived: false, chapters: [{ id: 'ch-1', title: 'Chapter One', position: 0 }], updatedAt: now });
  await db.sentences.add(sentenceRow(now));
  await db.bookSentences.add({ id: 'bs-1', bookId: 'book-1', sentenceId: 'sent-1', position: 0, status: 'unstarted', addedAt: now, chapterId: 'ch-1' });
  await db.sentenceAudio.add({
    id: 'audio-1', sentenceId: 'sent-1', sourceId: 'source-1', sourceSentenceId: 'src-1', sourceTitle: 'Ref',
    mimeType: 'audio/mp4', durationMs: 1_200, startMs: 0, endMs: 1_200, blob: new Blob(['ref'], { type: 'audio/mp4' }), importedAt: now,
  });
  for (const [id, expression, meaning, surface] of [['v-cat', '猫', 'cat', '猫'], ['v-fish', '魚', 'fish', '魚']] as const) {
    await db.vocabularyItems.add({ id, expression, reading: expression, meaning, partOfSpeech: 'noun', createdAt: now, updatedAt: now });
    await db.sentenceVocabulary.add({ id: `sv-${id}`, sentenceId: 'sent-1', vocabularyItemId: id, surfaceForm: surface } as never);
  }
}

function renderReader() {
  return render(
    withAppProviders(
      <MemoryRouter initialEntries={['/books/book-1/read?chapter=ch-1']}>
        <Routes>
          <Route path="books/:bookId/read" element={<ReaderPage />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

describe('reader study tools', () => {
  beforeEach(async () => {
    resetDbForTests(`reader-tools-${createId('db')}`);
    await ensureSettings();
    localStorage.setItem('satori-glossbook:reader-text-mode', 'plain');
    await seed();
  });

  it('blanks a phrase for dictation, shows the answer after checking, and records only the learner’s own call', async () => {
    const user = userEvent.setup();
    renderReader();
    await user.click(await screen.findByRole('button', { name: 'Dictation' }));

    const blank = await screen.findByLabelText('Sentence with a phrase blanked');
    expect(blank.textContent).toContain('＿＿＿');
    expect(blank.textContent).not.toContain('私は');

    await user.type(screen.getByLabelText('Missing phrase'), '私は');
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('✓ Matches')).toBeInTheDocument();
    expect(screen.getByText('私は', { selector: '.jp' })).toBeInTheDocument();

    // The typed match never records anything by itself.
    expect(await getDb().sentenceLearningEvents.count()).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Got it' }));

    await waitFor(async () => {
      const events = await getDb().sentenceLearningEvents.toArray();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        action: 'target_practice',
        sentenceId: 'sent-1',
        support: 'target_masked',
        outcome: 'got_it',
        assessmentSource: 'self',
        target: { kind: 'expression', label: '私は' },
      });
    });
    expect(await getDb().reviews.count()).toBe(0);
    expect(await getDb().studyItems.count()).toBe(0);
  });

  it('asks what a word means, reveals it, and logs the self-judged result as meaning recall', async () => {
    const user = userEvent.setup();
    renderReader();
    await user.click(await screen.findByRole('button', { name: 'Word check' }));

    expect(await screen.findByText(/What does/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show meaning' }));
    await user.click(screen.getByRole('button', { name: 'Needed help' }));

    await waitFor(async () => {
      const events = await getDb().sentenceLearningEvents.toArray();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        action: 'target_practice',
        support: 'target_masked',
        outcome: 'needed_help',
        assessmentSource: 'self',
      });
      expect(events[0]!.target!.key).toMatch(/^vocab:v-(cat|fish)$/);
    });
    expect(await getDb().reviews.count()).toBe(0);
  });

  it('rebuilds the sentence from tiles in the text itself, and rates nothing', async () => {
    const user = userEvent.setup();
    renderReader();
    await user.click(await screen.findByRole('button', { name: 'Ear tiles' }));

    // The blanks stand where the sentence line was; the bank sits in the panel below it.
    const slots = await screen.findByLabelText('Sentence so far');
    expect(slots.textContent).not.toContain('猫');
    const bank = screen.getByLabelText('Tile bank');
    expect(bank).toBeInTheDocument();

    const answer = buildCheckPuzzle(sentenceRow(new Date().toISOString()), 'seed')!.answer;
    for (const text of answer) {
      const tile = Array.from(bank.querySelectorAll('button')).find((button) => button.textContent === text && !button.disabled);
      expect(tile, text).toBeTruthy();
      await user.click(tile!);
    }
    expect(await screen.findByText('✓ Heard it cleanly')).toBeInTheDocument();
    expect(slots.textContent).toContain('猫');

    // The clean round is logged as listening evidence, graded by slips, with no self-assessment and no rating.
    await waitFor(async () => {
      const events = (await getDb().sentenceLearningEvents.toArray()).filter((event) => event.action === 'target_practice');
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ sentenceId: 'sent-1', target: { key: 'eartiles:sent-1' }, outcome: 'got_it' });
      expect(events[0]!.assessmentSource).toBeUndefined();
    });
    expect(await getDb().reviews.count()).toBe(0);
    expect(await getDb().studyItems.count()).toBe(0);
  });

  it('says why Ear tiles and Dictation cannot open on a sentence that does not split into phrases', async () => {
    await getDb().sentences.update('sent-1', { vocabularySuggestions: [] });
    const user = userEvent.setup();
    renderReader();
    await user.click(await screen.findByRole('button', { name: 'Ear tiles' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/word analysis/);
    expect(screen.queryByRole('group', { name: 'Ear tiles' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Dictation' }));
    expect(await screen.findByText(/Dictation needs the sentence's word analysis/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Sentence with a phrase blanked')).not.toBeInTheDocument();
  });

  it('hides all help until a Read check is revealed, then logs only the learner’s own call as a gist check', async () => {
    const user = userEvent.setup();
    renderReader();
    await user.click(await screen.findByRole('button', { name: 'Read check' }));

    const group = await screen.findByRole('group', { name: 'Read check' });
    expect(group).toBeInTheDocument();
    // Plain sentence only: no translation, no word help while unrevealed.
    expect(screen.queryByText('I ate the cat’s fish.')).not.toBeInTheDocument();
    expect(screen.queryByText('猫 — cat')).not.toBeInTheDocument();
    expect(await getDb().sentenceLearningEvents.count()).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Show help and meaning' }));
    expect(await screen.findByText('I ate the cat’s fish.')).toBeInTheDocument();
    expect(await getDb().sentenceLearningEvents.count()).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Needed help' }));

    await waitFor(async () => {
      const events = await getDb().sentenceLearningEvents.toArray();
      // The check itself, plus the follow-up offer it triggers (see the offer test below).
      expect(events.map((event) => event.action).sort()).toEqual(['follow_up_offer', 'gist_check']);
      expect(events.find((event) => event.action === 'gist_check')).toMatchObject({ sentenceId: 'sent-1', outcome: 'needed_help', assessmentSource: 'self' });
    });
    expect(await getDb().reviews.count()).toBe(0);
    expect(await getDb().studyItems.count()).toBe(0);
  });

  it('offers one follow-up after "Needed help", logs the offer under the check\u2019s visit, and opens it on request', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99); // outside the random share: the rule decides
    try {
      const user = userEvent.setup();
      renderReader();
      await user.click(await screen.findByRole('button', { name: 'Read check' }));
      await user.click(await screen.findByRole('button', { name: 'Show help and meaning' }));
      // "Got it" offers nothing.
      await user.click(screen.getByRole('button', { name: 'Needed help' }));

      expect(await screen.findByText(/Try Word check on it\?/)).toBeInTheDocument();
      const events = await getDb().sentenceLearningEvents.toArray();
      const check = events.find((event) => event.action === 'gist_check')!;
      const offer = events.find((event) => event.action === 'follow_up_offer')!;
      expect(offer).toMatchObject({ sentenceId: 'sent-1', visitId: check.visitId, target: { kind: 'expression', key: 'followup:meaning:rule', label: 'meaning' } });
      expect(offer.outcome).toBeUndefined();

      await user.click(screen.getByRole('button', { name: 'Try it' }));
      expect(await screen.findByRole('group', { name: /word check|meaning/i })).toBeInTheDocument();
      expect(await getDb().reviews.count()).toBe(0);
    } finally {
      random.mockRestore();
    }
  });

  it('offers nothing after "Got it"', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const user = userEvent.setup();
      renderReader();
      await user.click(await screen.findByRole('button', { name: 'Read check' }));
      await user.click(await screen.findByRole('button', { name: 'Show help and meaning' }));
      await user.click(screen.getByRole('button', { name: 'Got it' }));
      await waitFor(async () => expect(await getDb().sentenceLearningEvents.count()).toBe(1));
      expect(screen.queryByText(/Try .* on it\?/)).not.toBeInTheDocument();
      expect((await getDb().sentenceLearningEvents.toArray()).some((event) => event.action === 'follow_up_offer')).toBe(false);
    } finally {
      random.mockRestore();
    }
  });

  it('opens the Read check, not the walkthrough, from a planner Read check step', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(
      withAppProviders(
        <MemoryRouter initialEntries={['/books/book-1/recall/sent-1']}>
          <Routes>
            <Route path="books/:bookId/recall/:sentenceId" element={<ReaderPage />} />
          </Routes>
        </MemoryRouter>,
      ),
    );
    expect(await screen.findByRole('group', { name: 'Read check' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Sentence walkthrough' })).not.toBeInTheDocument();
  });

  it('docks the shadowing workspace under the sentence, without the page chrome, and closes it again', async () => {
    const user = userEvent.setup();
    renderReader();
    await user.click(await screen.findByRole('button', { name: 'Shadowing' }));

    const region = await screen.findByRole('region', { name: 'Shadowing' });
    // The embedded workspace keeps practice (record, loop) and drops the standalone page's chrome.
    expect(await within(region).findByRole('button', { name: 'Record attempt' })).toBeInTheDocument();
    expect(within(region).queryByText('Layout')).not.toBeInTheDocument();
    expect(within(region).queryByRole('link', { name: 'Back to Practice' })).not.toBeInTheDocument();

    // The learner's own good / not good call is logged as evidence, not a rating.
    await user.click(screen.getByRole('button', { name: 'Good' }));
    await waitFor(async () => {
      const events = await getDb().sentenceLearningEvents.toArray();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ action: 'target_practice', sentenceId: 'sent-1', target: { key: 'shadow:sent-1' }, outcome: 'got_it', assessmentSource: 'self' });
    });
    expect(await getDb().reviews.count()).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Close shadowing' }));
    expect(screen.queryByRole('region', { name: 'Shadowing' })).not.toBeInTheDocument();
  });

  it('opens shadowing, not the walkthrough, from a planner shadowing step', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(
      withAppProviders(
        <MemoryRouter initialEntries={['/books/book-1/speak/sent-1']}>
          <Routes>
            <Route path="books/:bookId/speak/:sentenceId" element={<ReaderPage />} />
          </Routes>
        </MemoryRouter>,
      ),
    );
    expect(await screen.findByRole('region', { name: 'Shadowing' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Sentence walkthrough' })).not.toBeInTheDocument();
  });

  it('opens the word check, not the walkthrough, from a planner Word check step', async () => {
    // jsdom has no scrollIntoView; the lesson/check route scrolls the opened sentence into view.
    Element.prototype.scrollIntoView = vi.fn();
    render(
      withAppProviders(
        <MemoryRouter initialEntries={['/books/book-1/check/sent-1']}>
          <Routes>
            <Route path="books/:bookId/check/:sentenceId" element={<ReaderPage />} />
          </Routes>
        </MemoryRouter>,
      ),
    );
    expect(await screen.findByRole('group', { name: 'Word meaning check' })).toBeInTheDocument();
    expect(screen.getByText(/What does/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Sentence walkthrough' })).not.toBeInTheDocument();
  });

  it('lets the learner tap a word and say whether they knew its reading and meaning, as evidence only', async () => {
    const user = userEvent.setup();
    renderReader();
    // The word in the sentence line is itself the button; there is no second list of words.
    expect(screen.queryByRole('group', { name: 'Words in this sentence' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: '猫' }));
    const panel = await screen.findByRole('group', { name: 'Word feedback' });
    const buttons = within(panel).getAllByRole('button', { name: 'I knew it' });
    await user.click(buttons[0]!);
    await user.click(within(panel).getByRole('button', { name: 'I didn’t' }));

    await waitFor(async () => {
      const events = await getDb().sentenceLearningEvents.toArray();
      expect(events).toHaveLength(2);
      const byKey = new Map(events.map((event) => [event.target?.key, event]));
      // Plain text mode hides the reading (recall); a new word's gloss is showing, so its meaning is only recognition.
      expect(byKey.get(readingFeedbackTargetKey('v-cat'))).toMatchObject({ action: 'target_practice', support: 'target_masked', outcome: 'got_it', assessmentSource: 'self' });
      expect(byKey.get(meaningCheckTargetKey('v-cat'))).toMatchObject({ support: 'explanation_hidden', outcome: 'needed_help', assessmentSource: 'self' });
    });
    expect(await getDb().reviews.count()).toBe(0);
    expect(await getDb().studyItems.count()).toBe(0);

    // A tool that would give the word away stops the line from taking taps and drops the panel.
    await user.click(screen.getByRole('button', { name: 'Word check' }));
    expect(screen.queryByRole('group', { name: 'Word feedback' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '猫' })).not.toBeInTheDocument();
  });

  it('works on a word that has no vocabulary item yet, creating just that item', async () => {
    // An unconfirmed AI draft: the sentence has word suggestions but nothing linked or saved.
    await getDb().sentenceVocabulary.clear();
    await getDb().vocabularyItems.clear();
    const user = userEvent.setup();
    renderReader();
    await user.click(await screen.findByRole('button', { name: '猫' }));
    const panel = await screen.findByRole('group', { name: 'Word feedback' });
    await user.click(within(panel).getAllByRole('button', { name: 'I knew it' })[0]!);

    await waitFor(async () => {
      const [item] = await getDb().vocabularyItems.toArray();
      expect(item).toMatchObject({ expression: '猫' });
      const events = await getDb().sentenceLearningEvents.toArray();
      expect(events).toHaveLength(1);
      expect(events[0]!.target!.key).toBe(readingFeedbackTargetKey(item!.id));
    });
    expect(await getDb().sentenceVocabulary.count()).toBe(0);
    expect(await getDb().studyItems.count()).toBe(0);
    expect(await getDb().reviews.count()).toBe(0);
  });

  it('lets the learner tap a grammar pattern in the sentence and records spot/use calls as evidence only', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await db.grammarPatterns.add({
      id: 'g-mashita', canonicalName: '〜ました', normalizedKey: 'mashita', aliases: [], shortMeaning: 'polite past', provenance: 'manual', createdAt: now, updatedAt: now,
    });
    await db.sentenceGrammar.add({
      id: 'sg-1', sentenceId: 'sent-1', grammarPatternId: 'g-mashita', surfaceForm: '食べました', start: 6, end: 11,
      confirmedByLearner: true, source: 'manual', createdAt: now, updatedAt: now,
    });
    const user = userEvent.setup();
    renderReader();
    // 食べ is not a tappable word, so it carries the pattern's tap.
    await user.click(await screen.findByRole('button', { name: '食べ' }));
    const panel = await screen.findByRole('group', { name: 'Grammar feedback' });
    expect(panel).not.toHaveTextContent('polite past');
    await user.click(within(panel).getAllByRole('button', { name: 'I knew it' })[0]!);
    await user.click(within(panel).getByRole('button', { name: 'I didn’t' }));
    expect(panel).toHaveTextContent('polite past');

    await waitFor(async () => {
      const events = await getDb().sentenceLearningEvents.toArray();
      expect(events).toHaveLength(2);
      const byKey = new Map(events.map((event) => [event.target?.key, event]));
      expect(byKey.get(grammarFeedbackTargetKey('g-mashita', 'spot'))).toMatchObject({ action: 'target_practice', support: 'target_masked', outcome: 'got_it', assessmentSource: 'self', target: { kind: 'grammar' } });
      expect(byKey.get(grammarFeedbackTargetKey('g-mashita', 'use'))).toMatchObject({ support: 'target_masked', outcome: 'needed_help' });
    });
    expect(await getDb().reviews.count()).toBe(0);
    expect(await getDb().studyItems.count()).toBe(0);

    // Tapping a word instead swaps the panel; the two never show together.
    await user.click(screen.getByRole('button', { name: '猫' }));
    expect(await screen.findByRole('group', { name: 'Word feedback' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Grammar feedback' })).not.toBeInTheDocument();
  });

  it('closes the tool when another sentence is chosen', async () => {
    const user = userEvent.setup();
    renderReader();
    await user.click(await screen.findByRole('button', { name: 'Word check' }));
    expect(await screen.findByRole('group', { name: 'Word meaning check' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Word check' }));
    expect(screen.queryByRole('group', { name: 'Word meaning check' })).not.toBeInTheDocument();
  });
});

describe('meaning check evidence', () => {
  beforeEach(() => {
    resetDbForTests(`meaning-evidence-${createId('db')}`);
  });

  it('turns a self-judged check into meaning recall, and nothing else', () => {
    const at = '2026-10-30T00:00:00.000Z';
    const map = buildWordEvidence({
      reviews: [],
      studyItems: [],
      wordsBySentence: new Map(),
      learningEvents: [
        { sentenceId: 's', timestamp: at, action: 'target_practice', support: 'target_masked', outcome: 'got_it', target: { kind: 'vocabulary', key: meaningCheckTargetKey('w1'), label: '猫' } },
        // A walkthrough target practice is not tied to a word id, and an unmasked one is not recall.
        { sentenceId: 's', timestamp: at, action: 'target_practice', support: 'target_masked', outcome: 'got_it', target: { kind: 'vocabulary', key: 'prepared-1', label: '猫' } },
        { sentenceId: 's', timestamp: at, action: 'target_practice', support: 'explanation_hidden', outcome: 'got_it', target: { kind: 'vocabulary', key: meaningCheckTargetKey('w2'), label: '魚' } },
      ],
    });
    expect(map.get('w1')).toEqual([{ wordId: 'w1', facet: 'meaning', kind: 'recall', at: Date.parse(at), success: true }]);
    // Shown with the answer on screen is only recognition.
    expect(map.get('w2')).toEqual([{ wordId: 'w2', facet: 'meaning', kind: 'recognition', at: Date.parse(at), success: true }]);
    expect(map.size).toBe(2);
  });

  it('turns reader word feedback into reading evidence: masked is recall, shown is recognition', () => {
    const at = '2026-10-30T00:00:00.000Z';
    const map = buildWordEvidence({
      reviews: [],
      studyItems: [],
      wordsBySentence: new Map(),
      learningEvents: [
        { sentenceId: 's', timestamp: at, action: 'target_practice', support: 'target_masked', outcome: 'needed_help', target: { kind: 'vocabulary', key: readingFeedbackTargetKey('w1'), label: '猫' } },
        { sentenceId: 's', timestamp: at, action: 'target_practice', support: 'explanation_hidden', outcome: 'got_it', target: { kind: 'vocabulary', key: readingFeedbackTargetKey('w2'), label: '魚' } },
      ],
    });
    expect(map.get('w1')).toEqual([{ wordId: 'w1', facet: 'reading', kind: 'recall', at: Date.parse(at), success: false }]);
    expect(map.get('w2')).toEqual([{ wordId: 'w2', facet: 'reading', kind: 'recognition', at: Date.parse(at), success: true }]);
  });

  it('asks about the word whose meaning is weaker, and moves on once it has been recalled', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await db.sentences.add(sentenceRow(now));
    for (const [id, expression, meaning] of [['v-cat', '猫', 'cat'], ['v-fish', '魚', 'fish']] as const) {
      await db.vocabularyItems.add({ id, expression, reading: expression, meaning, partOfSpeech: 'noun', createdAt: now, updatedAt: now });
      await db.sentenceVocabulary.add({ id: `sv-${id}`, sentenceId: 'sent-1', vocabularyItemId: id, surfaceForm: expression } as never);
    }
    const sentence = (await db.sentences.get('sent-1'))!;
    const log = (key: string, outcome: 'got_it' | 'needed_help') =>
      db.sentenceLearningEvents.add({
        id: createId('sl_event'), visitId: 'v', action: 'target_practice', bookId: 'book-1', sentenceId: 'sent-1',
        timestamp: new Date().toISOString(), target: { kind: 'vocabulary', key, label: 'x' }, support: 'target_masked', outcome,
      } as never);

    const first = (await getWordMeaningCheckTarget(sentence))!;
    // Recalling the first word twice makes the other one the weaker.
    await log(meaningCheckTargetKey(first.vocabularyItemId), 'got_it');
    await log(meaningCheckTargetKey(first.vocabularyItemId), 'got_it');
    const second = (await getWordMeaningCheckTarget(sentence))!;
    expect(second.vocabularyItemId).not.toBe(first.vocabularyItemId);
    expect(second.meaning).toMatch(/cat|fish/);
  });
});
