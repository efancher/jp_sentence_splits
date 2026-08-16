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

/** Bump when the alignment service's output would meaningfully change. */
export const ALIGNMENT_VERSION = 1;
/** Bump when the ASR model/prompting would meaningfully change its output. */
export const TRANSCRIPTION_VERSION = 1;

/** Generous enough to cover the service's cold-start lexicon/model load (~40-45s measured). */
const ALIGN_TIMEOUT_MS = 60_000;
const TRANSCRIBE_TIMEOUT_MS = 60_000;

export async function alignAudio(
  blob: Blob,
  transcript: string,
): Promise<AlignmentResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ALIGN_TIMEOUT_MS);
  try {
    const form = new FormData();
    form.append('audio', blob);
    form.append('transcript', transcript);
    const response = await fetch(`${SHADOWING_ANALYSIS_API_BASE}/align`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as AlignmentResult;
    if (!Array.isArray(data.words)) return null;
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
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
