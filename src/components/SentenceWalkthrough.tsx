import { useEffect, useMemo, useState } from 'react';

import { FuriganaText } from '../lib/furigana';
import { glossesFromWords } from '../lib/chunkGlosses';
import { registerReportContext } from '../lib/reportContext';

import type { AnalysisChunk, ConstructionLayer, ContextWalkthrough, GlossDecision, ParticleCheck, Sentence, StructureDraftChunk, SentenceAudio, SentenceLearningEvent } from '../domain/types';
import { validWalkthroughFor } from '../lib/contextWalkthrough';
import { previewHeuristicChunks } from '../lib/analysisHelpers';
import { assignClauseIndices, isClauseConnectorRole, isEngineRole } from '../lib/clauseBands';
import type { EpisodeFocusTarget } from '../lib/episodeFocus';
import { chunksMatchSource } from '../lib/chunking';
import { createId } from '../lib/ids';
import { roleGuideBlurb } from '../lib/roleGuide';
import { layersOverlapping, validLayersFor, type LayerWithSentence } from '../lib/phraseConstruction';
import { locateTargetSpan, selectSentenceTargets, type CompareSentence } from '../lib/sentenceLearning';

import { ChunkPuzzleStrip } from './ChunkPuzzleStrip';
import { ContextStepCard, HighlightedSentence, ParticipantList, WalkthroughCheckView, WalkthroughContentImport, type RoleHelp } from './ContextWalkthroughView';
import { buildCheckPuzzle } from '../lib/earTiles';
import { parkedDecisionKeys } from '../lib/glossSkill';

import { buildStructureChecks } from '../lib/structureChecks';

import { EarTilesCheck } from './EarTilesCheck';
import { StructureChecks } from './StructureChecks';
import { GlossDecisionPanel, planGlossDecisions, type GlossDecisionInput } from './GlossDecisionPanel';
import { SentenceExpressionCard, meaningUnits } from './SentenceExpressionCard';
import { NativeAudioButton } from './NativeAudioButton';
import { PhraseConstructionSection } from './PhraseConstructionSection';
import { TargetLessonCard, WordGlossList, type CompareAids, type LessonEventInput } from './TargetLessonCard';

export type SupportPreset = 'full' | 'less' | 'minimal';
const PRESET_KEY = 'glossbook.walkthroughSupport';
const PRESET_LABELS: Record<SupportPreset, string> = {
  full: 'Full help: role, gloss and explanation',
  less: 'Less help: role and gloss, explanation on request',
  minimal: 'Minimal: just the chunk, everything else on request',
};

function readPreset(): SupportPreset {
  try {
    const value = window.localStorage.getItem(PRESET_KEY);
    return value === 'less' || value === 'minimal' ? value : 'full';
  } catch {
    return 'full';
  }
}

export interface WalkthroughChunk {
  id: string;
  japanese: string;
  role: string;
  literalEnglish?: string;
  notes?: string;
}

/**
 * Prefer the learner's saved analysis; otherwise fall back to the generic
 * heuristic draft so the walkthrough never waits on analysis or vocabulary.
 * Zero-が chunks are inferred structure, not source text, so they are skipped.
 */
export function walkthroughChunks(
  sentence: Pick<Sentence, 'id' | 'japanese'>,
  saved?: AnalysisChunk[],
  aiDraft?: StructureDraftChunk[],
): { chunks: WalkthroughChunk[]; source: 'saved' | 'ai_draft' | 'draft' } {
  const surface = (saved ?? [])
    .filter((chunk) => chunk.kind !== 'zero_ga' && chunk.japanese)
    .sort((a, b) => a.order - b.order);
  if (surface.length > 0 && surface.map((chunk) => chunk.japanese).join('') === sentence.japanese.replace(/\s+/g, '')) {
    return {
      source: 'saved',
      chunks: surface.map((chunk) => ({
        id: chunk.id, japanese: chunk.japanese, role: chunk.role,
        literalEnglish: chunk.literalEnglish || undefined, notes: chunk.notes || undefined,
      })),
    };
  }
  if (aiDraft && aiDraft.length > 0 && chunksMatchSource(aiDraft.map((chunk) => chunk.japanese), sentence.japanese)) {
    return {
      source: 'ai_draft',
      chunks: aiDraft.map((chunk, index) => ({
        id: `${sentence.id}-ai-${index}`, japanese: chunk.japanese, role: chunk.role,
        literalEnglish: chunk.literalEnglish,
      })),
    };
  }
  const preview = previewHeuristicChunks(sentence.japanese);
  return {
    source: 'draft',
    chunks: preview.parts.map((japanese, index) => ({
      id: `${sentence.id}-draft-${index}`, japanese, role: preview.roles[index] ?? '',
    })),
  };
}

