import { readSettings } from '../db/database';
import {
  getDb,
  loadAlignmentsBulk,
  setSentenceComprehensionCheck,
  updateSentenceText,
} from '../db/repository';
import { generateMeaningBanks, MEANING_ASSIST_MAX_ITEMS_PER_CALL } from './meaningAssist';
import type { MeaningAssistResponse } from './meaningAssist';
import {
  MEANING_BANK_TARGET_SIZE,
  buildCheckFromMeaningBank,
  getMeaningBank,
  mergeDistractors,
} from './meaningChoices';
import type { MeaningBankRequest } from './meaningChoices';
import { parseInlineReadings } from './parseInlineReadings';
import {
  applyReadingFixes,
  audioSpanReadings,
  inlineKana,
  judgeSpan,
  llmSpanReadings,
} from './readingConsensus';
import type { SpanReadings } from './readingConsensus';

/**
 * Finds sentences that need wrong-meaning banks and fills them, either
 * through the `meaning-assist` Edge Function (auto path) or from a pasted
 * reply (the batch panel). Shared so both paths pick the same candidates,
 * use the sentence's own stored translation as the correct meaning, and
 * apply the same validation.
 *
 * `missing`: sentences with no comprehension check at all (every imported
 * sentence starts here). `topup`: sentences whose bank has fewer usable wrong
 * meanings than a full bank (legacy 3-option checks). `refresh`: AI-authored
 * checks with no key-word-swap distractors; the whole bank is replaced.
 */
export type MeaningBankMode = 'missing' | 'topup' | 'refresh';

/** A bank with at least this many usable wrong meanings is considered full enough. */
export const TOPUP_BELOW = 7;

export interface MeaningBankCandidate {
  sentenceId: string;
  request: MeaningBankRequest;
}

export async function findMeaningBankCandidates(options: {
  mode: MeaningBankMode;
  limit: number;
  bookId?: string;
  /** With `bookId`: only this chapter/episode's sentences. */
  chapterId?: string;
}): Promise<MeaningBankCandidate[]> {
  const db = getDb();
  const memberships = options.bookId
    ? await db.bookSentences.where('bookId').equals(options.bookId).toArray()
    : await db.bookSentences.toArray();
  const byBook = new Map<string, typeof memberships>();
  for (const membership of memberships) {
    const list = byBook.get(membership.bookId);
    if (list) list.push(membership);
    else byBook.set(membership.bookId, [membership]);
  }
  const ordered: { sentenceId: string; precedingIds: string[] }[] = [];
  const seen = new Set<string>();
  for (const list of byBook.values()) {
    list.sort((a, b) => a.position - b.position);
    list.forEach((membership, index) => {
      // Context (precedingIds) still comes from the whole book order.
      if (options.chapterId && membership.chapterId !== options.chapterId) return;
      if (seen.has(membership.sentenceId)) return;
      seen.add(membership.sentenceId);
      ordered.push({
        sentenceId: membership.sentenceId,
        precedingIds: list.slice(Math.max(0, index - 2), index).map((item) => item.sentenceId),
      });
    });
  }
  if (!options.bookId) {
    for (const sentence of await db.sentences.toArray()) {
      if (!seen.has(sentence.id)) ordered.push({ sentenceId: sentence.id, precedingIds: [] });
    }
  }

  const ids = ordered.map((item) => item.sentenceId);
  const [sentences, analyses] = await Promise.all([db.sentences.bulkGet(ids), db.analyses.bulkGet(ids)]);
  const sentenceById = new Map(ids.map((id, index) => [id, sentences[index]]));
  const candidates: MeaningBankCandidate[] = [];
  for (const [index, item] of ordered.entries()) {
    if (candidates.length >= options.limit) break;
    const sentence = sentences[index];
    if (!sentence?.japanese.trim()) continue;
    const check = analyses[index]?.comprehensionCheck;
    const bank = getMeaningBank(check);
    if (options.mode === 'missing' && check) continue;
    if (options.mode === 'topup') {
      if (!check || !bank || bank.distractors.length >= TOPUP_BELOW) continue;
    }
    if (options.mode === 'refresh') {
      // Hand-authored banks are left alone.
      if (!check || !bank || check.provenance === 'manual' || bank.wordSwaps.length > 0) continue;
    }
    candidates.push({
      sentenceId: item.sentenceId,
      request: {
        japanese: sentence.japanese,
        context: item.precedingIds.flatMap((id) => {
          const text = sentenceById.get(id)?.japanese;
          return text ? [text] : [];
        }),
        correct: bank?.correct ?? (sentence.translation?.trim() || undefined),
        existing: options.mode === 'refresh' ? undefined : bank?.entries.map((entry) => entry.text),
      },
    });
  }
  return candidates;
}

