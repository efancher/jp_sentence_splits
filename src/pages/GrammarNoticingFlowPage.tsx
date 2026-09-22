import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { GrammarPicker } from '../components/GrammarPicker';
import { findGrammarNoticingCandidates, getDb, setSentenceGrammarReviewStatus } from '../db/repository';
import type { AnalysisChunk } from '../domain/types';

/** Standalone-mode batch size (no session budget to bound it — just "show me what's currently eligible"). */
const STANDALONE_CANDIDATE_LIMIT = 20;

/**
 * Batched "notice the grammar in these worked-through sentences" flow. The
 * session planner used to draft one `grammar_noticing` step per sentence and
 * `preferCoherentChains` scattered them through the sitting — the learner
 * reported it "keeps coming up" (2026-09-06). Now the planner drafts a single
 * "Notice grammar in N sentences" step that deep-links here with
 * `?ids=<sentenceId,sentenceId,…>`, and this page walks them one at a time,
 * reusing the same `GrammarPicker` the AnalyzePage grammar panel uses (this
 * sequences, it doesn't reimplement — same principle as SessionRunnerPage).
 *
 * The step still settles only through the runner's explicit "Mark complete";
 * closing a sentence here (`GrammarPicker`'s "Done — nothing more to notice",
 * or the "Nothing to notice" shortcut below) flips its
 * `grammarReviewStatus` so it drops out of future noticing nudges.
 *
 * **Standalone mode** (2026-09-22, "a way to do notice grammar outside of
 * sessions"): with no `?ids=` at all (reached via `/notice-grammar` directly
 * — a link on `GrammarListPage`, not just a session deep link), this page
 * self-populates from `findGrammarNoticingCandidates` — the same pool the
 * planner draws from, just without its per-sitting budget/limit, so it shows
 * everything currently eligible up to `STANDALONE_CANDIDATE_LIMIT`.
 */
export function GrammarNoticingFlowPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const hasIdsParam = searchParams.has('ids');
  const urlIds = useMemo(
    () =>
      (searchParams.get('ids') ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    [searchParams],
  );

  const [index, setIndex] = useState(0);

  const standaloneIds = useLiveQuery(async () => {
    if (hasIdsParam) return undefined;
    const candidates = await findGrammarNoticingCandidates(STANDALONE_CANDIDATE_LIMIT);
    return candidates.map((candidate) => candidate.sentenceId);
  }, [hasIdsParam]);

  const ids = hasIdsParam ? urlIds : (standaloneIds ?? []);

  const data = useLiveQuery(async () => {
    if (ids.length === 0) return { sentences: [] as SentenceRow[] };
    const db = getDb();
    const [sentences, analyses] = await Promise.all([
      db.sentences.bulkGet(ids),
      db.analyses.bulkGet(ids),
    ]);
    const rows: SentenceRow[] = ids.map((id, i) => {
      const sentence = sentences[i];
      const analysis = analyses[i];
      return {
        id,
        japanese: sentence?.japanese ?? '',
        translation: sentence?.translation ?? '',
        chunks: analysis?.chunks ?? [],
        reviewed: (analysis?.grammarReviewStatus ?? 'unreviewed') === 'confirmed',
        missing: !sentence,
      };
    });
    return { sentences: rows };
  }, [ids.join(',')]);

  if (!hasIdsParam && standaloneIds === undefined) {
    return <p className="muted">Loading…</p>;
  }

  if (ids.length === 0) {
    return (
      <div className="stack">
        <section className="panel stack">
          <h2 style={{ margin: 0 }}>Notice grammar</h2>
          <p className="muted">
            {hasIdsParam
              ? 'No sentences to review.'
              : "Nothing eligible right now — this needs a sentence you've marked complete in its book, with its own vocabulary confirmed and proficient, that hasn't had its grammar-noticing pass done yet."}
          </p>
          <button type="button" className="primary" onClick={() => navigate(-1)}>
            Back
          </button>
        </section>
      </div>
    );
  }

  // `data`'s useLiveQuery keeps its previous value while recomputing, so
  // right after `ids` first becomes non-empty (standalone mode resolving)
  // it can briefly still hold the earlier `{ sentences: [] }` result from
  // when `ids` was empty — guard on that too, not just `!data`, or
  // `rows[Math.min(index, rows.length - 1)]` below reads `rows[-1]`.
  if (!data || data.sentences.length === 0) return <p className="muted">Loading…</p>;

  const rows = data.sentences;
  const current = rows[Math.min(index, rows.length - 1)]!;
  const remaining = rows.filter((row) => !row.reviewed).length;

  async function nothingToNotice() {
    await setSentenceGrammarReviewStatus(current.id, 'confirmed');
    goNext();
  }

  function goNext() {
    setIndex((value) => Math.min(value + 1, rows.length - 1));
  }

  function goPrev() {
    setIndex((value) => Math.max(value - 1, 0));
  }

  const onLast = index >= rows.length - 1;

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Notice grammar</h2>
          <span className="muted">
            {index + 1} / {rows.length}
          </span>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Pull out any grammar patterns worth tracking from these sentences you&rsquo;ve
          already worked through — or mark that there&rsquo;s nothing more to notice.
          {remaining > 0 ? ` ${remaining} still open.` : ' All closed.'}
        </p>
        <div className="row" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
          {rows.map((row, i) => (
            <button
              key={row.id}
              type="button"
              className={i === index ? undefined : 'ghost'}
              style={{ fontSize: '0.8rem' }}
              onClick={() => setIndex(i)}
            >
              {i + 1}
              {row.reviewed ? ' ✓' : ''}
            </button>
          ))}
        </div>
      </section>

      {current.missing ? (
        <section className="panel stack">
          <p className="muted">This sentence is no longer available.</p>
        </section>
      ) : (
        <section className="panel stack">
          <p className="jp" style={{ fontSize: '1.3rem', margin: 0 }}>
            {current.japanese}
          </p>
          {current.translation ? (
            <p className="muted" style={{ margin: 0 }}>
              {current.translation}
            </p>
          ) : null}
        </section>
      )}

      {current.missing ? null : (
        <GrammarPicker
          key={current.id}
          sentenceId={current.id}
          japanese={current.japanese}
          chunks={current.chunks.map((chunk) => ({
            japanese: chunk.japanese,
            role: chunk.role,
            literalEnglish: chunk.literalEnglish,
          }))}
        />
      )}

      <section className="panel">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <button type="button" className="ghost" disabled={index === 0} onClick={goPrev}>
            ← Previous
          </button>
          <div className="row" style={{ gap: '0.5rem' }}>
            {!current.missing && !current.reviewed ? (
              <button type="button" className="ghost" onClick={() => void nothingToNotice()}>
                Nothing to notice
              </button>
            ) : null}
            {onLast ? (
              <button type="button" className="primary" onClick={() => navigate(-1)}>
                Done
              </button>
            ) : (
              <button type="button" className="primary" onClick={goNext}>
                Next sentence →
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

interface SentenceRow {
  id: string;
  japanese: string;
  translation: string;
  chunks: AnalysisChunk[];
  reviewed: boolean;
  missing: boolean;
}
