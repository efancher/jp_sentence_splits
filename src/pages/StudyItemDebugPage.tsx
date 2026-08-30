import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';

import { getStudyItemDebugInfo, readSettings, type StudyItemDebugSubject } from '../db/repository';
import { isGraduated } from '../lib/scheduling';

const MATURITY_LABELS: Record<string, string> = {
  fragile: 'Fragile',
  established: 'Established',
  generalized: 'Generalized',
  mature: 'Mature',
};

/**
 * "Why am I seeing this card, and why is it scheduled this way" view
 * (Phase 7.10 — explainability + debug view). Read-only: raw FSRS state,
 * every Review this study item has (finally surfacing
 * source/assistance/responseRaw/expectedAnswer, recorded since Phases
 * 7.1/7.8/7.9 but never shown anywhere before this), and — for a
 * vocabulary-item subject — its computed maturity ladder position.
 */
export function StudyItemDebugPage() {
  const { studyItemId } = useParams<{ studyItemId: string }>();
  const navigate = useNavigate();
  const settings = useLiveQuery(() => readSettings(), []);

  // useLiveQuery itself returns undefined while loading — the querier
  // below never does, so `info?.found === false` is unambiguously "loaded,
  // but no such study item" rather than "still loading" (same "always
  // return a defined sentinel" convention KanjiDetailPage uses).
  const info = useLiveQuery(async () => {
    if (!studyItemId) return { found: false as const };
    const result = await getStudyItemDebugInfo(studyItemId);
    if (!result) return { found: false as const };
    return { found: true as const, ...result };
  }, [studyItemId]);

  return (
    <div className="stack">
      <section className="panel stack">
        <button type="button" onClick={() => navigate(-1)}>
          Back
        </button>
        {info === undefined ? (
          <p className="muted">Loading…</p>
        ) : !info.found ? (
          <p className="muted">Study item not found.</p>
        ) : (
          <>
            <SubjectSummary subject={info.subject} />

            <h3 style={{ margin: 0 }}>Scheduling state</h3>
            <div className="stack" style={{ gap: '0.25rem' }}>
              <Field label="Activity type" value={info.studyItem.activityType} />
              <Field label="State" value={info.studyItem.fsrsState.state} />
              <Field
                label="Due"
                value={new Date(info.studyItem.fsrsState.due).toLocaleString()}
              />
              <Field label="Stability" value={info.studyItem.fsrsState.stability.toFixed(2)} />
              <Field label="Difficulty" value={info.studyItem.fsrsState.difficulty.toFixed(2)} />
              <Field
                label="Scheduled interval (days)"
                value={info.studyItem.fsrsState.scheduledDays}
              />
              <Field
                label="Elapsed since last review (days)"
                value={info.studyItem.fsrsState.elapsedDays}
              />
              <Field label="Reps" value={info.studyItem.fsrsState.reps} />
              <Field label="Lapses" value={info.studyItem.fsrsState.lapses} />
              <Field
                label="Last review"
                value={
                  info.studyItem.fsrsState.lastReview
                    ? new Date(info.studyItem.fsrsState.lastReview).toLocaleString()
                    : '(never)'
                }
              />
              {settings ? (
                <Field
                  label="Graduated"
                  value={
                    isGraduated(info.studyItem.fsrsState, settings.graduationMinScheduledDays)
                      ? `Yes — won't come up for review again unless you lower the threshold`
                      : 'No'
                  }
                />
              ) : null}
            </div>

            {info.subject.kind === 'vocabularyItem' ? (
              <>
                <h3 style={{ margin: 0 }}>Maturity</h3>
                <div className="stack" style={{ gap: '0.25rem' }}>
                  <Field label="Level" value={MATURITY_LABELS[info.subject.maturity.level]} />
                  <Field
                    label="Distinct sentences"
                    value={info.subject.maturity.diversity.distinctSentenceCount}
                  />
                  <Field
                    label="Distinct sources"
                    value={info.subject.maturity.diversity.distinctSourceCount}
                  />
                </div>
              </>
            ) : null}

            <h3 style={{ margin: 0 }}>Review history ({info.reviews.length})</h3>
            {info.reviews.length === 0 ? (
              <p className="muted">No reviews recorded yet.</p>
            ) : (
              info.reviews.map((review) => {
                const contextSentence = review.contextSentenceId
                  ? info.contextSentencesById.get(review.contextSentenceId)
                  : undefined;
                return (
                  <div key={review.id} className="list-card">
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <strong>{review.rating}</strong>
                      <span className="muted">
                        {new Date(review.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <div className="muted">
                      Source: {review.source ?? 'scheduled_review'}
                    </div>
                    {review.assistance && review.assistance.length > 0 ? (
                      <div className="muted">
                        Assistance: {review.assistance.join(', ')}
                      </div>
                    ) : null}
                    {review.responseRaw !== undefined ? (
                      <div className="muted">
                        Typed: {review.responseRaw || '(empty)'}
                        {review.expectedAnswer ? ` (expected: ${review.expectedAnswer})` : ''}
                      </div>
                    ) : null}
                    {review.errorClassification ? (
                      <div className="muted">
                        Error: {JSON.stringify(review.errorClassification)}
                      </div>
                    ) : null}
                    {contextSentence ? (
                      <div className="jp">From: {contextSentence.japanese}</div>
                    ) : null}
                  </div>
                );
              })
            )}
          </>
        )}
      </section>
    </div>
  );
}

function SubjectSummary({ subject }: { subject: StudyItemDebugSubject }) {
  if (subject.kind === 'sentence') {
    return <div className="jp jp-lg">{subject.sentence.japanese}</div>;
  }
  if (subject.kind === 'vocabularyItem') {
    return (
      <>
        <div className="jp jp-lg">{subject.vocabularyItem.expression}</div>
        {subject.vocabularyItem.reading ? (
          <div className="muted">{subject.vocabularyItem.reading}</div>
        ) : null}
        {subject.vocabularyItem.meaning ? <div>{subject.vocabularyItem.meaning}</div> : null}
      </>
    );
  }
  if (subject.kind === 'vocabularyConfusion') {
    return (
      <div className="jp jp-lg">
        {subject.itemA.expression} vs {subject.itemB.expression}
      </div>
    );
  }
  if (subject.kind === 'sentenceVocabulary') {
    return (
      <>
        <div className="jp jp-lg">{subject.sentence.japanese}</div>
        <div className="muted">
          {subject.vocabularyItem.expression}
          {subject.surfaceForm && subject.surfaceForm !== subject.vocabularyItem.expression
            ? ` → ${subject.surfaceForm}`
            : null}
          {subject.vocabularyItem.meaning ? ` · ${subject.vocabularyItem.meaning}` : null}
        </div>
      </>
    );
  }
  return <p className="muted">Subject not found (may have been deleted).</p>;
}

function Field({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <span className="muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}
