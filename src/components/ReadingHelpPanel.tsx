import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';

import { getDb } from '../db/database';
import type { AnalysisChunk, Sentence } from '../domain/types';

import { SegmentLoopPlayer } from './SegmentLoopPlayer';

interface HelpTarget {
  surface: string;
  reading?: string;
  kind: 'word' | 'chunk';
}

/**
 * Revealed-sentence helper on the `reading_in_context` card: tap a word or
 * analysis chunk to loop just that span of the native clip, and flag a
 * word "Missed reading" (reported up, recorded on the review, and asked
 * back as a typed reading on the sentence's next review). Never touches
 * the rating.
 */
export function ReadingHelpPanel({
  sentence,
  chunks,
  onMissedChange,
}: {
  sentence: Sentence;
  chunks: AnalysisChunk[] | undefined;
  onMissedChange: (surfaces: string[]) => void;
}) {
  const { japanese, inlineReading, vocabularySuggestions } = sentence;
  const audio = useLiveQuery(
    async () => (await getDb().sentenceAudio.where('sentenceId').equals(sentence.id).first()) ?? null,
    [sentence.id],
  );

  const targets = useMemo<HelpTarget[]>(() => {
    const words = vocabularySuggestions.some((s) => s.selectedByDefault)
      ? vocabularySuggestions.filter((s) => s.selectedByDefault)
      : vocabularySuggestions;
    const seen = new Set<string>();
    const out: HelpTarget[] = [];
    for (const word of words) {
      if (!word.surface || seen.has(word.surface) || !japanese.includes(word.surface)) continue;
      seen.add(word.surface);
      out.push({ surface: word.surface, reading: word.reading, kind: 'word' });
    }
    for (const chunk of chunks ?? []) {
      if (chunk.kind === 'zero_ga' || !chunk.japanese) continue;
      if (seen.has(chunk.japanese) || !japanese.includes(chunk.japanese)) continue;
      seen.add(chunk.japanese);
      out.push({ surface: chunk.japanese, kind: 'chunk' });
    }
    return out;
  }, [vocabularySuggestions, chunks, japanese]);

  const [selected, setSelected] = useState<string | null>(null);
  const [missed, setMissed] = useState<string[]>([]);
  useEffect(() => {
    onMissedChange(missed);
    // The callback is a state setter in the parent; keyed on the value only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missed]);

  if (targets.length === 0) return null;
  const active = targets.find((target) => target.surface === selected);
  const isMissed = (surface: string) => missed.includes(surface);

  return (
    <div className="stack" style={{ gap: '0.45rem' }}>
      <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
        Tap a word or chunk to {audio ? 'hear it again or ' : ''}mark a reading you missed.
      </p>
      <div className="row">
        {targets.map((target) => (
          <button
            key={target.surface}
            type="button"
            className="chip"
            aria-pressed={selected === target.surface}
            onClick={() => setSelected(selected === target.surface ? null : target.surface)}
          >
            <span className="jp">{target.surface}</span>
            {isMissed(target.surface) ? <span className="muted"> ✗</span> : null}
          </button>
        ))}
      </div>
      {active ? (
        <div className="vocab-drawer panel stack" style={{ gap: '0.35rem' }}>
          <div className="jp" style={{ fontSize: '1.25rem' }}>
            {active.surface}
          </div>
          {active.reading ? <div className="muted">{active.reading}</div> : null}
          {active.kind === 'word' ? (
            <button
              type="button"
              aria-pressed={isMissed(active.surface)}
              onClick={() =>
                setMissed((prev) =>
                  prev.includes(active.surface)
                    ? prev.filter((surface) => surface !== active.surface)
                    : [...prev, active.surface],
                )
              }
            >
              {isMissed(active.surface)
                ? 'Missed reading ✓ (tap to undo)'
                : 'I missed this reading'}
            </button>
          ) : null}
          {audio ? (
            <SegmentLoopPlayer
              key={active.surface}
              audio={audio}
              japanese={japanese}
              inlineReading={inlineReading}
              surfaceForm={active.surface}
              loopLabel={active.kind === 'chunk' ? 'Loop this chunk' : 'Loop this word'}
              loopingLabel="Looping…"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
