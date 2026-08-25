import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { AnalysisPanel } from '../components/AnalysisPanel';
import { LiveShadowWaveform } from '../components/LiveShadowWaveform';
import { ProgressiveShadowingPanel } from '../components/ProgressiveShadowingPanel';
import { RecordToggleButton } from '../components/RecordToggleButton';
import {
  deleteAttempt,
  getDb,
  getReferenceAlignment,
  listAttemptAnalysisSummariesForSentence,
  listAttemptsForSentence,
  rateAttempt,
  saveAttempt,
  saveReferenceAlignment,
  setAttemptFavorite,
} from '../db/repository';
import type { Attempt, AttemptRating, SentenceAudio } from '../domain/types';
import { useShadowing } from '../hooks/useShadowing';
import { loadOrComputeAlignment } from '../lib/alignmentCache';
import { getSentenceReadingForMora, segmentIntoMorae, type MoraUnit } from '../lib/mora';
import { buildHistoryDisplay } from '../lib/pronunciationHistory';
import {
  MAX_RECORDING_DURATION_MS,
  PLAYBACK_SPEEDS,
  PlaybackCoordinator,
  RecordingService,
  calibrateMicrophone,
  type CalibrationResult,
  type TimeRangeMs,
} from '../lib/recording';

const RATINGS: { value: AttemptRating; label: string }[] = [
  { value: 'better', label: 'Better' },
  { value: 'same', label: 'Same' },
  { value: 'worse', label: 'Worse' },
  { value: 'unsure', label: 'Unsure' },
];

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Shadowing pronunciation-feedback Milestone 1 (docs/STATUS.md Phase 9). */
function MoraBreakdown({ units }: { units: MoraUnit[] }) {
  if (units.length === 0) return null;
  return (
    <div className="row mora-row" aria-label="Mora breakdown">
      {units.map((unit) => (
        <span key={unit.index} className="chip jp" data-kind={unit.kind}>
          {unit.text}
        </span>
      ))}
    </div>
  );
}

type AlignedWord = { text: string; start: number; end: number };

/**
 * Word-synced highlighting of the reference-audio transcript during
 * shadowing: as the clip plays, the corresponding slice of both the
 * Japanese sentence and the mora/hiragana row underneath it lights up
 * together. Mirrors KaraokeSentenceText's approach but ticks off
 * ShadowPage's own <audio> element directly (via ref) rather than the
 * global nativeAudioController singleton that component relies on, since
 * shadowing plays reference audio through PlaybackCoordinator/a raw
 * <audio> element, not that controller.
 *
 * The forced aligner's word boundaries are keyed to its own tokenization,
 * which can diverge from `japanese`'s literal characters (dictionary-
 * normalized spellings, re-segmentation) and from the mora sequence's own
 * word boundaries (`inlineReading` is an independently-authored field, not
 * guaranteed to be a lossless re-encoding of `japanese` — production data
 * has diverged, see scripts/fix-numeral-readings.ts). Rather than
 * string-matching across these independently-tokenized representations,
 * position is carried over by character-count proportion: the active
 * word's [start,end) fraction of the alignment's total (non-`<unk>`)
 * transcript length is applied to both `japanese` and the mora sequence to
 * pick the highlighted slice. This is an approximation of the true word
 * boundary, not an exact one, but needs no fragile text-matching and
 * degrades gracefully — worst case the highlighted span is a character or
 * two off.
 */
