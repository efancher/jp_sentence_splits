import { configure, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDb, resetDbForTests } from '../src/db/database';
import {
  deleteWordBoundaryLabel,
  listWordBoundaryLabels,
  loadWordBoundaryCandidates,
  loadWordBoundaryCandidatesForLinks,
  saveWordBoundaryLabel,
  updateSkipReason,
} from '../src/db/wordBoundaryLabels';
import { ALIGNMENT_VERSION } from '../src/lib/analysisApi';
import { createId } from '../src/lib/ids';
import { LabelWordAudioPage } from '../src/pages/LabelWordAudioPage';

// jsdom has no AudioContext: hand the page a fake decoded clip instead.
const fakeBuffer = {
  duration: 3,
  sampleRate: 16000,
  numberOfChannels: 1,
  length: 48000,
  getChannelData: () => new Float32Array(48000),
};
const decodeAudioBuffer = vi.fn(async (_blob: Blob): Promise<unknown> => fakeBuffer);
vi.mock('../src/lib/waveform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/waveform')>()),
  decodeAudioBuffer: (blob: Blob) => decodeAudioBuffer(blob),
}));
const repairSentenceAudio = vi.fn(async (_id: string): Promise<Blob | null> => null);
vi.mock('../src/sync/audioSync', () => ({ repairSentenceAudio: (id: string) => repairSentenceAudio(id) }));
// fake-indexeddb hands Blobs back as plain objects, which the real hook would then try to re-download.
vi.mock('../src/hooks/useSentenceAudioBlob', () => {
  const clip = new Blob(['clip'], { type: 'audio/mp4' }); // stable identity: the page decodes on blob change
  return { useSentenceAudioBlob: () => clip };
});
vi.mock('../src/lib/rangePlayer', () => ({
  RangePlayer: class {
    play = vi.fn(async () => undefined);
    stop = vi.fn();
    dispose = vi.fn();
  },
}));
const saveLabelsFile = vi.fn(async (_labels: unknown, _now?: unknown, _options?: unknown) => 'downloaded' as const);
vi.mock('../src/lib/wordBoundaryLabelExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/wordBoundaryLabelExport')>()),
  saveLabelsFile: (labels: unknown, now?: unknown, options?: unknown) => saveLabelsFile(labels, now, options),
}));

// These tests decode audio and write to IndexedDB several times per test; on a CPU-starved CI runner the default
// 1 s find-timeout / 5 s test limit flaked (2026-09-20), so give the whole file more room.
configure({ asyncUtilTimeout: 15_000 });
vi.setConfig({ testTimeout: 40_000 });

const T = '2026-09-20T00:00:00Z';

function phones(spec: string, startMs: number) {
  let t = startMs;
  return spec.split(' ').map((item) => {
    const [, text, ms] = /^(.+)\((\d+)\)$/.exec(item)!;
    const start = t / 1000;
    t += Number(ms);
    return { text: text!, start, end: t / 1000 };
  });
}

/** 生まれた時 — target 生まれ (ends inside the token 生まれた, at 1420 ms). */
async function seed(options: { withAlignment?: boolean; suspended?: boolean; sentenceId?: string; surfaceForm?: string; japanese?: string; inlineReading?: string } = {}) {
  const { withAlignment = true, suspended = false, sentenceId = createId('sent'), surfaceForm = '生まれ', japanese = '生まれた時', inlineReading = '生まれ[うまれ]た時[とき]' } = options;
  const db = getDb();
  const bookId = createId('book');
  await db.books.put({ id: bookId, title: 'b', createdAt: T, updatedAt: T, ...(suspended ? { suspendedAt: T } : {}) } as never);
  await db.sentences.put({
    id: sentenceId, normalizedKey: sentenceId, japanese, readingOnly: '', inlineReading,
    translation: '', targetVocabulary: [], vocabularySuggestions: [], sourceReferences: [], conflicts: [],
    firstOccurrenceIndex: 0, importBatchIds: [], createdAt: T, updatedAt: T,
  } as never);
  await db.bookSentences.put({ id: createId('bs'), bookId, sentenceId, position: 0, status: 'unstarted', addedAt: T } as never);
  const link = { id: createId('sv'), sentenceId, vocabularyItemId: 'vi', surfaceForm, createdAt: T, updatedAt: T };
  await db.sentenceVocabulary.put(link as never);
  const audioId = createId('audio');
  await db.sentenceAudio.put({
    id: audioId, sentenceId, sourceId: 's', sourceSentenceId: sentenceId, sourceTitle: 't', mimeType: 'audio/mp4',
    durationMs: 3000, startMs: 0, endMs: 3000, blob: new Blob(['x']), importedAt: T,
  });
  if (withAlignment) {
    const ph = phones('ɯ(100) m(100) a(100) ɾ(40) e(80) t(90) a(100)', 1000);
    const ph2 = phones('t(60) o(70) k(60) i(80)', 1610);
    await db.referenceAlignments.put({
      id: audioId, alignmentVersion: ALIGNMENT_VERSION, computedAt: T,
      result: {
        durationSeconds: 3,
        words: [
          { text: '生まれた', start: ph[0]!.start, end: ph[ph.length - 1]!.end, phones: ph },
          { text: '時', start: ph2[0]!.start, end: ph2[ph2.length - 1]!.end, phones: ph2 },
        ],
      },
    });
  }
  return { link, audioId, sentenceId, bookId };
}

