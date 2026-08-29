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


class Cue(BaseModel):
    index: int
    startMs: int
    endMs: int
    text: str
    isAuto: bool = False
    # Original-input positions this cue descends from, set by resegment.py's
    # merge/split passes; None until a provenance-tracking pass runs.
    sourceIndexes: list[int] | None = None


class MorphemeToken(BaseModel):
    surface: str = Field(min_length=1)
    start: int = Field(ge=0)
    end: int = Field(ge=1)
    lemma: str = Field(min_length=1)
    reading: str = ""
    pos: str = ""


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


JobState = Literal["pending", "fetching", "parsing", "ready", "error"]


class JobStatusResponse(BaseModel):
    jobId: str
    status: JobState
    stage: str
    error: str | None = None
    source: SourceInfo | None = None
    cues: list[CueOut] | None = None


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
