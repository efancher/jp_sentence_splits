import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { NativeAudioButton } from '../components/NativeAudioButton';
import {
  ensureGrammarRelationship,
  getDb,
  listGrammarRelationshipsForPattern,
  listSentenceGrammarForPattern,
  updateGrammarPattern,
  type GrammarRelationshipView,
} from '../db/repository';
import type { GrammarPattern, GrammarRelationshipType } from '../domain/types';
import {
  computeGrammarLearnerState,
  GRAMMAR_LEARNER_STATE_LABELS,
  GRAMMAR_RELATIONSHIP_TYPE_LABELS,
  GRAMMAR_RELATIONSHIP_TYPES,
} from '../lib/grammarPatterns';
import { isVocabularyItemProficient } from '../lib/scheduling';

function GrammarPatternFields({ pattern }: { pattern: GrammarPattern }) {
  const [shortMeaning, setShortMeaning] = useState(pattern.shortMeaning);
  const [structuralNotes, setStructuralNotes] = useState(pattern.structuralNotes ?? '');
  const [explanation, setExplanation] = useState(pattern.explanation ?? '');
  const [family, setFamily] = useState(pattern.family ?? '');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  useEffect(() => {
    setShortMeaning(pattern.shortMeaning);
    setStructuralNotes(pattern.structuralNotes ?? '');
    setExplanation(pattern.explanation ?? '');
    setFamily(pattern.family ?? '');
    setSaveState('idle');
  }, [pattern.id, pattern.shortMeaning, pattern.structuralNotes, pattern.explanation, pattern.family]);

  async function save() {
    setSaveState('saving');
    await updateGrammarPattern(pattern.id, {
      shortMeaning,
      structuralNotes,
      explanation,
      family,
    });
    setSaveState('saved');
  }

  return (
    <div className="stack">
      <label htmlFor="grammar-detail-meaning" className="muted">
        Short meaning / communicative function
      </label>
      <input
        id="grammar-detail-meaning"
        value={shortMeaning}
        onChange={(event) => {
          setShortMeaning(event.target.value);
          setSaveState('idle');
        }}
        placeholder="e.g. there's no way..."
      />
      <label htmlFor="grammar-detail-structural" className="muted">
        Structural explanation (Cure-Dolly style)
      </label>
      <textarea
        id="grammar-detail-structural"
        value={structuralNotes}
        onChange={(event) => {
          setStructuralNotes(event.target.value);
          setSaveState('idle');
        }}
        rows={2}
        placeholder="e.g. わけ = circumstance/reason, が marks it, ない = does not exist"
      />
      <label htmlFor="grammar-detail-explanation" className="muted">
        Explanation
      </label>
      <textarea
        id="grammar-detail-explanation"
        value={explanation}
        onChange={(event) => {
          setExplanation(event.target.value);
          setSaveState('idle');
        }}
        rows={3}
        placeholder="Literal mechanics + communicative function + natural English"
      />
      <label htmlFor="grammar-detail-family" className="muted">
        Family / category (optional)
      </label>
      <input
        id="grammar-detail-family"
        value={family}
        onChange={(event) => {
          setFamily(event.target.value);
          setSaveState('idle');
        }}
        placeholder="e.g. expectation/inference"
      />
      <div className="row" style={{ alignItems: 'center', gap: '0.5rem' }}>
        <button type="button" className="primary" onClick={() => void save()}>
          Save
        </button>
        {saveState === 'saving' ? (
          <span className="muted">Saving…</span>
        ) : saveState === 'saved' ? (
          <span className="muted">Saved</span>
        ) : null}
      </div>
    </div>
  );
}

