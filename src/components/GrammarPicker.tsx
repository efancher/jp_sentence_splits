import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  ensureGrammarPattern,
  ensureGrammarStudyItem,
  ensureSentenceGrammar,
  getDb,
  getSentenceFullReviewReadiness,
  removeSentenceGrammar,
  updateGrammarPattern,
} from '../db/repository';
import type { GrammarPattern, SentenceGrammar } from '../domain/types';
import {
  explainGrammarPattern,
  suggestGrammarPatterns,
  type GrammarAssistChunkContext,
  type GrammarSuggestionResult,
} from '../lib/grammarAssist';

/**
 * Grammar-pattern annotation for a sentence (grammar-learning system — see
 * docs/STATUS.md). Deliberately *not* routed through AnalyzePage's
 * autosave/chunks state: each action here (add/confirm/track/remove) is an
 * immediate, deliberate repository write, not a draft field — the "Grammar
 * noticed" panel should stay fast and skippable, not gate on the debounced
 * save cycle.
 *
 * AI suggestion/explanation (Phase 4) is always non-authoritative: a
 * suggestion only becomes a real GrammarPattern/SentenceGrammar row when the
 * learner taps Add, and an AI-drafted explanation only saves when the
 * learner taps Save on the (unchanged) manual form — see design brief §15.
 * Degrades silently to manual-only if the AI service is unavailable
 * (signed out, no Supabase, network/server error).
 */
export interface GrammarPickerProps {
  sentenceId: string;
  japanese: string;
  chunks?: GrammarAssistChunkContext[];
}

interface LinkedPattern {
  link: SentenceGrammar;
  pattern: GrammarPattern;
  tracked: boolean;
}