/**
 * Clause-local Cure Dolly sequence: clauses in source order; within each, any leading connector
 * (the link from the previous clause) first, then the engine, then the other parts in source order.
 * A one-clause sentence is simply engine first, then the rest. Clauses come from role banding, not a
 * full parse.
 */
export function walkthroughOrder<T extends { role: string }>(chunks: T[]): T[] {
  const clauseOf = assignClauseIndices(chunks);
  const clauses: T[][] = [];
  chunks.forEach((chunk, index) => (clauses[clauseOf[index]!] ??= []).push(chunk));
  return clauses.flatMap((clause, index) => {
    const connectors = index > 0 ? clause.filter((chunk, position) => position === 0 && isClauseConnectorRole(chunk.role)) : [];
    const rest = clause.filter((chunk) => !connectors.includes(chunk));
    return [...connectors, ...rest.filter((chunk) => isEngineRole(chunk.role)), ...rest.filter((chunk) => !isEngineRole(chunk.role))];
  });
}

/** 1-based clause number per chunk, in source order; used only to label multi-clause steps. */
export function walkthroughClauseNumbers<T extends { role: string }>(chunks: T[]): Map<T, number> {
  const clauseOf = assignClauseIndices(chunks);
  return new Map(chunks.map((chunk, index) => [chunk, clauseOf[index]! + 1]));
}

const STAGES = ['Understand', 'Recognise', 'Recall', 'Use', 'Say it', 'Express it your way'];

