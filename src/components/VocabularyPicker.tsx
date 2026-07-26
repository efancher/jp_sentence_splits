import { useMemo, useState } from 'react';

import type {
  VocabularyReviewStatus,
  VocabularySelection,
  VocabularySuggestion,
} from '../domain/types';
import { createId } from '../lib/ids';
import {
  buildMorphStrip,
  combineSuggestions,
  defaultSelectionsFromSuggestions,
  isContentPos,
  selectionFromSuggestion,
  validateSpan,
} from '../lib/vocabularySuggestions';

export interface VocabularyPickerProps {
  japanese: string;
  suggestions: VocabularySuggestion[];
  selections: VocabularySelection[];
  reviewStatus: VocabularyReviewStatus;
  onChange: (next: {
    selections: VocabularySelection[];
    reviewStatus: VocabularyReviewStatus;
  }) => void;
  onConfirmAndNext?: (payload: {
    selections: VocabularySelection[];
    reviewStatus: VocabularyReviewStatus;
  }) => void;
  hasNext?: boolean;
}

function selectionCoversSuggestion(
  selection: VocabularySelection,
  suggestion: VocabularySuggestion,
): boolean {
  if (selection.suggestionIds?.includes(suggestion.id)) return true;
  return (
    selection.start <= suggestion.start && selection.end >= suggestion.end
  );
}