export function GrammarPicker({ sentenceId, japanese, chunks }: GrammarPickerProps) {
  const [newName, setNewName] = useState('');
  const [expandedPatternId, setExpandedPatternId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<GrammarSuggestionResult[]>([]);
  const [suggestState, setSuggestState] = useState<
    { status: 'idle' } | { status: 'loading' } | { status: 'error'; reason: string }
  >({ status: 'idle' });

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
    // Grammar review needs this sentence's own vocabulary learned first
    // (same bar as pickContextSentenceForGrammarPattern / the "vocab before
    // glossing" rule) — otherwise Track just seeds a card that can never
    // render and sits stuck-due. Gate the Track button on it.
    const vocabReady =
      (await getSentenceFullReviewReadiness([sentenceId])).get(sentenceId) ?? false;
    return { linked, allPatterns, vocabReady };
  }, [sentenceId]);

  const linked = data?.linked ?? [];
  const allPatterns = data?.allPatterns ?? [];
  const vocabReady = data?.vocabReady ?? false;
  const linkedPatternIds = new Set(linked.map((item) => item.pattern.id));
  const linkedNames = new Set(
    linked.flatMap(({ pattern }) => [pattern.canonicalName, ...pattern.aliases]),
  );

  async function addPattern(
    name: string,
    opts?: { shortMeaning?: string; provenance?: 'manual' | 'ai_suggested' },
  ): Promise<void> {
    const existing = allPatterns.find(
      (pattern) => pattern.canonicalName === name || pattern.aliases.includes(name),
    );
    const pattern =
      existing ??
      (await ensureGrammarPattern(name, {
        provenance: opts?.provenance ?? 'manual',
        shortMeaning: opts?.shortMeaning,
      }));
    await ensureSentenceGrammar(sentenceId, pattern.id, {
      source: opts?.provenance === 'ai_suggested' ? 'ai_suggested' : 'manual',
    });
    setExpandedPatternId(pattern.id);
  }

  async function handleAdd() {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await addPattern(name);
      setNewName('');
    } finally {
      setBusy(false);
    }
  }

  async function handleSuggest() {
    setSuggestState({ status: 'loading' });
    const result = await suggestGrammarPatterns({
      sentence: japanese,
      chunks,
      existingPatternNames: allPatterns.flatMap((pattern) => [
        pattern.canonicalName,
        ...pattern.aliases,
      ]),
    });
    if (!result.ok) {
      setSuggestState({ status: 'error', reason: result.reason });
      return;
    }
    setSuggestState({ status: 'idle' });
    setSuggestions(
      result.data.patterns.filter(
        (item) =>
          !linkedNames.has(item.candidateName) &&
          !(item.matchedExistingName && linkedNames.has(item.matchedExistingName)),
      ),
    );
  }

  return (
    <section className="panel stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>Grammar noticed</h3>
        <button
          type="button"
          className="ghost"
          disabled={suggestState.status === 'loading' || !japanese.trim()}
          onClick={() => void handleSuggest()}
        >
          {suggestState.status === 'loading' ? 'Analyzing…' : 'Suggest grammar (AI)'}
        </button>
      </div>
      {suggestState.status === 'error' ? (
        <p className="muted" style={{ margin: 0 }}>
          {suggestState.reason}
        </p>
      ) : null}
      {suggestions.length > 0 ? (
        <div className="stack">
          {suggestions.map((suggestion) => (
            <div
              key={suggestion.candidateName}
              className="row"
              style={{ justifyContent: 'space-between', alignItems: 'center' }}
            >
              <span>
                <span className="jp">
                  {suggestion.matchedExistingName ?? suggestion.candidateName}
                </span>
                <span className="muted"> — {suggestion.shortMeaning}</span>
              </span>
              <span className="row" style={{ gap: '0.35rem' }}>
                <button
                  type="button"
                  onClick={() =>
                    void (async () => {
                      await addPattern(suggestion.matchedExistingName ?? suggestion.candidateName, {
                        shortMeaning: suggestion.shortMeaning,
                        provenance: 'ai_suggested',
                      });
                      setSuggestions((current) =>
                        current.filter((item) => item !== suggestion),
                      );
                    })()
                  }
                >
                  Add
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() =>
                    setSuggestions((current) => current.filter((item) => item !== suggestion))
                  }
                >
                  Dismiss
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
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
              trackable={vocabReady}
              japanese={japanese}
              chunks={chunks}
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
                  // Seed both starting activity types together (design
                  // brief §11's "smallest set that provides substantial
                  // value") — Track is the only entry point into grammar's
                  // FSRS rotation, ReviewPage never lazily seeds a new
                  // grammar study item on its own.
                  await ensureGrammarStudyItem(pattern.id, 'grammar_comprehension');
                  await ensureGrammarStudyItem(pattern.id, 'grammar_completion');
                })()
              }
              onRemove={() => void removeSentenceGrammar(link.id)}
            />
          ))}
          {!vocabReady && linked.some(({ tracked }) => !tracked) ? (
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              Track becomes available once this sentence&rsquo;s vocabulary is confirmed and
              proficient — grammar review needs its words already learned.
            </p>
          ) : null}
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
      {linked.length > 0 ? (
        <Link to="/grammar" className="muted" style={{ fontSize: '0.85rem' }}>
          Browse all grammar patterns →
        </Link>
      ) : null}
    </section>
  );
}

