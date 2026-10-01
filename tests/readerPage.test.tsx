import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import { getDb, readSettings } from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { ReaderPage } from '../src/pages/ReaderPage';
import { withAppProviders } from '../src/test/providers';

async function seedBook() {
  const db = getDb();
  const now = new Date().toISOString();
  await db.books.add({
    id: 'book-1',
    title: 'Test Book',
    archived: false,
    chapters: [
      { id: 'ch-1', title: 'Chapter One', position: 0 },
      { id: 'ch-2', title: 'Chapter Two', position: 1 },
    ],
    updatedAt: now,
  });
  await db.sentences.bulkAdd([
    {
      id: 'sent-1',
      normalizedKey: 'sent-1',
      japanese: '本を読みます。',
      readingOnly: 'ほんをよみます。',
      inlineReading: '本[ほん]を読[よ]みます。',
      translation: 'I read a book.',
      targetVocabulary: [],
      vocabularySuggestions: [],
      sourceReferences: [],
      conflicts: [],
      firstOccurrenceIndex: 0,
      importBatchIds: [],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'sent-2',
      normalizedKey: 'sent-2',
      japanese: '電気を消しました。',
      readingOnly: 'でんきをけしました。',
      inlineReading: '電気[でんき]を消[け]しました。',
      translation: 'I turned off the light.',
      targetVocabulary: [],
      vocabularySuggestions: [],
      sourceReferences: [],
      conflicts: [],
      firstOccurrenceIndex: 1,
      importBatchIds: [],
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.bookSentences.bulkAdd([
    {
      id: 'bs-1',
      bookId: 'book-1',
      sentenceId: 'sent-1',
      position: 0,
      status: 'unstarted',
      addedAt: now,
      chapterId: 'ch-1',
    },
    {
      id: 'bs-2',
      bookId: 'book-1',
      sentenceId: 'sent-2',
      position: 1,
      status: 'unstarted',
      addedAt: now,
      chapterId: 'ch-2',
    },
  ]);
  await db.sentenceAudio.add({
    id: 'audio-1',
    sentenceId: 'sent-1',
    sourceId: 'source-1',
    sourceSentenceId: 'source-sent-1',
    sourceTitle: 'Reference Video',
    mimeType: 'audio/mp4',
    durationMs: 1_200,
    startMs: 0,
    endMs: 1_200,
    blob: new Blob(['ref'], { type: 'audio/mp4' }),
    importedAt: now,
  });
}

function renderReaderPage(path: string) {
  return render(
    withAppProviders(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="books/:bookId/read" element={<ReaderPage />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

describe('ReaderPage (always-available chapter read-along)', () => {
  beforeEach(async () => {
    resetDbForTests(`reader-page-${createId('db')}`);
    await ensureSettings();
  });

  it('renders every sentence in the whole book when no chapter is given, with a Play control', async () => {
    await seedBook();
    renderReaderPage('/books/book-1/read');

    await screen.findByText('本を読みます。');
    expect(screen.getByText('電気を消しました。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '▶ Play' })).toBeInTheDocument();
  });

  it('gives a chapterless book a real "Whole book" chapter on request and opens preparation', async () => {
    await seedBook();
    const db = getDb();
    await db.books.update('book-1', { chapters: [] });
    await db.bookSentences.toCollection().modify((row) => { delete row.chapterId; });
    const user = userEvent.setup();
    renderReaderPage('/books/book-1/read');

    await user.click(await screen.findByRole('button', { name: 'Prepare this book (optional)' }));

    expect(await screen.findByText(/Episode preparation/)).toBeInTheDocument();
    const book = await db.books.get('book-1');
    expect(book?.chapters).toHaveLength(1);
    expect(book?.chapters[0]?.title).toBe('Whole book');
    const rows = await db.bookSentences.where('bookId').equals('book-1').toArray();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.chapterId === book?.chapters[0]?.id)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Prepare this book (optional)' })).not.toBeInTheDocument();
  });

  it('does not offer the default chapter when the book already has chapters', async () => {
    await seedBook();
    renderReaderPage('/books/book-1/read');
    await screen.findByText('本を読みます。');
    expect(screen.queryByRole('button', { name: 'Prepare this book (optional)' })).not.toBeInTheDocument();
  });

  it('scopes to a single chapter via the ?chapter= param', async () => {
    await seedBook();
    renderReaderPage('/books/book-1/read?chapter=ch-2');

    await screen.findByText('電気を消しました。');
    expect(screen.queryByText('本を読みます。')).not.toBeInTheDocument();
    // ch-2's sentence has no native audio — degrades to plain text, no play button, and a warning.
    expect(screen.getByText(/No native audio for this chapter yet\./)).toBeInTheDocument();
  });

  it('offers an optional whole-episode focus draft that never blocks reading', async () => {
    await seedBook();
    const db = getDb();
    const now = new Date().toISOString();
    await db.vocabularyItems.add({ id: 'v-1', expression: '図書館', reading: 'としょかん', meaning: 'library', createdAt: now, updatedAt: now });
    await db.sentenceVocabulary.bulkAdd(['sent-1', 'sent-2'].map((sentenceId) => ({
      id: `sv-${sentenceId}`, sentenceId, vocabularyItemId: 'v-1', createdAt: now, updatedAt: now,
    })));
    renderReaderPage('/books/book-1/read');

    await screen.findByText('本を読みます。');
    const summary = await screen.findByText('Suggested focus for this book');
    expect(summary.closest('details')).toHaveTextContent('図書館');
    expect(summary.closest('details')).toHaveTextContent('Appears in 2 sentences');
    expect(await db.studyItems.count()).toBe(0);
  });

  it('walks through a sentence with no vocabulary, analysis or gating, keeping audio adjust and quiet mode reachable', async () => {
    await seedBook();
    const user = userEvent.setup();
    renderReaderPage('/books/book-1/read');
    await screen.findByText('本を読みます。');
    await user.click(screen.getAllByRole('button', { name: 'Walk through' })[0]!);

    const panel = await screen.findByRole('region', { name: 'Sentence walkthrough' });
    expect(panel).toHaveTextContent('Automatic draft');
    expect(panel).toHaveTextContent('Step 1 of');
    expect(panel).toHaveTextContent('not assessed yet');
    // Adjust itself needs a real Blob size, which fake-indexeddb drops; the walkthrough mounts the same NativeAudioButton.
    expect(within(panel).getByRole('button', { name: /Play native sentence recording/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(panel).toHaveTextContent('Step 2 of');

    await user.click(screen.getByLabelText(/Can.t speak right now/));
    await waitFor(async () => expect((await readSettings()).quietMode).toBe(true));

    await user.click(screen.getByRole('button', { name: 'Back to reading' }));
    expect(screen.queryByRole('region', { name: 'Sentence walkthrough' })).not.toBeInTheDocument();
    expect(await getDb().studyItems.count()).toBe(0);
    expect(await getDb().reviews.count()).toBe(0);
  });

  it('validates a pasted preparation reply, lets the learner dismiss a target, and feeds the walkthrough', async () => {
    await seedBook();
    const user = userEvent.setup();
    renderReaderPage('/books/book-1/read?chapter=ch-1');
    await screen.findByText('本を読みます。');

    await user.click(await screen.findByText(/Episode preparation/));
    expect((screen.getByLabelText('Episode pack prompt') as HTMLTextAreaElement).value).toContain('S1: 本を読みます。');
    const reply = JSON.stringify({
      targets: [
        { kind: 'expression', label: '読みます', reason: 'Polite present.', occurrences: [{ sentence: 'S1', text: '読みます' }] },
        { kind: 'expression', label: '幻', reason: 'Invented.', occurrences: [{ sentence: 'S1', text: '幻' }] },
      ],
    });
    await user.click(screen.getByLabelText('AI reply'));
    await user.paste(reply);
    await user.click(screen.getByRole('button', { name: 'Check and save reply' }));

    expect(await screen.findByText(/some rejected, listed below/)).toBeInTheDocument();
    expect(await screen.findByText(/No quoted occurrence matched a real sentence/)).toBeInTheDocument();

    expect(screen.getByLabelText('Episode focus')).toHaveTextContent('読みます');
    expect(screen.getByText(/Focus here:/)).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Walk through' })[0]!);
    const panel = await screen.findByRole('region', { name: 'Sentence walkthrough' });
    expect(panel).toHaveTextContent('読みます');
    expect(panel).toHaveTextContent('Worth noticing here');

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText(/Worth noticing here/)).not.toBeInTheDocument());
    expect(await getDb().studyItems.count()).toBe(0);
    expect(await getDb().reviews.count()).toBe(0);
  });

  it('practises a focus target and compares real uses inside the walkthrough without touching FSRS', async () => {
    await seedBook();
    const db = getDb();
    await db.bookSentences.update('bs-2', { chapterId: 'ch-1' });
    const user = userEvent.setup();
    renderReaderPage('/books/book-1/read?chapter=ch-1');
    await screen.findByText('電気を消しました。');

    await user.click(await screen.findByText(/Episode preparation/));
    await user.click(screen.getByLabelText('AI reply'));
    await user.paste(JSON.stringify({
      targets: [{
        kind: 'expression', label: 'を', reason: 'Marks the object.',
        occurrences: [{ sentence: 'S1', text: 'を' }, { sentence: 'S2', text: 'を' }],
      }],
    }));
    await user.click(screen.getByRole('button', { name: 'Check and save reply' }));
    await screen.findByLabelText('Episode focus');

    await user.click(screen.getAllByRole('button', { name: 'Walk through' })[0]!);
    const panel = await screen.findByRole('region', { name: 'Sentence walkthrough' });

    await user.click(within(panel).getByRole('button', { name: 'Practise this' }));
    expect(within(panel).getByText(/Before you look/)).toBeInTheDocument();
    expect(within(panel).queryByText('Marks the object.')).not.toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Show explanation' }));
    expect(within(panel).getByText(/Marks the object\./)).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'I needed the explanation' }));
    expect(within(panel).getByText(/review schedule is unchanged/)).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: 'Compare uses' }));
    const compare = await within(panel).findByLabelText('Compare uses of を');
    expect(compare).toHaveTextContent('電気を消しました。');
    expect(compare.querySelector('mark')?.textContent).toBe('を');

    await waitFor(async () => {
      const events = await db.sentenceLearningEvents.toArray();
      expect(events.map((event) => event.action).sort()).toEqual(
        ['compare_uses_viewed', 'target_practice', 'walkthrough_opened'],
      );
    });
    const events = await db.sentenceLearningEvents.toArray();
    const practice = events.find((event) => event.action === 'target_practice')!;
    expect(practice).toMatchObject({ outcome: 'needed_help', assessmentSource: 'self', support: 'explanation_hidden', sentenceId: 'sent-1', bookId: 'book-1', chapterId: 'ch-1' });
    expect(events.find((event) => event.action === 'compare_uses_viewed')?.exposedSentenceId).toBe('sent-2');
    expect(await db.reviews.count()).toBe(0);
    expect(await db.studyItems.count()).toBe(0);
  });

  it('shows a failed reply without blocking reading', async () => {
    await seedBook();
    const user = userEvent.setup();
    renderReaderPage('/books/book-1/read?chapter=ch-1');
    await user.click(await screen.findByText(/Episode preparation/));
    await user.click(screen.getByLabelText('AI reply'));
    await user.paste('sorry, no');
    await user.click(screen.getByRole('button', { name: 'Check and save reply' }));
    expect(await screen.findByText(/Could not use that reply/)).toBeInTheDocument();
    expect(screen.getByText('本を読みます。')).toBeInTheDocument();
  });

  it('says so when a walked-through sentence has no native audio', async () => {
    await seedBook();
    const user = userEvent.setup();
    renderReaderPage('/books/book-1/read');
    await screen.findByText('電気を消しました。');
    await user.click(screen.getByText('電気を消しました。'));
    await user.click(screen.getByRole('button', { name: 'Walk through' }));
    expect(await screen.findByText(/No native audio for this sentence/)).toBeInTheDocument();
  });

  it('shows no focus panel when nothing recurs', async () => {
    await seedBook();
    renderReaderPage('/books/book-1/read');
    await screen.findByText('本を読みます。');
    expect(screen.queryByText(/Suggested focus/)).not.toBeInTheDocument();
  });

  it('does not offer a play button for a sentence with no native audio', async () => {
    await seedBook();
    renderReaderPage('/books/book-1/read');

    await screen.findByText('本を読みます。');
    expect(screen.getAllByRole('button', { name: 'Play from here' })).toHaveLength(1);
  });

  it('switches to furigana/reading-only text via the display-mode toggle', async () => {
    await seedBook();
    const user = userEvent.setup();
    renderReaderPage('/books/book-1/read');

    await screen.findByText('本を読みます。');
    await user.selectOptions(screen.getByLabelText('Text'), 'reading');
    expect(screen.getByText('ほんをよみます。')).toBeInTheDocument();
    expect(screen.queryByText('本を読みます。')).not.toBeInTheDocument();
  });

  it('keeps translations hidden until revealed per sentence', async () => {
    await seedBook();
    const user = userEvent.setup();
    renderReaderPage('/books/book-1/read');

    await screen.findByText('本を読みます。');
    expect(screen.queryByText('I read a book.')).not.toBeInTheDocument();

    const [reveal] = screen.getAllByRole('button', { name: 'Show translation' });
    await user.click(reveal!);
    expect(screen.getByText('I read a book.')).toBeInTheDocument();
  });
});
