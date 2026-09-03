import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { SegmentationEditor } from '../components/SegmentationEditor';
import {
  applyResegmentation,
  loadResegmentSourceContext,
  type ResegmentSourceContext,
} from '../db/repository';
import { fixNumeralsInReadingOnly } from '../lib/fixNumeralReadings';
import { inlineReadingFromTokens } from '../lib/inlineReadingFromTokens';
import {
  fetchSourceAudioRange,
  fetchSourceWaveform,
  resegmentSentences,
} from '../lib/miningApi';
import {
  buildRealignGroups,
  buildResegmentPlan,
  seedResegmentReview,
  type ResegmentReviewedSegment,
  type ResegmentReviewRow,
} from '../lib/resegmentPlan';
import { realignTranslations } from '../lib/sentenceRealign';

type Phase = 'loading' | 'mode' | 'segmenting' | 'review' | 'applying' | 'error';

export function ResegmentSourcePage() {
  const { bookId = '' } = useParams();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [context, setContext] = useState<ResegmentSourceContext | null>(null);
  const [rows, setRows] = useState<ResegmentReviewRow[]>([]);
  const [realigning, setRealigning] = useState(false);
  const [realignNote, setRealignNote] = useState('');
  const [showAllRows, setShowAllRows] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadResegmentSourceContext(bookId).then(
      (ctx) => {
        if (cancelled) return;
        if (!ctx || ctx.sentences.length === 0) {
          setError('This book has no shadowing-sourced sentences to re-segment.');
          setPhase('error');
          return;
        }
        setContext(ctx);
        setPhase('mode');
      },
      (err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load book');
        setPhase('error');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  async function runSegmentation(mode: 'drama' | 'lyrics') {
    if (!context) return;
    setPhase('segmenting');
    setError('');
    try {
      const cues = await resegmentSentences(
        context.sentences.map((s) => ({
          japanese: s.japanese,
          startMs: s.startMs,
          endMs: s.endMs,
        })),
        mode === 'lyrics' ? { merge: false, split: false } : {},
      );
      setRows(seedResegmentReview(context.sentences, cues));
      setPhase('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Re-segmentation failed');
      setPhase('mode');
    }
  }

  async function apply() {
    if (!context) return;
    setPhase('applying');
    setError('');
    try {
      // Re-annotate every row (edits invalidate readings/tokens); annotate-only
      // so the user's manual grouping is preserved 1:1.
      const annotated = await resegmentSentences(
        rows.map((row) => ({ japanese: row.japanese, startMs: 0, endMs: 0 })),
        { merge: false, split: false },
      );
      const segments: ResegmentReviewedSegment[] = rows.map((row, i) => {
        const cue = annotated[i];
        const tokens = cue?.tokens ?? [];
        return {
          japanese: row.japanese,
          translation: row.translation.trim(),
          readingOnly: fixNumeralsInReadingOnly(cue?.reading?.trim() ?? row.readingOnly),
          inlineReading: inlineReadingFromTokens(row.japanese, tokens),
          tokens,
          startMs: row.startMs,
          endMs: row.endMs,
        };
      });
      const plan = buildResegmentPlan(
        context.sentences.map((s) => ({
          id: s.id,
          japanese: s.japanese,
          translation: s.translation,
          studyItems: s.studyItems,
        })),
        segments,
      );
      await applyResegmentation(bookId, plan);
      navigate(`/books/${bookId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed');
      setPhase('review');
    }
  }

  async function autoFillTranslations() {
    if (!context || realigning) return;
    setRealigning(true);
    setRealignNote('');
    const { groups, assignments } = buildRealignGroups(rows, context.sentences);
    const result = await realignTranslations(groups);
    setRealigning(false);
    if (!result.ok) {
      setRealignNote(result.reason);
      return;
    }
    setRows((current) =>
      current.map((row, index) => {
        const assignment = assignments[index];
        const suggestion =
          assignment && result.groups[assignment.groupIndex]?.pieceTranslations[assignment.rank];
        const next = suggestion?.trim();
        if (!next) return row;
        return { ...row, translation: next, needsTranslationReview: true };
      }),
    );
    setRealignNote('Filled from the original translation — give the flagged rows a glance.');
  }

  const summary = useMemo(() => {
    if (!context) return null;
    const segments: ResegmentReviewedSegment[] = rows.map((row) => ({
      japanese: row.japanese,
      translation: row.translation,
      readingOnly: '',
      inlineReading: '',
      tokens: [],
    }));
    return buildResegmentPlan(
      context.sentences.map((s) => ({
        id: s.id,
        japanese: s.japanese,
        translation: s.translation,
        studyItems: s.studyItems,
      })),
      segments,
    );
  }, [context, rows]);

  const rowsWithProgress = useMemo(() => {
    const indexes = new Set<number>();
    for (const move of summary?.studyItemMoves ?? []) {
      if (move.targetIndex !== null) indexes.add(move.targetIndex);
    }
    return indexes;
  }, [summary]);

  // `SegmentationEditor` owns the row list + the collapsed-rows view; the
  // page keeps this derived count only for the header's translation-review
  // nudge.
  const filteringActive = rowsWithProgress.size > 0 && !showAllRows;
  const unresolvedTranslations = rows.filter(
    (row, i) =>
      row.needsTranslationReview && (!filteringActive || rowsWithProgress.has(i)),
  ).length;

  if (phase === 'loading') return <p className="muted">Loading source…</p>;

  if (phase === 'error') {
    return (
      <div className="stack">
        <div style={{ color: 'var(--danger)' }}>{error}</div>
        <Link to={`/books/${bookId}`}>Back to book</Link>
      </div>
    );
  }

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Re-segment captions — {context?.bookTitle}</h2>
        <p className="muted" style={{ margin: 0 }}>
          Rebuild this source&apos;s sentences on real sentence boundaries. The
          {' '}{context?.sentences.length} current sentences are replaced; study
          progress follows whichever new sentence overlaps each old one most.
          Analysis (chunks) is cleared.
        </p>
        {error ? <div style={{ color: 'var(--danger)' }}>{error}</div> : null}

        {phase === 'mode' ? (
          <div className="row">
            <button
              type="button"
              className="primary"
              onClick={() => void runSegmentation('drama')}
            >
              Punctuated transcript (drama)
            </button>
            <button type="button" onClick={() => void runSegmentation('lyrics')}>
              Lyrics / manual
            </button>
            <Link to={`/books/${bookId}`}>
              <button type="button">Cancel</button>
            </Link>
          </div>
        ) : null}

        {phase === 'segmenting' ? <div className="muted">Re-segmenting…</div> : null}
      </section>

      {phase === 'review' || phase === 'applying' ? (
        <>
          <section className="panel stack">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>
                {rows.length} sentences
                {summary
                  ? ` · ${summary.migratedCardCount} cards kept · ${summary.freshCardCount} reset`
                  : ''}
              </strong>
              <div className="row">
                <button
                  type="button"
                  disabled={phase === 'applying' || realigning}
                  onClick={() => void autoFillTranslations()}
                >
                  {realigning ? 'Filling…' : 'Auto-fill translations (AI)'}
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={phase === 'applying'}
                  onClick={() => void apply()}
                >
                  {phase === 'applying' ? 'Applying…' : 'Apply'}
                </button>
                <button
                  type="button"
                  disabled={phase === 'applying'}
                  onClick={() => setPhase('mode')}
                >
                  Start over
                </button>
              </div>
            </div>
            {realignNote ? <div className="muted">{realignNote}</div> : null}
            {unresolvedTranslations > 0 ? (
              <div className="muted">
                {unresolvedTranslations} translation
                {unresolvedTranslations === 1 ? '' : 's'} to check
                {filteringActive ? ' on cards with progress' : ''} — a split
                can&apos;t divide a translation automatically.
              </div>
            ) : null}
            {rowsWithProgress.size > 0 ? (
              <label className="row" style={{ fontSize: '0.9em' }}>
                <input
                  type="checkbox"
                  checked={showAllRows}
                  onChange={(event) => setShowAllRows(event.target.checked)}
                />
                Show all {rows.length} sentences (otherwise only the{' '}
                {rowsWithProgress.size} with study progress are shown in full)
              </label>
            ) : null}
          </section>

          <SegmentationEditor
            rows={rows}
            onRowsChange={setRows}
            rowsWithProgress={rowsWithProgress}
            showAllRows={showAllRows}
            disabled={phase === 'applying'}
            audioForRange={
              context?.sourceUrl
                ? (startMs, endMs) =>
                    fetchSourceAudioRange(context.sourceUrl!, startMs, endMs)
                : undefined
            }
            waveformForRange={
              context?.sourceUrl
                ? (startMs, endMs) =>
                    fetchSourceWaveform(context.sourceUrl!, startMs, endMs)
                : undefined
            }
          />
        </>
      ) : null}
    </div>
  );
}
