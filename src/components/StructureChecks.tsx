import { useState } from 'react';

import {
  gradeDescribes,
  ROLE_QUESTION,
  type DescribesCheck,
  type RolesCheck,
  type StructureChecks as StructureCheckSet,
} from '../lib/structureChecks';

import type { GlossDecisionInput } from './GlossDecisionPanel';

type Base = Pick<GlossDecisionInput, 'visitId' | 'sentenceId'>;

const chunkStyle = { fontSize: '1.15rem', borderStyle: 'solid', borderWidth: 2 } as const;

const RULE_PARTICLE = { doer: 'が', receiver: 'を', place: 'で', start: 'から', end: 'まで' } as const;

function RolesCard({ check, base, onRecord, onNext }: { check: RolesCheck; base: Base; onRecord: (d: GlossDecisionInput) => void; onNext: () => void }) {
  const [wrongTaps, setWrongTaps] = useState<string[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [solved, setSolved] = useState(false);
  const textOf = (id: string) => check.chunks.find((c) => c.id === id)?.japanese ?? '';

  function tap(id: string) {
    if (solved || id === check.predicateId) return;
    if (id === check.answerId) {
      setSolved(true);
      setFlash(null);
      onRecord({
        ...base,
        skill: 'particle',
        subskill: 'case',
        ruleKey: `particle:${RULE_PARTICLE[check.role]}:tap`,
        targetText: textOf(check.answerId),
        levelShown: 4,
        firstResponse: textOf(wrongTaps[0] ?? id),
        firstCorrect: wrongTaps.length === 0,
        referenceValue: textOf(check.answerId),
        referenceConfidence: 'settled',
        hintMaxStep: 0,
        explanationOpened: false,
        vocabHelped: false,
        translationLevel: 0,
        outcome: wrongTaps.length === 0 ? 'independent_correct' : 'assisted_correct',
      });
      return;
    }
    setWrongTaps((current) => [...current, id]);
    setFlash(id);
  }

  return (
    <div className="stack" style={{ gap: '0.5rem' }} aria-label="Who does what">
      <div>
        <strong>{ROLE_QUESTION[check.role]}</strong> <span className="muted">Read the little word after each chunk.</span>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {check.chunks.map((chunk) => {
          const isPredicate = chunk.id === check.predicateId;
          const right = solved && chunk.id === check.answerId;
          const flashed = flash === chunk.id;
          return (
            <button
              key={chunk.id}
              type="button"
              className="ghost"
              disabled={isPredicate || solved}
              onClick={() => tap(chunk.id)}
              aria-label={flashed ? `${chunk.japanese}, not that one` : chunk.japanese}
              style={{
                ...chunkStyle,
                borderColor: right ? 'var(--success)' : flashed ? 'var(--danger)' : undefined,
                color: right ? 'var(--success)' : flashed ? 'var(--danger)' : undefined,
                opacity: isPredicate || (solved && !right) ? 0.5 : 1,
              }}
            >
              <span className="jp">{chunk.japanese}</span>
            </button>
          );
        })}
      </div>
      {solved ? (
        <div className="stack" style={{ gap: '0.3rem' }} role="status">
          <div><strong>{wrongTaps.length === 0 ? '✓ ' : ''}<span className="jp">{textOf(check.answerId)}</span> — {RULE_PARTICLE[check.role]} marks it.</strong></div>
          <div><button type="button" className="primary" onClick={onNext}>Next</button></div>
        </div>
      ) : (
        <div className="muted" role="status" style={{ fontSize: '0.85rem' }}>
          {flash ? `Not ${textOf(flash)} — check its particle.` : ' '}
        </div>
      )}
    </div>
  );
}

function DescribesCard({ check, base, onRecord, onNext }: { check: DescribesCheck; base: Base; onRecord: (d: GlossDecisionInput) => void; onNext: () => void }) {
  const [tapped, setTapped] = useState<Set<string>>(() => new Set());
  const [result, setResult] = useState<ReturnType<typeof gradeDescribes> | null>(null);
  const textOf = (id: string) => check.chunks.find((c) => c.id === id)?.japanese ?? '';
  const head = textOf(check.headId);

  function submit() {
    const graded = gradeDescribes(check, tapped);
    setResult(graded);
    onRecord({
      ...base,
      skill: 'attachment',
      subskill: 'noun_modifier',
      ruleKey: `attachment:${check.kind}:describes`,
      targetText: head,
      levelShown: 4,
      firstResponse: check.chunks.filter((c) => tapped.has(c.id)).map((c) => c.japanese).join('・'),
      firstCorrect: graded.correct,
      referenceValue: check.requiredIds.map(textOf).join('・'),
      referenceConfidence: 'settled',
      hintMaxStep: 0,
      explanationOpened: false,
      vocabHelped: false,
      translationLevel: 0,
      outcome: graded.correct ? 'independent_correct' : 'assisted_correct',
    });
  }

  return (
    <div className="stack" style={{ gap: '0.5rem' }} aria-label="What describes it">
      <div>
        <strong>Tap everything that describes <span className="jp">{head}</span>.</strong>{' '}
        <span className="muted">
          {check.kind === 'chain'
            ? '(Aの B: A tells you which B, or whose.)'
            : '(A plain verb right before a noun describes it: "the book I bought".)'}
        </span>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {check.chunks.map((chunk) => {
          const isHead = chunk.id === check.headId;
          const isOn = tapped.has(chunk.id);
          const bad = result !== null && (result.missed.includes(chunk.id) || result.wrong.includes(chunk.id));
          return (
            <button
              key={chunk.id}
              type="button"
              className="ghost"
              disabled={isHead || result !== null}
              aria-pressed={isOn}
              onClick={() => setTapped((current) => {
                const next = new Set(current);
                if (!next.delete(chunk.id)) next.add(chunk.id);
                return next;
              })}
              style={{
                ...chunkStyle,
                borderColor: bad ? 'var(--danger)' : isHead ? 'var(--accent)' : isOn ? 'var(--success)' : undefined,
                opacity: isHead ? 1 : undefined,
              }}
            >
              <span className="jp">{chunk.japanese}</span>
            </button>
          );
        })}
      </div>
      {result === null ? (
        <div><button type="button" className="primary" onClick={submit}>Check</button></div>
      ) : (
        <div className="stack" style={{ gap: '0.3rem' }} role="status">
          <div><strong>{result.correct ? '✓ That is the whole description' : 'Not quite'}</strong></div>
          {result.missed.map((id) => (
            <div key={id}>✗ <span className="jp">{textOf(id)}</span> belongs to the description of <span className="jp">{head}</span>.</div>
          ))}
          {result.wrong.map((id) => (
            <div key={id}>✗ <span className="jp">{textOf(id)}</span> is not part of that description.</div>
          ))}
          <div>Answer: <span className="jp jp-lg">{check.requiredIds.map(textOf).join(' ')} {head}</span></div>
          <div><button type="button" className="primary" onClick={onNext}>Next</button></div>
        </div>
      )}
    </div>
  );
}

/** Roles then describes, whichever the sentence supports; calls onFinish after the last one. */
export function StructureChecks({
  sentenceId,
  visitId,
  checks,
  onRecord,
  onFinish,
}: {
  sentenceId: string;
  visitId: string;
  checks: StructureCheckSet;
  onRecord: (decision: GlossDecisionInput) => void;
  onFinish: () => void;
}) {
  const [index, setIndex] = useState(0);
  const base: Base = { sentenceId, visitId };
  const order: ('roles' | 'describes')[] = [];
  if (checks.roles) order.push('roles');
  if (checks.describes) order.push('describes');
  const current = order[index];
  if (!current) return null;
  const next = () => (index + 1 >= order.length ? onFinish() : setIndex(index + 1));
  return current === 'roles'
    ? <RolesCard key="roles" check={checks.roles!} base={base} onRecord={onRecord} onNext={next} />
    : <DescribesCard key="describes" check={checks.describes!} base={base} onRecord={onRecord} onNext={next} />;
}
