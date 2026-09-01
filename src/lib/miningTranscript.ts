/**
 * Pure edits for the mining wizard's transcript stage (stage 1). The
 * reviewer fixes ASR/caption text and coarse boundaries here, before
 * resegmentation runs on the server. Segment-level, not sentence-level:
 * one entry per ASR/caption segment, carrying its confidence flag.
 */

import { joinJapanese } from './resegmentPlan';

export interface WizardTranscriptSeg {
  text: string;
  startMs: number;
  endMs: number;
  isAuto: boolean;
  /** ASR flagged this segment shaky — the UI marks it for a careful listen. */
  lowConfidence: boolean;
}

/** Split on the character *after* each sentence-final mark, keeping the mark. */
const SENTENCE_SPLIT_RE = /(?<=[。！？!?…])/;

/** Fold segment `index + 1` into `index` — join text, span the union. */
export function mergeTranscriptSegDown(
  segs: WizardTranscriptSeg[],
  index: number,
): WizardTranscriptSeg[] {
  if (index < 0 || index + 1 >= segs.length) return segs;
  const a = segs[index]!;
  const b = segs[index + 1]!;
  const merged: WizardTranscriptSeg = {
    text: joinJapanese(a.text.trimEnd(), b.text.trimStart()),
    startMs: Math.min(a.startMs, b.startMs),
    endMs: Math.max(a.endMs, b.endMs),
    isAuto: a.isAuto || b.isAuto,
    lowConfidence: a.lowConfidence || b.lowConfidence,
  };
  return [...segs.slice(0, index), merged, ...segs.slice(index + 2)];
}

/**
 * Split segment `index` on internal sentence-final punctuation into one
 * segment per sentence, dividing the time span proportionally by character
 * count. No-op when there is nothing to split.
 */
export function splitTranscriptSeg(
  segs: WizardTranscriptSeg[],
  index: number,
): WizardTranscriptSeg[] {
  const seg = segs[index];
  if (!seg) return segs;
  const pieces = seg.text
    .split(SENTENCE_SPLIT_RE)
    .map((piece) => piece.trim())
    .filter(Boolean);
  if (pieces.length <= 1) return segs;
  const totalChars = pieces.reduce((n, p) => n + p.length, 0) || 1;
  const span = seg.endMs - seg.startMs;
  let cursor = seg.startMs;
  const replacements: WizardTranscriptSeg[] = pieces.map((text, i) => {
    const start = cursor;
    cursor =
      i === pieces.length - 1
        ? seg.endMs
        : Math.round(start + (span * text.length) / totalChars);
    return {
      text,
      startMs: start,
      endMs: cursor,
      isAuto: seg.isAuto,
      lowConfidence: seg.lowConfidence,
    };
  });
  return [...segs.slice(0, index), ...replacements, ...segs.slice(index + 1)];
}

/** Set one segment's text without disturbing the rest. */
export function editTranscriptSegText(
  segs: WizardTranscriptSeg[],
  index: number,
  text: string,
): WizardTranscriptSeg[] {
  return segs.map((seg, i) => (i === index ? { ...seg, text } : seg));
}

// ---------------------------------------------------------------------------
// "Segment with AI help" round-trip
//
// When the transcript came from punctuation-free auto-captions (the ASR
// fallback), the fragments break mid-sentence and the reviewer often can't
// tell where sentences begin. `formatTranscriptForAI` produces a
// copy-pasteable prompt for an external assistant; `parseAiSegmentedTranscript`
// reads its reply back into segments. Deliberately a manual copy/paste flow,
// not another Edge Function — no key, no deploy, works with whatever
// assistant the user already has open.
// ---------------------------------------------------------------------------

/** `123456` ms -> `2:03` (whole seconds — the round-trip doesn't need sub-second). */
export function formatWizardTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

const AI_PROMPT_HEADER = [
  'You are helping segment a Japanese transcript for shadowing practice.',
  'Below are timed fragments from automatic transcription. They often break',
  'mid-sentence and may lack punctuation or contain small recognition errors.',
  '',
  'Rewrite them as complete, natural sentences:',
  '- One sentence per line.',
  '- Add sentence-final punctuation (。！？) where it belongs.',
  '- Fix obvious mis-recognitions, but keep the wording faithful — do not paraphrase or translate.',
  '- Begin every line with the [m:ss] timestamp of the fragment where that sentence starts.',
  '- Output only the sentence lines, nothing else.',
  '',
  '--- transcript ---',
].join('\n');

export function formatTranscriptForAI(segs: WizardTranscriptSeg[]): string {
  const body = segs
    .map((seg) => `[${formatWizardTimestamp(seg.startMs)}] ${seg.text.trim()}`)
    .join('\n');
  return `${AI_PROMPT_HEADER}\n${body}\n`;
}

/** `[2:03] text` or `[2:03.4] text` — tolerant of `00:03`, missing space. */
const AI_LINE_RE = /^\[\s*(\d+):([0-5]?\d)(?:\.\d+)?\s*\]\s*(.*\S)?\s*$/;

/**
 * Parse an assistant's reply (`[m:ss] sentence` per line) back into wizard
 * segments. `fallbackEndMs` is the original transcript's end (last segment's
 * `endMs`) — the last parsed sentence runs to there. A line with no
 * timestamp is treated as a wrapped continuation of the previous sentence.
 * Returns `[]` when nothing parseable is found, so the caller can warn
 * rather than blow away the transcript.
 */
export function parseAiSegmentedTranscript(
  reply: string,
  fallbackEndMs: number,
): WizardTranscriptSeg[] {
  const parsed: { startMs: number; text: string }[] = [];
  for (const rawLine of reply.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = AI_LINE_RE.exec(line);
    if (!match) {
      if (parsed.length > 0) {
        const prev = parsed[parsed.length - 1]!;
        prev.text = joinJapanese(prev.text, line);
      }
      continue;
    }
    const startMs = (Number(match[1]) * 60 + Number(match[2])) * 1000;
    const text = (match[3] ?? '').trim();
    if (text) parsed.push({ startMs, text });
  }
  if (parsed.length === 0) return [];
  parsed.sort((a, b) => a.startMs - b.startMs);
  return parsed.map((entry, index) => {
    const nextStart = parsed[index + 1]?.startMs;
    const end =
      nextStart !== undefined
        ? Math.max(nextStart, entry.startMs + 1)
        : Math.max(fallbackEndMs, entry.startMs + 1);
    return {
      text: entry.text,
      startMs: entry.startMs,
      endMs: end,
      isAuto: true,
      lowConfidence: false,
    };
  });
}
