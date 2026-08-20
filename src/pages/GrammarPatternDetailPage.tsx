import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { NativeAudioButton } from '../components/NativeAudioButton';
import {
  getDb,
  listSentenceGrammarForPattern,
  updateGrammarPattern,
} from '../db/repository';
import type { GrammarPattern } from '../domain/types';

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

export function GrammarPatternDetailPage() {
  const { patternId = '' } = useParams();

  const data = useLiveQuery(async () => {
    const db = getDb();
    const pattern = await db.grammarPatterns.get(patternId);
    if (!pattern) return { pattern: null, encounters: [], tracked: false };
    const [encounters, studyItems] = await Promise.all([
      listSentenceGrammarForPattern(patternId),
      db.studyItems
        .where('subjectType')
        .equals('grammarPattern')
        .toArray(),
    ]);
    const tracked = studyItems.some((item) => item.subjectId === patternId);
    return { pattern, encounters, tracked };
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
              {data.tracked ? <span className="status-pill">Tracked</span> : null}
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
    </div>
  );
}
