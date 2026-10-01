import { useMemo, useState } from 'react';

import type { ConstructionLayer, SentenceLearningEvent } from '../domain/types';
import { openContentReports } from '../lib/contentReports';
import { createId } from '../lib/ids';
import {
  OPERATION_LABELS,
  constructionLayerId,
  constructionRule,
  constructionTargetKey,
  layerDepth,
  layersOverlapping,
  orderLayers,
  pickConstructionCompare,
  type ConstructionCompare,
  type LayerWithSentence,
} from '../lib/phraseConstruction';
import { summariseTargetActivity, type CompareSentence } from '../lib/sentenceLearning';

import { ExcerptWithAids, type CompareAids } from './CompareExcerptView';

type LessonEvent = Omit<SentenceLearningEvent, 'timestamp' | 'bookId' | 'chapterId' | 'inventoryRevision'>;

/**
 * Collapsed-by-default "How this phrase works" for one sentence: the layers of how a phrase is built,
 * one at a time, starting with the layer that matches the current target. Reading it is supported
 * exposure only — it logs nothing as practice and creates no review. Compare uses reuses the existing
 * `compare_uses_viewed` event; "looks wrong" reuses `content_report`.
 */
export function PhraseConstructionSection({
  sentence,
  layers,
  allLayers,
  startSpan,
  episodeSentences,
  compareAids,
  events,
  visitId,
  quietMode,
  onEvent,
}: {
  sentence: CompareSentence;
  /** Validated layers of this sentence. */
  layers: ConstructionLayer[];
  /** Validated layers across the episode, for Compare uses. */
  allLayers: LayerWithSentence[];
  /** Span of the current focus target; the layer that best matches it is opened first. */
  startSpan?: { start: number; end: number };
  episodeSentences: CompareSentence[];
  compareAids?: ReadonlyMap<string, CompareAids>;
  events: SentenceLearningEvent[];
  visitId: string;
  quietMode: boolean;
  onEvent: (event: LessonEvent) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reportedNow, setReportedNow] = useState<Set<string>>(() => new Set());
  const [opened, setOpened] = useState<string[]>([]);
  const [focusId, setFocusId] = useState<string>();
  const [compare, setCompare] = useState<Record<string, ConstructionCompare | 'none'>>({});
  const [seenNow, setSeenNow] = useState<Set<string>>(() => new Set());

  const reported = useMemo(() => {
    const ids = new Set(reportedNow);
    for (const report of openContentReports(events)) if (report.sentenceId === sentence.id && report.targetKey) ids.add(report.targetKey);
    return ids;
  }, [events, reportedNow, sentence.id]);

  const visible = useMemo(
    () => layers.filter((layer) => !reported.has(constructionLayerId(sentence.id, layer))),
    [layers, reported, sentence.id],
  );
  const ordered = useMemo(() => {
    const inner = orderLayers(visible);
    const first = startSpan ? layersOverlapping(visible, startSpan)[0] : undefined;
    return first ? [first, ...inner.filter((layer) => layer !== first)] : inner;
  }, [visible, startSpan]);

  if (ordered.length === 0) return null;
  const startId = constructionLayerId(sentence.id, ordered[0]!);
  const expanded = opened.length > 0 ? opened : [startId];
  const active = ordered.find((layer) => constructionLayerId(sentence.id, layer) === (focusId ?? expanded[expanded.length - 1]));

  function toggleLayer(id: string) {
    setFocusId(id);
    setOpened(expanded.includes(id) ? expanded.filter((item) => item !== id) : [...expanded, id]);
  }

  function showCompare(layer: ConstructionLayer) {
    const id = constructionLayerId(sentence.id, layer);
    const key = constructionTargetKey(layer.key);
    const exposed = new Set([...summariseTargetActivity(events, key).comparedSentenceIds, ...seenNow]);
    const next = pickConstructionCompare({ sentenceId: sentence.id, layer }, allLayers, episodeSentences, exposed);
    setCompare((current) => ({ ...current, [id]: next ?? 'none' }));
    if (!next) return;
    setSeenNow((current) => new Set(current).add(next.other.sentenceId));
    onEvent({
      id: `${visitId}:compare:${key}:${next.other.sentenceId}`,
      visitId,
      action: 'compare_uses_viewed',
      sentenceId: sentence.id,
      target: { kind: 'grammar', key, label: constructionRule(layer)?.name ?? layer.key },
      exposedSentenceId: next.other.sentenceId,
      quietMode,
    });
  }

  function report(layer: ConstructionLayer) {
    const id = constructionLayerId(sentence.id, layer);
    onEvent({
      id: createId('sl_event'),
      visitId,
      action: 'content_report',
      sentenceId: sentence.id,
      target: { kind: 'grammar', key: id, label: layer.text },
      report: 'poor_question',
      assessmentSource: 'self',
      quietMode,
    });
    setReportedNow((current) => new Set(current).add(id));
  }

  const aids = compareAids?.get(sentence.id);

  return (
    <div className="stack phrase-construction" style={{ gap: '0.3rem' }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        How this phrase works
      </button>
      {open ? (
        <div className="stack" style={{ gap: '0.4rem' }} aria-label="How this phrase works">
          <ExcerptWithAids
            excerpt={{
              sentenceId: sentence.id,
              position: sentence.position,
              japanese: sentence.japanese,
              span: active ? { start: active.start, end: active.end } : undefined,
            }}
            aids={aids}
          />
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }} className="stack">
            {ordered.map((layer) => {
              const id = constructionLayerId(sentence.id, layer);
              const isOpen = expanded.includes(id);
              const rule = constructionRule(layer);
              const found = compare[id];
              return (
                <li key={id} className="stack" style={{ gap: '0.25rem', marginLeft: `${Math.min(layerDepth(visible, layer), 3) * 0.9}rem` }}>
                  <button type="button" aria-expanded={isOpen} onClick={() => toggleLayer(id)}>
                    <span className="jp">{layer.operation === 'role_change' ? `［${layer.text}］` : layer.text}</span>
                    {' — '}
                    {OPERATION_LABELS[layer.operation]}
                    {rule ? `: ${rule.name}` : ''}
                  </button>
                  {isOpen ? (
                    <div className="stack" style={{ gap: '0.25rem' }}>
                      <dl style={{ margin: 0 }}>
                        <dt className="muted">In this sentence</dt>
                        <dd style={{ margin: 0 }}><span className="jp">{layer.text}</span></dd>
                        {layer.from ? (<><dt className="muted">From</dt><dd style={{ margin: 0 }}><span className="jp">{layer.from}</span></dd></>) : null}
                        <dt className="muted">How it attaches</dt>
                        <dd style={{ margin: 0 }}>{layer.attach}</dd>
                        <dt className="muted">What it does here</dt>
                        <dd style={{ margin: 0 }}>
                          {layer.contribution}
                          {layer.use ? <span className="muted"> ({layer.use})</span> : null}
                        </dd>
                        {layer.scope ? (<><dt className="muted">Applies to</dt><dd style={{ margin: 0 }}>{layer.scope}</dd></>) : null}
                      </dl>
                      {rule ? (
                        <div className="stack" style={{ gap: '0.1rem' }} aria-label={`Use this elsewhere: ${rule.name}`}>
                          <strong>Use this elsewhere</strong>
                          <div>{rule.formation}</div>
                          <div>{rule.function}</div>
                          {rule.caution ? <div className="muted">Careful: {rule.caution}</div> : null}
                          {rule.source === 'draft' ? <div className="muted">This rule is an AI draft and has not been checked.</div> : null}
                        </div>
                      ) : null}
                      <div className="row" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
                        {layer.operation !== 'unit' ? (
                          <button type="button" aria-expanded={!!found && found !== 'none'} onClick={() => (found && found !== 'none' ? setCompare((current) => ({ ...current, [id]: 'none' })) : showCompare(layer))}>
                            Compare uses
                          </button>
                        ) : null}
                        <button type="button" onClick={() => report(layer)}>This explanation looks wrong</button>
                      </div>
                      {found === 'none' ? <div className="muted">No other reliable use of this construction in this episode.</div> : null}
                      {found && found !== 'none' ? (
                        <div className="stack" style={{ gap: '0.25rem' }} aria-label={`Compare uses of ${rule?.name ?? layer.key}`}>
                          <div className="muted">This sentence:</div>
                          <ExcerptWithAids excerpt={found.current} aids={compareAids?.get(found.current.sentenceId)} />
                          <div className="muted">Same construction (sentence {found.other.position} of this episode):</div>
                          <ExcerptWithAids excerpt={found.other} aids={compareAids?.get(found.other.sentenceId)} />
                          <div className="muted">
                            {found.otherLayer.contribution}
                            {found.differentUse ? ` Similar form, different use: “${layer.use}” here, “${found.otherLayer.use}” there.` : ''}
                            {found.differentWords ? ' Different words, same construction.' : ''}
                          </div>
                          <div>What stays the same? What changes here?</div>
                          {found.remainingUnseen > 0 ? <button type="button" onClick={() => showCompare(layer)}>Show another example</button> : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="muted" style={{ fontSize: '0.8rem' }}>
            AI-drafted explanation, not checked by you. Reading it is not practice and does not change your review schedule.
          </div>
        </div>
      ) : null}
    </div>
  );
}