function GrammarPatternCard({
  link,
  pattern,
  tracked,
  trackable,
  japanese,
  chunks,
  expanded,
  onToggleExpand,
  onGotIt,
  onTrack,
  onRemove,
}: {
  link: SentenceGrammar;
  pattern: GrammarPattern;
  tracked: boolean;
  /** Is this sentence's own vocabulary confirmed + proficient? Tracking before that just seeds a stuck-due card. */
  trackable: boolean;
  japanese: string;
  chunks?: GrammarAssistChunkContext[];
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
  const [explainAssistState, setExplainAssistState] = useState<
    { status: 'idle' } | { status: 'loading' } | { status: 'error'; reason: string }
  >({ status: 'idle' });
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  );

  const dirty =
    shortMeaning !== pattern.shortMeaning ||
    structuralNotes !== (pattern.structuralNotes ?? '') ||
    explanation !== (pattern.explanation ?? '') ||
    family !== (pattern.family ?? '') ||
    occurrenceExplanation !== (link.occurrenceExplanation ?? '');

  // Drop the "Saved" confirmation as soon as the learner edits again.
  useEffect(() => {
    if (dirty) setSaveState((current) => (current === 'saved' ? 'idle' : current));
  }, [dirty]);

  // Re-sync local edit buffers when a different pattern expands, or the
  // underlying row changes from elsewhere (e.g. another device via sync).
  useEffect(() => {
    setShortMeaning(pattern.shortMeaning);
    setStructuralNotes(pattern.structuralNotes ?? '');
    setExplanation(pattern.explanation ?? '');
    setFamily(pattern.family ?? '');
    setOccurrenceExplanation(link.occurrenceExplanation ?? '');
    setExplainAssistState({ status: 'idle' });
    setSaveState('idle');
    // Only re-sync on identity/expand changes, not on every local keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern.id, expanded]);

  async function saveExplanation() {
    setSaveState('saving');
    try {
      await Promise.all([
        updateGrammarPattern(pattern.id, {
          shortMeaning,
          structuralNotes,
          explanation,
          family,
        }),
        ensureSentenceGrammar(link.sentenceId, pattern.id, { occurrenceExplanation }),
      ]);
      setSaveState('saved');
    } catch (error) {
      console.error('Failed to save grammar explanation', error);
      setSaveState('error');
    }
  }

  async function suggestExplanation() {
    setExplainAssistState({ status: 'loading' });
    const result = await explainGrammarPattern({
      sentence: japanese,
      patternName: pattern.canonicalName,
      chunks,
    });
    if (!result.ok) {
      setExplainAssistState({ status: 'error', reason: result.reason });
      return;
    }
    setExplainAssistState({ status: 'idle' });
    // Pre-fills only — the learner still must tap Save for anything to persist.
    setShortMeaning(result.data.shortMeaning);
    setStructuralNotes(result.data.structuralNotes);
    setExplanation(result.data.explanation);
  }

  return (
    <article className="panel stack" style={{ boxShadow: 'none' }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <Link to={`/grammar/${encodeURIComponent(pattern.id)}`} className="jp">
            <strong>{pattern.canonicalName}</strong>
          </Link>
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
          <button
            type="button"
            onClick={onTrack}
            disabled={!trackable}
            title={
              trackable
                ? undefined
                : "Confirm this sentence's vocabulary first — grammar review needs its words already learned"
            }
          >
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
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              Fill in below, or draft with AI and edit before saving.
            </span>
            <button
              type="button"
              className="ghost"
              disabled={explainAssistState.status === 'loading'}
              onClick={() => void suggestExplanation()}
            >
              {explainAssistState.status === 'loading'
                ? 'Drafting…'
                : 'Suggest explanation (AI)'}
            </button>
          </div>
          {explainAssistState.status === 'error' ? (
            <p className="muted" style={{ margin: 0 }}>
              {explainAssistState.reason}
            </p>
          ) : null}
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
          <div className="row" style={{ alignItems: 'center' }}>
            <button
              type="button"
              className="primary"
              disabled={saveState === 'saving' || !dirty}
              onClick={() => void saveExplanation()}
            >
              {saveState === 'saving' ? 'Saving…' : 'Save'}
            </button>
            {saveState === 'error' ? (
              <span role="alert" style={{ color: 'var(--warning)', fontSize: '0.85rem' }}>
                Couldn’t save — try again.
              </span>
            ) : dirty ? (
              <span className="muted" style={{ fontSize: '0.85rem' }}>
                Unsaved changes
              </span>
            ) : saveState === 'saved' ? (
              <span style={{ color: 'var(--success)', fontSize: '0.85rem' }}>Saved ✓</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}
