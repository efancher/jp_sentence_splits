import type { WordBoundaryLabel } from '../domain/types';

/**
 * The "Save labels" file for the word-boundary labelling tool
 * (`/label-word-audio`): every label on this device as one JSON document, read
 * by `scripts/analyze-word-boundary-labels.ts`. Labels are the irreplaceable
 * part (estimates can be recomputed), so the file is the way they leave the
 * device — there is deliberately no cloud sync.
 */

export const LABEL_EXPORT_FORMAT = 'word-boundary-labels';
export const LABEL_EXPORT_VERSION = 1;

export interface WordBoundaryLabelExport {
  format: typeof LABEL_EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  labels: WordBoundaryLabel[];
}

export function buildLabelExport(labels: readonly WordBoundaryLabel[], now = new Date()): WordBoundaryLabelExport {
  return {
    format: LABEL_EXPORT_FORMAT,
    version: LABEL_EXPORT_VERSION,
    exportedAt: now.toISOString(),
    labels: [...labels],
  };
}

export function labelExportFilename(now = new Date()): string {
  return `word-boundary-labels-${now.toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
}

/**
 * Reads one or more exported files' JSON text into a single label list.
 * Throws on a file that isn't a label export; duplicate ids (the same label in
 * two saves, or on two devices) keep the newest copy.
 */
export function parseLabelExports(texts: readonly string[]): WordBoundaryLabel[] {
  const byId = new Map<string, WordBoundaryLabel>();
  for (const text of texts) {
    let doc: Partial<WordBoundaryLabelExport>;
    try {
      doc = JSON.parse(text) as Partial<WordBoundaryLabelExport>;
    } catch {
      throw new Error('Not valid JSON');
    }
    if (doc.format !== LABEL_EXPORT_FORMAT || !Array.isArray(doc.labels)) {
      throw new Error('Not a word-boundary label export');
    }
    for (const label of doc.labels) {
      const existing = byId.get(label.id);
      if (!existing || label.createdAt >= existing.createdAt) byId.set(label.id, label);
    }
  }
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

const LAST_SAVE_KEY = 'wordBoundaryLabelsLastSaved';

export function getLastSaveTime(): string | null {
  try {
    return window.localStorage.getItem(LAST_SAVE_KEY);
  } catch {
    return null;
  }
}

/** How many labels were made since the last saved file (all of them if never saved). */
export function unsavedLabelCount(labels: readonly WordBoundaryLabel[], lastSaved: string | null): number {
  return lastSaved ? labels.filter((l) => l.createdAt > lastSaved).length : labels.length;
}

export type SaveLabelsResult = 'shared' | 'downloaded' | 'cancelled';

/**
 * Hands the file to the user: the share sheet where the browser can share files
 * (iOS/Android — lets you save to Files or send it on), otherwise a normal
 * download. Records the save time so the page can show how many labels are new.
 */
export async function saveLabelsFile(labels: readonly WordBoundaryLabel[], now = new Date()): Promise<SaveLabelsResult> {
  const name = labelExportFilename(now);
  const file = new File([JSON.stringify(buildLabelExport(labels, now), null, 1)], name, { type: 'application/json' });
  const remember = () => {
    try {
      window.localStorage.setItem(LAST_SAVE_KEY, now.toISOString());
    } catch {
      // ignore
    }
  };

  const nav = window.navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && typeof nav.share === 'function') {
    try {
      await nav.share({ files: [file], title: 'Word boundary labels' });
      remember();
      return 'shared';
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return 'cancelled';
      // any other share failure: fall through to a plain download
    }
  }
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  remember();
  return 'downloaded';
}
