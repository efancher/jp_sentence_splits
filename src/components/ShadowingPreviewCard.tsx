import { useState, type ReactNode } from 'react';

import { commitShadowingPackageImport } from '../db/repository';
import type { ShadowingImportPreview } from '../lib/shadowingImport';

const BYTES_PER_MEBIBYTE = 1024 * 1024;

function formatAudioSize(bytes: number): string {
  return `${(bytes / BYTES_PER_MEBIBYTE).toFixed(1)} MB`;
}

const CONFLICT_FIELD_LABELS: Record<string, string> = {
  translation: 'Translation',
  readingOnly: 'Reading',
  inlineReading: 'Inline reading',
  japanese: 'Japanese',
};

interface ShadowingPreviewCardProps {
  preview: ShadowingImportPreview;
  onImported: (result: { bookId: string }) => void;
  onCancel: () => void;
  /** Overrides the default "keep the ZIP to restore it" note — the
   * YouTube-mining flow has no ZIP to keep, so it needs different text. */
  retentionNote?: ReactNode;
}

/**
 * Preview summary + commit button for a fully-assembled
 * ShadowingImportPreview, shared between the manual `.shadowing.zip`
 * upload flow (ImportPage.tsx) and the YouTube-mining flow
 * (YouTubeMinePage.tsx) — both end up with the same preview shape (see
 * shadowingImport.ts's buildShadowingPreview), just built differently.
 */
export function ShadowingPreviewCard({
  preview,
  onImported,
  onCancel,
  retentionNote,
}: ShadowingPreviewCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const conflicts = preview.drafts
    .filter((item) => item.draft.conflicts.length > 0)
    .map((item) => ({ japanese: item.draft.japanese, list: item.draft.conflicts }));

  return (
    <div className="stack">
      <div>
        <strong>{preview.source.title}</strong>
        {preview.source.channel ? (
          <span className="muted"> · {preview.source.channel}</span>
        ) : null}
      </div>
      <ul className="muted" style={{ margin: 0, paddingLeft: '1.2rem' }}>
        <li>
          {preview.totalRows} video sentence occurrences ·{' '}
          {preview.counts.uniqueSentences} unique sentences
        </li>
        <li>
          {preview.audioDrafts.length} native audio clips ·{' '}
          {formatAudioSize(preview.audioBytes)}
        </li>
        <li>
          {preview.counts.newSentences} new ·{' '}
          {preview.counts.updatedSentences} updated/existing
        </li>
      </ul>
      {preview.warnings.map((warning) => (
        <div key={warning.message} className="status-pill needs_review">
          {warning.message}
        </div>
      ))}
      {conflicts.length > 0 ? (
        <details className="stack" style={{ fontSize: '0.85rem' }}>
          <summary style={{ cursor: 'pointer' }}>
            Conflicting values ({conflicts.length} sentence
            {conflicts.length === 1 ? '' : 's'}) — the first occurrence is kept
          </summary>
          <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem' }}>
            {conflicts.map((entry) => (
              <li key={entry.japanese} style={{ marginBottom: '0.4rem' }}>
                <div lang="ja">{entry.japanese}</div>
                {entry.list.map((conflict) => (
                  <div key={conflict.field} className="muted">
                    {CONFLICT_FIELD_LABELS[conflict.field] ?? conflict.field}:{' '}
                    keeping “{conflict.preferred}”, dropping{' '}
                    {conflict.alternatives
                      .map((alternative) => `“${alternative}”`)
                      .join(', ')}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        {retentionNote ?? (
          <>
            Native clips are not included in Glossbook JSON backups. Keep
            the project ZIP so they can be restored by reimporting it.
          </>
        )}
      </p>
      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const result = await commitShadowingPackageImport(preview);
              onImported(result);
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : 'Failed to import shadowing project',
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Import complete project
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {busy ? <div className="muted">Importing…</div> : null}
      {error ? <div style={{ color: 'var(--danger)' }}>{error}</div> : null}
    </div>
  );
}