function SyncedShadowText({
  audioRef,
  referenceAudio,
  japanese,
  moraUnits,
}: {
  audioRef: { current: HTMLAudioElement | null };
  referenceAudio: SentenceAudio | undefined;
  japanese: string;
  moraUnits: MoraUnit[];
}) {
  const [words, setWords] = useState<AlignedWord[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setWords([]);
    setActiveIndex(-1);
    if (!referenceAudio) return;
    void loadOrComputeAlignment(
      referenceAudio.id,
      referenceAudio.blob,
      japanese,
      getReferenceAlignment,
      saveReferenceAlignment,
    ).then((result) => {
      if (cancelled || !result) return;
      setWords(result.words.filter((word) => word.text && word.text !== '<eps>'));
    });
    return () => {
      cancelled = true;
    };
  }, [referenceAudio, japanese]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || words.length === 0) return;
    const handlePlay = () => setIsPlaying(true);
    const handleStop = () => setIsPlaying(false);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handleStop);
    audio.addEventListener('ended', handleStop);
    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handleStop);
      audio.removeEventListener('ended', handleStop);
    };
  }, [audioRef, words.length]);

  useEffect(() => {
    if (!isPlaying || words.length === 0) {
      setActiveIndex(-1);
      return;
    }
    let frame: number;
    const tick = () => {
      const t = audioRef.current?.currentTime ?? 0;
      const index = words.findIndex((word) => t >= word.start && t < word.end);
      setActiveIndex((prev) => (prev === index ? prev : index));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, words, audioRef]);

  const range = useMemo(() => {
    const activeWord = words[activeIndex];
    if (!activeWord || activeWord.text === '<unk>') return null;
    let before = 0;
    let total = 0;
    words.forEach((word, index) => {
      if (word.text === '<unk>') return;
      if (index < activeIndex) before += word.text.length;
      total += word.text.length;
    });
    if (total === 0) return null;
    return { startFrac: before / total, endFrac: (before + activeWord.text.length) / total };
  }, [words, activeIndex]);

  if (words.length === 0) {
    return (
      <div className="stack" style={{ flex: 1, gap: '0.25rem' }}>
        <div className="jp jp-lg">{japanese}</div>
        <MoraBreakdown units={moraUnits} />
      </div>
    );
  }

  const textStart = range ? Math.round(range.startFrac * japanese.length) : -1;
  const textEnd = range ? Math.round(range.endFrac * japanese.length) : -1;
  const moraStart = range ? Math.round(range.startFrac * moraUnits.length) : -1;
  const moraEnd = range ? Math.round(range.endFrac * moraUnits.length) : -1;

  return (
    <div className="stack" style={{ flex: 1, gap: '0.25rem' }}>
      <div className="jp jp-lg">
        {range ? (
          <>
            {japanese.slice(0, textStart)}
            <span className="karaoke-word-active">{japanese.slice(textStart, textEnd)}</span>
            {japanese.slice(textEnd)}
          </>
        ) : (
          japanese
        )}
      </div>
      {moraUnits.length > 0 && (
        <div className="row mora-row" aria-label="Mora breakdown">
          {moraUnits.map((unit) => (
            <span
              key={unit.index}
              className={`chip jp${range && unit.index >= moraStart && unit.index < moraEnd ? ' karaoke-word-active' : ''}`}
              data-kind={unit.kind}
            >
              {unit.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function SpeedControl({
  speed,
  onChange,
}: {
  speed: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      Playback speed
      <select value={speed} onChange={(event) => onChange(Number(event.target.value))}>
        {PLAYBACK_SPEEDS.map((value) => (
          <option key={value} value={value}>
            {value === 1 ? '1× (normal)' : `${value}×`}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ShadowPage() {
  const { bookId = '', sentenceId = '' } = useParams();
  const shadowing = useShadowing();
  const { stopComparison, cancelRecording } = shadowing;

  const [pendingAttempt, setPendingAttempt] = useState<
    { blob: Blob; durationMs: number } | null
  >(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [activeAttemptId, setActiveAttemptId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [targetRange, setTargetRange] = useState<TimeRangeMs | null>(null);
  const [isLoopingTarget, setIsLoopingTarget] = useState(false);
  const [guidedMode, setGuidedMode] = useState(false);
  const [shadowMode, setShadowMode] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [calibration, setCalibration] = useState<CalibrationResult | null>(null);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const [analyzingAttemptId, setAnalyzingAttemptId] = useState<string | null>(null);
  const [hideTranscript, setHideTranscript] = useState(false);
  const [showMeaningInstead, setShowMeaningInstead] = useState(false);
  const [delayMs, setDelayMs] = useState(750);
  const [delayedRecordPending, setDelayedRecordPending] = useState(false);
  const [draftNotes, setDraftNotes] = useState('');
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const referenceRepairAttempted = useRef(false);

  const referenceAudioRef = useRef<HTMLAudioElement | null>(null);
  const attemptAudioRef = useRef<HTMLAudioElement | null>(null);
  const targetLoopCoordinator = useRef(new PlaybackCoordinator());
  /** Cleanup for an in-flight "play reference, then auto-record" sequence (delayed shadowing). */
  const delayedShadowCancelRef = useRef<(() => void) | null>(null);

  const data = useLiveQuery(async () => {
    const db = getDb();
    const [book, sentence, sentenceAudio, attempts, analysisSummaries] = await Promise.all([
      db.books.get(bookId),
      db.sentences.get(sentenceId),
      db.sentenceAudio.where('sentenceId').equals(sentenceId).toArray(),
      listAttemptsForSentence(sentenceId),
      listAttemptAnalysisSummariesForSentence(sentenceId),
    ]);
    const matchingSourceId = book?.sourceKey?.startsWith('shadowing:')
      ? book.sourceKey.slice('shadowing:'.length)
      : undefined;
    const referenceAudio =
      sentenceAudio.find((audio) => audio.sourceId === matchingSourceId) ??
      sentenceAudio[0];
    return { book, sentence, referenceAudio, attempts, analysisSummaries };
  }, [bookId, sentenceId]);

  // Pick up recordings that finished either by the Stop button or by hitting
  // the max-duration auto-stop (both land in shadowing.lastRecording).
  useEffect(() => {
    if (shadowing.status === 'stopped' && shadowing.lastRecording) {
      setPendingAttempt(shadowing.lastRecording);
    }
  }, [shadowing.status, shadowing.lastRecording]);

  useEffect(() => {
    if (!pendingAttempt) {
      setPendingUrl(null);
      return;
    }
    const url = URL.createObjectURL(pendingAttempt.blob);
    setPendingUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingAttempt]);

  useEffect(() => {
    if (!data?.referenceAudio) {
      setReferenceUrl(null);
      return;
    }
    const url = URL.createObjectURL(data.referenceAudio.blob);
    setReferenceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [data?.referenceAudio]);

  useEffect(() => {
    setPendingAttempt(null);
    setDraftNotes('');
    setTargetRange(null);
    setAnalyzingAttemptId(null);
    setReferenceError(null);
    setGuidedMode(false);
    referenceRepairAttempted.current = false;
  }, [sentenceId]);

  /**
   * Safari's IndexedDB occasionally hands back a reference-audio Blob that
   * fails to play (WebKitBlobResource error) even though it looks intact
   * locally. One retry after refetching the clip from Supabase Storage
   * recovers from that without a full book re-import; `db.sentenceAudio`
   * updating retriggers the liveQuery above and swaps in a fresh
   * `referenceUrl` automatically.
   */
  function handleReferenceAudioError() {
    const audioId = data?.referenceAudio?.id;
    if (referenceRepairAttempted.current || !audioId) return;
    referenceRepairAttempted.current = true;
    void (async () => {
      const { repairSentenceAudio } = await import('../sync/audioSync');
      const freshBlob = await repairSentenceAudio(audioId);
      if (!freshBlob) {
        setReferenceError(
          'Could not play this recording on this device. Try re-importing the book.',
        );
      }
    })();
  }

  useEffect(() => {
    if (!referenceAudioRef.current) return;
    referenceAudioRef.current.playbackRate = speed;
    referenceAudioRef.current.preservesPitch = true;
  }, [speed, referenceUrl]);

  // Stop any in-flight recording/comparison/target-loop when leaving this sentence.
  useEffect(
    () => () => {
      stopComparison();
      cancelRecording();
      targetLoopCoordinator.current.cancel();
      delayedShadowCancelRef.current?.();
    },
    [sentenceId, stopComparison, cancelRecording],
  );

  function cancelDelayedShadow() {
    delayedShadowCancelRef.current?.();
    delayedShadowCancelRef.current = null;
    setDelayedRecordPending(false);
  }

  /**
   * Delayed shadowing (the brief's named practice-mode taxonomy, docs/
   * STATUS.md follow-up): play the reference clip in full, wait `delayMs`
   * after it ends, then auto-start recording — a fixed gap between hearing
   * and producing, rather than shadow mode's simultaneous play-along or a
   * manual "press Record whenever." Always plays the whole clip from the
   * start, not target-range-scoped — the existing loop mechanism already
   * covers sub-range practice; this stays a single deliberate listen.
   */
  async function handleDelayedShadow() {
    const audio = referenceAudioRef.current;
    if (!audio) return;
    cancelDelayedShadow();
    setDelayedRecordPending(true);
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const handleEnded = () => {
      timeoutId = setTimeout(() => {
        delayedShadowCancelRef.current = null;
        setDelayedRecordPending(false);
        void shadowing.startRecording();
      }, delayMs);
    };
    audio.addEventListener('ended', handleEnded);
    delayedShadowCancelRef.current = () => {
      audio.removeEventListener('ended', handleEnded);
      if (timeoutId) clearTimeout(timeoutId);
    };
    audio.currentTime = 0;
    try {
      await audio.play();
    } catch {
      cancelDelayedShadow();
    }
  }

  const moraUnits = useMemo<MoraUnit[]>(() => {
    const sentence = data?.sentence;
    if (!sentence) return [];
    const chunks = getSentenceReadingForMora(sentence);
    return chunks ? segmentIntoMorae(chunks) : [];
  }, [data?.sentence]);

  if (!data?.sentence) return <p className="muted">Loading…</p>;

  const { book, sentence, referenceAudio, attempts, analysisSummaries } = data;
  const historyByAttemptId = new Map(
    buildHistoryDisplay(analysisSummaries).map((entry) => [entry.summary.id, entry]),
  );

  async function handleSave() {
    if (!pendingAttempt) return;
    setSaveError(null);
    try {
      await saveAttempt({
        sentenceId,
        blob: pendingAttempt.blob,
        mimeType: RecordingService.supportedMimeType() ?? pendingAttempt.blob.type,
        durationMs: pendingAttempt.durationMs,
        notes: draftNotes.trim() || undefined,
        referencePlaybackRate: speed,
      });
      setPendingAttempt(null);
      setDraftNotes('');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to save attempt.');
    }
  }

  async function handleAlternate(attempt: Attempt) {
    if (!referenceAudioRef.current || !attemptAudioRef.current) return;
    targetLoopCoordinator.current.cancel();
    const attemptUrl = URL.createObjectURL(attempt.blob);
    attemptAudioRef.current.src = attemptUrl;
    setActiveAttemptId(attempt.id);
    try {
      await shadowing.playAlternate(
        referenceAudioRef.current,
        attemptAudioRef.current,
        attempt.id,
        speed,
        targetRange ?? undefined,
      );
    } finally {
      URL.revokeObjectURL(attemptUrl);
      setActiveAttemptId(null);
    }
  }

  async function handleDualEar(attempt: Attempt) {
    if (!referenceAudio) return;
    targetLoopCoordinator.current.cancel();
    setActiveAttemptId(attempt.id);
    try {
      await shadowing.playDualEar(referenceAudio.blob, attempt.blob, attempt.id, {
        playbackRate: speed,
        referenceRange: targetRange ?? undefined,
      });
    } finally {
      setActiveAttemptId(null);
    }
  }

  function handleMarkStart() {
    const audio = referenceAudioRef.current;
    if (!audio) return;
    const startMs = Math.round(audio.currentTime * 1000);
    setTargetRange((prev) => ({ startMs, endMs: prev?.endMs ?? startMs }));
  }

  function handleMarkEnd() {
    const audio = referenceAudioRef.current;
    if (!audio) return;
    const endMs = Math.round(audio.currentTime * 1000);
    setTargetRange((prev) => ({ startMs: prev?.startMs ?? 0, endMs }));
  }

  function handleClearTarget() {
    targetLoopCoordinator.current.cancel();
    setTargetRange(null);
  }

  async function handleToggleTargetLoop() {
    if (isLoopingTarget) {
      targetLoopCoordinator.current.cancel();
      return;
    }
    if (!targetRange || !referenceAudioRef.current) return;
    stopComparison();
    setIsLoopingTarget(true);
    try {
      await targetLoopCoordinator.current.loopRange(
        referenceAudioRef.current,
        targetRange,
        speed,
      );
    } finally {
      setIsLoopingTarget(false);
    }
  }

  async function handleCalibrate() {
    setCalibrating(true);
    setCalibrationError(null);
    try {
      setCalibration(await calibrateMicrophone());
    } catch (error) {
      setCalibrationError(
        error instanceof Error ? error.message : 'Unable to calibrate microphone.',
      );
    } finally {
      setCalibrating(false);
    }
  }

  async function handleDelete(attemptId: string) {
    const ok = window.confirm(
      'Delete this shadowing attempt? This cannot be undone.',
    );
    if (!ok) return;
    if (activeAttemptId === attemptId) shadowing.stopComparison();
    await deleteAttempt(attemptId);
  }

  const isRecording = shadowing.status === 'recording';
  const isRequestingMic = shadowing.status === 'requesting-mic';

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="muted">{book?.title} · Shadow</div>
          </div>
          <div className="row">
            <button
              type="button"
              onClick={() => setShowMeaningInstead((value) => !value)}
              disabled={!sentence.translation}
            >
              {showMeaningInstead ? 'Show Japanese' : 'Show meaning instead'}
            </button>
            <button type="button" onClick={() => setHideTranscript((value) => !value)}>
              {hideTranscript ? 'Show transcript' : 'Hide transcript'}
            </button>
            <Link to={`/books/${bookId}/practice/${sentenceId}`}>
              <button type="button">Back to Practice</button>
            </Link>
          </div>
        </div>

        <div className="row" style={{ alignItems: 'center' }}>
          {hideTranscript ? (
            <div className="muted" style={{ flex: 1 }}>
              Audio-only practice
            </div>
          ) : showMeaningInstead && sentence.translation ? (
            <div style={{ flex: 1 }}>{sentence.translation}</div>
          ) : (
            <SyncedShadowText
              audioRef={referenceAudioRef}
              referenceAudio={referenceAudio}
              japanese={sentence.japanese}
              moraUnits={moraUnits}
            />
          )}
        </div>
        {!referenceAudio || !referenceUrl ? (
          <p className="muted">
            No reference audio for this sentence yet — import one from
            Practice. You can still record and save shadowing attempts.
          </p>
        ) : (
          <div className="stack">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio
              ref={referenceAudioRef}
              controls
              src={referenceUrl}
              aria-label="Reference audio"
              className="audio-player"
              onError={handleReferenceAudioError}
            />
            {referenceError ? <p className="muted">{referenceError}</p> : null}
            <SpeedControl speed={speed} onChange={setSpeed} />
            <div className="row" style={{ alignItems: 'center' }}>
              <button type="button" onClick={handleMarkStart}>
                Mark start
              </button>
              <button type="button" onClick={handleMarkEnd}>
                Mark end
              </button>
              {targetRange ? (
                <>
                  <span className="muted">
                    Target: {formatDuration(targetRange.startMs)}–
                    {formatDuration(targetRange.endMs)}
                  </span>
                  <button
                    type="button"
                    disabled={!isLoopingTarget && targetRange.endMs <= targetRange.startMs}
                    onClick={() => void handleToggleTargetLoop()}
                  >
                    {isLoopingTarget ? 'Stop loop' : 'Loop target'}
                  </button>
                  <button type="button" onClick={handleClearTarget}>
                    Clear target
                  </button>
                </>
              ) : null}
            </div>
          </div>
        )}

        {referenceAudio && !guidedMode ? (
          <div className="row" style={{ alignItems: 'center' }}>
            <button type="button" disabled={isRecording || isRequestingMic} onClick={() => setGuidedMode(true)}>
              Start guided practice
            </button>
          </div>
        ) : null}

        {guidedMode && referenceAudio ? (
          <ProgressiveShadowingPanel
            sentenceId={sentenceId}
            shadowing={shadowing}
            referenceAudioRef={referenceAudioRef}
            referenceAudio={referenceAudio}
            targetRange={targetRange}
            speed={speed}
            onExit={() => setGuidedMode(false)}
          />
        ) : (
          <>
            <div className="row" style={{ alignItems: 'center' }}>
              <label className="row" style={{ alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={shadowMode}
                  disabled={!referenceAudio || isRecording || isRequestingMic}
                  onChange={(event) => setShadowMode(event.target.checked)}
                />
                Shadow mode (play reference while recording)
              </label>
              <button
                type="button"
                disabled={calibrating || isRecording || isRequestingMic}
                onClick={() => void handleCalibrate()}
              >
                {calibrating ? 'Calibrating…' : 'Calibrate mic'}
              </button>
            </div>
            {calibration ? (
              <ul className="stack" style={{ margin: 0 }}>
                {calibration.guidance.map((line) => (
                  <li key={line} className="muted">
                    {line}
                  </li>
                ))}
              </ul>
            ) : null}
            {calibrationError ? <p className="muted">{calibrationError}</p> : null}

            <div className="row" style={{ alignItems: 'center' }}>
              <label>
                Delay before recording
                <select
                  value={delayMs}
                  disabled={delayedRecordPending || isRecording || isRequestingMic}
                  onChange={(event) => setDelayMs(Number(event.target.value))}
                >
                  {[500, 750, 1000, 1500, 2000].map((value) => (
                    <option key={value} value={value}>
                      {(value / 1000).toFixed(1)}s
                    </option>
                  ))}
                </select>
              </label>
              {delayedRecordPending ? (
                <>
                  <span className="muted">Listen, then get ready…</span>
                  <button type="button" onClick={cancelDelayedShadow}>
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={!referenceAudio || isRecording || isRequestingMic}
                  onClick={() => void handleDelayedShadow()}
                >
                  Delayed shadow
                </button>
              )}
            </div>

            <div className="row" style={{ alignItems: 'center' }}>
              <RecordToggleButton
                isRecording={isRecording}
                isRequestingMic={isRequestingMic}
                elapsedMs={shadowing.recordingElapsedMs}
                maxDurationMs={MAX_RECORDING_DURATION_MS}
                idleLabel="Record"
                onStart={() =>
                  void shadowing.startRecording(
                    shadowMode && referenceAudio ? 'shadow' : undefined,
                    shadowMode && referenceAudio
                      ? { blob: referenceAudio.blob, playbackRate: speed }
                      : undefined,
                  )
                }
                onStop={() => void shadowing.stopRecording()}
              />
            </div>
            {shadowing.error ? <p className="muted">{shadowing.error}</p> : null}

            {isRecording && shadowing.shadowActive && referenceAudio ? (
              <LiveShadowWaveform
                referenceBlob={referenceAudio.blob}
                active={isRecording && shadowing.shadowActive}
                getMediaTime={shadowing.getShadowMediaTime}
                analyser={shadowing.getShadowAnalyser()}
                sampleRate={shadowing.getShadowSampleRate()}
              />
            ) : null}

            {pendingAttempt && pendingUrl ? (
              <div className="stack">
                <div className="row" style={{ alignItems: 'center' }}>
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <audio controls src={pendingUrl} />
                </div>
                <label>
                  Notes <span className="muted">(optional)</span>
                  <input
                    value={draftNotes}
                    onChange={(event) => setDraftNotes(event.target.value)}
                    placeholder="Focus for next time…"
                  />
                </label>
                <div className="row" style={{ alignItems: 'center' }}>
                  <button type="button" onClick={() => void handleSave()}>
                    Save attempt
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingAttempt(null);
                      setDraftNotes('');
                    }}
                  >
                    Discard
                  </button>
                </div>
              </div>
            ) : null}
            {saveError ? <p className="muted">{saveError}</p> : null}
          </>
        )}

        <div className="stack">
          <strong>Past attempts</strong>
          {attempts.length === 0 ? (
            <p className="muted">No shadowing attempts recorded yet.</p>
          ) : (
            <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
              {attempts.map((attempt) => (
                <li key={attempt.id} className="stack">
                  <div
                    className="row"
                    style={{ justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <div>
                      <div>
                        {new Date(attempt.createdAt).toLocaleString()}
                        {attempt.isFavorite ? ' ★' : ''}
                      </div>
                      <div className="muted">
                        {formatDuration(attempt.durationMs)}
                        {attempt.manualRating ? ` · ${attempt.manualRating}` : ''}
                      </div>
                      {attempt.notes ? <p className="muted">{attempt.notes}</p> : null}
                      {historyByAttemptId.has(attempt.id) ? (
                        <div className="muted">
                          Timing: {historyByAttemptId.get(attempt.id)!.timingLabel} · Pitch:{' '}
                          {historyByAttemptId.get(attempt.id)!.pitchLabel}
                        </div>
                      ) : null}
                    </div>
                    <div className="row">
                      <button
                        type="button"
                        aria-pressed={Boolean(attempt.isFavorite)}
                        onClick={() =>
                          void setAttemptFavorite(attempt.id, !attempt.isFavorite)
                        }
                      >
                        {attempt.isFavorite ? 'Unfavorite' : 'Favorite'}
                      </button>
                      <button
                        type="button"
                        disabled={!referenceAudio}
                        onClick={() => void handleAlternate(attempt)}
                      >
                        {shadowing.comparison?.mode === 'alternate' &&
                        shadowing.comparison.attemptId === attempt.id
                          ? 'Playing…'
                          : 'Alternate'}
                      </button>
                      <button
                        type="button"
                        disabled={!referenceAudio}
                        onClick={() => void handleDualEar(attempt)}
                      >
                        {shadowing.comparison?.mode === 'dualEar' &&
                        shadowing.comparison.attemptId === attempt.id
                          ? 'Playing…'
                          : 'Dual-ear'}
                      </button>
                      <button
                        type="button"
                        disabled={!referenceAudio}
                        className={analyzingAttemptId === attempt.id ? 'primary' : undefined}
                        aria-pressed={analyzingAttemptId === attempt.id}
                        onClick={() =>
                          setAnalyzingAttemptId((current) =>
                            current === attempt.id ? null : attempt.id,
                          )
                        }
                      >
                        {analyzingAttemptId === attempt.id ? 'Close analysis' : 'Analyze'}
                      </button>
                      {RATINGS.map((rating) => (
                        <button
                          key={rating.value}
                          type="button"
                          className={
                            attempt.manualRating === rating.value ? 'primary' : undefined
                          }
                          aria-pressed={attempt.manualRating === rating.value}
                          onClick={() => void rateAttempt(attempt.id, rating.value)}
                        >
                          {rating.label}
                        </button>
                      ))}
                      <button type="button" onClick={() => void handleDelete(attempt.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                  {analyzingAttemptId === attempt.id && referenceAudio ? (
                    <AnalysisPanel
                      sentenceId={sentenceId}
                      referenceAudioId={referenceAudio.id}
                      referenceBlob={referenceAudio.blob}
                      attemptId={attempt.id}
                      attemptCreatedAt={attempt.createdAt}
                      learnerBlob={attempt.blob}
                      transcript={sentence.japanese}
                      hasReading={Boolean(sentence.readingOnly || sentence.inlineReading)}
                      durationHintSeconds={attempt.durationMs / 1000}
                      targetRange={targetRange ?? undefined}
                      referencePlaybackRate={attempt.referencePlaybackRate}
                      onProposeSegment={setTargetRange}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Hidden player used only for Alternate playback's attempt side,
            which needs a real HTMLAudioElement reference (see
            PlaybackCoordinator.alternate). The reference side reuses the
            visible player above. */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio ref={attemptAudioRef} aria-label="Attempt audio" hidden />
      </section>
    </div>
  );
}
