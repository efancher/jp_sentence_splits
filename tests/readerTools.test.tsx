import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import { getDb, getWordMeaningCheckTarget } from '../src/db/repository';
import type { Sentence, VocabularySuggestion } from '../src/domain/types';
import { createId } from '../src/lib/ids';
import { buildWordEvidence, meaningCheckTargetKey } from '../src/lib/wordEvidence';
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
    expect(map.has('w2')).toBe(false);
    expect(map.size).toBe(1);
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
