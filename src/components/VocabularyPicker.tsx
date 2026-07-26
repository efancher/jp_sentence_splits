import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import type {
  VocabularyReviewStatus,
  VocabularySelection,
  VocabularySuggestion,
} from '../domain/types';
import { createId } from '../lib/ids';
import {
  buildMorphStrip,
  canMergeSuggestionIntoSelection,
  defaultSelectionsFromSuggestions,
  isContentPos,
  mergeSuggestionIntoSelection,
  selectionCoversSuggestion,
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

const TRAY_ID = 'tray';
const TRASH_ID = 'trash';
const STRIP_ID = 'strip';

function sugId(id: string): string {
  return `sug:${id}`;
}

function selDropId(id: string): string {
  return `sel:${id}`;
}

function selDragId(id: string): string {
  return `sel-drag:${id}`;
}

function parseSugId(id: string): string | null {
  return id.startsWith('sug:') ? id.slice(4) : null;
}

function parseSelDropId(id: string): string | null {
  return id.startsWith('sel:') && !id.startsWith('sel-drag:')
    ? id.slice(4)
    : null;
}

function parseSelDragId(id: string): string | null {
  return id.startsWith('sel-drag:') ? id.slice(9) : null;
}

function MorphChipContent({
  surface,
  expression,
  reading,
}: {
  surface: string;
  expression?: string;
  reading?: string;
}) {
  const lemmaDiffers =
    expression != null &&
    expression.trim() !== '' &&
    expression.trim() !== surface.trim();
  return (
    <>
      <span className="vocab-morph-surface jp">{surface}</span>
      {reading ? (
        <span className="vocab-morph-reading muted">{reading}</span>
      ) : null}
      {lemmaDiffers ? (
        <span className="vocab-morph-lemma muted">→ {expression}</span>
      ) : null}
    </>
  );
}

function DraggableMorphPiece({
  suggestion,
  selected,
  dragging,
  onToggle,
}: {
  suggestion: VocabularySuggestion;
  selected: boolean;
  dragging: boolean;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: sugId(suggestion.id),
      data: { type: 'suggestion', suggestion },
    });
  const content = isContentPos(suggestion.pos);
  const style: CSSProperties = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: isDragging || dragging ? 0.35 : 1,
      }
    : { opacity: isDragging || dragging ? 0.35 : 1 };
  const classes = [
    'vocab-morph-piece',
    selected ? 'is-selected' : '',
    content ? 'is-content' : 'is-function',
    isDragging ? 'is-dragging' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={classes}
      style={style}
      title={[
        selected ? 'Selected for Anki' : 'Not selected',
        'Drag into the tray or onto a selected card to combine',
        suggestion.expression,
        suggestion.reading,
        suggestion.pos || 'no POS',
      ]
        .filter(Boolean)
        .join(' · ')}
      onClick={onToggle}
      {...listeners}
      {...attributes}
      aria-pressed={selected}
    >
      <MorphChipContent
        surface={suggestion.surface}
        expression={suggestion.expression}
        reading={suggestion.reading}
      />
    </button>
  );
}

