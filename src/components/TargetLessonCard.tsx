import { useMemo, useState } from 'react';

import type { SentenceLearningEvent } from '../domain/types';
import type { EpisodeFocusTarget } from '../lib/episodeFocus';
import { pickCompareUses, summariseTargetActivity, type CompareExcerpt, type CompareSentence } from '../lib/sentenceLearning';
import { createId } from '../lib/ids';

export type LessonEventInput = Omit<SentenceLearningEvent, 'timestamp' | 'bookId' | 'chapterId' | 'inventoryRevision'>;

function Highlighted({ excerpt }: { excerpt: CompareExcerpt }) {
  const { japanese, span } = excerpt;
  if (!span) return <span className="jp">{japanese}</span>;
  return (
    <span className="jp">
      {japanese.slice(0, span.start)}
      <mark>{japanese.slice(span.start, span.end)}</mark>
      {japanese.slice(span.end)}
    </span>
  );
}

/**
 * Optional practice for one focus target inside the sentence walkthrough:
 * a self-checked "what does this do here?" and a look at another real
 * occurrence. Both are lesson events only — no Review, no FSRS.
 */
export function TargetLessonCard({
  target,
  sentenceId,
  visitId,
  episodeSentences,
  events,
  quietMode,
  onEvent,
}: {
  target: EpisodeFocusTarget;
  sentenceId: string;
  visitId: string;
  episodeSentences: CompareSentence[];
  events: SentenceLearningEvent[];
  quietMode: boolean;
  onEvent: (event: LessonEventInput) => void;
}) {
  const [practice, setPractice] = useState<'closed' | 'asking' | 'revealed' | 'recorded'>('closed');
  const [pair, setPair] = useState<ReturnType<typeof pickCompareUses>>();
  const [seenNow, setSeenNow] = useState<Set<string>>(() => new Set());

  const targetRef = useMemo(
    () => ({ kind: target.preparedKind ?? target.kind, key: target.id, label: target.label }),
    [target],
  );
  const activity = useMemo(() => summariseTargetActivity(events, target.id), [events, target.id]);
  const compareTarget = useMemo(
    () => ({ key: target.id, label: target.label, sentenceIds: target.sentenceIds, occurrences: target.occurrences }),
    [target],
  );
  const canCompare = useMemo(
    () => pickCompareUses(compareTarget, episodeSentences, sentenceId, new Set()) !== undefined,
    [compareTarget, episodeSentences, sentenceId],
  );

  const explanation = [target.detail, ...target.reasons].filter((line, index, all) => line && all.indexOf(line) === index);

  function showCompare() {
    const exposed = new Set([...activity.comparedSentenceIds, ...seenNow]);
    const next = pickCompareUses(compareTarget, episodeSentences, sentenceId, exposed);
    setPair(next);
    if (!next) return;
    setSeenNow((current) => new Set(current).add(next.other.sentenceId));
    onEvent({
      id: `${visitId}:compare:${target.id}:${next.other.sentenceId}`,
      visitId,
      action: 'compare_uses_viewed',
      sentenceId,
      target: targetRef,
      exposedSentenceId: next.other.sentenceId,
      quietMode,
    });
  }

  function record(outcome: 'got_it' | 'needed_help') {
    onEvent({
      id: createId('sl_event'),
      visitId,
      action: 'target_practice',
      sentenceId,
      target: targetRef,
      support: 'explanation_hidden',
      outcome,
      assessmentSource: 'self',
      quietMode,
    });
    setPractice('recorded');
  }

  return (
    <li className="stack" style={{ gap: '0.25rem' }}>
      <div>
        <strong className="jp">{target.label}</strong>
        {activity.practised > 0 || activity.comparedSentenceIds.size > 0 ? (
          <span className="muted">
            {' '}· practised {activity.practised}× ({activity.gotIt} got it)
            {activity.comparedSentenceIds.size > 0 ? ` · compared with ${activity.comparedSentenceIds.size} other ${activity.comparedSentenceIds.size === 1 ? 'use' : 'uses'}` : ''}
          </span>
        ) : null}
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: '0.35rem' }}>
        <button type="button" onClick={() => setPractice(practice === 'closed' || practice === 'recorded' ? 'asking' : 'closed')}>
          Practise this
        </button>
        {canCompare ? (
          <button type="button" aria-expanded={!!pair} onClick={() => (pair ? setPair(undefined) : showCompare())}>
            Compare uses
          </button>
        ) : (
          <span className="muted">Only one use in this episode.</span>
        )}
      </div>

      {practice === 'asking' || practice === 'revealed' ? (
        <div className="stack" style={{ gap: '0.25rem' }} aria-live="polite">
          <div>
            Before you look: what does <span className="jp">{target.label}</span> contribute in this sentence?
            {quietMode ? ' Think it through or type it in your head — no speaking needed.' : ' Think it through, or say it aloud.'}
          </div>
          {practice === 'asking' ? (
            <button type="button" onClick={() => setPractice('revealed')}>Show explanation</button>
          ) : (
            <>
              <div className="muted">{explanation.length > 0 ? explanation.join(' · ') : '(no explanation saved for this target)'}</div>
              <div className="row" style={{ gap: '0.35rem' }}>
                <button type="button" onClick={() => record('got_it')}>I had it</button>
                <button type="button" onClick={() => record('needed_help')}>I needed the explanation</button>
              </div>
            </>
          )}
        </div>
      ) : null}
      {practice === 'recorded' ? (
        <div className="muted" role="status">Noted as practice. Your review schedule is unchanged.</div>
      ) : null}

      {pair ? (
        <div className="stack" style={{ gap: '0.25rem' }} aria-label={`Compare uses of ${target.label}`}>
          <div className="muted">This sentence:</div>
          <Highlighted excerpt={pair.current} />
          <div className="muted">Another use (sentence {pair.other.position} of this episode):</div>
          <Highlighted excerpt={pair.other} />
          <div>What stays the same? What changes here?</div>
          {pair.remainingUnseen > 0 ? (
            <button type="button" onClick={showCompare}>Show another example</button>
          ) : (
            <span className="muted">No further unseen examples in this episode.</span>
          )}
        </div>
      ) : null}
    </li>
  );
}
