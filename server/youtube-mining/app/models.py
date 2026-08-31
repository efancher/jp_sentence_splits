"""Pydantic models shared across the mining pipeline and the HTTP API.

Adapted from ~/projects/shadowing/cli/src/shadowmine/models.py — copied
rather than imported so this service has no runtime dependency on that
sibling repo (see docs/ARCHITECTURE.md).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

TranscriptStatus = Literal[
    "unverified", "auto-caption", "manually-corrected", "verified"
]


class CueWord(BaseModel):
    text: str
    startMs: int
    endMs: int


class Cue(BaseModel):
    index: int
    startMs: int
    endMs: int
    text: str
    isAuto: bool = False
    # Original-input positions this cue descends from, set by resegment.py's
    # merge/split passes; None until a provenance-tracking pass runs.
    sourceIndexes: list[int] | None = None
    # True when this cue (or, after merge/split, any of its source segments)
    # came from a low-confidence ASR segment — the review UI marks it for a
    # careful listen. Set by app/asr_client.py, OR'd through merge/split.
    lowConfidence: bool = False
    # Whisper per-word timings (ASR only), carried so split_multi_sentence_cues
    # can put a boundary at a real word gap instead of a char-proportional
    # guess. Concatenated on merge. Not sent to the client.
    words: list[CueWord] | None = None


class MorphemeToken(BaseModel):
    surface: str = Field(min_length=1)
    start: int = Field(ge=0)
    end: int = Field(ge=1)
    lemma: str = Field(min_length=1)
    # Reading of the *surface* form (conjugated), for furigana over the text.
    reading: str = ""
    # Reading of the *lemma* (dictionary form), for the vocabulary suggestion —
    # UniDic's kanaBase. "" when the tokenizer can't give one; the client then
    # falls back to deriving it from `reading` + `lemma`.
    lemmaReading: str = ""
    pos: str = ""
    # UniDic accent type — the mora index of the accent nucleus, "0" = heiban.
    # "" when unavailable ("*") or a compound/accent-changing form. Same
    # convention as VocabularyItem.pitchAccentPositions. Only reliable for a
    # single-morpheme content word (names get a bare "1"/"0" default).
    accentType: str = ""


class SourceInfo(BaseModel):
    id: str
    type: Literal["youtube"] = "youtube"
    url: str
    videoId: str
    title: str
    channel: str | None = None
    durationMs: int | None = None


class CueOut(BaseModel):
    """A cue as returned to the browser for per-cue review."""

    index: int
    startMs: int
    endMs: int
    japanese: str
    isAuto: bool
    englishGuess: str | None = None
    lowConfidence: bool = False
    # Transcript-segment positions this cue descends from (resegment.py's
    # merge/split provenance) — the wizard groups rows by this for the
    # translate stage.
    sourceIndexes: list[int] | None = None


JobState = Literal["pending", "fetching", "parsing", "ready", "error"]

# The wizard's re-runnable pipeline position (docs/mining-wizard-spec.md).
# `status` above stays the coarse lifecycle flag the linear review UI polls;
# `stage` is the finer state machine each wizard panel drives.
JobStage = Literal[
    "fetching", "transcript", "segment", "translate", "ready", "error"
]


class TranscriptSegment(BaseModel):
    """One raw ASR/caption segment before resegmentation — what the wizard's
    transcript stage lets the reviewer correct by ear."""

    text: str
    startMs: int
    endMs: int
    isAuto: bool = False
    lowConfidence: bool = False


class TranscriptSegmentInput(BaseModel):
    text: str = Field(min_length=1)
    startMs: int = Field(ge=0)
    endMs: int = Field(ge=1)
    isAuto: bool = False
    lowConfidence: bool = False


class SegmentJobRequest(BaseModel):
    """Accept a corrected transcript and (re-)run resegmentation on it."""

    segments: list[TranscriptSegmentInput] = Field(min_length=1)
    # None → server heuristic (skip the merge pass for a Music upload or a
    # punctuation-free transcript, same as the initial pipeline run).
    merge: bool | None = None
    split: bool = True


class TranslatedRow(BaseModel):
    index: int
    japanese: str
    english: str | None = None
    startMs: int
    endMs: int


class JobStatusResponse(BaseModel):
    jobId: str
    status: JobState
    stage: JobStage
    # Human-readable progress line (was `stage` before the wizard rework).
    message: str
    error: str | None = None
    source: SourceInfo | None = None
    transcript: list[TranscriptSegment] | None = None
    cues: list[CueOut] | None = None
    rows: list[TranslatedRow] | None = None


class CreateJobRequest(BaseModel):
    url: str = Field(min_length=1)


class CreateJobResponse(BaseModel):
    jobId: str


class ResegmentSentenceInput(BaseModel):
    japanese: str = Field(min_length=1)
    startMs: int = Field(ge=0)
    endMs: int = Field(ge=0)


class ResegmentRequest(BaseModel):
    sentences: list[ResegmentSentenceInput] = Field(min_length=1)
    # Both default true = full resegmentation (merge cut-off cues, then split
    # bundled ones). Both false = annotate-only: return each input unchanged
    # with its reading/tokens, for lyrics/manual mode where punctuation is not
    # a reliable boundary signal.
    merge: bool = True
    split: bool = True
    generateKana: bool = True


class ResegmentedCue(BaseModel):
    japanese: str
    startMs: int
    endMs: int
    reading: str | None = None
    tokens: list[MorphemeToken] | None = None
    # Indexes into the request's `sentences` that fed this cue.
    sourceIndexes: list[int]


class ClipRequest(BaseModel):
    japanese: str = Field(min_length=1)
    english: str | None = None
    startMs: int | None = Field(default=None, ge=0)
    endMs: int | None = Field(default=None, ge=1)
    generateKana: bool = True
    transcriptStatus: TranscriptStatus = "manually-corrected"


class ReclipCut(BaseModel):
    # Milliseconds relative to the concatenation of this group's clips.
    startMs: int = Field(ge=0)
    endMs: int = Field(ge=1)


class ReclipRequest(BaseModel):
    """One group of old clips that a run of new sentences descends from."""

    clipsBase64: list[str] = Field(min_length=1)
    cuts: list[ReclipCut] = Field(min_length=1)
    # Tighten each cut to its spoken span — for re-cutting clips whose
    # source cue timings overshoot the speech (auto-caption drama imports).
    trimSilence: bool = False


class ReclipClip(BaseModel):
    audioBase64: str
    mimeType: Literal["audio/mp4"] = "audio/mp4"
    durationMs: int


class ReclipResponse(BaseModel):
    clips: list[ReclipClip]


class SourceAudioRequest(BaseModel):
    url: str = Field(min_length=1)


class SourceAudioInfo(BaseModel):
    videoId: str
    mimeType: Literal["audio/ogg"] = "audio/ogg"
    durationMs: int
    sizeBytes: int


class SourceClipRequest(BaseModel):
    """Cut absolute (startMs, endMs) spans out of a video's cached source
    audio — for re-cutting a book's reference clips from the original source
    instead of from lossy fragment clips (see app/source_cache.py)."""

    url: str = Field(min_length=1)
    cuts: list[ReclipCut] = Field(min_length=1)


class ClipAudioInfo(BaseModel):
    mimeType: Literal["audio/mp4"] = "audio/mp4"
    durationMs: int


class ClipResponse(BaseModel):
    sentenceId: str
    japanese: str
    reading: str | None = None
    english: str | None = None
    startMs: int
    endMs: int
    subtitleStartMs: int
    subtitleEndMs: int
    adjustedStartMs: int
    adjustedEndMs: int
    transcriptStatus: TranscriptStatus
    tokens: list[MorphemeToken] | None = None
    audio: ClipAudioInfo
