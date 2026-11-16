import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { resetDbForTests } from '../src/db/database';
import {
  createBook,
  ensureStudyItem,
  ensureVocabularyItem,
  ensureVocabularyStudyItem,
  getDb,
} from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { StudyItemsListPage } from '../src/pages/StudyItemsListPage';
import { withAppProviders } from '../src/test/providers';

function renderPage() {
  return render(
    withAppProviders(
      <MemoryRouter initialEntries={['/study-items']}>
        <Routes>
          <Route path="study-items" element={<StudyItemsListPage />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

async function addSentence(id: string, japanese: string, translation = '') {
  const now = new Date().toISOString();
  await getDb().sentences.add({
    id,
    normalizedKey: id,
    japanese,
    readingOnly: '',
    inlineReading: '',
    translation,
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: now,
    updatedAt: now,
  });
}

async function pushDue(studyItemId: string, days: number) {
  const item = (await getDb().studyItems.get(studyItemId))!;
  await getDb().studyItems.update(studyItemId, {
    fsrsState: { ...item.fsrsState, due: new Date(Date.now() + days * 86_400_000).toISOString() },
  });
}

describe('StudyItemsListPage (sentence cards)', () => {
  beforeEach(() => {
    resetDbForTests(`study-items-list-${createId('db')}`);
  });

  it('shows an empty state when no sentence has been met', async () => {
    renderPage();
    expect(await screen.findByText(/No sentences met yet/)).toBeInTheDocument();
  });

  it('lists a met sentence with its ladder chips linking to the card debug view', async () => {
    await addSentence('sent-1', '本を読みます。', 'I read a book.');
    const read = await ensureStudyItem('sentence', 'sent-1', 'reading_in_context');
    const tile = await ensureStudyItem('sentence', 'sent-1', 'dictation_tile:1');

    renderPage();

    expect(await screen.findByText('本を読みます。')).toBeInTheDocument();
    expect(screen.getByText('I read a book.')).toBeInTheDocument();
    const readLink = screen.getAllByRole('link').find((link) => link.getAttribute('href') === `/study-items/${read.id}`);
    expect(readLink).toBeDefined();
    expect(screen.getByRole('link', { name: /#2/ })).toHaveAttribute('href', `/study-items/${tile.id}`);
    expect(screen.getAllByText('Ear tiles').find((el) => el.closest('.chip'))!.closest('.chip')).toHaveTextContent('not yet');
  });

  it('leaves retired drill cards out of the page', async () => {
    const vocabItem = await ensureVocabularyItem('表す', 'あらわす');
    await ensureVocabularyStudyItem(vocabItem.id, 'reading_retrieval');
    await addSentence('sent-1', '本を読みます。');
    await ensureStudyItem('sentence', 'sent-1', 'reading_in_context');

    renderPage();

    await screen.findByText('本を読みます。');
    expect(screen.queryByText(/表す/)).not.toBeInTheDocument();
    expect(screen.queryByText('reading_retrieval')).not.toBeInTheDocument();
  });

  it('defaults to due sentences and switches to all and lapsed', async () => {
    await addSentence('due', '今日です。');
    await addSentence('later', '明日です。');
    await ensureStudyItem('sentence', 'due', 'reading_in_context');
    const later = await ensureStudyItem('sentence', 'later', 'reading_in_context');
    await pushDue(later.id, 3);
    await getDb().studyItems.update(later.id, {
      fsrsState: { ...(await getDb().studyItems.get(later.id))!.fsrsState, lapses: 2 },
    });

    renderPage();

    expect(await screen.findByText('今日です。')).toBeInTheDocument();
    expect(screen.queryByText('明日です。')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Due now (1)' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'All (2)' }));
    expect(screen.getByText('明日です。')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Lapsed (1)' }));
    expect(screen.queryByText('今日です。')).not.toBeInTheDocument();
    expect(screen.getByText('2 lapses')).toBeInTheDocument();
  });

  it('summarises sentences and due cards per stage', async () => {
    await addSentence('a', 'あ。');
    await addSentence('b', 'い。');
    await ensureStudyItem('sentence', 'a', 'reading_in_context');
    const laterRead = await ensureStudyItem('sentence', 'b', 'reading_in_context');
    await pushDue(laterRead.id, 1);
    await ensureStudyItem('sentence', 'b', 'ear_tiles');

    renderPage();

    await screen.findByText('Stage');
    const row = (label: string) => screen.getAllByText(label).find((el) => el.closest('tr'))!.closest('tr')!;
    expect(row('Read')).toHaveTextContent(/Read\s*2\s*1/);
    expect(row('Ear tiles')).toHaveTextContent(/Ear tiles\s*1\s*1/);
  });

  it('links the sentence into its book reader and filters by book', async () => {
    await addSentence('s1', '猫が好きです。');
    await addSentence('s2', '犬が好きです。');
    await ensureStudyItem('sentence', 's1', 'reading_in_context');
    await ensureStudyItem('sentence', 's2', 'reading_in_context');
    const cats = await createBook({ title: 'Cats' });
    const dogs = await createBook({ title: 'Dogs' });
    const addedAt = new Date().toISOString();
    await getDb().bookSentences.bulkAdd([
      { id: 'bs1', bookId: cats.id, sentenceId: 's1', position: 0, status: 'in_progress', addedAt, chapterId: 'ch1' },
      { id: 'bs2', bookId: dogs.id, sentenceId: 's2', position: 0, status: 'in_progress', addedAt },
    ]);

    renderPage();

    expect(await screen.findByRole('link', { name: '猫が好きです。' })).toHaveAttribute(
      'href',
      `/books/${cats.id}/read?chapter=ch1`,
    );
    await userEvent.selectOptions(screen.getByRole('combobox'), dogs.id);
    expect(screen.queryByText('猫が好きです。')).not.toBeInTheDocument();
    expect(screen.getByText('犬が好きです。')).toBeInTheDocument();
  });
});
