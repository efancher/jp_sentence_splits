import { SHADOWING_ANALYSIS_API_BASE } from '../appConfig';
import type { AlignmentResult } from '../domain/types';

/**
 * Client for the tailnet-only forced-alignment service
 * (~/projects/shadowing-analysis-api, docs/STATUS.md Phase 9 Milestone 2a).
 * `alignAudio` never throws — an unreachable/off-tailnet/cold-starting
 * server is an expected, ordinary condition here, not an error state to
 * surface to the user. Callers treat `null` as "not available" and fall
 * back to whatever they'd show without it.
 */

/**
 * Bump when the alignment service's output would meaningfully change.
 * v2 (2026-09-18): shadowing-analysis-api now expands arabic-digit dates
 * (16日, 10月) to their hiragana reading before alignment — fixes the
 * `<unk>` cascade for most day/month values (see
 * ~/projects/shadowing-analysis-api's app/numerals.py and docs/STATUS.md).
 */
export const ALIGNMENT_VERSION = 2;
/** Bump when the ASR model/prompting would meaningfully change its output. */
export const TRANSCRIPTION_VERSION = 1;

/** Generous enough to cover the service's cold-start lexicon/model load (~40-45s measured). */
const ALIGN_TIMEOUT_MS = 60_000;
const TRANSCRIBE_TIMEOUT_MS = 60_000;

/**
 * `'unreachable'`: the request never got a response (network error, off
 * tailnet, timed-out cold start) — nothing to say about this particular
 * take, any take would fail the same way right now.
 * `'rejected'`: the service responded but declined this audio/transcript
 * (e.g. the MFA aligner couldn't find a path within its beam for a very
 * short/isolated-word clip) — the service itself is up and reachable.
 */
export type AlignAudioFailureReason = 'unreachable' | 'rejected';

export interface AlignAudioOutcome {
  result: AlignmentResult | null;
  reason?: AlignAudioFailureReason;
}

/** Reason-preserving version of `alignAudio`, for callers that want to tell "server down" apart from "this take couldn't be aligned". */
export async function alignAudioDetailed(
  blob: Blob,
  transcript: string,
): Promise<AlignAudioOutcome> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ALIGN_TIMEOUT_MS);
  let response: Response;
  try {
    const form = new FormData();
    form.append('audio', blob);
    form.append('transcript', transcript);
    response = await fetch(`${SHADOWING_ANALYSIS_API_BASE}/align`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
  } catch {
    return { result: null, reason: 'unreachable' };
  } finally {
    clearTimeout(timeout);
  }
  // A response — even a bad one — means the service was reached; anything
  // that goes wrong from here is "rejected", not "unreachable".
  if (!response.ok) return { result: null, reason: 'rejected' };
  try {
    const data = (await response.json()) as AlignmentResult;
    if (!Array.isArray(data.words)) return { result: null, reason: 'rejected' };
    return { result: data };
  } catch {
    return { result: null, reason: 'rejected' };
  }
}

export async function alignAudio(
  blob: Blob,
  transcript: string,
): Promise<AlignmentResult | null> {
  return (await alignAudioDetailed(blob, transcript)).result;
}

/**
 * Japanese ASR on a learner recording — a secondary, non-authoritative
 * diagnostic signal only (docs/STATUS.md Phase 9, Milestone 7). Same
 * never-throws contract as `alignAudio`. `prompt` (the known sentence
 * text) is optional but improves recognition when provided.
 */
export async function transcribeAudio(
  blob: Blob,
  prompt?: string,
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS);
  try {
    const form = new FormData();
    form.append('audio', blob);
    if (prompt) form.append('prompt', prompt);
    const response = await fetch(`${SHADOWING_ANALYSIS_API_BASE}/transcribe`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { text?: unknown };
    if (typeof data.text !== 'string') return null;
    return data.text;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
