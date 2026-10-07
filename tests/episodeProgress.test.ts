import { describe, expect, it } from 'vitest';

import type { Book, BookSentence, SentenceLearningEvent } from '../src/domain/types';
import { buildEpisodeProgress, sentenceEpisodeStage } from '../src/lib/episodeProgress';

let n = 0;
const ev = (
  sentenceId: string,
  action: SentenceLearningEvent['action'],
  timestamp: string,
  extra: Partial<SentenceLearningEvent> = {},
): SentenceLearningEvent => ({ id: `e${n++}`, timestamp, visitId: 'v', action, bookId: 'b', sentenceId, ...extra });

describe('sentenceEpisodeStage', () => {
  it('walks up the ladder from events alone', () => {
    expect(sentenceEpisodeStage([])).toBe('unseen');
    const walk = ev('s', 'walkthrough_completed', '2026-10-01T10:00:00Z');
    expect(sentenceEpisodeStage([walk])).toBe('walked');
    const gist = ev('s', 'gist_check', '2026-10-01T10:05:00Z', { outcome: 'got_it' });
    expect(sentenceEpisodeStage([walk, gist])).toBe('gist');
    const g2 = ev('s', 'gist_check', '2026-10-03T10:00:00Z', { outcome: 'got_it' });
    const g3 = ev('s', 'gist_check', '2026-10-05T10:00:00Z', { outcome: 'got_it' });
    expect(sentenceEpisodeStage([walk, g2, g3])).toBe('retained');
    const framed = ev('s', 'expression_attempt', '2026-10-06T10:00:00Z', { outcome: 'got_it', scaffold: 'frame' });
    expect(sentenceEpisodeStage([walk, framed])).toBe('expressed');
    const free = ev('s', 'expression_attempt', '2026-10-06T10:00:00Z', { outcome: 'got_it', scaffold: 'none' });
    expect(sentenceEpisodeStage([walk, free])).toBe('independent');
  });

  it('does not credit a same-day cue-free attempt as independent', () => {
    const walk = ev('s', 'walkthrough_completed', '2026-10-01T10:00:00Z');
    const same = ev('s', 'expression_attempt', '2026-10-01T10:30:00Z', { outcome: 'got_it', scaffold: 'none' });
    expect(sentenceEpisodeStage([walk, same])).toBe('expressed');
  });
});

describe('buildEpisodeProgress', () => {
  const book = (over: Partial<Book>): Book =>
    ({
      id: 'b',
      title: 'Book',
      archived: false,
      createdAt: '',
      updatedAt: '',
      collapsedChapterIds: [],
      chapters: [{ id: 'c1', title: 'Ep 1', position: 0 }],
      ...over,
    }) as Book;
  const m = (sentenceId: string): BookSentence =>
    ({ id: `m-${sentenceId}`, bookId: 'b', sentenceId, position: 0, status: 'new', addedAt: '', chapterId: 'c1' }) as BookSentence;

  it('counts sentences per chapter and cumulative stages', () => {
    const rows = buildEpisodeProgress(
      [book({})],
      [m('a'), m('b'), m('c')],
      [
        ev('a', 'walkthrough_completed', '2026-10-01T10:00:00Z'),
        ev('b', 'walkthrough_completed', '2026-10-01T10:00:00Z'),
        ev('b', 'gist_check', '2026-10-01T10:01:00Z', { outcome: 'got_it' }),
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].total).toBe(3);
    expect(rows[0].reached.walked).toBe(2);
    expect(rows[0].reached.gist).toBe(1);
    expect(rows[0].byStage.unseen).toBe(1);
  });

  it('skips archived and suspended books', () => {
    expect(buildEpisodeProgress([book({ archived: true }), book({ id: 'x', suspendedAt: '2026-10-01' })], [m('a')], [])).toEqual([]);
  });
});
