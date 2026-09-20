import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WordBoundaryLabel } from '../src/domain/types';
import {
  buildLabelExport,
  getLastSaveTime,
  labelExportFilename,
  parseLabelExports,
  saveLabelsFile,
  unsavedLabelCount,
} from '../src/lib/wordBoundaryLabelExport';

const label = (id: string, createdAt: string, over: Partial<WordBoundaryLabel> = {}): WordBoundaryLabel => ({
  id,
  sentenceVocabularyId: 'v',
  sentenceId: 's',
  sentenceAudioId: 'a',
  surfaceForm: '語',
  verdict: 'clean',
  shown: { startMs: 1, endMs: 2 },
  label: { startMs: 1, endMs: 2 },
  estimates: { token: null, mora: null, shipped: null },
  sampleKind: 'random',
  spanVersion: 'v',
  elapsedMs: 1,
  createdAt,
  ...over,
});

describe('label export file', () => {
  const now = new Date('2026-09-20T12:34:56.789Z');

  it('wraps the labels with a format marker and timestamp, and names the file by time', () => {
    const doc = buildLabelExport([label('a', '2026-09-20T00:00:00Z')], now);
    expect(doc).toMatchObject({ format: 'word-boundary-labels', version: 1, exportedAt: '2026-09-20T12:34:56.789Z' });
    expect(doc.labels).toHaveLength(1);
    expect(labelExportFilename(now)).toBe('word-boundary-labels-2026-09-20T12-34-56.json');
  });

  it('round-trips, sorted by time', () => {
    const text = JSON.stringify(buildLabelExport([label('b', '2026-09-20T00:00:02Z'), label('a', '2026-09-20T00:00:01Z')], now));
    expect(parseLabelExports([text]).map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('merges several files, keeping the newest copy of a label present in both', () => {
    const phone = JSON.stringify(buildLabelExport([label('x', '2026-09-20T00:00:01Z', { verdict: 'clean' }), label('p', '2026-09-20T00:00:05Z')], now));
    const laptop = JSON.stringify(buildLabelExport([label('x', '2026-09-20T00:00:09Z', { verdict: 'corrected' }), label('l', '2026-09-20T00:00:07Z')], now));
    const merged = parseLabelExports([phone, laptop]);
    expect(merged.map((l) => l.id)).toEqual(['p', 'l', 'x']);
    expect(merged.find((l) => l.id === 'x')!.verdict).toBe('corrected');
  });

  it('rejects files that are not label exports', () => {
    expect(() => parseLabelExports(['not json'])).toThrow(/valid JSON/);
    expect(() => parseLabelExports([JSON.stringify({ hello: 1 })])).toThrow(/not a word-boundary label export/i);
  });
});

describe('unsavedLabelCount', () => {
  const labels = [label('a', '2026-09-20T01:00:00Z'), label('b', '2026-09-20T03:00:00Z')];
  it('counts everything before the first save, and only newer labels after', () => {
    expect(unsavedLabelCount(labels, null)).toBe(2);
    expect(unsavedLabelCount(labels, '2026-09-20T02:00:00Z')).toBe(1);
    expect(unsavedLabelCount(labels, '2026-09-20T04:00:00Z')).toBe(0);
  });
});

describe('saveLabelsFile', () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  beforeEach(() => {
    window.localStorage.clear();
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    vi.restoreAllMocks();
    delete (window.navigator as { share?: unknown }).share;
    delete (window.navigator as { canShare?: unknown }).canShare;
  });

  it('downloads a file when the browser cannot share files, and remembers the save time', async () => {
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    const now = new Date('2026-09-20T12:00:00Z');
    expect(await saveLabelsFile([label('a', '2026-09-20T00:00:00Z')], now)).toBe('downloaded');
    expect(clicked).toEqual(['word-boundary-labels-2026-09-20T12-00-00.json']);
    expect(getLastSaveTime()).toBe('2026-09-20T12:00:00.000Z');
  });

  it('uses the share sheet where files can be shared', async () => {
    const share = vi.fn(async () => undefined);
    Object.assign(window.navigator, { canShare: () => true, share });
    expect(await saveLabelsFile([label('a', '2026-09-20T00:00:00Z')])).toBe('shared');
    expect(share).toHaveBeenCalledOnce();
    expect(getLastSaveTime()).not.toBeNull();
  });

  it('treats a dismissed share sheet as cancelled — nothing is recorded as saved', async () => {
    const abort = Object.assign(new Error('x'), { name: 'AbortError' });
    Object.assign(window.navigator, { canShare: () => true, share: vi.fn(async () => { throw abort; }) });
    expect(await saveLabelsFile([label('a', '2026-09-20T00:00:00Z')])).toBe('cancelled');
    expect(getLastSaveTime()).toBeNull();
  });
});
