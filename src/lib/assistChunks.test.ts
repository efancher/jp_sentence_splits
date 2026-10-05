import { describe, expect, it, vi } from 'vitest';

import {
  MAX_ATTEMPTS_PER_CHUNK,
  chunkTranscript,
  mergeChunkReplies,
  runSegmentChunks,
  validateChunkReply,
} from './assistChunks';
import { parseAiCombinedReply } from './miningQuickImport';
import { splitCombinedReply } from './combinedImportPrompt';

const seg = (startS: number) => ({
  text: 'あ',
  startMs: startS * 1000,
  endMs: (startS + 5) * 1000,
  isAuto: false,
  lowConfidence: false,
});
const goodReply = (startS: number) =>
  `=== SENTENCES ===\n[0:${String(startS).padStart(2, '0')}] あ。 || Ah.\n=== END ===`;

describe('chunkTranscript', () => {
  it('splits into fixed-size chunks', () => {
    expect(chunkTranscript([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe('validateChunkReply', () => {
  it('accepts a complete reply and rejects truncated or empty ones', () => {
    const chunk = [seg(0), seg(10)];
    const full = '=== SENTENCES ===\n[0:00] あ。 || Ah.\n[0:10] あ。 || Ah.\n=== END ===';
    expect(validateChunkReply(full, chunk)).toBeNull();
    expect(validateChunkReply(full.replace('=== END ===', ''), chunk)).toMatch(/END/);
    expect(validateChunkReply('hello', chunk)).toMatch(/no "\[m:ss\]/);
  });
});

describe('mergeChunkReplies', () => {
  it('joins the sentence lines of every chunk into one parseable reply', () => {
    const merged = mergeChunkReplies([goodReply(0), goodReply(30)]);
    const rows = parseAiCombinedReply(splitCombinedReply(merged).sentences, 60_000);
    expect(rows.map((row) => row.startMs)).toEqual([0, 30_000]);
  });
});

describe('runSegmentChunks', () => {
  const base = {
    onChunkDone: () => {},
    onProgress: () => {},
    isCancelled: () => false,
  };

  it('retries a failing chunk only up to the cap, then stops the whole run', async () => {
    const run = vi.fn().mockRejectedValue(new Error('rate limited'));
    const result = await runSegmentChunks({
      ...base,
      chunks: [[seg(0)], [seg(30)]],
      replies: [],
      run,
    });
    expect(run).toHaveBeenCalledTimes(MAX_ATTEMPTS_PER_CHUNK);
    expect(result.failure).toEqual({ index: 0, error: 'rate limited' });
    expect(result.replies).toEqual([null, null]);
  });

  it('keeps finished chunks and skips them on a resume', async () => {
    const onChunkDone = vi.fn();
    const run = vi
      .fn()
      .mockResolvedValueOnce({ reply: goodReply(0), backend: 'codex' })
      .mockRejectedValue(new Error('boom'));
    const first = await runSegmentChunks({
      ...base,
      onChunkDone,
      chunks: [[seg(0)], [seg(30)]],
      replies: [],
      run,
    });
    expect(first.failure?.index).toBe(1);
    expect(onChunkDone).toHaveBeenCalledTimes(1);

    const run2 = vi.fn().mockResolvedValue({ reply: goodReply(30), backend: 'claude' });
    const second = await runSegmentChunks({
      ...base,
      chunks: [[seg(0)], [seg(30)]],
      replies: first.replies,
      run: run2,
    });
    expect(run2).toHaveBeenCalledTimes(1);
    expect(second.failure).toBeNull();
    expect(second.replies.every(Boolean)).toBe(true);
  });

  it('treats an unusable reply as a failed attempt', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ reply: 'sorry, I cannot', backend: 'codex' })
      .mockResolvedValueOnce({ reply: goodReply(0), backend: 'codex' });
    const result = await runSegmentChunks({ ...base, chunks: [[seg(0)]], replies: [], run });
    expect(run).toHaveBeenCalledTimes(2);
    expect(result.failure).toBeNull();
  });
});
