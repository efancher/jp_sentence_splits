import { useMemo, useState } from 'react';

import type { GlossDecision } from '../domain/types';
import {
  LEVEL_NAMES,
  buildDecisions,
  gradeResponse,
  hintLadder,
  inferSkillState,
  outcomeFor,
  translationLevelFor,
  type Blocker,
  type GlossChunk,
  type GlossDecisionSpec,
  type SkillState,
  type SupportLevel,
} from '../lib/glossSkill';

import type { CompareAids } from './CompareExcerptView';
import { WordGlossList } from './CompareExcerptView';

export type GlossDecisionInput = Omit<GlossDecision, 'id' | 'timestamp' | 'bookId'>;

const MAX_DECISIONS_PER_SENTENCE = 3;

const HELP: { blocker: Blocker; label: string }[] = [
  { blocker: 'word', label: 'A word' },
  { blocker: 'form', label: 'A verb/adjective form' },
  { blocker: 'structure', label: 'How the pieces connect' },
  { blocker: 'unsure', label: 'Not sure' },
];

/** Decisions this sentence offers, each with the learner's support level for its skill frozen at open. */
export function planGlossDecisions(chunks: GlossChunk[], records: GlossDecision[], now: Date = new Date()) {
  const specs = buildDecisions(chunks);
  const ordered = [
    ...specs.filter((s) => s.skill === 'predicate'),
    ...specs.filter((s) => s.skill === 'particle' && s.confidence === 'settled'),
    ...specs.filter((s) => s.skill === 'particle' && s.confidence !== 'settled'),
  ].slice(0, MAX_DECISIONS_PER_SENTENCE);
  const states: Record<string, SkillState> = {
    predicate: inferSkillState(records, 'predicate', now),
    particle: inferSkillState(records, 'particle', now),
  };
  return ordered.map((spec) => {
    const state = states[spec.skill]!;
    const level: SupportLevel = state.needsIntro ? 1 : state.level;
    return { spec, state, level };
  });
}

interface Attempt {
  first?: string;
  firstCorrect: boolean | null;
  hintStep: 0 | 1 | 2 | 3;
  explanationOpened: boolean;
  blocker?: Blocker;
  vocabHelped: boolean;
  resolved: boolean;
  wrongTries: string[];
  finished?: GlossDecision['outcome'];
}

const freshAttempt = (): Attempt => ({ firstCorrect: null, hintStep: 0, explanationOpened: false, vocabHelped: false, resolved: false, wrongTries: [] });

export function GlossDecisionPanel({
  sentenceId,
  visitId,
  chunks,
  records,
  translation,
  words,
  onRecord,
  onFinish,
}: {
  sentenceId: string;
  visitId: string;
  chunks: GlossChunk[];
  records: GlossDecision[];
  translation?: string;
  words: CompareAids['words'];
  onRecord: (decision: GlossDecisionInput) => void;
  onFinish: () => void;
}) {
  const [plan] = useState(() => planGlossDecisions(chunks, records));
  const [index, setIndex] = useState(0);
  const current = plan[index];

  if (!current) {
    return (
      <div className="stack" style={{ gap: '0.35rem' }}>
        <div>Nothing in this sentence to check yet — the walkthrough covers it.</div>
        <button type="button" className="primary" onClick={onFinish}>Continue to the walkthrough</button>
      </div>
    );
  }
  return (
    <DecisionCard
      key={current.spec.chunkId + current.spec.ruleKey}
      sentenceId={sentenceId}
      visitId={visitId}
      spec={current.spec}
      level={current.level}
      state={current.state}
      chunks={chunks}
      translation={translation}
      words={words}
      position={`${index + 1} of ${plan.length}`}
      isLast={index === plan.length - 1}
      onRecord={onRecord}
      onNext={() => (index === plan.length - 1 ? onFinish() : setIndex(index + 1))}
    />
  );
}

