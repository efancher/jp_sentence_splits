import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { getSentenceDeepDiveInfo } from '../db/repository';
import type { MasteryRungKey, SentenceMasteryArc } from '../lib/masteryArc';

/**
 * "Opt-in single-sentence deep dive" (docs/ROADMAP.md) — reached from
 * `/progress`'s "Sentence mastery" panel. Walks one lagging sentence's
 * remaining mastery rungs: the reviewable ones (reading, listening,
 * conjugation, grammar, pitch) open a real `/review` session pinned to this
 * sentence, which pulls those cards in regardless of due date (a deliberate,
 * user-confirmed bypass of normal FSRS pacing — see `ignoreDue` on
 * `getDueStudyItems`) rather than waiting for the schedule. `vocabConfirmed`
 * and `shadowed` aren't FSRS cards at all, so they link to their existing
 * flows instead. `contextMature` can't be fast-tracked this way — maturity
 * needs real calendar time between successful reviews, not a cram session —
 * so it's shown as informational only, never a button.
 */
export function SentenceDeepDivePage() {
  const { sentenceId } = useParams<{ sentenceId: string }>();
  const navigate = useNavigate();

  const info = useLiveQuery(async () => {
    if (!sentenceId) return { found: false as const };
    const result = await getSentenceDeepDiveInfo(sentenceId);
    if (!result) return { found: false as const };
    return { found: true as const, ...result };
  }, [sentenceId]);

  return (
    <div className="stack">
      <section className="panel stack">
        <button type="button" onClick={() => navigate('/progress')}>
          Back to progress
        </button>
        {info === undefined ? (
          <p className="muted">Loading…</p>
        ) : !info.found ? (
          <p className="muted">Sentence not found.</p>
        ) : (
          <SentenceDeepDiveContent
            sentenceId={info.sentence.id}
            japanese={info.sentence.japanese}
            bookId={info.bookId}
            arc={info.arc}
          />
        )}
      </section>
    </div>
  );
}

function SentenceDeepDiveContent({
  sentenceId,
  japanese,
  bookId,
  arc,
}: {
  sentenceId: string;
  japanese: string;
  bookId: string | undefined;
  arc: SentenceMasteryArc;
}) {
  const reviewableFalseRungKeys = new Set<MasteryRungKey>([
    'readingProficient',
    'listeningProficient',
    'conjugationsProficient',
    'grammarRecognized',
    'pitchProficient',
  ]);
  const hasReviewableWork = arc.rungs.some(
    (rung) => rung.status === false && reviewableFalseRungKeys.has(rung.key),
  );

  return (
    <>
      <p className="jp" style={{ fontSize: '1.1rem' }}>
        {japanese}
      </p>
      <p className="muted" style={{ margin: 0 }}>
        {arc.clearedCount}/{arc.applicableCount} rungs cleared.
      </p>

      {arc.complete ? (
        <p>Every rung that applies to this sentence is already cleared. Nothing left to dive into.</p>
      ) : (
        <>
          {hasReviewableWork ? (
            <p>
              <Link to={`/review?sentenceId=${sentenceId}`}>
                <button type="button">Start deep-dive review</button>
              </Link>{' '}
              <span className="muted" style={{ fontSize: '0.85rem' }}>
                Pulls this sentence's not-yet-proficient cards in now, out of the normal schedule —
                grading them counts as a real review, same as any other.
              </span>
            </p>
          ) : null}

          <div className="stack" style={{ gap: '0.4rem' }}>
            {arc.rungs.map((rung) => (
              <div
                key={rung.key}
                className="row"
                style={{ justifyContent: 'space-between', alignItems: 'baseline' }}
              >
                <span>
                  {rung.status === true ? '✓ ' : rung.status === null ? '– ' : '○ '}
                  {rung.label}
                </span>
                {rung.status === false && rung.key === 'vocabConfirmed' && bookId ? (
                  <Link to={`/books/${bookId}/vocabulary/${sentenceId}`}>Confirm vocabulary →</Link>
                ) : rung.status === false && rung.key === 'shadowed' && bookId ? (
                  <Link to={`/books/${bookId}/shadow/${sentenceId}`}>Shadow this sentence →</Link>
                ) : rung.status === false && rung.key === 'contextMature' ? (
                  <span className="muted" style={{ fontSize: '0.8rem' }}>
                    Comes with time — needs real calendar days between successful reviews, not
                    a cram session.
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
