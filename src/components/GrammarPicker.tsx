import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';

import {
  ensureGrammarPattern,
  ensureGrammarStudyItem,
  ensureSentenceGrammar,
  getDb,
  removeSentenceGrammar,
  updateGrammarPattern,
} from '../db/repository';
import type { GrammarPattern, SentenceGrammar } from '../domain/types';

/**
 * Manual grammar-pattern annotation for a sentence (grammar-learning system,
 * Phase 2 — see docs/STATUS.md). Deliberately *not* routed through
 * AnalyzePage's autosave/chunks state: each action here (add/confirm/track/
 * remove) is an immediate, deliberate repository write, not a draft field —
 * the "Grammar noticed" panel should stay fast and skippable, not gate on
 * the debounced save cycle. No AI suggestions yet (Phase 4); this is pure
 * search-existing-or-create-new, validating the domain model with real
 * annotations first.
 */
export interface GrammarPickerProps {
  sentenceId: string;
}

interface LinkedPattern {
  link: SentenceGrammar;
  pattern: GrammarPattern;
  tracked: boolean;
}

export function GrammarPicker({ sentenceId }: GrammarPickerProps) {
  const [newName, setNewName] = useState('');
  const [expandedPatternId, setExpandedPatternId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const data = useLiveQuery(async () => {
    const db = getDb();
    const links = await db.sentenceGrammar
      .where('sentenceId')
      .equals(sentenceId)
      .toArray();
    const patterns = await db.grammarPatterns.bulkGet(
      links.map((link) => link.grammarPatternId),
    );
    const grammarStudyItems = await db.studyItems
      .where('subjectType')
      .equals('grammarPattern')
      .toArray();
    const trackedPatternIds = new Set(grammarStudyItems.map((item) => item.subjectId));
    const linked: LinkedPattern[] = links
      .map((link, index) => {
        const pattern = patterns[index];
        if (!pattern) return null;
        return { link, pattern, tracked: trackedPatternIds.has(pattern.id) };
      })
      .filter((item): item is LinkedPattern => Boolean(item))
      .sort((a, b) => a.link.createdAt.localeCompare(b.link.createdAt));
    const allPatterns = await db.grammarPatterns.toArray();
    return { linked, allPatterns };
  }, [sentenceId]);

  const linked = data?.linked ?? [];
  const allPatterns = data?.allPatterns ?? [];
  const linkedPatternIds = new Set(linked.map((item) => item.pattern.id));

  async function handleAdd() {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const existing = allPatterns.find(
        (pattern) =>
          pattern.canonicalName === name || pattern.aliases.includes(name),
      );
      const pattern =
        existing ?? (await ensureGrammarPattern(name, { provenance: 'manual' }));
      await ensureSentenceGrammar(sentenceId, pattern.id, { source: 'manual' });
      setNewName('');
      setExpandedPatternId(pattern.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel stack">
      <h3 style={{ margin: 0 }}>Grammar noticed</h3>
      {linked.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          No grammar patterns tagged for this sentence yet.
        </p>
      ) : (
        <div className="stack">
          {linked.map(({ link, pattern, tracked }) => (
            <GrammarPatternCard
              key={link.id}
              link={link}
              pattern={pattern}
              tracked={tracked}
              expanded={expandedPatternId === pattern.id}
              onToggleExpand={() =>
                setExpandedPatternId((current) =>
                  current === pattern.id ? null : pattern.id,
                )
              }
              onGotIt={() =>
                void ensureSentenceGrammar(sentenceId, pattern.id, {
                  confirmedByLearner: true,
                })
              }
              onTrack={() =>
                void (async () => {
                  await ensureSentenceGrammar(sentenceId, pattern.id, {
                    confirmedByLearner: true,
                  });
                  await ensureGrammarStudyItem(pattern.id, 'grammar_comprehension');
                })()
              }
              onRemove={() => void removeSentenceGrammar(link.id)}
            />
          ))}
        </div>
      )}
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          void handleAdd();
        }}
      >
        <input
          list="grammar-pattern-options"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="Add a grammar pattern, e.g. 〜わけがない"
          aria-label="Grammar pattern name"
        />
        <datalist id="grammar-pattern-options">
          {allPatterns
            .filter((pattern) => !linkedPatternIds.has(pattern.id))
            .map((pattern) => (
              <option key={pattern.id} value={pattern.canonicalName} />
            ))}
        </datalist>
        <button type="submit" disabled={busy || !newName.trim()}>
          Add
        </button>
      </form>
    </section>
  );
}

