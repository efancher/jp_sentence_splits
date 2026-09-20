import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDb, resetDbForTests } from '../src/db/database';
import {
  deleteWordBoundaryLabel,
  listWordBoundaryLabels,
  loadWordBoundaryCandidates,
  saveWordBoundaryLabel,
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
const saveLabelsFile = vi.fn(async (_labels: unknown) => 'downloaded' as const);
vi.mock('../src/lib/wordBoundaryLabelExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/wordBoundaryLabelExport')>()),
  saveLabelsFile: (labels: unknown) => saveLabelsFile(labels),
}));

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
async function seed(options: { withAlignment?: boolean; suspended?: boolean; sentenceId?: string } = {}) {
  const { withAlignment = true, suspended = false, sentenceId = createId('sent') } = options;
  const db = getDb();
  const bookId = createId('book');
  await db.books.put({ id: bookId, title: 'b', createdAt: T, updatedAt: T, ...(suspended ? { suspendedAt: T } : {}) } as never);
  await db.sentences.put({
    id: sentenceId, normalizedKey: sentenceId, japanese: '生まれた時', readingOnly: '', inlineReading: '生まれ[うまれ]た時[とき]',
    translation: '', targetVocabulary: [], vocabularySuggestions: [], sourceReferences: [], conflicts: [],
    firstOccurrenceIndex: 0, importBatchIds: [], createdAt: T, updatedAt: T,
  } as never);
  await db.bookSentences.put({ id: createId('bs'), bookId, sentenceId, position: 0, status: 'unstarted', addedAt: T } as never);
  const link = { id: createId('sv'), sentenceId, vocabularyItemId: 'vi', surfaceForm: '生まれ', createdAt: T, updatedAt: T };
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
    expect(await screen.findByText(/labels downloaded as a file/i)).toBeInTheDocument();
  });

  it('offers no save button before there is anything to save', async () => {
    renderPage();
    await screen.findByRole('button', { name: /start labelling/i });
    expect(screen.queryByRole('button', { name: /save labels/i })).not.toBeInTheDocument();
  });
});
