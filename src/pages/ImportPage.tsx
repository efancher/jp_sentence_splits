import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { previewShadowingPackageFile } from '../db/repository';
import { ShadowingPreviewCard } from '../components/ShadowingPreviewCard';
import type { ShadowingImportPreview } from '../lib/shadowingImport';

export function ImportPage() {
  const navigate = useNavigate();
  const [shadowingPreview, setShadowingPreview] =
    useState<ShadowingImportPreview | null>(null);
  const [shadowingBusy, setShadowingBusy] = useState(false);
  const [shadowingError, setShadowingError] = useState('');

  async function handleShadowingPackage(file: File | null) {
    if (!file) return;
    setShadowingError('');
    setShadowingBusy(true);
    try {
      setShadowingPreview(await previewShadowingPackageFile(file));
    } catch (err) {
      setShadowingPreview(null);
      setShadowingError(
        err instanceof Error
          ? err.message
          : 'Failed to read shadowing project package',
      );
    } finally {
      setShadowingBusy(false);
    }
  }

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Import</h2>
        <p className="muted" style={{ margin: 0 }}>
          Four ways to bring sentences in — pick one below.
        </p>
      </section>

      <section
        className="stack"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '1rem',
        }}
      >
        <div className="panel stack">
          <h3 style={{ margin: 0 }}>Shadowing project ZIP</h3>
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            A <code>.shadowing.zip</code> package. Creates or refreshes one
            book in the original video order, with native sentence
            recordings. Audio stays in this browser.
          </p>
          <label>
            Shadowing project ZIP
            <input
              type="file"
              accept=".zip,.shadowing.zip,application/zip"
              onChange={(event) =>
                void handleShadowingPackage(event.target.files?.[0] ?? null)
              }
            />
          </label>
          {shadowingBusy ? <div className="muted">Reading package…</div> : null}
          {shadowingError ? (
            <div style={{ color: 'var(--danger)' }}>{shadowingError}</div>
          ) : null}
        </div>

        <div className="panel stack">
          <h3 style={{ margin: 0 }}>YouTube or podcast — quick import</h3>
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            Paste a YouTube URL or a podcast's RSS feed. One combined prompt
            segments and translates the transcript in a single AI round trip,
            then a quick skim before committing.
          </p>
          <Link to="/import/quick">
            <button type="button" className="primary">
              Start
            </button>
          </Link>
        </div>

        <div className="panel stack">
          <h3 style={{ margin: 0 }}>YouTube or podcast — full wizard</h3>
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            Same sources, but with separate transcript, sentence-boundary
            (waveform editing), and translation review steps. Use this when a
            source needs closer editing than the quick import's single pass.
          </p>
          <Link to="/import/youtube">
            <button type="button">Start</button>
          </Link>
        </div>

        <div className="panel stack">
          <h3 style={{ margin: 0 }}>NHK Easy News</h3>
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            Paste an nhkeasier.com feed URL and pick a graded news article —
            furigana-annotated text plus the real NHK narration audio, no
            transcription needed.
          </p>
          <Link to="/import/nhk-easy">
            <button type="button" className="primary">
              Start
            </button>
          </Link>
        </div>
      </section>

      {shadowingPreview ? (
        <section className="panel stack">
          <h3 style={{ margin: 0 }}>Shadowing project preview</h3>
          <ShadowingPreviewCard
            preview={shadowingPreview}
            onImported={(result) => navigate(`/books/${result.bookId}`)}
            onCancel={() => setShadowingPreview(null)}
          />
        </section>
      ) : null}
    </div>
  );
}