function GrammarPatternCard({
  link,
  pattern,
  tracked,
  expanded,
  onToggleExpand,
  onGotIt,
  onTrack,
  onRemove,
}: {
  link: SentenceGrammar;
  pattern: GrammarPattern;
  tracked: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onGotIt: () => void;
  onTrack: () => void;
  onRemove: () => void;
}) {
  const [shortMeaning, setShortMeaning] = useState(pattern.shortMeaning);
  const [structuralNotes, setStructuralNotes] = useState(pattern.structuralNotes ?? '');
  const [explanation, setExplanation] = useState(pattern.explanation ?? '');
  const [family, setFamily] = useState(pattern.family ?? '');
  const [occurrenceExplanation, setOccurrenceExplanation] = useState(
    link.occurrenceExplanation ?? '',
  );

  // Re-sync local edit buffers when a different pattern expands, or the
  // underlying row changes from elsewhere (e.g. another device via sync).
  useEffect(() => {
    setShortMeaning(pattern.shortMeaning);
    setStructuralNotes(pattern.structuralNotes ?? '');
    setExplanation(pattern.explanation ?? '');
    setFamily(pattern.family ?? '');
    setOccurrenceExplanation(link.occurrenceExplanation ?? '');
    // Only re-sync on identity/expand changes, not on every local keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern.id, expanded]);

  async function saveExplanation() {
    await Promise.all([
      updateGrammarPattern(pattern.id, {
        shortMeaning,
        structuralNotes,
        explanation,
        family,
      }),
      ensureSentenceGrammar(link.sentenceId, pattern.id, { occurrenceExplanation }),
    ]);
  }

  return (
    <article className="panel stack" style={{ boxShadow: 'none' }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <strong className="jp">{pattern.canonicalName}</strong>
          {pattern.shortMeaning ? (
            <span className="muted"> — {pattern.shortMeaning}</span>
          ) : null}
        </div>
        <div className="row" style={{ gap: '0.35rem' }}>
          {link.confirmedByLearner ? (
            <span className="status-pill confirmed">Confirmed</span>
          ) : null}
          {tracked ? <span className="status-pill">Tracked</span> : null}
        </div>
      </div>
      <div className="row">
        {!link.confirmedByLearner ? (
          <button type="button" onClick={onGotIt}>
            Got it
          </button>
        ) : null}
        <button type="button" onClick={onToggleExpand}>
          {expanded ? 'Hide explanation' : 'Explain'}
        </button>
        {!tracked ? (
          <button type="button" onClick={onTrack}>
            Track
          </button>
        ) : null}
        <button type="button" className="ghost" onClick={onRemove}>
          Remove
        </button>
      </div>
      {expanded ? (
        <div
          className="stack"
          style={{ borderTop: '1px solid var(--border)', paddingTop: '0.5rem' }}
        >
          <label htmlFor={`grammar-meaning-${pattern.id}`} className="muted">
            Short meaning / communicative function
          </label>
          <input
            id={`grammar-meaning-${pattern.id}`}
            value={shortMeaning}
            onChange={(event) => setShortMeaning(event.target.value)}
            placeholder="e.g. there's no way..."
          />
          <label htmlFor={`grammar-structural-${pattern.id}`} className="muted">
            Structural explanation (Cure-Dolly style)
          </label>
          <textarea
            id={`grammar-structural-${pattern.id}`}
            value={structuralNotes}
            onChange={(event) => setStructuralNotes(event.target.value)}
            rows={2}
            placeholder="e.g. わけ = circumstance/reason, が marks it, ない = does not exist"
          />
          <label htmlFor={`grammar-explanation-${pattern.id}`} className="muted">
            Explanation
          </label>
          <textarea
            id={`grammar-explanation-${pattern.id}`}
            value={explanation}
            onChange={(event) => setExplanation(event.target.value)}
            rows={2}
            placeholder="Literal mechanics + communicative function + natural English"
          />
          <label htmlFor={`grammar-family-${pattern.id}`} className="muted">
            Family / category (optional)
          </label>
          <input
            id={`grammar-family-${pattern.id}`}
            value={family}
            onChange={(event) => setFamily(event.target.value)}
            placeholder="e.g. expectation/inference"
          />
          <label htmlFor={`grammar-occurrence-${pattern.id}`} className="muted">
            Why this fits this sentence (optional)
          </label>
          <textarea
            id={`grammar-occurrence-${pattern.id}`}
            value={occurrenceExplanation}
            onChange={(event) => setOccurrenceExplanation(event.target.value)}
            rows={2}
          />
          <div className="row">
            <button type="button" className="primary" onClick={() => void saveExplanation()}>
              Save
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