export function VocabularyPicker({
  japanese,
  suggestions,
  selections,
  reviewStatus,
  onChange,
  onConfirmAndNext,
  hasNext = false,
}: VocabularyPickerProps) {
  const [combineIds, setCombineIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);

  const orderedSuggestions = useMemo(
    () => [...suggestions].sort((a, b) => a.start - b.start),
    [suggestions],
  );

  const strip = useMemo(
    () => buildMorphStrip(japanese, orderedSuggestions),
    [japanese, orderedSuggestions],
  );

  function setSelections(
    next: VocabularySelection[],
    status: VocabularyReviewStatus = 'unreviewed',
  ) {
    onChange({ selections: next, reviewStatus: status });
  }

  function isSuggestionSelected(suggestion: VocabularySuggestion): boolean {
    return selections.some((item) => selectionCoversSuggestion(item, suggestion));
  }

  function toggleSuggestion(suggestion: VocabularySuggestion) {
    if (isSuggestionSelected(suggestion)) {
      setSelections(
        selections.filter(
          (item) => !selectionCoversSuggestion(item, suggestion),
        ),
      );
      return;
    }
    setSelections([...selections, selectionFromSuggestion(suggestion)]);
  }

  function toggleCombine(suggestionId: string) {
    setCombineIds((current) => {
      const next = new Set(current);
      if (next.has(suggestionId)) next.delete(suggestionId);
      else next.add(suggestionId);
      return next;
    });
  }

  function combineSelected() {
    const chosen = orderedSuggestions.filter((item) => combineIds.has(item.id));
    const combined = combineSuggestions(chosen, japanese);
    if (!combined) {
      window.alert(
        'Mark two or more adjacent pieces (in sentence order) to combine into one vocabulary item.',
      );
      return;
    }
    const withoutCovered = selections.filter(
      (item) =>
        !chosen.some(
          (suggestion) =>
            item.start < suggestion.end && item.end > suggestion.start,
        ),
    );
    setSelections([...withoutCovered, combined]);
    setCombineIds(new Set());
    setEditingId(combined.id);
  }

  function addManualFromCombine() {
    if (combineIds.size === 0) {
      window.alert('Mark one or more pieces first, then add as vocabulary.');
      return;
    }
    const chosen = orderedSuggestions.filter((item) => combineIds.has(item.id));
    if (chosen.length === 1) {
      toggleSuggestion(chosen[0]!);
      setCombineIds(new Set());
      return;
    }
    combineSelected();
  }

  function updateSelection(
    id: string,
    patch: Partial<VocabularySelection>,
  ) {
    setSelections(
      selections.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function removeSelection(id: string) {
    setSelections(selections.filter((item) => item.id !== id));
  }

  function resetToDefaults() {
    setSelections(defaultSelectionsFromSuggestions(suggestions, japanese));
    setCombineIds(new Set());
    setEditingId(null);
  }

  function confirm() {
    for (const item of selections) {
      if (!validateSpan(japanese, item.start, item.end, item.surface)) {
        window.alert(
          `Selection "${item.expression}" no longer matches the sentence text.`,
        );
        return;
      }
      if (!item.expression.trim()) {
        window.alert('Every selection needs a dictionary expression.');
        return;
      }
    }
    onChange({ selections, reviewStatus: 'confirmed' });
    onConfirmAndNext?.({
      selections,
      reviewStatus: 'confirmed',
    });
  }

  if (!suggestions.length && !selections.length) {
    return (
      <section className="panel stack">
        <h3 style={{ margin: 0 }}>Vocabulary for Anki</h3>
        <p className="muted" style={{ margin: 0 }}>
          No morphology suggestions on this sentence. Re-export the video
          package with Shadowmine v2 (Fugashi tokens), or add words manually
          after importing a newer package.
        </p>
      </section>
    );
  }

  return (
    <section className="panel stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>Vocabulary for Anki</h3>
        <span className={`status-pill ${reviewStatus}`}>
          {reviewStatus === 'confirmed' ? 'Confirmed' : 'Unreviewed'}
        </span>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        The sentence is pre-chunked by morphology (like ichi.moe). Each block is
        one piece — tap to include or exclude it for Anki. Use{' '}
        <strong>Mark</strong> on adjacent pieces, then Combine, for compounds
        such as やって来る. Only confirmed sentences are exported.
      </p>

      <div
        className="vocab-morph-strip"
        role="group"
        aria-label="Morphology chunks in sentence order"
      >
        {strip.map((piece) => {
          if (piece.kind === 'gap') {
            return (
              <span
                key={`gap-${piece.start}-${piece.end}`}
                className="vocab-morph-gap jp"
                title="Uncovered text"
              >
                {piece.surface}
              </span>
            );
          }

          const { suggestion } = piece;
          const selected = isSuggestionSelected(suggestion);
          const combining = combineIds.has(suggestion.id);
          const content = isContentPos(suggestion.pos);
          const lemmaDiffers =
            suggestion.expression.trim() !== suggestion.surface.trim();
          const classes = [
            'vocab-morph-piece',
            selected ? 'is-selected' : '',
            combining ? 'is-marked' : '',
            content ? 'is-content' : 'is-function',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <div key={suggestion.id} className={classes}>
              <button
                type="button"
                className="vocab-morph-main"
                aria-pressed={selected}
                title={[
                  suggestion.expression,
                  suggestion.reading,
                  suggestion.pos || 'no POS',
                ]
                  .filter(Boolean)
                  .join(' · ')}
                onClick={() => toggleSuggestion(suggestion)}
              >
                <span className="vocab-morph-surface jp">{suggestion.surface}</span>
                {suggestion.reading ? (
                  <span className="vocab-morph-reading muted">
                    {suggestion.reading}
                  </span>
                ) : null}
                {lemmaDiffers ? (
                  <span className="vocab-morph-lemma muted">
                    → {suggestion.expression}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                className={
                  combining
                    ? 'vocab-morph-mark is-active'
                    : 'vocab-morph-mark ghost'
                }
                aria-pressed={combining}
                aria-label={`Mark ${suggestion.surface} for combining`}
                title="Mark for combine"
                onClick={() => toggleCombine(suggestion.id)}
              >
                Mark
              </button>
            </div>
          );
        })}
      </div>

      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button type="button" onClick={combineSelected}>
          Combine marked
        </button>
        <button type="button" className="ghost" onClick={addManualFromCombine}>
          Add marked
        </button>
        <button type="button" className="ghost" onClick={resetToDefaults}>
          Reset defaults
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() =>
            setSelections([
              ...selections,
              {
                id: createId('vsel'),
                surface: '',
                start: 0,
                end: 0,
                expression: '',
                reading: '',
                source: 'manual',
              },
            ])
          }
        >
          Add blank
        </button>
      </div>

      {selections.length ? (
        <div className="stack" style={{ gap: '0.65rem' }}>
          <h4 style={{ margin: 0 }}>Selected for Anki</h4>
          {selections.map((item) => {
            const open = editingId === item.id;
            const spanOk =
              item.surface &&
              validateSpan(japanese, item.start, item.end, item.surface);
            return (
              <div key={item.id} className="panel" style={{ boxShadow: 'none' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <div className="jp">
                      {item.surface || '(no surface)'}
                      {item.expression ? (
                        <span className="muted"> → {item.expression}</span>
                      ) : null}
                    </div>
                    {!spanOk ? (
                      <div style={{ color: 'var(--danger)' }}>
                        Span does not match the sentence
                      </div>
                    ) : null}
                  </div>
                  <div className="row">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setEditingId(open ? null : item.id)}
                    >
                      {open ? 'Hide' : 'Edit'}
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => removeSelection(item.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                {open ? (
                  <div className="stack" style={{ marginTop: '0.5rem' }}>
                    <label>
                      Surface in sentence
                      <input
                        className="jp"
                        value={item.surface}
                        onChange={(event) => {
                          const surface = event.target.value;
                          const start = japanese.indexOf(surface);
                          updateSelection(item.id, {
                            surface,
                            start: start >= 0 ? start : item.start,
                            end: start >= 0 ? start + surface.length : item.end,
                          });
                        }}
                      />
                    </label>
                    <label>
                      Dictionary expression
                      <input
                        className="jp"
                        value={item.expression}
                        onChange={(event) =>
                          updateSelection(item.id, {
                            expression: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      Reading
                      <input
                        className="jp"
                        value={item.reading}
                        onChange={(event) =>
                          updateSelection(item.id, {
                            reading: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      Meaning (optional)
                      <input
                        value={item.english ?? ''}
                        onChange={(event) =>
                          updateSelection(item.id, {
                            english: event.target.value,
                          })
                        }
                      />
                    </label>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          No vocabulary selected — confirming will export this sentence with
          zero cards.
        </p>
      )}

      <div className="row">
        <button type="button" onClick={confirm}>
          {hasNext ? 'Confirm vocabulary and next' : 'Confirm vocabulary'}
        </button>
      </div>
    </section>
  );
}
