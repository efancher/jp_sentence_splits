import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ShadowingPreviewCard } from '../components/ShadowingPreviewCard';
import { commitSeriesEpisodeImport, getDb } from '../db/repository';
import {
  base64ToBlob,
  fetchPodcastFeed,
  importNhkEasyArticle,
  type NhkEasyImportResult,
  type PodcastEpisode,
  type PodcastFeed,
} from '../lib/miningApi';
import { normalizeSentenceKey } from '../lib/normalize';
import { parseInlineReadings } from '../lib/parseInlineReadings';
import {
  realignTranslations,
  type RealignGroupInput,
} from '../lib/sentenceRealign';
import {
  buildShadowingPreview,
  type ShadowingAudioDraft,
  type ShadowingImportPreview,
  type ShadowingSentenceInput,
} from '../lib/shadowingImport';

const MANIFEST = {
  format: 'japanese-shadowing-package',
  version: 2,
  createdAt: '',
  generator: { name: 'jp-sentence-splits-nhk-easy-import', version: '1' },
} as const;

type Stage = 'idle' | 'imported' | 'commit';

// Fixed, not per-feed — every NHK Easy article lands in the same one book
// regardless of which nhkeasier.com-shaped feed URL it came from.
const NHK_EASY_SERIES_ID = 'nhk-easy-news';
const NHK_EASY_SERIES_TITLE = 'NHK Easy News';

/** Flatten NHK's own `漢字[かな]` inline reading into a plain kana string —
 * same "each segment's reading, falling back to its base" shape mora.ts /
 * readingAnswer.ts already use for the same conversion. */
function flatReading(inlineReading: string): string {
  return parseInlineReadings(inlineReading)
    .map((segment) => segment.reading ?? segment.base)
    .join('');
}

/**
 * NHK Easy News import — a plain-text feed article (nhkeasier.com's
 * furigana-annotated republication, see docs/ROADMAP.md "NHK News Web Easy
 * import") turned into a book, one call to `POST /nhk-easy/import` for the
 * known text + real per-sentence audio, then the same
 * translate-review-commit shape the YouTube-mining wizard ends on
 * (`ShadowingPreviewCard`) — but no job/polling/ASR in between, since the
 * text here is already correct.
 */