beforeEach(() => {
  saveLabelsFile.mockClear();
  decodeAudioBuffer.mockReset();
  decodeAudioBuffer.mockImplementation(async () => fakeBuffer);
  repairSentenceAudio.mockReset();
  repairSentenceAudio.mockResolvedValue(null);
  resetDbForTests(`label-${createId('db')}`);
  window.localStorage.clear();
});

describe('loadWordBoundaryCandidates', () => {
  it('returns a link with recording + alignment, its estimators, and the book', async () => {
    const { link, bookId } = await seed();
    const pool = await loadWordBoundaryCandidates(10, () => 0.5);
    expect(pool).toHaveLength(1);
    expect(pool[0]).toMatchObject({ linkId: link.id, bookId, surfaceForm: '生まれ' });
    expect(pool[0]!.estimates.token).toEqual({ startMs: 1000, endMs: 1610 });
    expect(pool[0]!.estimates.mora).toEqual({ startMs: 1000, endMs: 1420 });
  });

  it('leaves out links without a cached alignment, in suspended books, or already labelled', async () => {
    await seed({ withAlignment: false });
    await seed({ suspended: true });
    const done = await seed();
    await saveWordBoundaryLabel({
      id: 'l1', sentenceVocabularyId: done.link.id, sentenceId: done.sentenceId, sentenceAudioId: done.audioId,
      surfaceForm: '生まれ', verdict: 'clean', shown: { startMs: 1000, endMs: 1420 }, label: { startMs: 1000, endMs: 1420 },
      estimates: { token: null, mora: null, shipped: null }, sampleKind: 'random', spanVersion: 'v', elapsedMs: 1, createdAt: T,
    });
    expect(await loadWordBoundaryCandidates(10)).toEqual([]);
  });

  it('rebuilds specific links in the given order, skipping any already labelled', async () => {
    const a = await seed();
    const b = await seed();
    const c = await seed();
    await saveWordBoundaryLabel({
      id: 'l', sentenceVocabularyId: b.link.id, sentenceId: b.sentenceId, sentenceAudioId: b.audioId, surfaceForm: '生まれ',
      verdict: 'clean', shown: { startMs: 1, endMs: 2 }, label: { startMs: 1, endMs: 2 }, estimates: { token: null, mora: null, shipped: null },
      sampleKind: 'random', spanVersion: 'v', elapsedMs: 1, createdAt: T,
    });
    const rebuilt = await loadWordBoundaryCandidatesForLinks([c.link.id, b.link.id, a.link.id, 'gone']);
    expect(rebuilt.map((x) => x.linkId)).toEqual([c.link.id, a.link.id]);
  });

  it('persists, lists and deletes labels', async () => {
    const base = {
      sentenceVocabularyId: 'v', sentenceId: 's', sentenceAudioId: 'a', surfaceForm: '語', verdict: 'clean' as const,
      shown: { startMs: 0, endMs: 1 }, estimates: { token: null, mora: null, shipped: null },
      sampleKind: 'random' as const, spanVersion: 'v', elapsedMs: 1,
    };
    await saveWordBoundaryLabel({ ...base, id: 'b', createdAt: '2026-09-20T00:00:02Z' });
    await saveWordBoundaryLabel({ ...base, id: 'a', createdAt: '2026-09-20T00:00:01Z' });
    expect((await listWordBoundaryLabels()).map((l) => l.id)).toEqual(['a', 'b']);
    await deleteWordBoundaryLabel('a');
    expect((await listWordBoundaryLabels()).map((l) => l.id)).toEqual(['b']);
  });
});

