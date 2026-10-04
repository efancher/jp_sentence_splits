/**
 * "Quick import" round-trip: a single combined prompt that asks an external
 * AI to both segment a raw transcript into sentences AND translate each one,
 * instead of the staged wizard's two separate copy/paste passes (segment via
 * `miningTranscript.ts`, translate via `miningTranslate.ts`). Trades the
 * wizard's interim segment-boundary review (SegmentationEditor, waveform
 * drag) for one round trip — see QuickMinePage's review stage for the
 * lightweight edit list that replaces it as a safety net before commit.
 */

import { joinJapanese } from './resegmentPlan';

// The combined prompt itself lives in combinedImportPrompt.ts.

export interface CombinedAiRow {
  startMs: number;
  endMs: number;
  japanese: string;
  translation: string;
}

/** `[2:03] text` or `[2:03.4] text` — tolerant of `00:03`, missing space. */
const AI_LINE_RE = /^\[\s*(\d+):([0-5]?\d)(?:\.\d+)?\s*\]\s*(.*\S)?\s*$/;
const SEPARATOR_RE = /\s*\|\|\s*/;

/**
 * Parse an assistant's reply (`[m:ss] 日本語 || English` per line) into
 * timed, translated sentences. `fallbackEndMs` is the original transcript's
 * end — the last parsed sentence runs to there. Mirrors
 * `parseAiSegmentedTranscript`'s timestamp-grouping/proportional-split
 * logic (same reason: the source ASR only timestamps whole fragments, so
 * when the assistant splits one fragment into several sentences, those
 * sentences share a timestamp and need their span divided by text length
 * rather than collapsing to a 1ms clip). Returns `[]` when nothing
 * parseable is found, so the caller can warn instead of committing garbage.
 */
export function parseAiCombinedReply(
  reply: string,
  fallbackEndMs: number,
): CombinedAiRow[] {
  const parsed: { startMs: number; japanese: string; translation: string }[] = [];
  for (const rawLine of reply.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = AI_LINE_RE.exec(line);
    if (!match) {
      // Wrapped continuation of the previous line — a bare line before any
      // "||" is a Japanese wrap, an English translation is already in
      // progress once the previous entry has one.
      const prev = parsed[parsed.length - 1];
      if (prev) {
        if (prev.translation) {
          prev.translation = `${prev.translation} ${line}`.trim();
        } else if (line.includes('||')) {
          const [jp, ...en] = line.split(SEPARATOR_RE);
          prev.japanese = joinJapanese(prev.japanese, (jp ?? '').trim());
          const translation = en.join(' || ').trim();
          if (translation) prev.translation = translation;
        } else {
          prev.japanese = joinJapanese(prev.japanese, line);
        }
      }
      continue;
    }
    const startMs = (Number(match[1]) * 60 + Number(match[2])) * 1000;
    const remainder = (match[3] ?? '').trim();
    if (!remainder) continue;
    const [jpPart, ...enParts] = remainder.split(SEPARATOR_RE);
    const japanese = (jpPart ?? '').trim();
    const translation = enParts.join(' || ').trim();
    if (japanese) parsed.push({ startMs, japanese, translation });
  }
  if (parsed.length === 0) return [];
  parsed.sort((a, b) => a.startMs - b.startMs);

  const groups: (typeof parsed)[number][][] = [];
  for (const entry of parsed) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup[0]!.startMs === entry.startMs) {
      lastGroup.push(entry);
    } else {
      groups.push([entry]);
    }
  }

  const rows: CombinedAiRow[] = [];
  groups.forEach((group, groupIndex) => {
    const groupStart = group[0]!.startMs;
    const nextGroupStart = groups[groupIndex + 1]?.[0]?.startMs;
    const groupEnd =
      nextGroupStart !== undefined
        ? Math.max(nextGroupStart, groupStart + group.length)
        : Math.max(fallbackEndMs, groupStart + group.length);
    const totalLen = group.reduce((sum, entry) => sum + entry.japanese.length, 0) || 1;
    let cursor = groupStart;
    let cumLen = 0;
    group.forEach((entry, i) => {
      cumLen += entry.japanese.length;
      const isLast = i === group.length - 1;
      const end = isLast
        ? groupEnd
        : Math.max(cursor + 1, Math.round(groupStart + (groupEnd - groupStart) * (cumLen / totalLen)));
      rows.push({
        startMs: cursor,
        endMs: end,
        japanese: entry.japanese,
        translation: entry.translation,
      });
      cursor = end;
    });
  });
  return rows;
}
