import { useRef, useState, type ReactNode } from 'react';

import type { SentenceAudio } from '../domain/types';
import {
  EMPTY_EAR_TILES_PROGRESS,
  earTilesDone,
  particleOutcomes,
  tapEarTile,
  type EarTilesProgress,
  type EarTilesPuzzle,
} from '../lib/earTiles';

import type { GlossDecisionInput } from './GlossDecisionPanel';
import { NativeAudioButton } from './NativeAudioButton';

/** The gloss decisions a finished round feeds the particle skill: one per particle fake in the bank. */
export function particleGlossDecisions(
  puzzle: EarTilesPuzzle,
  wrongTaps: readonly string[],
  ids: { visitId: string; sentenceId: string },
): GlossDecisionInput[] {
  return particleOutcomes(puzzle, wrongTaps).map((outcome) => ({
    ...ids,
    skill: 'particle',
    subskill: outcome.particle === 'は' || outcome.particle === 'も' ? 'topic' : 'case',
    ruleKey: `particle:${outcome.particle}:ear`,
    targetText: outcome.tile,
    levelShown: 4,
    firstResponse: outcome.fellFor ? 'distractor' : outcome.tile,
    firstCorrect: !outcome.fellFor,
    referenceValue: outcome.tile,
    referenceConfidence: 'settled',
    hintMaxStep: 0,
    explanationOpened: false,
    vocabHelped: false,
    translationLevel: 0,
    outcome: outcome.fellFor ? 'assisted_correct' : 'independent_correct',
  }));
}

/** The sentence being rebuilt: placed tiles in green, the next slot highlighted. Used inline in the reader's text. */
export function EarTilesSlots({ puzzle, progress }: { puzzle: EarTilesPuzzle; progress: EarTilesProgress }) {
  const textOf = (id: string) => puzzle.bank.find((tile) => tile.id === id)?.text ?? '';
  const done = earTilesDone(puzzle, progress);
  return (
    <div className="row jp jp-lg" style={{ minHeight: '3rem', gap: '0.35rem', flexWrap: 'wrap' }} aria-label="Sentence so far">
      {puzzle.answer.map((_, slot) => {
        const id = progress.placed[slot];
        return id ? (
          <span key={slot} style={{ padding: '0.1rem 0.5rem', border: '2px solid var(--success)', borderRadius: 'var(--radius)', color: 'var(--success)' }}>
            {textOf(id)}
          </span>
        ) : (
          <span
            key={slot}
            aria-label={`Slot ${slot + 1}, empty`}
            style={{
              minWidth: '2rem',
              padding: '0.1rem 0.5rem',
              border: `2px dashed ${slot === progress.placed.length && !done ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 'var(--radius)',
              textAlign: 'center',
            }}
          >
            ＿
          </span>
        );
      })}
    </div>
  );
}

/** The tile bank, the "not next / never said" status line and, once finished, the result. */
export function EarTilesBank({
  puzzle,
  progress,
  onTap,
  finish,
}: {
  puzzle: EarTilesPuzzle;
  progress: EarTilesProgress;
  onTap: (tileId: string) => void;
  /** Shown under the result once the round is done. */
  finish: ReactNode;
}) {
  const { placed, wrongTaps, struck, flash } = progress;
  const textOf = (id: string) => puzzle.bank.find((tile) => tile.id === id)?.text ?? '';
  const done = earTilesDone(puzzle, progress);
  const fakesTapped = puzzle.bank.filter((tile) => tile.distractor && wrongTaps.includes(tile.text));

  return (
    <>
      {!done ? (
        <div className="row" style={{ flexWrap: 'wrap' }} aria-label="Tile bank">
          {puzzle.bank.map((tile) => {
            const isPlaced = placed.includes(tile.id);
            const isStruck = struck.includes(tile.id);
            const flashed = flash === tile.id;
            return (
              <button
                key={tile.id}
                type="button"
                className="ghost"
                disabled={isPlaced || isStruck}
                onClick={() => onTap(tile.id)}
                aria-label={isStruck ? `${tile.text}, not in the sentence` : flashed ? `${tile.text}, not next` : tile.text}
                style={{
                  fontSize: '1.15rem',
                  opacity: isPlaced || isStruck ? 0.3 : 1,
                  textDecoration: isStruck ? 'line-through' : undefined,
                  borderStyle: 'solid',
                  borderWidth: 2,
                  borderColor: flashed ? 'var(--danger)' : undefined,
                  color: flashed ? 'var(--danger)' : undefined,
                }}
              >
                <span className="jp">{tile.text}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {!done ? (
        <div className="muted" role="status" style={{ fontSize: '0.85rem' }}>
          {flash
            ? `Not ${textOf(flash)} next — listen again.`
            : struck.length > 0
              ? `${textOf(struck[struck.length - 1]!)} was never said.`
              : ' '}
        </div>
      ) : (
        <div className="stack" style={{ gap: '0.3rem' }} role="status">
          <div>
            <strong>{wrongTaps.length === 0 ? '✓ Heard it cleanly' : `Got it — ${wrongTaps.length} slip${wrongTaps.length === 1 ? '' : 's'}`}</strong>
          </div>
          {fakesTapped.map((tile) => (
            <div key={tile.id}>
              ✗ You took <span className="jp">{tile.text}</span>; the clip says{' '}
              <span className="jp">{tile.distractor!.from}</span>.
            </div>
          ))}
          <div>{finish}</div>
        </div>
      )}
    </>
  );
}

/**
 * The warm-up before a sentence's walkthrough: hear the clip, then tap only the tiles that were
 * said, in the order said. A few tiles are fakes (a particle or ending swapped), so the check is
 * partly "did you hear は or が". Particle fakes are logged to the gloss decision log so the
 * particle skill keeps its evidence; missing one never lowers the support level.
 */
export function EarTilesCheck({
  sentenceId,
  visitId,
  puzzle,
  audio,
  onRecord,
  onFinish,
  finishLabel = 'Continue to the walkthrough',
}: {
  sentenceId: string;
  visitId: string;
  puzzle: EarTilesPuzzle;
  audio: SentenceAudio;
  /** Omit where there is no gloss decision log to feed (the review card). */
  onRecord?: (decision: GlossDecisionInput) => void;
  onFinish: () => void;
  finishLabel?: string;
}) {
  const [progress, setProgress] = useState<EarTilesProgress>(EMPTY_EAR_TILES_PROGRESS);
  const recorded = useRef(false);

  function tapTile(id: string) {
    const next = tapEarTile(puzzle, progress, id);
    if (next === progress) return;
    setProgress(next);
    if (earTilesDone(puzzle, next) && !recorded.current) {
      recorded.current = true;
      for (const decision of particleGlossDecisions(puzzle, next.wrongTaps, { visitId, sentenceId })) onRecord?.(decision);
    }
  }

  return (
    <div className="stack" style={{ gap: '0.5rem' }} aria-label="Ear tiles check">
      <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <NativeAudioButton audio={audio} displayLabel="Hear the sentence" />
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          Tap the tiles you hear, in order. Some tiles were never said — skip those. Replay as often as you like.
        </span>
      </div>
      <EarTilesSlots puzzle={puzzle} progress={progress} />
      <EarTilesBank
        puzzle={puzzle}
        progress={progress}
        onTap={tapTile}
        finish={<button type="button" className="primary" onClick={onFinish}>{finishLabel}</button>}
      />
    </div>
  );
}