function RelatedPatterns({
  patternId,
  relationships,
  otherPatterns,
}: {
  patternId: string;
  relationships: GrammarRelationshipView[];
  otherPatterns: GrammarPattern[];
}) {
  const [targetId, setTargetId] = useState('');
  const [relationshipType, setRelationshipType] = useState<GrammarRelationshipType>(
    'commonly_confused',
  );
  const [saving, setSaving] = useState(false);

  const linkedIds = useMemo(
    () =>
      new Set(
        relationships.map((view) =>
          view.relationship.patternAId === patternId
            ? view.relationship.patternBId
            : view.relationship.patternAId,
        ),
      ),
    [relationships, patternId],
  );
  const candidates = useMemo(
    () => otherPatterns.filter((candidate) => candidate.id !== patternId),
    [otherPatterns, patternId],
  );

  async function addRelationship() {
    if (!targetId) return;
    setSaving(true);
    try {
      await ensureGrammarRelationship(patternId, targetId, relationshipType);
      setTargetId('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="stack">
      <h3 style={{ margin: 0 }}>Related patterns</h3>
      {relationships.length === 0 ? (
        <p className="muted">No related patterns linked yet.</p>
      ) : (
        relationships.map((view) => (
          <Link
            key={view.relationship.id}
            to={`/grammar/${encodeURIComponent(view.otherPattern.id)}`}
            className="list-card"
          >
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong className="jp">{view.otherPattern.canonicalName}</strong>
              <span className="muted" style={{ fontSize: '0.85rem' }}>
                {GRAMMAR_RELATIONSHIP_TYPE_LABELS[view.relationship.relationshipType]}
              </span>
            </div>
            {view.otherPattern.shortMeaning ? (
              <div className="muted">{view.otherPattern.shortMeaning}</div>
            ) : null}
          </Link>
        ))
      )}
      {candidates.length > 0 ? (
        <div className="row" style={{ alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <select
            value={relationshipType}
            onChange={(event) =>
              setRelationshipType(event.target.value as GrammarRelationshipType)
            }
            aria-label="Relationship type"
          >
            {GRAMMAR_RELATIONSHIP_TYPES.map((type) => (
              <option key={type} value={type}>
                {GRAMMAR_RELATIONSHIP_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <select
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            aria-label="Pattern to link"
          >
            <option value="">Choose a pattern…</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.canonicalName}
                {linkedIds.has(candidate.id) ? ' (already linked)' : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!targetId || saving}
            onClick={() => void addRelationship()}
          >
            Link
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function GrammarPatternDetailPage() {
  const { patternId = '' } = useParams();

  const data = useLiveQuery(async () => {
    const db = getDb();
    const pattern = await db.grammarPatterns.get(patternId);
    if (!pattern) {
      return {
        pattern: null,
        encounters: [],
        tracked: false,
        state: 'encountered' as const,
        relationships: [],
        allPatterns: [],
      };
    }
    const [encounters, studyItems, relationships, allPatterns] = await Promise.all([
      listSentenceGrammarForPattern(patternId),
      db.studyItems
        .where('subjectType')
        .equals('grammarPattern')
        .toArray(),
      listGrammarRelationshipsForPattern(patternId),
      db.grammarPatterns.toArray(),
    ]);
    const patternStudyItems = studyItems.filter((item) => item.subjectId === patternId);
    const tracked = patternStudyItems.length > 0;
    const confirmedCount = encounters.filter(
      (encounter) => encounter.sentenceGrammar.confirmedByLearner,
    ).length;
    const proficient = patternStudyItems.some(
      (item) =>
        item.activityType === 'grammar_comprehension' &&
        isVocabularyItemProficient(item.fsrsState.state),
    );
    const contrastProficient = patternStudyItems.some(
      (item) =>
        item.activityType === 'grammar_contrast' &&
        isVocabularyItemProficient(item.fsrsState.state),
    );
    const state = computeGrammarLearnerState({
      encounterCount: encounters.length,
      confirmedCount,
      tracked,
      proficient,
      contrastProficient,
    });
    return { pattern, encounters, tracked, state, relationships, allPatterns };
  }, [patternId]);

  return (
    <div className="stack">
      <section className="panel stack">
        <Link to="/grammar">
          <button type="button">Back to grammar</button>
        </Link>
        {data === undefined ? (
          <p className="muted">Loading…</p>
        ) : !data.pattern ? (
          <p className="muted">Unknown grammar pattern.</p>
        ) : (
          <>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="jp jp-lg">{data.pattern.canonicalName}</div>
              <div className="row" style={{ gap: '0.5rem' }}>
                <span className="status-pill">{GRAMMAR_LEARNER_STATE_LABELS[data.state]}</span>
                {data.tracked ? <span className="status-pill">Tracked</span> : null}
              </div>
            </div>
            {data.pattern.aliases.length ? (
              <div className="muted">
                Also seen as: {data.pattern.aliases.join('、')}
              </div>
            ) : null}
            <GrammarPatternFields pattern={data.pattern} />
          </>
        )}
      </section>

      {data?.pattern ? (
        <section className="stack">
          <h3 style={{ margin: 0 }}>
            Your encounters ({data.encounters.length})
          </h3>
          {data.encounters.length === 0 ? (
            <p className="muted">
              No sentences tagged with this pattern yet.
            </p>
          ) : (
            data.encounters.map(({ sentenceGrammar, sentence, books, audio }) => {
              const book = books[0];
              return (
                <article key={sentenceGrammar.id} className="list-card">
                  <div className="jp">
                    {book ? (
                      <Link to={`/books/${book.id}/analyze/${sentence.id}`}>
                        {sentence.japanese}
                      </Link>
                    ) : (
                      sentence.japanese
                    )}
                  </div>
                  {sentence.translation ? (
                    <div className="muted">{sentence.translation}</div>
                  ) : null}
                  <div className="row" style={{ alignItems: 'center', gap: '0.5rem' }}>
                    {books.length ? (
                      <span className="muted" style={{ fontSize: '0.85rem' }}>
                        {books.map((b) => b.title).join(', ')}
                      </span>
                    ) : null}
                    {sentenceGrammar.confirmedByLearner ? (
                      <span className="status-pill confirmed">Confirmed</span>
                    ) : null}
                    {audio.map((clip) => (
                      <NativeAudioButton key={clip.id} audio={clip} />
                    ))}
                  </div>
                  {sentenceGrammar.occurrenceExplanation ? (
                    <p className="muted" style={{ margin: 0 }}>
                      {sentenceGrammar.occurrenceExplanation}
                    </p>
                  ) : null}
                </article>
              );
            })
          )}
        </section>
      ) : null}

      {data?.pattern ? (
        <RelatedPatterns
          patternId={data.pattern.id}
          relationships={data.relationships}
          otherPatterns={data.allPatterns}
        />
      ) : null}
    </div>
  );
}
