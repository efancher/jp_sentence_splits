import { useEffect, useRef, useState, type RefObject } from 'react';

import { rateAttempt, saveAttempt } from '../db/repository';
import type { Attempt, AttemptRating, SentenceAudio } from '../domain/types';
import type { useShadowing } from '../hooks/useShadowing';
import {
  useProgressiveShadowing,
  type ProgressiveStage,
} from '../hooks/useProgressiveShadowing';
import type { MoraUnit } from '../lib/mora';
import {
  MAX_RECORDING_DURATION_MS,
  PlaybackCoordinator,
  RecordingService,
  calibrateMicrophone,
  type CalibrationResult,
  type TimeRangeMs,
} from '../lib/recording';
import { LiveShadowWaveform } from './LiveShadowWaveform';
import { RecordToggleButton } from './RecordToggleButton';
import { SyncedShadowText } from './SyncedShadowText';

type Shadowing = ReturnType<typeof useShadowing>;

const STAGE_ORDER: ProgressiveStage[] = ['listen', 'repeat', 'delayed', 'close', 'compare'];

const STAGE_LABEL: Record<ProgressiveStage, string> = {
  listen: 'Listen',
  repeat: 'Pause & Repeat',
  delayed: 'Delayed Shadow',
  close: 'Close Shadow',
  compare: 'Record & Compare',
};

const STAGE_COACHING: Record<ProgressiveStage, string> = {
  listen:
    'Just listen. Notice the rhythm, pauses, and pitch movement — copy the speaker, not just the words.',
  repeat: 'Listen, then repeat it back once the native audio stops.',
  delayed: 'Play along and speak a beat behind the speaker — let them lead.',
  close: 'Play along and stay as close behind the speaker as you can.',
  compare: 'Record one more take, then compare it side by side with the native audio.',
};

const STAGE_TIP: Partial<Record<ProgressiveStage, string>> = {
  listen: 'Try this once or twice.',
  repeat: 'A couple of tries is usually enough.',
  delayed:
    'Repeat a few times — this is the hardest habit to build. "Loop shadow reps" runs the play-along hands-free so you just keep shadowing.',
  close:
    'Repeat as many times as feels useful before recording a final take — "Loop shadow reps" runs them back to back for you.',
};

const RATINGS: { value: AttemptRating; label: string }[] = [
  { value: 'better', label: 'Better' },
  { value: 'same', label: 'Same' },
  { value: 'worse', label: 'Worse' },
  { value: 'unsure', label: 'Unsure' },
];

const REPEAT_AUTO_STOP_MULTIPLIER = 1.6;
const AUTO_STOP_BUFFER_MS = 700;
const REPEAT_STAGE_DELAY_MS = 750;
/** Fallback when the reference clip's duration isn't known yet — segments this feature targets are short. */
const DEFAULT_SEGMENT_DURATION_MS = 5000;

function segmentDurationMs(targetRange: TimeRangeMs | null, referenceEl: HTMLAudioElement | null): number {
  if (targetRange) return targetRange.endMs - targetRange.startMs;
  const duration = referenceEl?.duration;
  return duration && Number.isFinite(duration) ? duration * 1000 : DEFAULT_SEGMENT_DURATION_MS;
}

interface ProgressiveShadowingPanelProps {
  sentenceId: string;
  shadowing: Shadowing;
  referenceAudioRef: RefObject<HTMLAudioElement | null>;
  referenceAudio: SentenceAudio;
  japanese: string;
  moraUnits: MoraUnit[];
  targetRange: TimeRangeMs | null;
  speed: number;
  onExit: () => void;
}

/**
 * Guided/progressive shadowing practice (docs/AI_OVERVIEW.md §6):
 * Listen -> Pause&Repeat -> Delayed Shadow -> Close Shadow -> Record&Compare.
 * Every stage is a thin wrapper over existing playback/recording primitives
 * (ShadowingController via `shadowing`, PlaybackCoordinator) — no parallel
 * audio engine. Only the final stage's recording is persisted; stages 1-4
 * are ephemeral self-playback reps, discarded on retry/next.
 */