function DroppableStrip({
  activeSelection,
  children,
}: {
  activeSelection: VocabularySelection | null;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: STRIP_ID,
    data: { type: 'strip' },
  });
  return (
    <div
      ref={setNodeRef}
      className={[
        'vocab-morph-strip',
        activeSelection && isOver ? 'is-drop-target' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="group"
      aria-label="Morphology chunks in sentence order"
    >
      {children}
    </div>
  );
}

function DroppableTrash({
  activeSelection,
}: {
  activeSelection: VocabularySelection | null;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: TRASH_ID,
    data: { type: 'trash' },
  });
  return (
    <div
      ref={setNodeRef}
      className={[
        'vocab-remove-zone',
        activeSelection ? 'is-active' : '',
        isOver ? 'is-drop-over' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label="Drop selected vocabulary here to remove"
    >
      {activeSelection
        ? 'Drop here to remove from Anki'
        : 'Drag a selected card here (or back to the strip) to remove'}
    </div>
  );
}

function DroppableTray({
  activeSuggestion,
  children,
}: {
  activeSuggestion: VocabularySuggestion | null;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: TRAY_ID,
    data: { type: 'tray' },
  });
  return (
    <div
      ref={setNodeRef}
      className={[
        'vocab-selected-tray',
        isOver && activeSuggestion ? 'is-drop-over' : '',
        activeSuggestion ? 'is-drop-target' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}

function SelectedCard({
  item,
  japanese,
  open,
  dropState,
  onToggleEdit,
  onRemove,
  onUpdate,
}: {
  item: VocabularySelection;
  japanese: string;
  open: boolean;
  dropState: 'valid' | 'invalid' | null;
  onToggleEdit: () => void;
  onRemove: () => void;
  onUpdate: (patch: Partial<VocabularySelection>) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    transform,
    isDragging,
  } = useDraggable({
    id: selDragId(item.id),
    data: { type: 'selection', selection: item },
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: selDropId(item.id),
    data: { type: 'selection', selection: item },
  });

  const spanOk =
    Boolean(item.surface) &&
    validateSpan(japanese, item.start, item.end, item.surface);
  const style: CSSProperties = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: isDragging ? 0.45 : 1,
        boxShadow: 'none',
      }
    : { opacity: isDragging ? 0.45 : 1, boxShadow: 'none' };
  const classes = [
    'vocab-selected-card',
    'panel',
    dropState === 'valid' ? 'is-drop-target' : '',
    dropState === 'invalid' ? 'is-drop-invalid' : '',
    isOver && dropState === 'valid' ? 'is-drop-over' : '',
    isDragging ? 'is-dragging' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={(node) => {
        setDropRef(node);
        setDragRef(node);
      }}
      className={classes}
      style={style}
    >
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button
          type="button"
          className="vocab-selected-drag ghost"
          aria-label={`Drag ${item.surface || 'selection'} to remove zone`}
          title="Drag to Remove zone to unselect"
          {...listeners}
          {...attributes}
        >
          ⠿
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="jp">
            {item.surface || '(no surface)'}
            {item.expression ? (
              <span className="muted"> → {item.expression}</span>
            ) : null}
          </div>
          {item.source === 'combined' ? (
            <div className="muted">Combined from adjacent pieces</div>
          ) : null}
          {!spanOk ? (
            <div style={{ color: 'var(--danger)' }}>
              Span does not match the sentence
            </div>
          ) : null}
        </div>
        <div className="row">
          <button type="button" className="ghost" onClick={onToggleEdit}>
            {open ? 'Hide' : 'Edit'}
          </button>
          <button type="button" className="ghost" onClick={onRemove}>
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
                onUpdate({
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
              onChange={(event) => onUpdate({ expression: event.target.value })}
            />
          </label>
          <label>
            Reading
            <input
              className="jp"
              value={item.reading}
              onChange={(event) => onUpdate({ reading: event.target.value })}
            />
          </label>
          <label>
            Meaning (optional)
            <input
              value={item.english ?? ''}
              onChange={(event) => onUpdate({ english: event.target.value })}
            />
          </label>
        </div>
      ) : null}
    </div>
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 6 },
    }),
  );

  const orderedSuggestions = useMemo(
    () => [...suggestions].sort((a, b) => a.start - b.start),
    [suggestions],
  );

  const strip = useMemo(
    () => buildMorphStrip(japanese, orderedSuggestions),
    [japanese, orderedSuggestions],
  );

  const suggestionById = useMemo(() => {
    const map = new Map<string, VocabularySuggestion>();
    for (const item of orderedSuggestions) map.set(item.id, item);
    return map;
  }, [orderedSuggestions]);

  const selectionById = useMemo(() => {
    const map = new Map<string, VocabularySelection>();
    for (const item of selections) map.set(item.id, item);
    return map;
  }, [selections]);

  const activeSuggestion = useMemo(() => {
    if (!activeDragId) return null;
    const id = parseSugId(activeDragId);
    return id ? (suggestionById.get(id) ?? null) : null;
  }, [activeDragId, suggestionById]);

  const activeSelection = useMemo(() => {
    if (!activeDragId) return null;
    const id = parseSelDragId(activeDragId);
    return id ? (selectionById.get(id) ?? null) : null;
  }, [activeDragId, selectionById]);

  function setSelections(
    next: VocabularySelection[],
    status: VocabularyReviewStatus = 'unreviewed',
  ) {
    onChange({ selections: next, reviewStatus: status });
  }

  function isSuggestionSelected(suggestion: VocabularySuggestion): boolean {
    return selections.some((item) =>
      selectionCoversSuggestion(item, suggestion),
    );
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

  function updateSelection(id: string, patch: Partial<VocabularySelection>) {
    setSelections(
      selections.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function removeSelection(id: string) {
    setSelections(selections.filter((item) => item.id !== id));
  }

  function resetToDefaults() {
    setSelections(defaultSelectionsFromSuggestions(suggestions, japanese));
    setEditingId(null);
  }

  function clearSelections() {
    setSelections([]);
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

  function handleDragStart(event: DragStartEvent) {
    setActiveDragId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    setActiveDragId(null);
    if (!overId) return;

    const draggedSugId = parseSugId(activeId);
    const draggedSelId = parseSelDragId(activeId);

    if (draggedSugId) {
      const suggestion = suggestionById.get(draggedSugId);
      if (!suggestion) return;

      if (overId === TRAY_ID) {
        if (isSuggestionSelected(suggestion)) return;
        setSelections([...selections, selectionFromSuggestion(suggestion)]);
        return;
      }

      const targetSelId = parseSelDropId(overId);
      if (targetSelId) {
        const target = selectionById.get(targetSelId);
        if (!target) return;
        if (selectionCoversSuggestion(target, suggestion)) return;
        if (!canMergeSuggestionIntoSelection(suggestion, target, japanese)) {
          window.alert(
            `"${suggestion.surface}" is not adjacent to “${target.surface}”. Drop it on a neighboring card, or into the tray as its own word.`,
          );
          return;
        }
        const merged = mergeSuggestionIntoSelection(
          suggestion,
          target,
          japanese,
        );
        if (!merged) return;
        const next = selections
          .filter(
            (item) =>
              item.id === target.id ||
              item.end <= merged.start ||
              item.start >= merged.end,
          )
          .map((item) => (item.id === target.id ? merged : item));
        if (!next.some((item) => item.id === merged.id)) {
          next.push(merged);
        }
        setSelections(next);
        setEditingId(merged.id);
      }
      return;
    }

    if (draggedSelId) {
      if (overId === TRASH_ID || overId === STRIP_ID) {
        removeSelection(draggedSelId);
      }
    }
  }

  function cardDropState(
    selection: VocabularySelection,
  ): 'valid' | 'invalid' | null {
    if (!activeSuggestion) return null;
    if (selectionCoversSuggestion(selection, activeSuggestion)) return null;
    return canMergeSuggestionIntoSelection(
      activeSuggestion,
      selection,
      japanese,
    )
      ? 'valid'
      : 'invalid';
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
        Drag a piece into the tray to select it, or onto an adjacent selected
        card to combine (e.g. やっ onto て → やって). Tap still toggles
        selection. On phones, press-and-hold briefly, then drag. Content words
        start selected.
      </p>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveDragId(null)}
      >
        <DroppableStrip activeSelection={activeSelection}>
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
            return (
              <DraggableMorphPiece
                key={suggestion.id}
                suggestion={suggestion}
                selected={isSuggestionSelected(suggestion)}
                dragging={activeDragId === sugId(suggestion.id)}
                onToggle={() => toggleSuggestion(suggestion)}
              />
            );
          })}
        </DroppableStrip>

        <DroppableTrash activeSelection={activeSelection} />

        <DroppableTray activeSuggestion={activeSuggestion}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h4 style={{ margin: 0 }}>
              Selected for Anki ({selections.length})
            </h4>
            <span className="muted vocab-tray-hint">
              Drop here to add as its own word
            </span>
          </div>

          {selections.length ? (
            <div className="stack" style={{ gap: '0.65rem' }}>
              {selections.map((item) => (
                <SelectedCard
                  key={item.id}
                  item={item}
                  japanese={japanese}
                  open={editingId === item.id}
                  dropState={cardDropState(item)}
                  onToggleEdit={() =>
                    setEditingId(editingId === item.id ? null : item.id)
                  }
                  onRemove={() => removeSelection(item.id)}
                  onUpdate={(patch) => updateSelection(item.id, patch)}
                />
              ))}
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Tray is empty — drag pieces here, or tap them in the strip above.
            </p>
          )}
        </DroppableTray>

        <DragOverlay dropAnimation={null}>
          {activeSuggestion ? (
            <div className="vocab-morph-piece is-content vocab-drag-overlay">
              <MorphChipContent
                surface={activeSuggestion.surface}
                expression={activeSuggestion.expression}
                reading={activeSuggestion.reading}
              />
            </div>
          ) : activeSelection ? (
            <div className="vocab-selected-card panel vocab-drag-overlay">
              <div className="jp">
                {activeSelection.surface || '(no surface)'}
                {activeSelection.expression ? (
                  <span className="muted"> → {activeSelection.expression}</span>
                ) : null}
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="ghost" onClick={resetToDefaults}>
          Reset defaults
        </button>
        <button type="button" className="ghost" onClick={clearSelections}>
          Clear all
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

      <div className="row">
        <button type="button" onClick={confirm}>
          {hasNext ? 'Confirm vocabulary and next' : 'Confirm vocabulary'}
        </button>
      </div>
    </section>
  );
}
