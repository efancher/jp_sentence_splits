import { useMemo, useState } from 'react';

import type { SentenceLearningEvent } from '../domain/types';
import type { EpisodeFocusTarget } from '../lib/episodeFocus';
import { locateTargetSpan, maskSpan, pickCompareUses, summariseTargetActivity, findDueTransferRecheck, pickHeldBackContext, type CompareExcerpt, type CompareSentence } from '../lib/sentenceLearning';
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
  const [gap, setGap] = useState<'closed' | 'asking' | 'revealed' | 'recorded'>('closed');
  const [gapAnswer, setGapAnswer] = useState('');
  const [practice, setPractice] = useState<'closed' | 'asking' | 'revealed' | 'recorded'>('closed');
  const [pair, setPair] = useState<ReturnType<typeof pickCompareUses>>();
  const [reported, setReported] = useState<'another_answer_works' | 'poor_question'>();
  const [answerDraft, setAnswerDraft] = useState('');
  const [transfer, setTransfer] = useState<'closed' | 'writing' | 'checking' | 'recorded'>('closed');
  const [transferText, setTransferText] = useState('');
  const [transferChecks, setTransferChecks] = useState({ usesTarget: false, newMeaning: false, sounds: false });
  const [transferModel, setTransferModel] = useState<ReturnType<typeof pickCompareUses>>();
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
  const dueRecheck = useMemo(() => findDueTransferRecheck(events, target.id, new Date()), [events, target.id]);
  const [rechecking, setRechecking] = useState(false);
  const [heldBack, setHeldBack] = useState<'closed' | 'asking' | 'revealed' | 'recorded'>('closed');
  const [heldBackAnswer, setHeldBackAnswer] = useState('');
  const heldBackContext = useMemo(
    () => pickHeldBackContext(compareTarget, episodeSentences, sentenceId, events),
    [compareTarget, episodeSentences, sentenceId, events],
  );
  const [heldBackShown, setHeldBackShown] = useState<CompareExcerpt>();
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

  const currentSentence = episodeSentences.find((item) => item.id === sentenceId);
  const gapSpan = currentSentence ? locateTargetSpan(compareTarget, currentSentence) : undefined;

  function recordGap(outcome: 'got_it' | 'needed_help') {
    onEvent({
      id: createId('sl_event'),
      visitId,
      action: 'target_practice',
      sentenceId,
      target: targetRef,
      support: 'target_masked',
      outcome,
      assessmentSource: 'self',
      quietMode,
    });
    setGap('recorded');
    setGapAnswer('');
  }

  function startHeldBack() {
    setHeldBackShown(heldBackContext);
    setHeldBackAnswer('');
    setHeldBack(heldBackContext ? 'asking' : 'closed');
  }

  function recordHeldBack(outcome: 'got_it' | 'needed_help') {
    if (!heldBackShown) return;
    onEvent({
      id: createId('sl_event'),
      visitId,
      action: 'held_back_check',
      sentenceId,
      target: targetRef,
      support: 'target_masked',
      outcome,
      assessmentSource: 'self',
      modality: 'typed',
      exposedSentenceId: heldBackShown.sentenceId,
      ...(heldBackAnswer.trim() ? { learnerAnswer: heldBackAnswer.trim().slice(0, 300) } : {}),
      quietMode,
    });
    setHeldBack('recorded');
  }

  function startTransfer() {
    setTransferText('');
    setTransferChecks({ usesTarget: false, newMeaning: false, sounds: false });
    setTransferModel(undefined);
    setRechecking(dueRecheck !== undefined);
    setTransfer('writing');
  }

  // The model is another real occurrence, shown only after the attempt so it can't be copied;
  // it is not counted as a Compare-uses exposure.
  function checkTransfer() {
    const exposed = new Set([...activity.comparedSentenceIds, ...seenNow]);
    setTransferModel(pickCompareUses(compareTarget, episodeSentences, sentenceId, exposed));
    setTransfer('checking');
  }

  function recordTransfer() {
    const ticked = [transferChecks.usesTarget, transferChecks.newMeaning, transferChecks.sounds].filter(Boolean).length;
    onEvent({
      id: createId('sl_event'),
      visitId,
      action: rechecking ? 'transfer_recheck' : 'transfer_attempt',
      sentenceId,
      target: targetRef,
      // Success needs both: the target really used, and for a meaning other than this sentence's.
      outcome: transferChecks.usesTarget && transferChecks.newMeaning ? 'got_it' : 'needed_help',
      assessmentSource: 'self',
      modality: 'typed',
      scaffold: 'none',
      unitsExpressed: ticked,
      unitsTotal: 3,
      ...(transferText.trim() ? { learnerAnswer: transferText.trim().slice(0, 300) } : {}),
      ...(transferModel ? { exposedSentenceId: transferModel.other.sentenceId } : {}),
      quietMode,
    });
    setTransfer('recorded');
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
        {activity.practised > 0 || activity.comparedSentenceIds.size > 0 || activity.transferAttempts > 0 ? (
          <span className="muted">
            {activity.practised > 0 ? ` · practised ${activity.practised}× (${activity.gotIt} got it${activity.independent > 0 ? `, ${activity.independent} with the word hidden` : ''})` : ''}
            {activity.heldBackChecks > 0 ? ` · new sentences ${activity.heldBackGotIt}/${activity.heldBackChecks}` : ''}
            {activity.recheckAttempts > 0 ? ` · re-checked ${activity.recheckAttempts}× (${activity.recheckSucceeded} ok)` : ''}
            {activity.transferAttempts > 0 ? ` · own sentence ${activity.transferAttempts}× (${activity.transferSucceeded} new meaning)` : ''}
            {activity.comparedSentenceIds.size > 0 ? ` · compared with ${activity.comparedSentenceIds.size} other ${activity.comparedSentenceIds.size === 1 ? 'use' : 'uses'}` : ''}
          </span>
        ) : null}
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: '0.35rem' }}>
        <button type="button" onClick={() => setPractice(practice === 'closed' || practice === 'recorded' ? 'asking' : 'closed')}>
          Practise this
        </button>
        {gapSpan ? (
          <button type="button" onClick={() => setGap(gap === 'closed' || gap === 'recorded' ? 'asking' : 'closed')}>
            Fill the gap
          </button>
        ) : null}
        {heldBackContext || heldBack !== 'closed' ? (
          <button type="button" onClick={() => (heldBack === 'closed' || heldBack === 'recorded' ? startHeldBack() : setHeldBack('closed'))}>
            Try a sentence you haven't seen
          </button>
        ) : null}
        <button type="button" onClick={() => (transfer === 'closed' || transfer === 'recorded' ? startTransfer() : setTransfer('closed'))}>
          {dueRecheck ? 'Re-check: use it again from memory' : 'Use it in your own sentence'}
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
      {gap === 'asking' || gap === 'revealed' ? (
        <div className="stack" style={{ gap: '0.25rem' }} aria-label={`Fill the gap for ${target.label}`} aria-live="polite">
          <div className="jp jp-lg">{currentSentence && gapSpan ? maskSpan(currentSentence.japanese, gapSpan) : ''}</div>
          {compareAids?.get(sentenceId)?.translation ? <div className="muted">{compareAids.get(sentenceId)!.translation}</div> : null}
          {gap === 'asking' ? (
            <>
              <div>
                What fits the gap?
                {quietMode ? ' Type it or think it through — no speaking needed.' : ' Say it aloud, or type it.'}
              </div>
              <input type="text" lang="ja" aria-label="Your answer for the gap" value={gapAnswer} onChange={(event) => setGapAnswer(event.target.value)} />
              <button type="button" onClick={() => setGap('revealed')}>Show the answer</button>
            </>
          ) : (
            <>
              <div>
                Answer: <span className="jp"><mark>{currentSentence && gapSpan ? currentSentence.japanese.slice(gapSpan.start, gapSpan.end) : target.label}</mark></span>
                {gapAnswer.trim() ? <span className="muted"> · you wrote <span className="jp">{gapAnswer.trim()}</span></span> : null}
              </div>
              <div className="muted">Judge yourself honestly: only count it if you had it before looking.</div>
              <div className="row" style={{ gap: '0.35rem' }}>
                <button type="button" onClick={() => recordGap('got_it')}>I had it before looking</button>
                <button type="button" onClick={() => recordGap('needed_help')}>I needed to see it</button>
              </div>
            </>
          )}
        </div>
      ) : null}
      {heldBack === 'asking' || heldBack === 'revealed' ? (
        <div className="stack" style={{ gap: '0.25rem' }} aria-label={`Try ${target.label} in a sentence you haven't seen`} aria-live="polite">
          <div className="jp jp-lg">{heldBackShown?.span ? maskSpan(heldBackShown.japanese, heldBackShown.span) : ''}</div>
          {heldBack === 'asking' ? (
            <>
              <div>A different sentence from this episode. What fits the gap? Type it or think it through.</div>
              <input type="text" lang="ja" aria-label="Your answer for the gap" value={heldBackAnswer} onChange={(event) => setHeldBackAnswer(event.target.value)} />
              <button type="button" onClick={() => setHeldBack('revealed')}>Show the answer</button>
            </>
          ) : (
            <>
              <div>
                Answer: <span className="jp"><mark>{heldBackShown?.span ? heldBackShown.japanese.slice(heldBackShown.span.start, heldBackShown.span.end) : target.label}</mark></span>
                {heldBackAnswer.trim() ? <span className="muted"> · you wrote <span className="jp">{heldBackAnswer.trim()}</span></span> : null}
              </div>
              {heldBackShown && compareAids?.get(heldBackShown.sentenceId)?.translation ? <div className="muted">{compareAids.get(heldBackShown.sentenceId)!.translation}</div> : null}
              <div className="muted">Judge yourself honestly: only count it if you had it before looking.</div>
              <div className="row" style={{ gap: '0.35rem' }}>
                <button type="button" onClick={() => recordHeldBack('got_it')}>I had it before looking</button>
                <button type="button" onClick={() => recordHeldBack('needed_help')}>I needed to see it</button>
              </div>
            </>
          )}
        </div>
      ) : null}
      {heldBack === 'recorded' ? (
        <div className="muted" role="status">Noted as a check on a sentence you hadn't seen (separate from same-sentence practice). Your review schedule is unchanged.</div>
      ) : null}
      {transfer === 'writing' || transfer === 'checking' ? (
        <div className="stack" style={{ gap: '0.25rem' }} aria-label={`Use ${target.label} in your own sentence`} aria-live="polite">
          {rechecking && dueRecheck ? (
            <div>
              {dueRecheck.daysAgo} {dueRecheck.daysAgo === 1 ? 'day' : 'days'} ago you wrote:{' '}
              <span className="jp">{dueRecheck.answer}</span>. Without looking back, write a different one now.
            </div>
          ) : null}
          <div>
            Make up a new sentence that uses <span className="jp">{target.label}</span> for a <strong>different</strong> meaning from
            this one. Typing is enough — no audio or speaking needed.
          </div>
          <textarea lang="ja" aria-label="Your own sentence" rows={2} value={transferText} disabled={transfer === 'checking'} onChange={(event) => setTransferText(event.target.value)} />
          {transfer === 'writing' ? (
            <button type="button" onClick={checkTransfer}>Check it</button>
          ) : (
            <>
              {transferModel ? (
                <div className="stack" style={{ gap: '0.15rem' }}>
                  <span className="muted">Another real use in this episode, for comparison:</span>
                  <Highlighted excerpt={transferModel.other} />
                </div>
              ) : null}
              <div className="muted">Judge it yourself — tick only what is true:</div>
              {([
                ['usesTarget', `It really uses ${target.label}`],
                ['newMeaning', 'It says something different from the lesson sentence'],
                ['sounds', 'It sounds natural as far as I can tell'],
              ] as const).map(([key, label]) => (
                <label key={key} className="row" style={{ gap: '0.4rem' }}>
                  <input type="checkbox" checked={transferChecks[key]} onChange={(event) => setTransferChecks({ ...transferChecks, [key]: event.target.checked })} />
                  {label}
                </label>
              ))}
              <button type="button" onClick={recordTransfer}>Record this</button>
            </>
          )}
        </div>
      ) : null}
      {transfer === 'recorded' ? (
        <div className="muted" role="status">{rechecking ? 'Noted as a delayed re-check (separate from same-day practice).' : 'Noted as transfer practice (separate from saying the original meaning).'} Your review schedule is unchanged.</div>
      ) : null}
      {gap === 'recorded' ? (
        <div className="muted" role="status">Noted as gap practice. Your review schedule is unchanged.</div>
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