export function SentenceWalkthrough({
  sentence,
  savedChunks,
  structureDraft,
  audio,
  focusTargets,
  episodeSentences = [],
  compareAids,
  constructionDrafts,
  contextWalkthrough,
  importTarget,
  events = [],
  onEvent,
  glossRecords,
  onGlossDecision,
  skipCheck = false,
  knownRatio,
  particleChecks,
  quietMode,
  shadowHref,
  onQuietModeChange,
  onClose,
}: {
  sentence: Sentence;
  savedChunks?: AnalysisChunk[];
  structureDraft?: StructureDraftChunk[];
  audio?: SentenceAudio;
  focusTargets: EpisodeFocusTarget[];
  /** The whole episode, for "Compare uses" excerpts. */
  episodeSentences?: CompareSentence[];
  /** Translation, word glosses and native audio per episode sentence, shown under Compare uses excerpts. */
  compareAids?: ReadonlyMap<string, CompareAids>;
  /** AI-drafted construction layers per sentence id (validated against the live text here). */
  constructionDrafts?: Record<string, ConstructionLayer[]>;
  /** AI-drafted contextual walkthrough for this sentence; the main content when it still matches the text. */
  contextWalkthrough?: ContextWalkthrough;
  /** Where to save a contextual walkthrough for this sentence (enables the "add one" panel on older sentences). */
  importTarget?: { bookId: string; chapterId: string };
  /** Earlier lesson events for this book, to show what has been practised/compared. */
  events?: SentenceLearningEvent[];
  onEvent?: (event: LessonEventInput) => void;
  /** Earlier structural decisions (progressive glossing). With `onGlossDecision`, the walkthrough opens on a "try it first" check. */
  glossRecords?: GlossDecision[];
  onGlossDecision?: (decision: GlossDecisionInput) => void;
  /** Open past the "try it first" check with English under the chunks (arrived from a missed review card, so the answer is already seen). */
  skipCheck?: boolean;
  /** Share of this sentence's content words already known (advisory readiness; thin opens the glosses). */
  knownRatio?: number;
  /** Authored contextual particle questions for this sentence (SentenceAnalysis.particleChecks). */
  particleChecks?: ParticleCheck[];
  quietMode: boolean;
  shadowHref?: string;
  onQuietModeChange: (quiet: boolean) => void;
  onClose: () => void;
}) {
  const { chunks, source } = useMemo(() => walkthroughChunks(sentence, savedChunks, structureDraft), [sentence, savedChunks, structureDraft]);
  const ordered = useMemo(() => walkthroughOrder(chunks), [chunks]);
  const clauseNumbers = useMemo(() => walkthroughClauseNumbers(chunks), [chunks]);
  const clauseCount = useMemo(() => new Set(clauseNumbers.values()).size, [clauseNumbers]);
  const contextual = useMemo(() => validWalkthroughFor(sentence.japanese, contextWalkthrough), [sentence.japanese, contextWalkthrough]);
  const stepCount = contextual ? contextual.steps.length : ordered.length;
  const chunkSpans = useMemo(() => {
    if (chunks.map((item) => item.japanese).join('') !== sentence.japanese) return undefined;
    let at = 0;
    return chunks.map((item) => {
      const span = { start: at, end: at + item.japanese.length };
      at = span.end;
      return { ...item, ...span };
    });
  }, [chunks, sentence.japanese]);
  const [step, setStep] = useState(0);
  const visitId = useMemo(() => createId('visit'), []);
  // Sentences with audio open on the ear-tiles check, unless earlier checks on it are parked for a retry.
  const tilePuzzle = useMemo(
    () =>
      !skipCheck && audio && onGlossDecision != null && glossRecords != null && !parkedDecisionKeys(glossRecords).has(sentence.id)
        ? buildCheckPuzzle(sentence, visitId)
        : null,
    // Chosen once per opening so the bank doesn't reshuffle under the learner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visitId, sentence.id],
  );
  const structureChecks = useMemo(
    () => buildStructureChecks(chunks.map(({ id, japanese, role, literalEnglish }) => ({ id, japanese, role, literalEnglish })), visitId),
    [chunks, visitId],
  );
  const hasStructureChecks = structureChecks.roles != null || structureChecks.describes != null;
  const [tilesDone, setTilesDone] = useState(false);
  const [tryFirst, setTryFirst] = useState(() =>
    !skipCheck && onGlossDecision != null && glossRecords != null && (tilePuzzle != null || planGlossDecisions(walkthroughChunks(sentence, savedChunks, structureDraft).chunks, glossRecords, new Date(), sentence.id, particleChecks).length > 0));
  const [showTranslation, setShowTranslation] = useState(false);
  const [showFurigana, setShowFurigana] = useState(false);
  const [stickyEnglish, setStickyEnglish] = useState(false);
  const wordGlosses = useMemo(
    () => glossesFromWords(chunks, compareAids?.get(sentence.id)?.words ?? []),
    [chunks, compareAids, sentence.id],
  );
  const [glossUnderChunks, setGlossUnderChunks] = useState(skipCheck);
  const [englishBefore, setEnglishBefore] = useState(0);
  const [englishAfter, setEnglishAfter] = useState(0);
  const contextStep = contextual?.steps[step];
  const chunk = contextual ? undefined : ordered[step];
  const done = step >= stepCount;
  const roleHelp: RoleHelp[] = contextStep && chunkSpans
    ? chunkSpans
        .filter((item) => item.start < contextStep.end && contextStep.start < item.end)
        .map((item) => ({ japanese: item.japanese, role: item.role, blurb: roleGuideBlurb(item.role) }))
    : [];
  const revealedIds = new Set(ordered.slice(0, step + 1).map((item) => item.id));
  const here = focusTargets.filter((target) => target.sentenceIds.includes(sentence.id));
  const [showAllTargets, setShowAllTargets] = useState(false);
  const [gist, setGist] = useState<'closed' | 'asking' | 'revealed' | 'recorded'>('closed');
  const [gistAnswer, setGistAnswer] = useState('');
  const [expressing, setExpressing] = useState(false);
  const [preset, setPresetState] = useState<SupportPreset>(readPreset);
  const [askedFor, setAskedFor] = useState<{ role: Set<number>; gloss: Set<number>; why: Set<number> }>({ role: new Set(), gloss: new Set(), why: new Set() });
  const setPreset = (value: SupportPreset) => {
    setPresetState(value);
    try { window.localStorage.setItem(PRESET_KEY, value); } catch { /* preference is best-effort */ }
  };
  const ask = (kind: 'role' | 'gloss' | 'why') =>
    setAskedFor((current) => ({ ...current, [kind]: new Set(current[kind]).add(step) }));
  const emit = (event: LessonEventInput) => onEvent?.({ ...event, helpLevel: preset });
  const showRole = preset !== 'minimal' || askedFor.role.has(step);
  const showGloss = preset !== 'minimal' || askedFor.gloss.has(step);
  const showWhy = preset === 'full' || askedFor.why.has(step);
  // Chosen once per opening so practising a card doesn't reshuffle or hide it under the learner.
  const [{ shown: shownTargets, hidden: hiddenTargets }] = useState(() => selectSentenceTargets(here, events));
  const blurb = chunk ? roleGuideBlurb(chunk.role) : undefined;
  const constructions = useMemo(() => {
    const sentenceLayers = validLayersFor(sentence.japanese, constructionDrafts?.[sentence.id]);
    const allLayers: LayerWithSentence[] = [];
    for (const item of episodeSentences) {
      for (const layer of validLayersFor(item.japanese, constructionDrafts?.[item.id])) allLayers.push({ ...layer, sentenceId: item.id });
    }
    return { sentenceLayers, allLayers };
  }, [constructionDrafts, episodeSentences, sentence.id, sentence.japanese]);
  const currentCompareSentence = episodeSentences.find((item) => item.id === sentence.id);
  const targetsWithLayers = new Set<string>();
  for (const target of [...shownTargets, ...hiddenTargets]) {
    const span = currentCompareSentence
      ? locateTargetSpan({ key: target.id, label: target.label, sentenceIds: target.sentenceIds, occurrences: target.occurrences }, currentCompareSentence)
      : undefined;
    if (span && layersOverlapping(constructions.sentenceLayers, span).length > 0) targetsWithLayers.add(target.id);
  }

  function recordGist(outcome: 'got_it' | 'needed_help') {
    emit({ id: createId('sl_event'), visitId, action: 'gist_check', sentenceId: sentence.id, outcome, assessmentSource: 'self', quietMode });
    setGist('recorded');
  }

  useEffect(() => {
    emit({ id: `${visitId}:opened`, visitId, action: 'walkthrough_opened', sentenceId: sentence.id, quietMode });
    // Once per opening; quietMode at that moment is what is recorded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId, sentence.id]);

  useEffect(() => {
    if (done && stepCount > 0) emit({ id: `${visitId}:completed`, visitId, action: 'walkthrough_completed', sentenceId: sentence.id, quietMode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  useEffect(() =>
    registerReportContext('walkthrough', () => ({
      sentenceId: sentence.id,
      japanese: sentence.japanese,
      chunkSource: source,
      contextualWalkthrough: contextual ? { steps: contextual.steps.length, savedSteps: contextWalkthrough?.steps.length ?? 0 } : contextWalkthrough ? 'saved but no longer matches the sentence' : null,
      savedAnalysisChunkCount: savedChunks?.length ?? 0,
      structureDraftReceived: structureDraft ? { chunkCount: structureDraft.length, rebuildsSentence: chunksMatchSource(structureDraft.map((chunk) => chunk.japanese), sentence.japanese) } : null,
      chunks: chunks.map((item) => ({ japanese: item.japanese, role: item.role, literalEnglish: item.literalEnglish ?? null, wordListGloss: wordGlosses.get(item.id) ?? null })),
      step,
      tryFirst,
      preset,
      stickyEnglish,
      glossUnderChunks,
    })));

  if (expressing) {
    return (
      <SentenceExpressionCard
        sentence={sentence}
        translation={sentence.translation ?? ''}
        units={meaningUnits(chunks, sentence.translation ?? '')}
        visitId={visitId}
        quietMode={quietMode}
        wordBank={[...new Set(sentence.vocabularySuggestions.filter((item) => item.selectedByDefault).map((item) => item.expression))]}
        shadowHref={audio ? shadowHref : undefined}
        onEvent={emit}
        onClose={() => setExpressing(false)}
      />
    );
  }

  return (
    <section className="panel stack sentence-walkthrough" aria-label="Sentence walkthrough" style={{ gap: '0.5rem' }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <strong>Walk through this sentence</strong>
        <button type="button" onClick={onClose}>Back to reading</button>
      </div>
      <div
        className="stack"
        style={{ gap: '0.25rem', position: 'sticky', top: 0, zIndex: 5, background: 'var(--bg-elevated)', padding: '0.3rem 0', borderBottom: stickyEnglish ? '1px solid currentColor' : undefined }}
        aria-label="Sticky English"
      >
        <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" aria-pressed={stickyEnglish} onClick={() => setStickyEnglish((on) => !on)}>
            {stickyEnglish ? 'Hide English' : 'Show English'}
          </button>
          <button type="button" aria-pressed={glossUnderChunks} onClick={() => setGlossUnderChunks((on) => !on)}>
            {glossUnderChunks ? 'Hide English under chunks' : 'English under chunks'}
          </button>
          {stickyEnglish ? (
            <>
              <label className="row" style={{ gap: '0.3rem' }}>
                <span className="muted">Before</span>
                <select aria-label="Sentences of English before" value={englishBefore} onChange={(event) => setEnglishBefore(Number(event.target.value))}>
                  {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="row" style={{ gap: '0.3rem' }}>
                <span className="muted">After</span>
                <select aria-label="Sentences of English after" value={englishAfter} onChange={(event) => setEnglishAfter(Number(event.target.value))}>
                  {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </>
          ) : null}
        </div>
        {stickyEnglish ? (() => {
          const at = episodeSentences.findIndex((item) => item.id === sentence.id);
          const lines = at < 0
            ? [{ id: sentence.id, translation: sentence.translation, current: true }]
            : episodeSentences
                .slice(Math.max(0, at - englishBefore), at + englishAfter + 1)
                .map((item) => ({ id: item.id, translation: item.translation, current: item.id === sentence.id }));
          return lines.map((line) => (
            <div key={line.id} className={line.current ? undefined : 'muted'} style={{ fontWeight: line.current ? 600 : undefined }}>
              {line.translation?.trim() || '(no translation saved)'}
            </div>
          ));
        })() : null}
      </div>
      <ol className="muted" aria-label="Learning stages" style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem' }}>
        {STAGES.map((stage, index) => (
          <li key={stage} aria-current={index === 0 ? 'step' : undefined}>
            {stage}{index === 0 ? ' — guided here' : ' — not assessed yet'}
          </li>
        ))}
      </ol>
      <label className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
        <span className="muted">Help level</span>
        <select aria-label="Help level" value={preset} onChange={(event) => setPreset(event.target.value as SupportPreset)}>
          {(Object.keys(PRESET_LABELS) as SupportPreset[]).map((key) => <option key={key} value={key}>{PRESET_LABELS[key]}</option>)}
        </select>
      </label>
      {tryFirst && onGlossDecision && tilePuzzle && audio && !tilesDone ? (
        <EarTilesCheck
          sentenceId={sentence.id}
          visitId={visitId}
          puzzle={tilePuzzle}
          audio={audio}
          onRecord={onGlossDecision}
          onFinish={() => (hasStructureChecks ? setTilesDone(true) : setTryFirst(false))}
        />
      ) : null}
      {tryFirst && onGlossDecision && tilePuzzle && tilesDone ? (
        <StructureChecks
          sentenceId={sentence.id}
          visitId={visitId}
          checks={structureChecks}
          onRecord={onGlossDecision}
          onFinish={() => setTryFirst(false)}
        />
      ) : null}
      {tryFirst && onGlossDecision && !tilePuzzle ? (
        <GlossDecisionPanel
          sentenceId={sentence.id}
          visitId={visitId}
          chunks={chunks.map(({ id, japanese, role, literalEnglish }) => ({ id, japanese, role, literalEnglish }))}
          records={glossRecords ?? []}
          translation={sentence.translation}
          words={compareAids?.get(sentence.id)?.words ?? []}
          knownRatio={knownRatio}
          particleChecks={particleChecks}
          onRecord={onGlossDecision}
          onFinish={() => setTryFirst(false)}
        />
      ) : null}
      {tryFirst ? null : contextual ? (
        <>
          {sentence.inlineReading ? (
            <button type="button" aria-pressed={showFurigana} onClick={() => setShowFurigana((value) => !value)} style={{ alignSelf: 'flex-start' }}>
              {showFurigana ? 'Hide furigana' : 'Show furigana'}
            </button>
          ) : null}
          <HighlightedSentence
            japanese={sentence.japanese}
            main={contextStep}
            connect={contextStep?.connects}
            inlineReading={showFurigana ? sentence.inlineReading : undefined}
          />
          <details>
            <summary className="muted">Chunk view (generic roles)</summary>
            <ChunkPuzzleStrip
              chunks={chunks.map(({ id, japanese, role, literalEnglish }) => ({ id, japanese, role, gloss: literalEnglish || wordGlosses.get(id) }))}
              showGloss={glossUnderChunks}
              revealRoles={preset !== 'minimal'}
            />
          </details>
        </>
      ) : <ChunkPuzzleStrip
        chunks={chunks.map(({ id, japanese, role, literalEnglish }) => ({ id, japanese, role, gloss: literalEnglish || wordGlosses.get(id) }))}
        showGloss={glossUnderChunks}
        revealedIds={done ? undefined : revealedIds}
        revealRoles={preset !== 'minimal'}
      />}
      {tryFirst ? <button type="button" onClick={() => setTryFirst(false)}>Skip the check, just walk through</button> : done ? (
        <div className="stack" style={{ gap: '0.35rem' }}>
          {contextual ? null : showFurigana && sentence.inlineReading ? <FuriganaText className="jp jp-lg" text={sentence.inlineReading} /> : <div className="jp jp-lg">{sentence.japanese}</div>}
          {contextual && gist !== 'asking' ? (
            <div className="stack" style={{ gap: '0.2rem' }} aria-label="Putting it together">
              <strong>Putting it together</strong>
              <div>{contextual.natural}</div>
              {contextual.caveat ? <div className="muted"><strong>Depends on context: </strong>{contextual.caveat}</div> : null}
              {contextual.participants?.length ? <ParticipantList participants={contextual.participants} /> : null}
              {contextual.check ? <WalkthroughCheckView check={contextual.check} /> : null}
            </div>
          ) : null}
          {gist === 'closed' && !showTranslation && sentence.translation?.trim() ? (
            <button type="button" onClick={() => setGist('asking')}>Check my understanding</button>
          ) : null}
          {gist === 'asking' ? (
            <div className="stack" style={{ gap: '0.25rem' }} aria-label="Understanding check" aria-live="polite">
              <div>In your own words, what does this whole sentence say? Translation stays hidden until you ask.</div>
              <textarea rows={2} aria-label="Your understanding" value={gistAnswer} onChange={(event) => setGistAnswer(event.target.value)} />
              <button type="button" onClick={() => { setShowTranslation(true); setGist('revealed'); }}>Reveal the translation</button>
            </div>
          ) : null}
          {gist === 'revealed' ? (
            <div className="stack" style={{ gap: '0.25rem' }} aria-label="Understanding check" aria-live="polite">
              {gistAnswer.trim() ? <div className="muted">You wrote: {gistAnswer.trim()}</div> : null}
              <div>{sentence.translation}</div>
              <div className="muted">Your wording can differ. Count it only if you had the main meaning before looking.</div>
              <div className="row" style={{ gap: '0.35rem' }}>
                <button type="button" onClick={() => recordGist('got_it')}>I had the gist</button>
                <button type="button" onClick={() => recordGist('needed_help')}>I missed something</button>
              </div>
            </div>
          ) : null}
          {gist === 'recorded' ? <div className="muted" role="status">Noted. This says nothing about any single word or pattern, and your review schedule is unchanged.</div> : null}
          {gist === 'closed' || gist === 'asking' ? (
            showTranslation ? (
              <div>{sentence.translation || '(no translation saved)'}</div>
            ) : gist === 'closed' ? (
              <button type="button" onClick={() => setShowTranslation(true)}>Show natural translation</button>
            ) : null
          ) : null}
          {sentence.translation?.trim() ? (
            <button type="button" onClick={() => setExpressing(true)}>Say it in Japanese</button>
          ) : null}
          <button type="button" onClick={() => setStep(0)}>Walk through again</button>
        </div>
      ) : contextStep ? (
        <div aria-live="polite">
          <ContextStepCard
            step={contextStep}
            roleHelp={roleHelp}
            showGloss={showGloss}
            showWhy={showWhy}
            onAskGloss={() => ask('gloss')}
            onAskWhy={() => ask('why')}
          />
        </div>
      ) : chunk ? (
        <div className="stack" style={{ gap: '0.25rem' }} aria-live="polite">
          {clauseCount > 1 ? <div className="muted">Clause {clauseNumbers.get(chunk)} of {clauseCount}</div> : null}
          <div className="jp jp-lg">{chunk.japanese}</div>
          <div>
            {showRole ? <strong>{chunk.role || 'Unlabelled'}</strong> : <button type="button" onClick={() => ask('role')}>Show role</button>}
            {chunk.literalEnglish ? (showGloss ? <> · “{chunk.literalEnglish}”</> : <> <button type="button" onClick={() => ask('gloss')}>Show gloss</button></>) : null}
          </div>
          {showRole && showWhy ? (
            <>
              {blurb ? <div className="muted">{blurb}</div> : <div className="muted">No guide text for this role yet.</div>}
              {chunk.notes ? <div className="muted">{chunk.notes}</div> : null}
            </>
          ) : showRole ? (
            <button type="button" onClick={() => ask('why')}>Explain this role</button>
          ) : null}
        </div>
      ) : null}
      {compareAids?.get(sentence.id)?.words.length ? (
        <div className="stack" style={{ gap: '0.15rem' }}>
          <span className="muted">Words in this sentence:</span>
          <WordGlossList words={compareAids.get(sentence.id)!.words} />
        </div>
      ) : null}
      <div className="row">
        <button type="button" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>Back</button>
        <button type="button" className="primary" disabled={done} onClick={() => setStep((value) => value + 1)}>
          {step >= stepCount - 1 ? 'Finish' : 'Continue'}
        </button>
        <span className="muted">{done ? 'Done' : `Step ${step + 1} of ${stepCount}`}</span>
      </div>
      {contextual ? (
        <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
          Explanations were drafted by an AI from a pasted reply, using the sentences around this one; they are not verified by you.
          Anything marked &ldquo;From context&rdquo; is inferred rather than stated.
          {(contextual.version ?? 1) < 2 ? ' This is an older-format explanation without nested structure or who-does-what; it can be enriched from the book page.' : ''}
        </p>
      ) : (
        <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
          No contextual explanation is saved for this sentence, so this basic fallback shows generic role guidance only. Roles such as &ldquo;engine&rdquo; and
          &ldquo;car&rdquo; are generic and do not say which predicate a phrase belongs to; word-list glosses may split compounds and names.
        </p>
      )}
      {!contextual && importTarget ? <WalkthroughContentImport bookId={importTarget.bookId} chapterId={importTarget.chapterId} sentenceId={sentence.id} /> : null}
      <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
        {source === 'saved'
          ? 'From your saved analysis of this sentence.'
          : source === 'ai_draft'
            ? 'From the AI reply you pasted, not verified by you. Correct it on Analyze.'
            : 'Automatic draft: roles are generic, not verified for this sentence. Correct it on Analyze.'}
      </p>
      {here.length > 0 ? (
        <div className="stack" style={{ gap: '0.25rem' }}>
          <span className="muted">Worth noticing here (recurs in this episode). Practice is optional and never changes your review schedule.</span>
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {(showAllTargets ? [...shownTargets, ...hiddenTargets] : shownTargets).map((target) => (
              <TargetLessonCard
                key={target.id}
                target={target}
                sentenceId={sentence.id}
                visitId={visitId}
                episodeSentences={episodeSentences}
                compareAids={compareAids}
                constructions={targetsWithLayers.has(target.id) ? constructions : undefined}
                events={events}
                quietMode={quietMode}
                onEvent={emit}
              />
            ))}
          </ul>
          {hiddenTargets.length > 0 && !showAllTargets ? (
            <button type="button" onClick={() => setShowAllTargets(true)}>
              Show {hiddenTargets.length} more {hiddenTargets.length === 1 ? 'target' : 'targets'}
            </button>
          ) : null}
        </div>
      ) : null}
      {targetsWithLayers.size === 0 && currentCompareSentence && constructions.sentenceLayers.length > 0 ? (
        <PhraseConstructionSection
          sentence={currentCompareSentence}
          layers={constructions.sentenceLayers}
          allLayers={constructions.allLayers}
          episodeSentences={episodeSentences}
          compareAids={compareAids}
          events={events}
          visitId={visitId}
          quietMode={quietMode}
          onEvent={emit}
        />
      ) : null}
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        {audio ? (
          <NativeAudioButton audio={audio} displayLabel="Native audio" />
        ) : (
          <span className="muted">No native audio for this sentence; reading and the walkthrough still work.</span>
        )}
        <label className="row" style={{ gap: '0.35rem' }}>
          <input type="checkbox" checked={quietMode} onChange={(event) => onQuietModeChange(event.target.checked)} />
          Can&rsquo;t speak right now
        </label>
      </div>
    </section>
  );
}