function DecisionCard({
  sentenceId, visitId, spec, level, state, chunks, translation, words, position, isLast, onRecord, onNext,
}: {
  sentenceId: string;
  visitId: string;
  spec: GlossDecisionSpec;
  level: SupportLevel;
  state: SkillState;
  chunks: GlossChunk[];
  translation?: string;
  words: CompareAids['words'];
  position: string;
  isLast: boolean;
  onRecord: (decision: GlossDecisionInput) => void;
  onNext: () => void;
}) {
  const [attempt, setAttempt] = useState<Attempt>(freshAttempt);
  const [glossesOpen, setGlossesOpen] = useState(false);
  const ladder = useMemo(() => hintLadder(spec, attempt.blocker), [spec, attempt.blocker]);
  const isWorkedExample = level === 1;
  const translationLevel = translationLevelFor(level);
  const showGlosses = translationLevel >= 1 || glossesOpen;
  const showTranslation = translationLevel === 3 && !!translation?.trim();
  const referenceLabel = spec.options.find((o) => o.id === spec.referenceValue)?.label ?? spec.referenceValue;
  const narrowed = level === 2 ? ladder[1]!.keepOptions : attempt.hintStep >= 2 ? ladder[1]!.keepOptions : undefined;
  const visibleOptions = narrowed ? spec.options.filter((o) => narrowed.includes(o.id)) : spec.options;
  const question = spec.skill === 'predicate'
    ? 'Which chunk is the main predicate — the one that closes the sentence?'
    : `What is ${spec.targetText} to the rest of the sentence?`;
  const done = attempt.finished !== undefined;

  function finish(next: Attempt, outcome: GlossDecision['outcome'], responseOverride?: string) {
    const record: GlossDecisionInput = {
      visitId, sentenceId, skill: spec.skill, subskill: spec.subskill, ruleKey: spec.ruleKey, targetText: spec.targetText,
      levelShown: level, firstResponse: responseOverride ?? next.first, firstCorrect: next.firstCorrect,
      referenceValue: spec.referenceValue, referenceConfidence: spec.confidence, hintMaxStep: next.hintStep,
      explanationOpened: next.explanationOpened, blocker: next.blocker, vocabHelped: next.vocabHelped,
      translationLevel, outcome,
    };
    onRecord(record);
    setAttempt({ ...next, finished: outcome });
  }

  function choose(optionId: string) {
    if (done) return;
    if (attempt.first === undefined) {
      const graded = gradeResponse(spec, optionId);
      const next = { ...attempt, first: optionId, firstCorrect: graded };
      if (graded === null) return finish({ ...next, resolved: true }, 'ungraded');
      if (graded) return finish({ ...next, resolved: true }, outcomeFor({ graded, hintMaxStep: next.hintStep, resolved: true }));
      setAttempt({ ...next, wrongTries: [optionId] });
      return;
    }
    if (optionId === spec.referenceValue) {
      finish({ ...attempt, resolved: true }, outcomeFor({ graded: attempt.firstCorrect, hintMaxStep: attempt.hintStep, resolved: true }));
    } else {
      setAttempt({ ...attempt, wrongTries: [...attempt.wrongTries, optionId] });
    }
  }

  function help(blocker: Blocker) {
    if (done) return;
    const hintStep = Math.min(3, attempt.hintStep + 1) as 1 | 2 | 3;
    setAttempt({
      ...attempt,
      blocker: attempt.blocker ?? blocker,
      hintStep,
      explanationOpened: attempt.explanationOpened || blocker === 'form',
      vocabHelped: attempt.vocabHelped || blocker === 'word',
    });
    if (blocker === 'word') setGlossesOpen(true);
  }

  const lastHint = attempt.hintStep > 0 ? ladder[attempt.hintStep - 1] : undefined;
  const revealed = attempt.hintStep >= 3;
  const stuck = revealed && !done;

  return (
    <div className="stack gloss-decision" style={{ gap: '0.4rem' }} aria-label="Structure check" aria-live="polite">
      <div className="muted" style={{ fontSize: '0.85rem' }}>
        Check {position} · {spec.skill === 'predicate' ? 'Main predicate' : 'Particle roles'}:{' '}
        <strong>{isWorkedExample ? 'Worked example' : LEVEL_NAMES[level]}</strong> — {state.reason}
      </div>
      <div className="row jp jp-lg" style={{ flexWrap: 'wrap', gap: '0.4rem' }} aria-label="Sentence chunks">
        {chunks.map((chunk) => (
          <span key={chunk.id} style={chunk.id === spec.chunkId ? { fontWeight: 700, borderBottom: '2px solid currentColor' } : undefined}>
            {chunk.japanese}
          </span>
        ))}
      </div>
      {showTranslation ? <div>{translation}</div> : null}
      {showGlosses && words.length > 0 ? <WordGlossList words={words} /> : null}
      {!showGlosses && words.length > 0 ? (
        <button type="button" onClick={() => { setGlossesOpen(true); setAttempt({ ...attempt, vocabHelped: true }); }}>Show word glosses</button>
      ) : null}
      <div>{question}</div>

      {isWorkedExample ? (
        <div className="stack" style={{ gap: '0.3rem' }}>
          <div>
            <strong>{spec.skill === 'predicate' ? spec.targetText : referenceLabel}</strong>
            {spec.skill === 'predicate'
              ? ' — Japanese closes on its verb, adjective or です/だ, so start there and hang everything else off it.'
              : ` — ${spec.targetText} is marked by ${spec.particle}: ${referenceLabel}.`}
          </div>
          <button type="button" className="primary" disabled={done} onClick={() => { finish({ ...attempt, resolved: true }, 'ungraded'); }}>
            Got it
          </button>
        </div>
      ) : (
        <div className="stack" style={{ gap: '0.3rem' }}>
          <div className="row" style={{ flexWrap: 'wrap', gap: '0.35rem' }} role="group" aria-label="Answer choices">
            {visibleOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={done || attempt.wrongTries.includes(option.id) || (stuck && option.id !== spec.referenceValue)}
                className={done && option.id === spec.referenceValue ? 'primary' : undefined}
                onClick={() => choose(option.id)}
              >
                <span className={spec.skill === 'predicate' ? 'jp' : undefined}>{option.label}</span>
              </button>
            ))}
          </div>
          {attempt.wrongTries.length > 0 && !done ? (
            <div role="status">Not quite — try again, or ask for help below. Nothing is lost.</div>
          ) : null}
          {lastHint ? <div className="muted" role="status">{lastHint.text}</div> : null}
          {!done ? (
            <div className="stack" style={{ gap: '0.25rem' }}>
              <span className="muted">What would help?</span>
              <div className="row" style={{ flexWrap: 'wrap', gap: '0.35rem' }} role="group" aria-label="Help">
                {HELP.map(({ blocker, label }) => (
                  <button key={blocker} type="button" disabled={revealed} onClick={() => help(blocker)}>{label}</button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {done && !isWorkedExample ? <DecisionFeedback attempt={attempt} spec={spec} referenceLabel={referenceLabel} /> : null}
      <div className="row" style={{ flexWrap: 'wrap', gap: '0.35rem' }}>
        {done ? (
          <button type="button" className="primary" onClick={onNext}>{isLast ? 'Continue to the walkthrough' : 'Next check'}</button>
        ) : (
          <>
            {stuck ? (
              <button type="button" onClick={() => finish({ ...attempt, resolved: false }, 'unresolved')}>I&rsquo;ll come back to this</button>
            ) : null}
            {!isWorkedExample && spec.confidence === 'settled' ? (
              <button type="button" onClick={() => finish({ ...attempt, resolved: true }, 'disputed', attempt.first)}>
                I think another answer works
              </button>
            ) : null}
            <button type="button" onClick={() => finish({ ...attempt, resolved: false }, 'skipped')}>Skip</button>
          </>
        )}
      </div>
    </div>
  );
}

function DecisionFeedback({ attempt, spec, referenceLabel }: { attempt: Attempt; spec: GlossDecisionSpec; referenceLabel: string }) {
  const outcome = attempt.finished;
  if (outcome === 'ungraded') {
    return (
      <div role="status">
        {spec.confidence === 'alternative'
          ? `Usually: ${referenceLabel}. With ${spec.particle} the best reading depends on the verb, so this isn't scored.`
          : `The usual reference: ${spec.skill === 'predicate' ? spec.targetText : referenceLabel}. Not scored here.`}
      </div>
    );
  }
  if (outcome === 'independent_correct') return <div role="status">Right, with no help.</div>;
  if (outcome === 'assisted_correct') return <div role="status">Right, with help — support stays where it is until you manage it unaided.</div>;
  if (outcome === 'disputed') return <div role="status">Noted. This won&rsquo;t count for or against you, and it flags the rule for review.</div>;
  if (outcome === 'unresolved') return <div role="status">Parked. The answer was: {spec.skill === 'predicate' ? spec.targetText : referenceLabel}. The walkthrough covers it next.</div>;
  return <div role="status">Skipped.</div>;
}
