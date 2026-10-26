import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BookAssistExtras } from '../src/components/BookAssistExtras';
import { BOOK_EXTRA_KINDS } from '../src/lib/bookAssistRun';
import { planBookAssistExtras, saveBookAssistExtras } from '../src/lib/bookAssistExtras';
import { deleteAssistRun, getAssistRun } from '../src/lib/miningApi';

vi.mock('../src/lib/bookAssistExtras', async (original) => ({
  ...await original<typeof import('../src/lib/bookAssistExtras')>(),
  planBookAssistExtras: vi.fn(), saveBookAssistExtras: vi.fn(),
}));
vi.mock('../src/lib/miningApi', () => ({ getAssistRun: vi.fn(), deleteAssistRun: vi.fn(), startBookExtrasRun: vi.fn(), cancelAssistRun: vi.fn() }));
const sentences = [{ id: 's1', handle: 1, japanese: '猫です。', translation: 'A cat.', chapterId: 'c' }];
const snapshot = { bookId: 'b', sentenceIds: ['s1'], kinds: { constructions: { handles: [1], replaceHandles: [] } } };
const result: Awaited<ReturnType<typeof saveBookAssistExtras>> = { saved: { constructions: 1 }, keptExisting: {}, problems: [], rejections: [] };
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  vi.mocked(planBookAssistExtras).mockResolvedValue({ sentences, kinds: Object.fromEntries(BOOK_EXTRA_KINDS.map((kind) => [kind, { missing: [1], existing: [], outdated: [] }])) as never });
  vi.mocked(getAssistRun).mockResolvedValue({ status: 'done', progress: '', segmentsDone: 0, segmentsTotal: 0, log: [], updatedAt: 1,
    selection: { constructions: [1] }, sentenceCount: 1, bookSentences: sentences, extraReplies: { 'constructions:1-1': '{"constructions":{}}' } });
  vi.mocked(saveBookAssistExtras).mockResolvedValue(result);
});
function open() {
  const { container } = render(<BookAssistExtras bookId="b" />);
  const details = container.querySelector('details')!;
  details.open = true; fireEvent(details, new Event('toggle'));
}
it('reattaches without local storage, saves, and lets Save retry without clearing the server', async () => {
  open();
  await screen.findByText(/1 saved/);
  expect(JSON.parse(localStorage.getItem('bookextras.snapshot.b')!)).toEqual(snapshot);
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(saveBookAssistExtras).toHaveBeenCalledTimes(2));
  expect(deleteAssistRun).not.toHaveBeenCalled();
});
it('keeps the server copy after a failed save and clears only after a successful retry', async () => {
  vi.mocked(saveBookAssistExtras).mockRejectedValue(new Error('Storage unavailable'));
  open(); await screen.findByText('Storage unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Save and clear' }));
  await waitFor(() => expect(saveBookAssistExtras).toHaveBeenCalledTimes(2));
  expect(deleteAssistRun).not.toHaveBeenCalled();
  expect(localStorage.getItem('bookextras.saved.b')).toBeNull();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save and clear' })).toBeEnabled());
  vi.mocked(saveBookAssistExtras).mockResolvedValue(result);
  fireEvent.click(screen.getByRole('button', { name: 'Save and clear' }));
  await waitFor(() => expect(deleteAssistRun).toHaveBeenCalledTimes(1));
});
it.each(['problem', 'rejection'] as const)('does not acknowledge or clear replies with an importer %s', async (kind) => {
  vi.mocked(saveBookAssistExtras).mockResolvedValue({ ...result,
    problems: kind === 'problem' ? ['Entry did not match.'] : [],
    rejections: kind === 'rejection' ? [{ kind: 'structure', reason: 'Entry did not match.' }] : [],
  });
  open(); await screen.findByText(/Entry did not match/);
  fireEvent.click(screen.getByRole('button', { name: 'Save and clear' }));
  await waitFor(() => expect(saveBookAssistExtras).toHaveBeenCalledTimes(2));
  expect(deleteAssistRun).not.toHaveBeenCalled();
  expect(localStorage.getItem('bookextras.saved.b')).toBeNull();
});
it('refuses to attach when the count matches but the sentence changed', async () => {
  vi.mocked(planBookAssistExtras).mockResolvedValue({ ...(await planBookAssistExtras('b')), sentences: [{ ...sentences[0]!, japanese: '犬です。' }] });
  open(); await screen.findByText(/original sentences could not be verified/);
  expect(saveBookAssistExtras).not.toHaveBeenCalled();
  expect(localStorage.getItem('bookextras.snapshot.b')).toBeNull();
});
it('keeps supporting the initiating device when an older server omits the sentence manifest', async () => {
  localStorage.setItem('bookextras.snapshot.b', JSON.stringify(snapshot));
  vi.mocked(getAssistRun).mockResolvedValue({ ...(await getAssistRun('b'))!, bookSentences: undefined });
  open(); await screen.findByText(/1 saved/);
  expect(saveBookAssistExtras).toHaveBeenCalledTimes(1);
});
