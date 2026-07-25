import { useMemo, useState } from 'react';

import type {
  VocabularyReviewStatus,
  VocabularySelection,
  VocabularySuggestion,
} from '../domain/types';
import { createId } from '../lib/ids';
import {
  combineSuggestions,
  defaultSelectionsFromSuggestions,
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
        'Select two or more adjacent tokens to combine into one vocabulary item.',
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
      window.alert('Select one or more tokens first, then add as vocabulary.');
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
        Suggestions start selected. Uncheck false matches, combine adjacent
        tokens for compounds such as やって来る, then edit the dictionary form.
        Only confirmed sentences are exported to Anki.
      </p>

      <div className="row" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
        {orderedSuggestions.map((suggestion) => {
          const selected = isSuggestionSelected(suggestion);
          const combining = combineIds.has(suggestion.id);
          return (
            <div key={suggestion.id} className="row" style={{ gap: '0.25rem' }}>
              <button
                type="button"
                className={selected ? 'chip' : 'chip ghost'}
                aria-pressed={selected}
                title={`${suggestion.expression} · ${suggestion.pos || 'no POS'}`}
                onClick={() => toggleSuggestion(suggestion)}
              >
                <span className="jp">{suggestion.surface}</span>
                {suggestion.expression !== suggestion.surface ? (
                  <span className="muted">→ {suggestion.expression}</span>
                ) : null}
              </button>
              <button
                type="button"
                className={combining ? '' : 'ghost'}
                aria-pressed={combining}
                aria-label={`Mark ${suggestion.surface} for combining`}
                onClick={() => toggleCombine(suggestion.id)}
              >
                +
              </button>
            </div>
          );
        })}
      </div>

      <div className="row">
        <button type="button" onClick={combineSelected}>
          Combine marked tokens
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
