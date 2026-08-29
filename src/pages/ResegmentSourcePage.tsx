import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  applyResegmentation,
  loadResegmentSourceContext,
  type ResegmentSourceContext,
} from '../db/repository';
import { inlineReadingFromTokens } from '../lib/inlineReadingFromTokens';
import { resegmentSentences } from '../lib/miningApi';
import {
  buildRealignGroups,
  buildResegmentPlan,
  distributeTranslation,
  seedResegmentReview,
  type ResegmentReviewedSegment,
} from '../lib/resegmentPlan';
import { realignTranslations } from '../lib/sentenceRealign';

type Phase = 'loading' | 'mode' | 'segmenting' | 'review' | 'applying' | 'error';

interface ReviewRow {
  japanese: string;
  translation: string;
  /** From the initial /resegment pass; stale after a manual edit — apply re-annotates. */
  readingOnly: string;
  sourceIndexes: number[];
  /** Contributing old sentences' translations — shown as a hint, not the field value. */
  sourceTranslations: string[];
  needsTranslationReview: boolean;
}

/** Split on the character *after* each sentence-final mark, keeping the mark. */
const SENTENCE_SPLIT_RE = /(?<=[。！？!?…])/;

function joinJapanese(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return /[　-鿿＀-￯]$/.test(a) || /^[　-鿿]/.test(b)
    ? a + b
    : `${a} ${b}`;
}

export function ResegmentSourcePage() {
  const { bookId = '' } = useParams();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [context, setContext] = useState<ResegmentSourceContext | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
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
      const seeded = seedResegmentReview(context.sentences, cues);
      setRows(
        seeded.map((row) => ({
          japanese: row.japanese,
          translation: row.translation,
          readingOnly: row.readingOnly,
          sourceIndexes: row.sourceIndexes,
          sourceTranslations: row.sourceTranslations,
          needsTranslationReview: row.needsTranslationReview,
        })),
      );
      setPhase('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Re-segmentation failed');
      setPhase('mode');
    }
  }

  function updateRow(index: number, patch: Partial<ReviewRow>) {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, i) => i !== index));
  }

  function mergeUp(index: number) {
    setRows((current) => {
      if (index === 0) return current;
      const next = [...current];
      const prev = next[index - 1]!;
      const row = next[index]!;
      next[index - 1] = {
        japanese: joinJapanese(prev.japanese, row.japanese),
        translation: [prev.translation, row.translation].filter(Boolean).join(' '),
        readingOnly: '',
        sourceIndexes: [...new Set([...prev.sourceIndexes, ...row.sourceIndexes])],
        sourceTranslations: [
          ...new Set([...prev.sourceTranslations, ...row.sourceTranslations]),
        ],
        needsTranslationReview: true,
      };
      next.splice(index, 1);
      return next;
    });
  }

  function splitRow(index: number) {
    setRows((current) => {
      const row = current[index]!;
      const pieces = row.japanese
        .split(SENTENCE_SPLIT_RE)
        .map((piece) => piece.trim())
        .filter(Boolean);
      if (pieces.length <= 1) return current;
      const translations = distributeTranslation(row.translation, pieces.length);
      const replacements: ReviewRow[] = pieces.map((japanese, pieceIndex) => ({
        japanese,
        translation: translations[pieceIndex] ?? '',
        readingOnly: '',
        sourceIndexes: row.sourceIndexes,
        sourceTranslations: row.sourceTranslations,
        needsTranslationReview: true,
      }));
      const next = [...current];
      next.splice(index, 1, ...replacements);
      return next;
    });
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
          readingOnly: cue?.reading?.trim() ?? row.readingOnly,
          inlineReading: inlineReadingFromTokens(row.japanese, tokens),
          tokens,
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

  const filteringActive = rowsWithProgress.size > 0 && !showAllRows;
  const hiddenRowCount = filteringActive
    ? rows.length - rows.filter((_, i) => rowsWithProgress.has(i)).length
    : 0;
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

          {rows.map((row, index) =>
            !filteringActive || rowsWithProgress.has(index) ? (
              <section className="panel stack" key={index}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="muted">
                    #{index + 1} · from original{' '}
                    {row.sourceIndexes.map((i) => i + 1).join(', ')}
                    {rowsWithProgress.has(index) ? ' · has study progress' : ''}
                  </span>
                  <div className="row">
                    <button
                      type="button"
                      disabled={index === 0 || phase === 'applying'}
                      onClick={() => mergeUp(index)}
                    >
                      Merge up
                    </button>
                    <button
                      type="button"
                      disabled={phase === 'applying'}
                      onClick={() => splitRow(index)}
                    >
                      Split by 。
                    </button>
                    <button
                      type="button"
                      disabled={phase === 'applying' || rows.length === 1}
                      onClick={() => removeRow(index)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <textarea
                  className="jp"
                  rows={2}
                  value={row.japanese}
                  disabled={phase === 'applying'}
                  onChange={(event) =>
                    updateRow(index, { japanese: event.target.value })
                  }
                />
                <label>
                  Translation
                  <input
                    value={row.translation}
                    disabled={phase === 'applying'}
                    onChange={(event) =>
                      updateRow(index, {
                        translation: event.target.value,
                        needsTranslationReview: false,
                      })
                    }
                    style={
                      row.needsTranslationReview
                        ? { borderColor: 'var(--warning)' }
                        : undefined
                    }
                  />
                </label>
                {row.needsTranslationReview ? (
                  <span className="muted" style={{ color: 'var(--warning)' }}>
                    verify translation
                  </span>
                ) : null}
                {row.sourceTranslations.length > 0 &&
                !row.sourceTranslations.includes(row.translation.trim()) ? (
                  <span className="muted" style={{ fontSize: '0.85em' }}>
                    original: {row.sourceTranslations.join(' / ')}
                  </span>
                ) : null}
              </section>
            ) : null,
          )}

          {filteringActive && hiddenRowCount > 0 ? (
            <section className="panel stack">
              <span className="muted">
                {hiddenRowCount} other sentence{hiddenRowCount === 1 ? '' : 's'} —
                no study progress, will apply with the seeded translation.
              </span>
              {rows.map((row, index) =>
                rowsWithProgress.has(index) ? null : (
                  <div
                    key={index}
                    className="row"
                    style={{ justifyContent: 'space-between', gap: '0.5rem' }}
                  >
                    <span className="jp jp-sm">{row.japanese}</span>
                    <span
                      className="muted"
                      style={{
                        fontSize: '0.85em',
                        color: row.needsTranslationReview
                          ? 'var(--warning)'
                          : undefined,
                      }}
                    >
                      {row.translation || '—'}
                    </span>
                    <button
                      type="button"
                      disabled={phase === 'applying' || rows.length === 1}
                      onClick={() => removeRow(index)}
                    >
                      Remove
                    </button>
                  </div>
                ),
              )}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
