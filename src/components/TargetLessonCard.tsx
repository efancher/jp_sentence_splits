import { useMemo, useState } from 'react';

import type { SentenceLearningEvent } from '../domain/types';
import type { EpisodeFocusTarget } from '../lib/episodeFocus';
import { pickCompareUses, summariseTargetActivity, type CompareExcerpt, type CompareSentence } from '../lib/sentenceLearning';
import { createId } from '../lib/ids';
import type { SentenceAudio } from '../domain/types';
import { NativeAudioButton } from './NativeAudioButton';

/** Optional per-sentence aids for an excerpt; missing pieces are simply not shown. */
export interface CompareAids {
  translation?: string;
  words: { expression: string; reading: string; english: string }[];
  audio?: SentenceAudio;
}

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

export function WordGlossList({ words }: { words: CompareAids['words'] }) {
  if (words.length === 0) return null;
  return (
    <ul className="muted" aria-label="Words in this sentence" style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.85em' }}>
      {words.map((word) => (
        <li key={word.expression}>
          <span className="jp">{word.expression}</span>
          {word.reading && word.reading !== word.expression ? <span className="jp"> ({word.reading})</span> : null} — {word.english}
        </li>
      ))}
    </ul>
  );
}

function ExcerptWithAids({ excerpt, aids }: { excerpt: CompareExcerpt; aids?: CompareAids }) {
  const [showTranslation, setShowTranslation] = useState(false);
  return (
    <div className="stack" style={{ gap: '0.2rem' }}>
      <Highlighted excerpt={excerpt} />
      {aids ? <WordGlossList words={aids.words} /> : null}
      <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {aids?.audio ? <NativeAudioButton audio={aids.audio} displayLabel="Native audio" hideAdjust /> : null}
        {aids?.translation ? (
          showTranslation ? (
            <span className="muted">{aids.translation}</span>
          ) : (
            <button type="button" onClick={() => setShowTranslation(true)}>Show translation</button>
          )
        ) : null}
      </div>
    </div>
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
  compareAids,
  events,
  quietMode,
  onEvent,
}: {
  target: EpisodeFocusTarget;
  sentenceId: string;
  visitId: string;
  episodeSentences: CompareSentence[];
  compareAids?: ReadonlyMap<string, CompareAids>;
  events: SentenceLearningEvent[];
  quietMode: boolean;
  onEvent: (event: LessonEventInput) => void;
}) {
  const [practice, setPractice] = useState<'closed' | 'asking' | 'revealed' | 'recorded'>('closed');
  const [pair, setPair] = useState<ReturnType<typeof pickCompareUses>>();
  const [reported, setReported] = useState<'another_answer_works' | 'poor_question'>();
  const [answerDraft, setAnswerDraft] = useState('');
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

  function report(kind: 'another_answer_works' | 'poor_question') {
    onEvent({
      id: createId('sl_event'),
      visitId,
      action: 'content_report',
      sentenceId,
      target: targetRef,
      report: kind,
      ...(kind === 'another_answer_works' && answerDraft.trim() ? { learnerAnswer: answerDraft.trim().slice(0, 300) } : {}),
      assessmentSource: 'self',
      quietMode,
    });
    setReported(kind);
  }

  return (
    <li className="stack" style={{ gap: '0.25rem' }}>
      <div>
        <strong className="jp">{target.label}</strong>
        {activity.practised > 0 || activity.comparedSentenceIds.size > 0 ? (
          <span className="muted">
            {activity.practised > 0 ? ` · practised ${activity.practised}× (${activity.gotIt} got it)` : ''}
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
              {reported ? (
                <div className="muted" role="status">
                  Thanks — flagged for repair ({reported === 'poor_question' ? 'poor question' : 'another answer works'}). It is not counted against you.
                </div>
              ) : (
                <div className="stack" style={{ gap: '0.2rem' }}>
                  <label className="stack" style={{ gap: '0.1rem' }}>
                    <span className="muted">Your own answer, if it differs (optional)</span>
                    <input type="text" value={answerDraft} maxLength={300} onChange={(event) => setAnswerDraft(event.target.value)} />
                  </label>
                  <div className="row" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => report('another_answer_works')}>Another answer works</button>
                    <button type="button" onClick={() => report('poor_question')}>Poor question</button>
                  </div>
                </div>
              )}
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
          <ExcerptWithAids excerpt={pair.current} aids={compareAids?.get(pair.current.sentenceId)} />
          <div className="muted">Another use (sentence {pair.other.position} of this episode):</div>
          <ExcerptWithAids excerpt={pair.other} aids={compareAids?.get(pair.other.sentenceId)} />
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