export function ProgressiveShadowingPanel({
  sentenceId,
  shadowing,
  referenceAudioRef,
  referenceAudio,
  japanese,
  moraUnits,
  targetRange,
  speed,
  onExit,
}: ProgressiveShadowingPanelProps) {
  const resetKey = `${sentenceId}:${targetRange ? `${targetRange.startMs}-${targetRange.endMs}` : 'full'}`;
  const progressive = useProgressiveShadowing(resetKey);
  const { stage } = progressive;

  const [listening, setListening] = useState(false);
  const [gettingReady, setGettingReady] = useState(false);
  const [isLoopingReps, setIsLoopingReps] = useState(false);
  const [repCount, setRepCount] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);

  const [pendingFinalAttempt, setPendingFinalAttempt] = useState<
    { blob: Blob; durationMs: number } | null
  >(null);
  const [finalNotes, setFinalNotes] = useState('');
  const [savedFinalAttempt, setSavedFinalAttempt] = useState<Attempt | null>(null);
  const [savingFinal, setSavingFinal] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [micSettingsOpen, setMicSettingsOpen] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [calibration, setCalibration] = useState<CalibrationResult | null>(null);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);

  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ephemeralAudioRef = useRef<HTMLAudioElement | null>(null);
  const finalAudioRef = useRef<HTMLAudioElement | null>(null);
  const compareCoordinatorRef = useRef(new PlaybackCoordinator());
  /** Hands-free shadow-rep loop (stages 3-4): true while it's running. */
  const loopActiveRef = useRef(false);
  const gapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingGapCancelRef = useRef<(() => void) | null>(null);

  const isRecording = shadowing.status === 'recording';
  const isRequestingMic = shadowing.status === 'requesting-mic';

  const [ephemeralUrl, setEphemeralUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!progressive.ephemeralTake) {
      setEphemeralUrl(null);
      return;
    }
    const url = URL.createObjectURL(progressive.ephemeralTake.blob);
    setEphemeralUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [progressive.ephemeralTake]);

  /**
   * `ephemeralAudioRef` is one persistent <audio> element reused across
   * every rep in stages 2-4 (a fresh `new Audio()` per take, like
   * ShadowReferencePlayer uses, would be simpler but loses the element's
   * play/pause event wiring elsewhere) — only its `src` changes, reactively,
   * as `ephemeralUrl` updates. Some browsers (Safari in particular; see the
   * similar Blob-playback workaround in ShadowPage's
   * `handleReferenceAudioError`) don't reliably pick up a same-element `src`
   * swap without an explicit `load()`, so a stale take can keep playing back
   * after a retry/re-record. Runs in its own effect, one render after the
   * `src` prop above actually commits to the DOM, so `load()` targets the
   * new URL rather than the one it's replacing.
   */
  useEffect(() => {
    ephemeralAudioRef.current?.load();
  }, [ephemeralUrl]);

  const [pendingFinalUrl, setPendingFinalUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingFinalAttempt) {
      setPendingFinalUrl(null);
      return;
    }
    const url = URL.createObjectURL(pendingFinalAttempt.blob);
    setPendingFinalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFinalAttempt]);

  function clearAutoStop() {
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
  }

  function cancelPendingGap() {
    pendingGapCancelRef.current?.();
    pendingGapCancelRef.current = null;
    if (gapTimerRef.current) {
      clearTimeout(gapTimerRef.current);
      gapTimerRef.current = null;
    }
    setGettingReady(false);
  }

  /** Force the shadow-rep loop down, discarding any in-flight rep. */
  function teardownRepLoop() {
    if (!loopActiveRef.current) return;
    loopActiveRef.current = false;
    setIsLoopingReps(false);
    setRepCount(0);
    shadowing.cancelRecording();
  }

  // Reset all in-flight/ephemeral local UI state whenever the stage or the
  // practice session changes (segment/sentence change, restart, next/prev).
  useEffect(() => {
    cancelPendingGap();
    clearAutoStop();
    teardownRepLoop();
    setActionError(null);
    setPendingFinalAttempt(null);
    setFinalNotes('');
    setSavedFinalAttempt(null);
    setSaveError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, progressive.sessionId]);

  // Stop everything in flight when the panel unmounts (leaving guided mode
  // or navigating away) — same precedent as ShadowPage's own cleanup effect.
  useEffect(
    () => () => {
      cancelPendingGap();
      clearAutoStop();
      teardownRepLoop();
      compareCoordinatorRef.current.cancel();
      shadowing.cancelRecording();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Pick up a just-finished recording. During stages 1-4 it becomes this
  // stage's ephemeral take; during Compare it becomes the pending final
  // attempt, following ShadowPage's existing save/discard pattern. (Rep-loop
  // takes come through `startShadowLoop`'s onRep callback instead.)
  useEffect(() => {
    if (shadowing.status !== 'stopped' || !shadowing.lastRecording) return;
    clearAutoStop();
    if (stage === 'compare') {
      setPendingFinalAttempt(shadowing.lastRecording);
    } else if (!loopActiveRef.current) {
      progressive.setEphemeralTake(shadowing.lastRecording);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shadowing.status, shadowing.lastRecording]);

  // If the loop's mic/audio setup fails, drop back out of loop UI.
  useEffect(() => {
    if (loopActiveRef.current && shadowing.status === 'idle' && shadowing.error) {
      loopActiveRef.current = false;
      setIsLoopingReps(false);
      setRepCount(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shadowing.status, shadowing.error]);

  function armAutoStop(durationMs: number) {
    clearAutoStop();
    autoStopTimerRef.current = setTimeout(() => {
      autoStopTimerRef.current = null;
      void shadowing.stopRecording();
    }, durationMs);
  }

  async function handlePlayListen() {
    const audio = referenceAudioRef.current;
    if (!audio) return;
    setActionError(null);
    setListening(true);
    try {
      await compareCoordinatorRef.current.playRange(audio, targetRange ?? undefined, speed);
    } catch {
      setActionError('Could not play the reference audio.');
    } finally {
      setListening(false);
    }
  }

  async function handlePauseAndRepeat() {
    const audio = referenceAudioRef.current;
    if (!audio || isRecording || isRequestingMic) return;
    setActionError(null);
    cancelPendingGap();
    try {
      await compareCoordinatorRef.current.playRange(audio, targetRange ?? undefined, speed);
    } catch {
      setActionError('Could not play the reference audio.');
      return;
    }
    setGettingReady(true);
    let cancelled = false;
    pendingGapCancelRef.current = () => {
      cancelled = true;
    };
    gapTimerRef.current = setTimeout(() => {
      gapTimerRef.current = null;
      setGettingReady(false);
      if (cancelled) return;
      const durationMs = segmentDurationMs(targetRange, audio);
      void shadowing.startRecording().then(() => {
        armAutoStop(durationMs * REPEAT_AUTO_STOP_MULTIPLIER + AUTO_STOP_BUFFER_MS);
      });
    }, REPEAT_STAGE_DELAY_MS);
  }

  /** One shadow-along rep: play the native audio through the shadow-mode
   *  graph while recording the mic, auto-stopping past the clip's length. */
  function handleStartShadowAlong() {
    setActionError(null);
    const audio = referenceAudioRef.current;
    void shadowing
      .startRecording('shadow', { blob: referenceAudio.blob, playbackRate: speed })
      .then(() => {
        const fullDurationMs =
          audio?.duration && Number.isFinite(audio.duration)
            ? (audio.duration * 1000) / speed
            : null;
        armAutoStop((fullDurationMs ?? DEFAULT_SEGMENT_DURATION_MS) + AUTO_STOP_BUFFER_MS);
      });
  }

  /**
   * Hands-free shadow practice for stages 3-4: the native audio loops
   * itself (one `<audio loop>`, started under this tap) while the mic
   * records, cycled into one ephemeral take per rep — see
   * ShadowingController.startShadowLoop. No per-rep `play()` / mic
   * re-grab, so it holds up on iOS where those need a user gesture.
   */
  function handleToggleRepLoop() {
    if (loopActiveRef.current) {
      loopActiveRef.current = false;
      setIsLoopingReps(false);
      setRepCount(0);
      shadowing.stopShadowLoop();
      return;
    }
    setActionError(null);
    loopActiveRef.current = true;
    setIsLoopingReps(true);
    setRepCount(1);
    void shadowing.startShadowLoop(referenceAudio.blob, {
      playbackRate: speed,
      onRep: (take) => {
        progressive.setEphemeralTake(take);
        setRepCount((n) => n + 1);
      },
    });
  }

  function handleStartFinalRecording() {
    setActionError(null);
    const audio = referenceAudioRef.current;
    void shadowing.startRecording().then(() => {
      armAutoStop(segmentDurationMs(targetRange, audio) * REPEAT_AUTO_STOP_MULTIPLIER + AUTO_STOP_BUFFER_MS);
    });
  }

  async function handleHearEphemeral() {
    if (!ephemeralAudioRef.current) return;
    try {
      await ephemeralAudioRef.current.play();
    } catch {
      setActionError('Could not play that back.');
    }
  }

  async function handleCompareEphemeral() {
    const reference = referenceAudioRef.current;
    const learner = ephemeralAudioRef.current;
    if (!reference || !learner) return;
    await shadowing.playAlternate(reference, learner, 'ephemeral-take', speed, targetRange ?? undefined);
  }

  async function handleSaveFinal() {
    if (!pendingFinalAttempt) return;
    setSaveError(null);
    setSavingFinal(true);
    try {
      const attempt = await saveAttempt({
        sentenceId,
        blob: pendingFinalAttempt.blob,
        mimeType: RecordingService.supportedMimeType() ?? pendingFinalAttempt.blob.type,
        durationMs: pendingFinalAttempt.durationMs,
        notes: finalNotes.trim() || undefined,
        referencePlaybackRate: speed,
        practiceStage: 'final',
        practiceSessionId: progressive.sessionId,
      });
      setSavedFinalAttempt(attempt);
      progressive.setFinalAttempt(attempt.id);
      setPendingFinalAttempt(null);
      setFinalNotes('');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to save attempt.');
    } finally {
      setSavingFinal(false);
    }
  }

  async function handleCompareFinal() {
    if (!savedFinalAttempt || !referenceAudioRef.current || !finalAudioRef.current) return;
    const attemptUrl = URL.createObjectURL(savedFinalAttempt.blob);
    finalAudioRef.current.src = attemptUrl;
    try {
      await shadowing.playAlternate(
        referenceAudioRef.current,
        finalAudioRef.current,
        savedFinalAttempt.id,
        speed,
        targetRange ?? undefined,
      );
    } finally {
      URL.revokeObjectURL(attemptUrl);
    }
  }

  async function handleDualEarFinal() {
    if (!savedFinalAttempt) return;
    await shadowing.playDualEar(referenceAudio.blob, savedFinalAttempt.blob, savedFinalAttempt.id, {
      playbackRate: speed,
      referenceRange: targetRange ?? undefined,
    });
  }

  async function handleCalibrate() {
    setCalibrating(true);
    setCalibrationError(null);
    try {
      setCalibration(await calibrateMicrophone());
    } catch (error) {
      setCalibrationError(error instanceof Error ? error.message : 'Unable to calibrate microphone.');
    } finally {
      setCalibrating(false);
    }
  }

  const stageIndex = STAGE_ORDER.indexOf(stage);
  const progressPct = ((stageIndex + 1) / STAGE_ORDER.length) * 100;

  return (
    <div className="stack panel">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>
          Stage {stageIndex + 1} of {STAGE_ORDER.length} · {STAGE_LABEL[stage]}
        </strong>
        <button type="button" onClick={onExit}>
          Exit guided practice
        </button>
      </div>
      <div className="progress-bar">
        <span style={{ width: `${progressPct}%` }} />
      </div>

      <p className="muted">{STAGE_COACHING[stage]}</p>
      {STAGE_TIP[stage] ? <p className="muted">{STAGE_TIP[stage]}</p> : null}

      <div className="row" style={{ alignItems: 'center' }}>
        <button type="button" disabled={progressive.isFirstStage || isRecording} onClick={progressive.previous}>
          ‹ Back
        </button>
        {!progressive.isLastStage ? (
          <button type="button" disabled={isRecording} onClick={progressive.skip}>
            Skip ›
          </button>
        ) : null}
        <button type="button" disabled={isRecording} onClick={progressive.restart}>
          Restart session
        </button>
      </div>

      {/* Kept right above the stage's action buttons (rather than only at
          the top of ShadowPage, further up the page) so the text being
          practiced stays in view next to whatever the learner is about to
          press, in every stage — not just while reading, but while
          recording/comparing/retrying too. */}
      <SyncedShadowText
        audioRef={referenceAudioRef}
        referenceAudio={referenceAudio}
        japanese={japanese}
        moraUnits={moraUnits}
      />

      {stage === 'listen' ? (
        <div className="stack">
          <button type="button" className="primary" disabled={listening} onClick={() => void handlePlayListen()}>
            {listening ? 'Playing…' : '▶ Play native audio'}
          </button>
          <button type="button" onClick={progressive.next}>
            Next: {STAGE_LABEL['repeat']} →
          </button>
        </div>
      ) : null}

      {stage === 'repeat' ? (
        <div className="stack">
          {gettingReady ? (
            <div className="row" style={{ alignItems: 'center' }}>
              <span className="muted">Get ready…</span>
              <button type="button" onClick={cancelPendingGap}>
                Cancel
              </button>
            </div>
          ) : (
            <RecordToggleButton
              isRecording={isRecording}
              isRequestingMic={isRequestingMic}
              elapsedMs={shadowing.recordingElapsedMs}
              maxDurationMs={MAX_RECORDING_DURATION_MS}
              idleLabel="🎙 Play & repeat"
              onStart={() => void handlePauseAndRepeat()}
              onStop={() => void shadowing.stopRecording()}
            />
          )}
          {ephemeralUrl ? (
            <div className="row" style={{ alignItems: 'center' }}>
              <button type="button" onClick={() => void handleHearEphemeral()}>
                ▶ Hear that back
              </button>
              <button
                type="button"
                disabled={Boolean(shadowing.comparison)}
                onClick={() => void handleCompareEphemeral()}
              >
                {shadowing.comparison?.attemptId === 'ephemeral-take' ? 'Playing…' : '🔁 Compare to native'}
              </button>
              <button type="button" onClick={progressive.retryStage}>
                Retry
              </button>
              <button type="button" onClick={progressive.next}>
                Next: {STAGE_LABEL['delayed']} →
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {stage === 'delayed' || stage === 'close' ? (
        // Fixed footprint so the page doesn't jump as the controls below
        // swap between record / loop / stop-loop, or as the rep counter
        // ticks — on mobile a reflow here scrolls the sentence out of view.
        <div className="stack" style={{ minHeight: '9rem' }}>
          {isLoopingReps ? (
            <div className="row" style={{ alignItems: 'center' }}>
              <button
                type="button"
                className="primary"
                aria-pressed
                onClick={handleToggleRepLoop}
              >
                ⏹ Stop loop
              </button>
              <span className="muted">Rep {repCount} — shadow along…</span>
            </div>
          ) : (
            <>
              <RecordToggleButton
                isRecording={isRecording}
                isRequestingMic={isRequestingMic}
                elapsedMs={shadowing.recordingElapsedMs}
                maxDurationMs={MAX_RECORDING_DURATION_MS}
                idleLabel={stage === 'delayed' ? '🎙 Shadow along (trailing)' : '🎙 Shadow along (close)'}
                onStart={handleStartShadowAlong}
                onStop={() => void shadowing.stopRecording()}
              />
              <button
                type="button"
                disabled={isRecording || isRequestingMic}
                onClick={handleToggleRepLoop}
              >
                🔁 Loop shadow reps (hands-free practice)
              </button>
            </>
          )}
          {isRecording && shadowing.shadowActive ? (
            <LiveShadowWaveform
              referenceBlob={referenceAudio.blob}
              active={isRecording && shadowing.shadowActive}
              getMediaTime={shadowing.getShadowMediaTime}
              analyser={shadowing.getShadowAnalyser()}
              sampleRate={shadowing.getShadowSampleRate()}
            />
          ) : null}
          {ephemeralUrl && !isLoopingReps ? (
            <div className="row" style={{ alignItems: 'center' }}>
              <button type="button" onClick={() => void handleHearEphemeral()}>
                ▶ Hear that back
              </button>
              <button
                type="button"
                disabled={Boolean(shadowing.comparison)}
                onClick={() => void handleCompareEphemeral()}
              >
                {shadowing.comparison?.attemptId === 'ephemeral-take' ? 'Playing…' : '🔁 Compare to native'}
              </button>
              <button type="button" onClick={progressive.retryStage}>
                Retry
              </button>
              <button type="button" onClick={progressive.next}>
                Next: {STAGE_LABEL[stage === 'delayed' ? 'close' : 'compare']} →
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {stage === 'compare' ? (
        <div className="stack">
          {!pendingFinalAttempt && !savedFinalAttempt ? (
            <RecordToggleButton
              isRecording={isRecording}
              isRequestingMic={isRequestingMic}
              elapsedMs={shadowing.recordingElapsedMs}
              maxDurationMs={MAX_RECORDING_DURATION_MS}
              idleLabel="🎙 Record final attempt"
              onStart={handleStartFinalRecording}
              onStop={() => void shadowing.stopRecording()}
            />
          ) : null}
          {pendingFinalAttempt && pendingFinalUrl ? (
            <div className="stack">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio controls src={pendingFinalUrl} />
              <label>
                Notes <span className="muted">(optional)</span>
                <input
                  value={finalNotes}
                  onChange={(event) => setFinalNotes(event.target.value)}
                  placeholder="Focus for next time…"
                />
              </label>
              <div className="row" style={{ alignItems: 'center' }}>
                <button type="button" disabled={savingFinal} onClick={() => void handleSaveFinal()}>
                  {savingFinal ? 'Saving…' : 'Save attempt'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPendingFinalAttempt(null);
                    setFinalNotes('');
                  }}
                >
                  Discard, try again
                </button>
              </div>
              {saveError ? <p className="muted">{saveError}</p> : null}
            </div>
          ) : null}
          {savedFinalAttempt ? (
            <div className="stack">
              <p className="muted">Saved. Compare your take against the native audio:</p>
              <div className="row" style={{ alignItems: 'center' }}>
                <button
                  type="button"
                  disabled={Boolean(shadowing.comparison)}
                  onClick={() => void handleCompareFinal()}
                >
                  {shadowing.comparison?.mode === 'alternate' &&
                  shadowing.comparison.attemptId === savedFinalAttempt.id
                    ? 'Playing…'
                    : 'Alternate'}
                </button>
                <button
                  type="button"
                  disabled={Boolean(shadowing.comparison)}
                  onClick={() => void handleDualEarFinal()}
                >
                  {shadowing.comparison?.mode === 'dualEar' &&
                  shadowing.comparison.attemptId === savedFinalAttempt.id
                    ? 'Playing…'
                    : 'Dual-ear'}
                </button>
                {RATINGS.map((rating) => (
                  <button
                    key={rating.value}
                    type="button"
                    className={savedFinalAttempt.manualRating === rating.value ? 'primary' : undefined}
                    aria-pressed={savedFinalAttempt.manualRating === rating.value}
                    onClick={() =>
                      void rateAttempt(savedFinalAttempt.id, rating.value).then((updated) =>
                        setSavedFinalAttempt(updated),
                      )
                    }
                  >
                    {rating.label}
                  </button>
                ))}
              </div>
              <div className="row" style={{ alignItems: 'center' }}>
                <button type="button" onClick={progressive.restart}>
                  Practice again
                </button>
                <button type="button" onClick={onExit}>
                  Done
                </button>
              </div>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio ref={finalAudioRef} aria-label="Saved final attempt" hidden />
            </div>
          ) : null}
        </div>
      ) : null}

      {actionError ? <p className="muted">{actionError}</p> : null}
      {shadowing.error ? <p className="muted">{shadowing.error}</p> : null}

      <details open={micSettingsOpen} onToggle={(event) => setMicSettingsOpen(event.currentTarget.open)}>
        <summary>More options</summary>
        <div className="stack">
          <button type="button" disabled={calibrating || isRecording} onClick={() => void handleCalibrate()}>
            {calibrating ? 'Calibrating…' : 'Calibrate mic'}
          </button>
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
        </div>
      </details>

      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={ephemeralAudioRef}
        src={ephemeralUrl ?? undefined}
        aria-label="Ephemeral practice take"
        hidden
      />
    </div>
  );
}
