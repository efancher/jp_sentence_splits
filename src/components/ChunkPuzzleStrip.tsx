import type { CSSProperties } from 'react';

import { assignClauseIndices, isEngineRole } from '../lib/clauseBands';
export type PuzzleChunk = {
  id: string;
  japanese: string;
  role: string;
  /** Short English shown under the Japanese when `showGloss` is on. */
  gloss?: string;
};

type ChunkPuzzleStripProps = {
  chunks: PuzzleChunk[];
  /** Speech / highlight target, e.g. `chunk-${id}`. */
  activeItemId?: string | null;
  /** When false, hide role labels on pieces (Practice before reveal). */
  revealRoles?: boolean;
  /**
   * Guided-walkthrough mode (AnalyzePage): chunk ids the learner has reached
   * so far. Pieces outside this set still render their shape/Japanese text
   * (so the sentence's full length/outline is visible up front) but their
   * role label is hidden and the piece is dimmed, regardless of
   * `revealRoles` — undefined (the default) reveals every piece normally.
   */
  revealedIds?: Set<string>;
  /** Interlinear English under each revealed piece that has a `gloss`. */
  showGloss?: boolean;
};

const CLAUSE_TINT_COUNT = 4;

export function ChunkPuzzleStrip({
  chunks,
  activeItemId = null,
  revealRoles = true,
  revealedIds,
  showGloss = false,
}: ChunkPuzzleStripProps) {
  if (!chunks.length) return null;

  const clauseIndices = assignClauseIndices(chunks);

  return (
    <div className="chunk-puzzle-block">
      <div
        className="chunk-puzzle-strip"
        aria-label="Chunk structure strip"
      >
        {chunks.map((chunk, index) => {
          const clause = clauseIndices[index] ?? 0;
          const engine = isEngineRole(chunk.role);
          const speaking =
            activeItemId === `chunk-${chunk.id}` || activeItemId === chunk.id;
          const nextClause = clauseIndices[index + 1];
          const clauseFinal =
            engine && (nextClause === undefined || nextClause !== clause);
          const revealed = !revealedIds || revealedIds.has(chunk.id);

          return (
            <div
              key={chunk.id}
              className={[
                'chunk-puzzle-piece',
                engine ? 'chunk-puzzle-piece-engine' : '',
                clauseFinal ? 'chunk-puzzle-piece-clause-final' : '',
                speaking ? 'chunk-puzzle-piece-speaking' : '',
                revealed ? '' : 'chunk-puzzle-piece-unrevealed',
              ]
                .filter(Boolean)
                .join(' ')}
              style={
                {
                  '--clause-tint': `var(--clause-band-${clause % CLAUSE_TINT_COUNT})`,
                } as CSSProperties
              }
            >
              <div className="chunk-puzzle-body">
                <div className="jp chunk-puzzle-japanese">{chunk.japanese}</div>
                {showGloss && revealed && chunk.gloss?.trim() ? (
                  <div className="chunk-puzzle-gloss">{chunk.gloss.trim()}</div>
                ) : null}
                {revealRoles && revealed ? (
                  <div className="chunk-puzzle-role muted">
                    {chunk.role.trim() || '—'}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
