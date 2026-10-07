import { useRef, useState } from 'react';

import type { SentenceAudio } from '../domain/types';
import { isCorrectTile, particleOutcomes, type EarTilesPuzzle } from '../lib/earTiles';

import type { GlossDecisionInput } from './GlossDecisionPanel';
import { NativeAudioButton } from './NativeAudioButton';

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
}: {
  sentenceId: string;
  visitId: string;
  puzzle: EarTilesPuzzle;
  audio: SentenceAudio;
  onRecord: (decision: GlossDecisionInput) => void;
  onFinish: () => void;
}) {
  const total = puzzle.answer.length;
  const [placed, setPlaced] = useState<string[]>([]);
  const [wrongTaps, setWrongTaps] = useState<string[]>([]);
  // Fakes the learner has tapped and ruled out.
  const [struck, setStruck] = useState<string[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const recorded = useRef(false);
  const textOf = (id: string) => puzzle.bank.find((tile) => tile.id === id)?.text ?? '';
  const done = placed.length === total;

  function record(finalWrongTaps: string[]) {
    if (recorded.current) return;
    recorded.current = true;
    for (const outcome of particleOutcomes(puzzle, finalWrongTaps)) {
      onRecord({
        visitId,
        sentenceId,
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
      });
    }
  }

  function tapTile(id: string) {
    if (done || placed.includes(id) || struck.includes(id)) return;
    const tile = puzzle.bank.find((item) => item.id === id);
    if (!tile) return;
    if (isCorrectTile(puzzle, placed.length, tile.text)) {
      const nextPlaced = [...placed, id];
      setPlaced(nextPlaced);
      setFlash(null);
      if (nextPlaced.length === total) record(wrongTaps);
      return;
    }
    const nextWrong = [...wrongTaps, tile.text];
    setWrongTaps(nextWrong);
    if (tile.distractor) {
      setStruck((current) => [...current, id]);
      setFlash(null);
    } else {
      setFlash(id);
    }
  }

  const fakesTapped = puzzle.bank.filter((tile) => tile.distractor && wrongTaps.includes(tile.text));

  return (
    <div className="stack" style={{ gap: '0.5rem' }} aria-label="Ear tiles check">
      <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <NativeAudioButton audio={audio} displayLabel="Hear the sentence" />
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          Tap the tiles you hear, in order. Some tiles were never said — skip those. Replay as often as you like.
        </span>
      </div>

      <div className="row jp jp-lg" style={{ minHeight: '3rem', gap: '0.35rem', flexWrap: 'wrap' }} aria-label="Sentence so far">
        {puzzle.answer.map((_, slot) => {
          const id = placed[slot];
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
                border: `2px dashed ${slot === placed.length && !done ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 'var(--radius)',
                textAlign: 'center',
              }}
            >
              ＿
            </span>
          );
        })}
      </div>

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
                onClick={() => tapTile(tile.id)}
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
          <div>
            <button type="button" className="primary" onClick={onFinish}>Continue to the walkthrough</button>
          </div>
        </div>
      )}
    </div>
  );
}