/** Validate and save one sentence's AI/pasted result. Returns whether anything was written. */
export async function applyMeaningBankResult(
  sentenceId: string,
  mode: MeaningBankMode,
  result: { correct?: string; wrong: readonly string[]; swaps?: readonly string[] },
  provenance: 'ai_suggested' | 'manual' = 'ai_suggested',
): Promise<boolean> {
  const db = getDb();
  // Re-read at write time: the author may have saved a check by hand meanwhile.
  const existing = (await db.analyses.get(sentenceId))?.comprehensionCheck;
  if (mode === 'missing') {
    if (existing) return false;
    const sentence = await db.sentences.get(sentenceId);
    const correct = sentence?.translation?.trim() || result.correct?.trim();
    if (!correct) return false;
    const { check } = buildCheckFromMeaningBank(correct, result.wrong, provenance, result.swaps);
    if (!check) return false;
    await setSentenceComprehensionCheck(sentenceId, check);
    return true;
  }
  if (!existing) return false;
  if (mode === 'refresh') {
    if (existing.provenance === 'manual') return false;
    const correct = getMeaningBank(existing)?.correct;
    if (!correct || !result.swaps?.length) return false;
    const { check } = buildCheckFromMeaningBank(correct, result.wrong, provenance, result.swaps);
    if (!check?.wordSwapDistractors?.length) return false;
    await setSentenceComprehensionCheck(sentenceId, { ...check, createdAt: existing.createdAt });
    return true;
  }
  const merged = mergeDistractors(existing, [...(result.swaps ?? []), ...result.wrong]);
  if (merged.added.length === 0) return false;
  const swapKeys = new Set((result.swaps ?? []).map((text) => text.trim().toLowerCase()));
  const addedSwaps = merged.added.filter((text) => swapKeys.has(text.toLowerCase()));
  await setSentenceComprehensionCheck(
    sentenceId,
    addedSwaps.length
      ? {
          ...merged.check,
          wordSwapDistractors: [...(existing.wordSwapDistractors ?? []), ...addedSwaps],
        }
      : merged.check,
  );
  return true;
}

export interface ReadingCheckOutcome {
  fixed: number;
  /** Human-readable disagreements that were not auto-fixed. */
  flagged: string[];
}

/**
 * Check a sentence's stored furigana against the assistant's contextual
 * whole-sentence reading and (when the clip is aligned) what was actually
 * spoken. A span is rewritten only when both of those agree with each other
 * and disagree with the tokenizer; any other disagreement is returned as a
 * flag. Nothing is written when the markup can't be rebuilt exactly.
 */
export async function checkSentenceReading(
  sentenceId: string,
  llmReading: string,
): Promise<ReadingCheckOutcome> {
  const outcome: ReadingCheckOutcome = { fixed: 0, flagged: [] };
  const db = getDb();
  const sentence = await db.sentences.get(sentenceId);
  const inline = sentence?.inlineReading;
  if (!sentence || !inline) return outcome;

  const llm = llmSpanReadings(inline, llmReading);
  const audioRows = await db.sentenceAudio.where('sentenceId').equals(sentenceId).toArray();
  const alignments = await loadAlignmentsBulk(audioRows.map((row) => row.id));
  const firstAligned = audioRows.find((row) => alignments.has(row.id));
  const audio = firstAligned
    ? audioSpanReadings(inline, alignments.get(firstAligned.id)!.words)
    : new Map<number, string>();

  const fixes: SpanReadings = new Map();
  parseInlineReadings(inline).forEach((seg, index) => {
    if (seg.kind !== 'ruby' || !seg.reading) return;
    const verdict = judgeSpan(seg.reading, audio.get(index), llm.get(index));
    if (verdict.kind === 'fix') fixes.set(index, verdict.reading);
    else if (verdict.kind === 'flag') {
      const heard = [
        verdict.audio ? `audio ${verdict.audio}` : '',
        verdict.llm ? `assistant ${verdict.llm}` : '',
      ].filter(Boolean);
      outcome.flagged.push(`${seg.base}: furigana ${seg.reading}, ${heard.join(', ')}`);
    }
  });
  if (fixes.size === 0) return outcome;

  const rewritten = applyReadingFixes(inline, fixes);
  if (!rewritten) {
    outcome.flagged.push(`readings differ but the furigana markup can't be rebuilt safely`);
    return outcome;
  }
  const oldKana = inlineKana(inline).kana.replace(/\s+/g, '');
  const readingOnlyMatches = (sentence.readingOnly ?? '').replace(/\s+/g, '') === oldKana;
  await updateSentenceText(sentenceId, {
    inlineReading: rewritten,
    ...(readingOnlyMatches ? { readingOnly: inlineKana(rewritten).kana } : {}),
  });
  outcome.fixed = fixes.size;
  return outcome;
}

