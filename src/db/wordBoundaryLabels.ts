import type { SentenceAudio, WordAlignment, WordBoundaryEstimates, WordBoundaryLabel } from '../domain/types';
import { createId } from '../lib/ids';
import { estimateWordSpans, startingSpan } from '../lib/wordBoundaryLabels';

import { getDb } from './database';
import { sentenceIsSuspendedOnly } from '../lib/suspendedBooks';

import { loadAlignmentsBulk, loadSuspendedBookIndex } from './repository';

/**
 * Persistence + candidate loading for the word-boundary labelling tool
 * (`/label-word-audio`, docs/ROADMAP.md "Word-audio ground truth"). Labels live
 * on the device and leave it only through the page's "Save labels" file export
 * (`src/lib/wordBoundaryLabelExport.ts`) — there is no cloud sync.
 */

export async function saveWordBoundaryLabel(label: WordBoundaryLabel): Promise<void> {
  await getDb().wordBoundaryLabels.put(label);
}

export async function listWordBoundaryLabels(): Promise<WordBoundaryLabel[]> {
  return getDb().wordBoundaryLabels.orderBy('createdAt').toArray();
}

export async function deleteWordBoundaryLabel(id: string): Promise<void> {
  await getDb().wordBoundaryLabels.delete(id);
}

export function newWordBoundaryLabelId(): string {
  return createId('wbl');
}

/** Everything the labelling screen needs for one target word. */
export interface WordBoundaryCandidate {
  linkId: string;
  sentenceId: string;
  bookId?: string;
  surfaceForm: string;
  japanese: string;
  inlineReading: string;
  audio: SentenceAudio;
  words: WordAlignment[];
  estimates: WordBoundaryEstimates;
}

/** Default number of links examined per session build (alignments are fetched for these). */
export const CANDIDATE_POOL_SIZE = 160;

/**
 * Loads a stratified-by-book pool of labellable links: a confirmed link with a
 * surface form, a reference recording, a current-version alignment (cached
 * locally or in Supabase — never computed here), a resolvable span, and not
 * already labelled. Books are visited round-robin so no single book dominates
 * the pool; the caller then picks the session's queue from it.
 */
export async function loadWordBoundaryCandidates(
  poolSize = CANDIDATE_POOL_SIZE,
  rand: () => number = Math.random,
): Promise<WordBoundaryCandidate[]> {
  const db = getDb();
  const [allLinks, labelled, suspendedIndex] = await Promise.all([
    db.sentenceVocabulary.toArray(),
    db.wordBoundaryLabels.toArray(),
    loadSuspendedBookIndex(),
  ]);
  const done = new Set(labelled.map((l) => l.sentenceVocabularyId));
  const links = allLinks.filter(
    (l) =>
      !!l.surfaceForm &&
      !done.has(l.id) &&
      !(suspendedIndex && sentenceIsSuspendedOnly(l.sentenceId, suspendedIndex)),
  );
  if (links.length === 0) return [];

  const sentenceIds = [...new Set(links.map((l) => l.sentenceId))];
  const [sentences, audioRows, memberships] = await Promise.all([
    db.sentences.bulkGet(sentenceIds),
    db.sentenceAudio.where('sentenceId').anyOf(sentenceIds).toArray(),
    db.bookSentences.where('sentenceId').anyOf(sentenceIds).toArray(),
  ]);
  const sentenceById = new Map(sentences.filter(Boolean).map((s) => [s!.id, s!]));
  const audioBySentence = new Map<string, SentenceAudio>();
  for (const a of audioRows) if (!audioBySentence.has(a.sentenceId)) audioBySentence.set(a.sentenceId, a);
  const bookBySentence = new Map<string, string>();
  for (const m of memberships) if (!bookBySentence.has(m.sentenceId)) bookBySentence.set(m.sentenceId, m.bookId);

  // Stratify by book: shuffle within each, then take round-robin up to the pool size.
  const lanes = new Map<string, typeof links>();
  const shuffle = <T,>(xs: T[]) => {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };
  for (const link of shuffle(links)) {
    if (!sentenceById.has(link.sentenceId) || !audioBySentence.has(link.sentenceId)) continue;
    const key = bookBySentence.get(link.sentenceId) ?? '(none)';
    lanes.set(key, [...(lanes.get(key) ?? []), link]);
  }
  const ordered = shuffle([...lanes.values()]);
  const pool: typeof links = [];
  for (let round = 0; pool.length < poolSize; round += 1) {
    let took = false;
    for (const lane of ordered) {
      const next = lane[round];
      if (next) {
        pool.push(next);
        took = true;
        if (pool.length >= poolSize) break;
      }
    }
    if (!took) break;
  }

  const alignments = await loadAlignmentsBulk([...new Set(pool.map((l) => audioBySentence.get(l.sentenceId)!.id))]);
  const out: WordBoundaryCandidate[] = [];
  for (const link of pool) {
    const audio = audioBySentence.get(link.sentenceId)!;
    const alignment = alignments.get(audio.id);
    const sentence = sentenceById.get(link.sentenceId)!;
    if (!alignment) continue;
    const estimates = estimateWordSpans(alignment.words, sentence.japanese, sentence.inlineReading, link.surfaceForm!);
    if (!startingSpan(estimates)) continue;
    out.push({
      linkId: link.id,
      sentenceId: link.sentenceId,
      bookId: bookBySentence.get(link.sentenceId),
      surfaceForm: link.surfaceForm!,
      japanese: sentence.japanese,
      inlineReading: sentence.inlineReading,
      audio,
      words: alignment.words,
      estimates,
    });
  }
  return out;
}