export function NhkEasyImportPage() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('idle');

  const [feedUrl, setFeedUrl] = useState('');
  const [feed, setFeed] = useState<PodcastFeed | null>(null);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState('');

  const [importResult, setImportResult] = useState<NhkEasyImportResult | null>(null);
  // The picked article's own publish date, for commitSeriesEpisodeImport's
  // chapter-chronology — captured at pick time since NhkEasyImportResult
  // doesn't carry it.
  const [articleDate, setArticleDate] = useState<string | null>(null);
  const [translations, setTranslations] = useState<string[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState('');
  const [realignBusy, setRealignBusy] = useState(false);
  const [realignNote, setRealignNote] = useState('');

  const [preview, setPreview] = useState<ShadowingImportPreview | null>(null);

  function reset() {
    setStage('idle');
    setFeedUrl('');
    setFeed(null);
    setFeedError('');
    setImportResult(null);
    setArticleDate(null);
    setTranslations([]);
    setImportError('');
    setRealignNote('');
    setPreview(null);
  }

  async function handleLoadFeed() {
    setFeedError('');
    setFeed(null);
    setFeedLoading(true);
    try {
      setFeed(await fetchPodcastFeed(feedUrl.trim()));
    } catch (err) {
      setFeedError(err instanceof Error ? err.message : 'Failed to load feed');
    } finally {
      setFeedLoading(false);
    }
  }

  async function handleImportArticle(episode: PodcastEpisode) {
    setImportError('');
    setImportBusy(true);
    try {
      if (!episode.descriptionHtml) {
        throw new Error(
          'This feed item has no article body — is this really an NHK Easy feed?',
        );
      }
      const result = await importNhkEasyArticle(
        episode.title,
        episode.descriptionHtml,
        episode.url,
      );
      setImportResult(result);
      setArticleDate(episode.publishedAt ?? null);
      setTranslations(result.sentences.map(() => ''));
      setStage('imported');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to import article');
    } finally {
      setImportBusy(false);
    }
  }

  async function handleAutoFillTranslations() {
    if (!importResult) return;
    setRealignBusy(true);
    setRealignNote('');
    try {
      const groups: RealignGroupInput[] = importResult.sentences.map((sentence) => ({
        originalJapanese: sentence.japanese,
        originalTranslation: '',
        pieces: [sentence.japanese],
      }));
      const result = await realignTranslations(groups);
      if (!result.ok) {
        setRealignNote(result.reason);
        return;
      }
      setTranslations((current) =>
        current.map((existing, index) => {
          const filled = result.groups[index]?.pieceTranslations[0]?.trim();
          return filled || existing;
        }),
      );
      setRealignNote('Filled by AI — give them a glance before continuing.');
    } finally {
      setRealignBusy(false);
    }
  }

  async function handleBuildPreview() {
    if (!importResult) return;
    const sourceId = `nhk-easy-${Date.now()}`;
    const sentences: ShadowingSentenceInput[] = [];
    const audio: ShadowingAudioDraft[] = [];
    importResult.sentences.forEach((sentence, index) => {
      const id = `${sourceId}-${index}`;
      sentences.push({
        id,
        japanese: sentence.japanese,
        reading: flatReading(sentence.inlineReading),
        english: translations[index]?.trim() || undefined,
        startMs: 0,
        endMs: sentence.durationMs ?? 0,
        tags: [],
        transcriptStatus: 'verified',
        tokens: sentence.tokens ?? undefined,
      });
      if (sentence.audioBase64) {
        audio.push({
          sourceSentenceId: id,
          normalizedKey: normalizeSentenceKey(sentence.japanese),
          path: `clips/${id}.m4a`,
          mimeType: 'audio/mp4',
          durationMs: sentence.durationMs ?? 0,
          startMs: 0,
          endMs: sentence.durationMs ?? 0,
          blob: base64ToBlob(sentence.audioBase64, 'audio/mp4'),
        });
      }
    });
    const existing = await getDb().sentences.toArray();
    const built = buildShadowingPreview(
      { id: sourceId, type: 'other', title: importResult.title },
      { ...MANIFEST, createdAt: new Date().toISOString() },
      sentences,
      audio,
      existing,
    );
    // NHK's own furigana is authoritative — buildDrafts derives inlineReading
    // from `tokens` (UniDic-inferred), which can differ on names/uncommon
    // readings, so overwrite it with the real one after the fact rather than
    // feed a synthetic token stream just to fake it out.
    const inlineReadingByJapanese = new Map(
      importResult.sentences.map((s) => [s.japanese, s.inlineReading]),
    );
    for (const item of built.drafts) {
      const real = inlineReadingByJapanese.get(item.draft.japanese);
      if (real) item.draft.inlineReading = real;
    }
    setPreview(built);
    setStage('commit');
  }

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Import from NHK Easy News</h2>
        <p className="muted" style={{ margin: 0 }}>
          Paste an nhkeasier.com feed URL (<code>https://nhkeasier.com/feed/</code>)
          — a third-party mirror of NHK News Web Easy for learners, with
          furigana-annotated text and the real NHK narration audio per
          article. The text is already correct, so it's forced-aligned
          against the audio rather than transcribed.
        </p>
        {stage === 'idle' ? (
          <div className="stack" style={{ gap: '0.4rem' }}>
            <div className="row">
              <input
                style={{ flex: 1 }}
                value={feedUrl}
                placeholder="https://nhkeasier.com/feed/"
                onChange={(event) => setFeedUrl(event.target.value)}
              />
              <button
                type="button"
                className="primary"
                disabled={!feedUrl.trim() || feedLoading}
                onClick={() => void handleLoadFeed()}
              >
                {feedLoading ? 'Loading…' : 'Load articles'}
              </button>
            </div>
            {feedError ? (
              <div className="muted" style={{ color: 'var(--warning)', fontSize: '0.85rem' }}>
                {feedError}
              </div>
            ) : null}
            {importError ? (
              <div className="muted" style={{ color: 'var(--warning)', fontSize: '0.85rem' }}>
                {importError}
              </div>
            ) : null}
            {feed ? (
              <div className="stack" style={{ gap: '0.25rem', maxHeight: '20rem', overflowY: 'auto' }}>
                <div className="muted" style={{ fontSize: '0.85rem' }}>
                  {feed.title} — {feed.episodes.length} articles
                </div>
                {feed.episodes.map((episode) => (
                  <button
                    key={episode.url}
                    type="button"
                    className="row"
                    style={{ justifyContent: 'space-between', textAlign: 'left', gap: '1rem' }}
                    disabled={importBusy}
                    onClick={() => void handleImportArticle(episode)}
                  >
                    <span>{episode.title}</span>
                    <span className="muted" style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                      {importBusy ? 'Importing…' : ''}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {stage === 'imported' && importResult ? (
        <section className="panel stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>{importResult.title}</h3>
            <button type="button" onClick={reset}>
              Start over
            </button>
          </div>
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            {importResult.audioAligned
              ? `${importResult.sentences.length} sentences, native audio per sentence.`
              : `${importResult.sentences.length} sentences — no usable audio for this article, importing as text-only.`}
          </div>
          <div className="row">
            <button type="button" disabled={realignBusy} onClick={() => void handleAutoFillTranslations()}>
              {realignBusy ? 'Asking the translation AI…' : 'Auto-fill translations (AI)'}
            </button>
            <button type="button" className="primary" onClick={() => void handleBuildPreview()}>
              Continue to review
            </button>
          </div>
          {realignNote ? <div className="muted" style={{ fontSize: '0.85rem' }}>{realignNote}</div> : null}
          <div className="stack" style={{ gap: '0.5rem' }}>
            {importResult.sentences.map((sentence, index) => (
              <div key={index} className="stack" style={{ gap: '0.2rem' }}>
                <div>{sentence.japanese}</div>
                {sentence.audioBase64 ? (
                  <audio
                    controls
                    src={URL.createObjectURL(base64ToBlob(sentence.audioBase64, 'audio/mp4'))}
                  />
                ) : null}
                <input
                  style={{ width: '100%' }}
                  value={translations[index] ?? ''}
                  placeholder="English translation"
                  onChange={(event) =>
                    setTranslations((current) =>
                      current.map((t, i) => (i === index ? event.target.value : t)),
                    )
                  }
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {stage === 'commit' && preview ? (
        <section className="panel stack">
          <ShadowingPreviewCard
            preview={preview}
            commitLabel="Add as a new chapter"
            onCommit={(p) =>
              commitSeriesEpisodeImport({
                seriesId: NHK_EASY_SERIES_ID,
                seriesTitle: NHK_EASY_SERIES_TITLE,
                episodeTitle: p.source.title,
                sourceDate: articleDate ?? new Date().toISOString(),
                preview: p,
              })
            }
            onImported={(result) => navigate(`/books/${result.bookId}`)}
            onCancel={() => setStage('imported')}
            retentionNote="Audio was clipped from the article's real narration — there's no source ZIP to keep."
          />
        </section>
      ) : null}
    </div>
  );
}