export interface AutogenSummary {
  saved: number;
  attempted: number;
  unavailableReason?: string;
}

let inFlight = false;
let blockedUntil = 0;

/**
 * Progress of the current/most recent run, readable from any screen
 * (`useSyncExternalStore`-compatible) so a run keeps showing its progress
 * after the user navigates away from the page that started it.
 */
export interface MeaningJobState {
  running: boolean;
  mode: MeaningBankMode;
  bookId?: string;
  total: number;
  attempted: number;
  saved: number;
  unavailableReason?: string;
}

let jobState: MeaningJobState | null = null;
const jobListeners = new Set<() => void>();

function setJobState(next: MeaningJobState | null): void {
  jobState = next;
  for (const listener of jobListeners) listener();
}

export function subscribeMeaningJob(listener: () => void): () => void {
  jobListeners.add(listener);
  return () => {
    jobListeners.delete(listener);
  };
}

export function getMeaningJob(): MeaningJobState | null {
  return jobState;
}

const FAILURE_BACKOFF_MS = 60 * 60 * 1000;

/**
 * Background fill-in for sentences with no check yet — covers every import
 * path (mining, text, NHK, series) because it works from the stored data, not
 * from the import UI. Silent and best-effort: AI unavailable / signed out
 * backs off for an hour and the batch panel remains the manual route.
 */
export async function autoGenerateMeaningChecks(
  options: {
    limit?: number;
    mode?: MeaningBankMode;
    bookId?: string;
    chapterId?: string;
    ignoreBackoff?: boolean;
    generate?: (items: Parameters<typeof generateMeaningBanks>[0]) => Promise<MeaningAssistResponse>;
  } = {},
): Promise<AutogenSummary> {
  const summary: AutogenSummary = { saved: 0, attempted: 0 };
  if (inFlight) return summary;
  if (!options.ignoreBackoff && Date.now() < blockedUntil) return summary;
  if (!options.ignoreBackoff && (await readSettings()).autoMeaningChoices === false) return summary;
  inFlight = true;
  try {
    const mode = options.mode ?? 'missing';
    const candidates = await findMeaningBankCandidates({
      mode,
      limit: options.limit ?? 20,
      bookId: options.bookId,
      chapterId: options.chapterId,
    });
    const generate = options.generate ?? generateMeaningBanks;
    setJobState({
      running: true,
      mode,
      bookId: options.bookId,
      total: candidates.length,
      attempted: 0,
      saved: 0,
    });
    for (let start = 0; start < candidates.length; start += MEANING_ASSIST_MAX_ITEMS_PER_CALL) {
      const chunk = candidates.slice(start, start + MEANING_ASSIST_MAX_ITEMS_PER_CALL);
      const response = await generate(
        chunk.map((candidate) => ({ id: candidate.sentenceId, ...candidate.request })),
      );
      summary.attempted += chunk.length;
      if (!response.ok) {
        summary.unavailableReason = response.reason;
        blockedUntil = Date.now() + FAILURE_BACKOFF_MS;
        break;
      }
      for (const item of response.items) {
        if (await applyMeaningBankResult(item.id, mode, item)) summary.saved += 1;
      }
      setJobState({ ...jobState!, attempted: summary.attempted, saved: summary.saved });
    }
    setJobState({
      ...jobState!,
      running: false,
      attempted: summary.attempted,
      saved: summary.saved,
      unavailableReason: summary.unavailableReason,
    });
    return summary;
  } catch (error) {
    if (jobState?.running) setJobState({ ...jobState, running: false });
    throw error;
  } finally {
    inFlight = false;
  }
}

/** Test hook: clear the failure backoff. */
export function resetMeaningAutogenBackoff(): void {
  blockedUntil = 0;
}

export { MEANING_BANK_TARGET_SIZE };
