import type { CSSProperties } from 'react';

import { assignClauseIndices, isEngineRole } from '../lib/clauseBands';

export type PuzzleChunk = {
  id: string;
  japanese: string;
  role: string;
};

type ChunkPuzzleStripProps = {
  chunks: PuzzleChunk[];
  /** Speech / highlight target, e.g. `chunk-${id}`. */
  activeItemId?: string | null;
  /** When false, hide role labels on pieces (Practice before reveal). */
  revealRoles?: boolean;
};

const CLAUSE_TINT_COUNT = 4;

export function ChunkPuzzleStrip({
  chunks,
  activeItemId = null,
  revealRoles = true,
}: ChunkPuzzleStripProps) {
  if (!chunks.length) return null;

  const clauseIndices = assignClauseIndices(chunks);

  return (
    <div
      className="chunk-puzzle-strip"
      aria-label="Chunk structure strip"
    >
      {chunks.map((chunk, index) => {
        const clause = clauseIndices[index] ?? 0;
        const engine = isEngineRole(chunk.role);
        const speaking =
          activeItemId === `chunk-${chunk.id}` || activeItemId === chunk.id;
        const first = index === 0;
        const last = index === chunks.length - 1;

        return (
          <div
            key={chunk.id}
            className={[
              'chunk-puzzle-piece',
              engine ? 'chunk-puzzle-piece-engine' : '',
              speaking ? 'chunk-puzzle-piece-speaking' : '',
              first ? 'chunk-puzzle-piece-first' : '',
              last ? 'chunk-puzzle-piece-last' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={
              {
                '--clause-tint': `var(--clause-band-${clause % CLAUSE_TINT_COUNT})`,
              } as CSSProperties
            }
          >
            <div className="jp chunk-puzzle-japanese">{chunk.japanese}</div>
            {revealRoles ? (
              <div className="chunk-puzzle-role muted">
                {chunk.role.trim() || '—'}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
