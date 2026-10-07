import { useState } from 'react';

import {
  gradeCutDown,
  type AttachmentCheck,
  type CutDownCheck,
  type StructureChecks as StructureCheckSet,
} from '../lib/structureChecks';

import type { GlossDecisionInput } from './GlossDecisionPanel';

type Base = Pick<GlossDecisionInput, 'visitId' | 'sentenceId'>;

const chunkStyle = { fontSize: '1.15rem', borderStyle: 'solid', borderWidth: 2 } as const;

function CutDownCard({ check, base, onRecord, onNext }: { check: CutDownCheck; base: Base; onRecord: (d: GlossDecisionInput) => void; onNext: () => void }) {
  const [kept, setKept] = useState<Set<string>>(() => new Set(check.chunks.map((c) => c.id)));
  const [result, setResult] = useState<ReturnType<typeof gradeCutDown> | null>(null);
  const textOf = (id: string) => check.chunks.find((c) => c.id === id)?.japanese ?? '';

  function submit() {
    const graded = gradeCutDown(check, kept);
    setResult(graded);
    onRecord({
      ...base,
      skill: 'predicate',
      subskill: 'predicate',
      ruleKey: 'predicate:cut-down',
      targetText: textOf(check.predicateId),
      levelShown: 4,
      firstResponse: check.chunks.filter((c) => kept.has(c.id)).map((c) => c.japanese).join('・'),
      firstCorrect: graded.correct,
      referenceValue: check.keepIds.map(textOf).join('・'),
      referenceConfidence: check.graded ? 'settled' : 'compare',
      hintMaxStep: 0,
      explanationOpened: false,
      vocabHelped: false,
      translationLevel: 0,
      outcome: graded.correct === null ? 'ungraded' : graded.correct ? 'independent_correct' : 'assisted_correct',
    });
  }

  return (
    <div className="stack" style={{ gap: '0.5rem' }} aria-label="Cut it down">
      <div>
        <strong>Cut it down.</strong> Tap the chunks you can drop and still say who or what did what (the sentence in its simplest form).
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {check.chunks.map((chunk) => {
          const isKept = kept.has(chunk.id);
          const wrong = result !== null && (result.droppedCore.includes(chunk.id) || result.keptExtras.includes(chunk.id));
          return (
            <button
              key={chunk.id}
              type="button"
              className="ghost"
              disabled={result !== null}
              aria-pressed={!isKept}
              aria-label={isKept ? chunk.japanese : `${chunk.japanese}, cut`}
              onClick={() => setKept((current) => {
                const next = new Set(current);
                if (!next.delete(chunk.id)) next.add(chunk.id);
                return next;
              })}
              style={{
                ...chunkStyle,
                opacity: isKept ? 1 : 0.35,
                textDecoration: isKept ? undefined : 'line-through',
                borderColor: wrong ? 'var(--danger)' : undefined,
              }}
            >
              <span className="jp">{chunk.japanese}</span>
            </button>
          );
        })}
      </div>
      {result === null ? (
        <div><button type="button" className="primary" onClick={submit}>Check my cut</button></div>
      ) : (
        <div className="stack" style={{ gap: '0.3rem' }} role="status">
          {result.correct === null ? (
            <div><strong>Compare:</strong> the usual bare skeleton is below. Your cut is noted, not graded.</div>
          ) : (
            <div><strong>{result.correct ? '✓ Clean cut' : 'Not quite'}</strong></div>
          )}
          {result.droppedCore.map((id) => (
            <div key={id}>✗ <span className="jp">{textOf(id)}</span> {id === check.predicateId ? 'closes the sentence — it has to stay.' : 'is the one doing it or being done to — it stays.'}</div>
          ))}
          {result.keptExtras.map((id) => (
            <div key={id}>✗ <span className="jp">{textOf(id)}</span> only adds where, how or from when — an extra you can cut.</div>
          ))}
          <div>Bare skeleton: <span className="jp jp-lg">{check.keepIds.map(textOf).join(' ')}</span></div>
          <div><button type="button" className="primary" onClick={onNext}>Next</button></div>
        </div>
      )}
    </div>
  );
}

function AttachmentCard({ check, base, onRecord, onNext }: { check: AttachmentCheck; base: Base; onRecord: (d: GlossDecisionInput) => void; onNext: () => void }) {
  const [wrongTaps, setWrongTaps] = useState<string[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [solved, setSolved] = useState(false);
  const textOf = (id: string) => check.chunks.find((c) => c.id === id)?.japanese ?? '';
  const modifier = textOf(check.modifierId);
  const head = textOf(check.headId);

  function tap(id: string) {
    if (solved || id === check.askedId) return;
    if (id === check.answerId) {
      setSolved(true);
      setFlash(null);
      onRecord({
        ...base,
        skill: 'attachment',
        subskill: 'noun_modifier',
        ruleKey: 'attachment:の:tap',
        targetText: modifier,
        levelShown: 4,
        firstResponse: wrongTaps[0] ? textOf(wrongTaps[0]) : textOf(id),
        firstCorrect: wrongTaps.length === 0,
        referenceValue: head,
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
    <div className="stack" style={{ gap: '0.5rem' }} aria-label="What it describes">
      <div>
        <strong>{check.direction === 'forward' ? <>What does <span className="jp">{modifier}</span> describe?</> : <>Which chunk describes <span className="jp">{head}</span>?</>}</strong>{' '}
        <span className="muted">Tap it in the sentence. (Aの B: A tells you which B, or whose.)</span>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {check.chunks.map((chunk) => {
          const asked = chunk.id === check.askedId;
          const right = solved && chunk.id === check.answerId;
          const flashed = flash === chunk.id;
          return (
            <button
              key={chunk.id}
              type="button"
              className="ghost"
              disabled={asked || solved}
              onClick={() => tap(chunk.id)}
              aria-label={flashed ? `${chunk.japanese}, not that one` : chunk.japanese}
              style={{
                ...chunkStyle,
                borderColor: right ? 'var(--success)' : flashed ? 'var(--danger)' : asked ? 'var(--accent)' : undefined,
                color: right ? 'var(--success)' : flashed ? 'var(--danger)' : undefined,
                opacity: solved && !right && !asked ? 0.5 : 1,
              }}
            >
              <span className="jp">{chunk.japanese}</span>
            </button>
          );
        })}
      </div>
      {solved ? (
        <div className="stack" style={{ gap: '0.3rem' }} role="status">
          <div><strong>{wrongTaps.length === 0 ? '✓ ' : ''}<span className="jp">{modifier}</span> describes <span className="jp">{head}</span>.</strong></div>
          <div><button type="button" className="primary" onClick={onNext}>Next</button></div>
        </div>
      ) : (
        <div className="muted" role="status" style={{ fontSize: '0.85rem' }}>
          {flash ? `Not ${textOf(flash)} — try another chunk.` : ' '}
        </div>
      )}
    </div>
  );
}

/** Cut-down then attachment, whichever the sentence supports; calls onFinish after the last one. */
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
  const order: ('cutDown' | 'attachment')[] = [];
  if (checks.cutDown) order.push('cutDown');
  if (checks.attachment) order.push('attachment');
  const current = order[index];
  if (!current) return null;
  const next = () => (index + 1 >= order.length ? onFinish() : setIndex(index + 1));
  return current === 'cutDown'
    ? <CutDownCard key="cut" check={checks.cutDown!} base={base} onRecord={onRecord} onNext={next} />
    : <AttachmentCard key="attach" check={checks.attachment!} base={base} onRecord={onRecord} onNext={next} />;
}
