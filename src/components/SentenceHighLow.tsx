import { useEffect, useState } from 'react';

import {
  getReferenceAlignment,
  getReferencePitchTrack,
  saveReferenceAlignment,
  saveReferencePitchTrack,
} from '../db/repository';
import { loadOrComputeAlignment } from '../lib/alignmentCache';
import { buildPhrasePitch, moraHighLow, type PhrasePitchResult } from '../lib/phrasePitch';
import { loadOrComputeReferencePitch } from '../lib/referencePitchCache';

const SLOT_W = 22;

type Cell =
  | { kind: 'phrase'; phraseIndex: number; kana: string[]; hl: ('h' | 'l')[] | null }
  | { kind: 'gap'; phraseIndex: number; text: string };

/** The sentence's phrases in order — measured ones with their H/L, unmeasured ones as a gap holding their place. */
function cellsOf(result: PhrasePitchResult): Cell[] {
  const cells: Cell[] = [
    ...result.rows.map((row): Cell => ({
      kind: 'phrase',
      phraseIndex: row.phraseIndex,
      kana: row.kana,
      hl: moraHighLow(row.nativeContour, row.nativeLevels, row.kana.length),
    })),
    ...result.unmeasured.map((gap): Cell => ({ kind: 'gap', phraseIndex: gap.phraseIndex, text: gap.text })),
  ];
  return cells.sort((a, b) => a.phraseIndex - b.phraseIndex);
}

/**
 * The native recording's high/low for the whole sentence, phrase by phrase, under its sounds. Each H/L is
 * read from the measured pitch against that phrase's own average (`moraHighLow`) — not a dictionary accent,
 * and not comparable across phrases.
 */
export function SentenceHighLow({ result }: { result: PhrasePitchResult }) {
  if (result.unavailable || result.rows.length === 0) return null;
  const cells = cellsOf(result);
  return (
    <div className="stack" style={{ gap: '0.2rem' }}>
      <span className="muted" style={{ fontSize: '0.85rem' }}>High / low (native)</span>
      <div className="row" style={{ flexWrap: 'wrap', columnGap: '0.9rem', rowGap: '0.4rem', alignItems: 'flex-start' }}>
        {cells.map((cell) =>
          cell.kind === 'gap' ? (
            <div key={cell.phraseIndex} className="stack muted" style={{ gap: 0, textAlign: 'center' }} title="Not measured">
              <span className="pa-kana jp">{cell.text}</span>
              <span className="pa-hl">–</span>
            </div>
          ) : (
            <div
              key={cell.phraseIndex}
              className="stack"
              style={{ gap: 0 }}
              aria-label={cell.hl ? `${cell.kana.join('')}: ${cell.hl.join(' ').toUpperCase()}` : undefined}
            >
              <div className="row pp-kana" style={{ gap: 0 }}>
                {cell.kana.map((kana, index) => (
                  <span key={index} className="pa-kana jp" style={{ width: SLOT_W, textAlign: 'center' }}>
                    {kana}
                  </span>
                ))}
              </div>
              <div className="row" style={{ gap: 0 }}>
                {cell.kana.map((_, index) => (
                  <span key={index} className="pa-hl" data-c={cell.hl?.[index]} style={{ width: SLOT_W, textAlign: 'center' }}>
                    {cell.hl ? cell.hl[index]!.toUpperCase() : '–'}
                  </span>
                ))}
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/**
 * Loads the cached native alignment and pitch for a reference clip and shows `SentenceHighLow`. Renders
 * nothing while loading or when either is unavailable (no alignment service, undecodable audio, or no exact
 * mora timing) — the practice loop never waits on it.
 */
export function ShadowSentenceHighLow({
  referenceAudioId,
  referenceBlob,
  transcript,
}: {
  referenceAudioId: string;
  referenceBlob: Blob;
  transcript: string;
}) {
  const [result, setResult] = useState<PhrasePitchResult>();
  useEffect(() => {
    let active = true;
    setResult(undefined);
    void (async () => {
      try {
        const [alignment, pitch] = await Promise.all([
          loadOrComputeAlignment(referenceAudioId, referenceBlob, transcript, getReferenceAlignment, saveReferenceAlignment),
          loadOrComputeReferencePitch(referenceAudioId, referenceBlob, getReferencePitchTrack, saveReferencePitchTrack),
        ]);
        if (!active || !alignment || !pitch) return;
        setResult(buildPhrasePitch({ reference: { words: alignment.words, pitch } }));
      } catch {
        // Practice carries on without the strip.
      }
    })();
    return () => {
      active = false;
    };
  }, [referenceAudioId, referenceBlob, transcript]);
  return result ? <SentenceHighLow result={result} /> : null;
}
