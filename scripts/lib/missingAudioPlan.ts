/**
 * Parse the "Video position: 189.000–197.000 seconds" line a mined sentence
 * keeps in its source reference notes. Returns whole milliseconds, or null when
 * the line is absent or the span is empty/inverted.
 */
export function parseVideoSpanMs(userNotes: string): { startMs: number; endMs: number } | null {
  const match = /Video position:\s*([\d.]+)\s*[–-]\s*([\d.]+)\s*seconds/i.exec(userNotes);
  if (!match) return null;
  const startMs = Math.round(Number(match[1]) * 1000);
  const endMs = Math.round(Number(match[2]) * 1000);
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs ? { startMs, endMs } : null;
}

/** The source id half of a mined `cardId` ("source-<id>:sentence-020-ceb553"), or null. */
export function sourceKeyOfCardId(cardId: string): string | null {
  const key = cardId.split(':')[0];
  return key && key.startsWith('source-') ? key : null;
}