describe('LabelWordAudioPage', () => {
  const renderPage = () =>
    render(
      <MemoryRouter>
        <LabelWordAudioPage />
      </MemoryRouter>,
    );

  it('accepts the detected span in one tap, storing what was shown', async () => {
    const { link } = await seed();
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /start labelling/i }));
    await user.click(await screen.findByRole('button', { name: /both edges are right/i }));

    await waitFor(async () => expect(await listWordBoundaryLabels()).toHaveLength(1));
    const [label] = await listWordBoundaryLabels();
    expect(label).toMatchObject({
      sentenceVocabularyId: link.id,
      verdict: 'clean',
      sampleKind: 'random',
      shown: { startMs: 1000, endMs: 1420 },
      label: { startMs: 1000, endMs: 1420 },
    });
    expect(label!.estimates.token).toEqual({ startMs: 1000, endMs: 1610 });
    expect(label!.spanVersion).toBeTruthy();
    expect(await screen.findByText(/session done/i)).toBeInTheDocument();
  });

  it('saves a nudged edge as a correction relative to the shown span', async () => {
    await seed();
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /start labelling/i }));
    await user.click(await screen.findByRole('button', { name: /move end edge 10 ms/i }));
    await user.click(await screen.findByRole('button', { name: /move end edge 10 ms/i }));
    await user.click(await screen.findByRole('button', { name: /save my edits/i }));

    await waitFor(async () => expect(await listWordBoundaryLabels()).toHaveLength(1));
    const [label] = await listWordBoundaryLabels();
    expect(label).toMatchObject({
      verdict: 'corrected',
      shown: { startMs: 1000, endMs: 1420 },
      label: { startMs: 1000, endMs: 1440 },
    });
  });

  it('has ±100 ms buttons for a big miss', async () => {
    await seed();
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /start labelling/i }));
    await user.click(await screen.findByRole('button', { name: /move start edge -100 ms/i }));
    await user.click(await screen.findByRole('button', { name: /move end edge 100 ms/i }));
    await user.click(await screen.findByRole('button', { name: /save my edits/i }));

    await waitFor(async () => expect(await listWordBoundaryLabels()).toHaveLength(1));
    const [label] = await listWordBoundaryLabels();
    expect(label).toMatchObject({ verdict: 'corrected', label: { startMs: 900, endMs: 1520 } });
  });

  it('records a skip with its reason and no span', async () => {
    await seed();
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /start labelling/i }));
    await user.click(await screen.findByRole('button', { name: /can.t label this/i }));
    await user.click(await screen.findByRole('button', { name: /word isn.t in this clip/i }));

    await waitFor(async () => expect(await listWordBoundaryLabels()).toHaveLength(1));
    const [label] = await listWordBoundaryLabels();
    expect(label).toMatchObject({ verdict: 'skipped', skipReason: 'wrong-word' });
    expect(label!.label).toBeUndefined();
  });

  it('lets you skip a word the speaker slurs into its neighbour, and records why', async () => {
    await seed();
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /start labelling/i }));
    await user.click(await screen.findByRole('button', { name: /can.t label this/i }));
    await user.click(await screen.findByRole('button', { name: /slurred \/ merged into its neighbour/i }));

    await waitFor(async () => expect(await listWordBoundaryLabels()).toHaveLength(1));
    expect((await listWordBoundaryLabels())[0]).toMatchObject({ verdict: 'skipped', skipReason: 'reduced' });
  });

  it('undoes the last label and brings the item back', async () => {
    await seed();
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /start labelling/i }));
    await user.click(await screen.findByRole('button', { name: /both edges are right/i }));
    await screen.findByText(/session done/i);
    await user.click(screen.getByRole('button', { name: /undo last/i }));
    await waitFor(async () => expect(await listWordBoundaryLabels()).toHaveLength(0));
    expect(await screen.findByRole('button', { name: /both edges are right/i })).toBeInTheDocument();
  });

  it('explains the empty case instead of showing a blank screen', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /start labelling/i }));
    expect(await screen.findByText(/nothing to label/i)).toBeInTheDocument();
  });

  it('re-downloads a recording that will not decode locally and carries on', async () => {
    await seed();
    decodeAudioBuffer.mockRejectedValueOnce(Object.assign(new Error('Unable to decode audio data'), { name: 'EncodingError' }));
    repairSentenceAudio.mockResolvedValue(new Blob(['fresh']));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /start labelling/i }));
    expect(await screen.findByRole('button', { name: /both edges are right/i })).toBeInTheDocument();
    expect(repairSentenceAudio).toHaveBeenCalledOnce();
    expect(screen.queryByText(/couldn.t decode/i)).not.toBeInTheDocument();
  });

  it('shows why decoding failed and lets you skip an unplayable recording', async () => {
    await seed();
    decodeAudioBuffer.mockRejectedValue(Object.assign(new Error('Unable to decode audio data'), { name: 'EncodingError' }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /start labelling/i }));
    expect(await screen.findByText(/EncodingError: Unable to decode audio data \(no cloud copy to repair from\)/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /skip this one/i }));

    await waitFor(async () => expect(await listWordBoundaryLabels()).toHaveLength(1));
    const [label] = await listWordBoundaryLabels();
    expect(label).toMatchObject({ verdict: 'skipped', skipReason: 'undecodable' });
  });

  describe('fixing a slip after a reload', () => {
    const past = (id: string, over: Record<string, unknown> = {}) => ({
      id, sentenceVocabularyId: `v-${id}`, sentenceId: 's', sentenceAudioId: 'a', surfaceForm: `語${id}`, verdict: 'skipped' as const,
      skipReason: 'wrong-word' as const, shown: { startMs: 1, endMs: 2 }, estimates: { token: null, mora: null, shipped: null },
      sampleKind: 'random' as const, spanVersion: 'v', elapsedMs: 1, createdAt: T, ...over,
    });

    it('changes the reason on a skipped label you tapped too quickly', async () => {
      await saveWordBoundaryLabel(past('a'));
      const user = userEvent.setup();
      renderPage(); // a fresh page load: "Undo last" knows nothing about it
      await user.click(await screen.findByText(/your recent labels/i));
      await user.selectOptions(screen.getByRole('combobox', { name: /reason for skipping 語a/i }), 'reduced');
      await waitFor(async () => expect((await listWordBoundaryLabels())[0]!.skipReason).toBe('reduced'));
    });

    it('deletes a label (after a confirming second tap) so the word can come up again', async () => {
      await saveWordBoundaryLabel(past('a'));
      await saveWordBoundaryLabel(past('b', { verdict: 'clean', skipReason: undefined, label: { startMs: 1, endMs: 2 } }));
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByText(/your recent labels/i));
      await user.click(screen.getByRole('button', { name: /delete label for 語a/i }));
      expect(await listWordBoundaryLabels()).toHaveLength(2); // first tap only asks
      await user.click(screen.getByRole('button', { name: /delete label for 語a/i }));
      await waitFor(async () => expect((await listWordBoundaryLabels()).map((l) => l.id)).toEqual(['b']));
    });

    it('only skipped labels have a reason to change', async () => {
      await saveWordBoundaryLabel(past('b', { verdict: 'clean', skipReason: undefined, label: { startMs: 1, endMs: 2 } }));
      await updateSkipReason('b', 'noisy'); // ignored: not a skip
      expect((await listWordBoundaryLabels())[0]!.skipReason).toBeUndefined();
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByText(/your recent labels/i));
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    });
  });

  describe('a word that appears twice in the sentence', () => {
    it('tells you to label the highlighted first one', async () => {
      // 生まれ occurs twice; the links don't record which, so the screen always means the first.
      await seed({ japanese: '生まれた時、生まれた', inlineReading: '生まれ[うまれ]た時[とき]、生まれた' });
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('button', { name: /start labelling/i }));
      expect(await screen.findByText(/appears 2 times in the sentence — label the highlighted \(first\) one/i)).toBeInTheDocument();
    });

    it('says nothing when the word occurs once', async () => {
      await seed();
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('button', { name: /start labelling/i }));
      await screen.findByRole('button', { name: /both edges are right/i });
      expect(screen.queryByText(/times in the sentence/i)).not.toBeInTheDocument();
    });
  });

  describe('sampling situations', () => {
    it('records which situation each item fell in, and how common it was in the pool', async () => {
      await seed(); // 生まれ inside 生まれた → the target ends mid-token
      await seed({ surfaceForm: '生まれた' }); // the whole token → nothing special
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('button', { name: /start labelling/i }));
      for (let i = 0; i < 2; i += 1) {
        await user.click(await screen.findByRole('button', { name: /both edges are right/i }));
        // Wait for the save before clicking again: otherwise a slow runner finds the *same* button (the next item
        // hasn't rendered yet), clicks it twice, and the session never finishes.
        await waitFor(async () => expect(await listWordBoundaryLabels()).toHaveLength(i + 1));
      }
      await screen.findByText(/session done/i);
      const labels = await listWordBoundaryLabels();
      expect(labels).toHaveLength(2);
      const mid = labels.find((l) => l.surfaceForm === '生まれ')!;
      const plain = labels.find((l) => l.surfaceForm === '生まれた')!;
      expect(mid).toMatchObject({ sampleKind: 'random', stratum: 'mid-token', stratumCount: 1, poolSize: 2 });
      expect(plain).toMatchObject({ stratum: 'plain', stratumCount: 1, poolSize: 2 });
    });

    it('"Tricky cases" draws only from the special situations and says which one', async () => {
      await seed({ surfaceForm: '生まれた' }); // plain — must not be drawn
      const tricky = await seed(); // mid-token
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('radio', { name: /tricky cases/i }));
      await user.click(screen.getByRole('button', { name: /start labelling/i }));
      expect(await screen.findByText(/sampled from: target ends inside a longer aligner token/i)).toBeInTheDocument();
      await user.click(await screen.findByRole('button', { name: /both edges are right/i }));
      await screen.findByText(/session done/i);
      const labels = await listWordBoundaryLabels();
      expect(labels).toHaveLength(1); // the plain item was left alone
      expect(labels[0]).toMatchObject({ sentenceVocabularyId: tricky.link.id, sampleKind: 'targeted', stratum: 'mid-token' });
    });

    it('says so when nothing in the pool is tricky', async () => {
      await seed({ surfaceForm: '生まれた' });
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('radio', { name: /tricky cases/i }));
      await user.click(screen.getByRole('button', { name: /start labelling/i }));
      expect(await screen.findByText(/no items in the tricky situations/i)).toBeInTheDocument();
    });

    it('a batch resumed after a refresh still records its situations', async () => {
      await seed();
      await seed();
      const user = userEvent.setup();
      const first = renderPage();
      await user.click(await screen.findByRole('button', { name: /start labelling/i }));
      await user.click(await screen.findByRole('button', { name: /both edges are right/i }));
      first.unmount();
      renderPage();
      await user.click(await screen.findByRole('button', { name: /both edges are right/i }));
      await screen.findByText(/session done/i);
      const labels = await listWordBoundaryLabels();
      expect(labels).toHaveLength(2);
      expect(labels.every((l) => l.stratum === 'mid-token' && l.poolSize === 2)).toBe(true);
    });
  });

  describe('batches', () => {
    const start = async (user: ReturnType<typeof userEvent.setup>) =>
      user.click(await screen.findByRole('button', { name: /start (labelling|a new batch)/i }));
    const accept = async (user: ReturnType<typeof userEvent.setup>) =>
      user.click(await screen.findByRole('button', { name: /both edges are right/i }));

    it('lets you label one at a time, and remembers the batch size', async () => {
      await seed();
      await seed();
      await seed();
      const user = userEvent.setup();
      const first = renderPage();
      await user.click(await screen.findByRole('button', { name: /1 at a time/i }));
      await start(user);
      await accept(user);
      expect(await screen.findByText(/session done/i)).toBeInTheDocument();
      expect(await listWordBoundaryLabels()).toHaveLength(1); // one item, then it stops
      expect(screen.getByRole('button', { name: /label another one/i })).toBeInTheDocument();

      first.unmount();
      renderPage();
      expect(await screen.findByRole('button', { name: /1 at a time/i })).toHaveAttribute('aria-pressed', 'true');
    });

    it('goes straight back into the same batch after a refresh, at the next item', async () => {
      await seed();
      await seed();
      await seed();
      const user = userEvent.setup();
      const first = renderPage();
      await user.click(await screen.findByRole('button', { name: /^5$/ }));
      await start(user);
      expect(await screen.findByText('1 / 3')).toBeInTheDocument();
      const planned = JSON.parse(window.localStorage.getItem('wordBoundaryLabelSession')!).linkIds as string[];
      await accept(user);
      expect(await screen.findByText('2 / 3')).toBeInTheDocument();

      first.unmount(); // a refresh
      renderPage();
      expect(await screen.findByText('2 / 3')).toBeInTheDocument(); // not a fresh random batch
      expect(await screen.findByRole('button', { name: /both edges are right/i })).toBeInTheDocument();
      expect(JSON.parse(window.localStorage.getItem('wordBoundaryLabelSession')!).linkIds).toEqual(planned);

      await accept(user);
      await accept(user);
      expect(await screen.findByText(/session done/i)).toBeInTheDocument();
      expect(window.localStorage.getItem('wordBoundaryLabelSession')).toBeNull(); // finished batch is forgotten
      expect(await listWordBoundaryLabels()).toHaveLength(3);
    });

    it('stops for now, offers to resume, and can discard the batch', async () => {
      await seed();
      await seed();
      const user = userEvent.setup();
      const first = renderPage();
      await start(user);
      await accept(user);
      await user.click(await screen.findByRole('button', { name: /stop for now/i }));
      expect(await screen.findByText(/1 of 2 left/i)).toBeInTheDocument();

      first.unmount(); // paused: a refresh does NOT jump back in
      renderPage();
      expect(await screen.findByText(/you have a batch in progress/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /both edges are right/i })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /^resume$/i }));
      expect(await screen.findByText('2 / 2')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /stop for now/i }));
      await user.click(await screen.findByRole('button', { name: /discard this batch/i }));
      expect(screen.queryByText(/you have a batch in progress/i)).not.toBeInTheDocument();
      expect(window.localStorage.getItem('wordBoundaryLabelSession')).toBeNull();
    });

    it('drops a stale plan whose items were labelled elsewhere', async () => {
      const { link } = await seed();
      window.localStorage.setItem(
        'wordBoundaryLabelSession',
        JSON.stringify({ mode: 'random', linkIds: [link.id], paused: false, startedAt: T }),
      );
      await saveWordBoundaryLabel({
        id: 'done', sentenceVocabularyId: link.id, sentenceId: 's', sentenceAudioId: 'a', surfaceForm: '生まれ', verdict: 'clean',
        shown: { startMs: 1, endMs: 2 }, label: { startMs: 1, endMs: 2 }, estimates: { token: null, mora: null, shipped: null },
        sampleKind: 'random', spanVersion: 'v', elapsedMs: 1, createdAt: T,
      });
      renderPage();
      expect(await screen.findByRole('button', { name: /start labelling/i })).toBeInTheDocument();
      expect(window.localStorage.getItem('wordBoundaryLabelSession')).toBeNull();
    });
  });

  it('saves every label on the device to a file with one button, and counts what is new', async () => {
    const { link, audioId, sentenceId } = await seed();
    await saveWordBoundaryLabel({
      id: 'p1', sentenceVocabularyId: link.id, sentenceId, sentenceAudioId: audioId, surfaceForm: '生まれ', verdict: 'clean',
      shown: { startMs: 1, endMs: 2 }, label: { startMs: 1, endMs: 2 }, estimates: { token: null, mora: null, shipped: null },
      sampleKind: 'random', spanVersion: 'v', elapsedMs: 1, createdAt: T,
    });
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText(/1 not in a saved file yet/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /save labels/i }));
    await waitFor(() => expect(saveLabelsFile).toHaveBeenCalledTimes(1));
    expect((saveLabelsFile.mock.calls[0]![0] as { id: string }[]).map((l) => l.id)).toEqual(['p1']);
    expect(await screen.findByText(/labels downloaded — look in files/i)).toBeInTheDocument();
  });

  it('has a plain "Download file" button that skips the share sheet', async () => {
    const { link, audioId, sentenceId } = await seed();
    await saveWordBoundaryLabel({
      id: 'p1', sentenceVocabularyId: link.id, sentenceId, sentenceAudioId: audioId, surfaceForm: '生まれ', verdict: 'clean',
      shown: { startMs: 1, endMs: 2 }, label: { startMs: 1, endMs: 2 }, estimates: { token: null, mora: null, shipped: null },
      sampleKind: 'random', spanVersion: 'v', elapsedMs: 1, createdAt: T,
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /download file/i }));
    await waitFor(() => expect(saveLabelsFile).toHaveBeenCalledTimes(1));
    expect(saveLabelsFile.mock.calls[0]![2]).toEqual({ download: true });
    await user.click(screen.getByRole('button', { name: /^save labels$/i }));
    await waitFor(() => expect(saveLabelsFile).toHaveBeenCalledTimes(2));
    expect(saveLabelsFile.mock.calls[1]![2]).toEqual({ download: false });
  });

  it('offers no save button before there is anything to save', async () => {
    renderPage();
    await screen.findByRole('button', { name: /start labelling/i });
    expect(screen.queryByRole('button', { name: /save labels/i })).not.toBeInTheDocument();
  });
});
