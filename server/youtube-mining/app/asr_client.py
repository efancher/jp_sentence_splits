"""Client for shadowing-analysis-api's `POST /transcribe-source` and
`POST /transcribe`.

YouTube's Japanese auto-caption track has no reliable kanji and no
punctuation — the latter being exactly what `resegment.py`'s merge/split
keys on, so the segmenter is inert on the input that needs it most. A
Whisper transcript of the audio has both. When the analysis service is
reachable we use its transcript as the cue source; otherwise we fall back
to the caption track (`app/subtitles.py`), same as before.
"""

from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
import tempfile
from collections.abc import Callable
from pathlib import Path

import httpx

from app import clip, config
from app.models import Cue, CueWord

logger = logging.getLogger("youtube_mining_api.asr")


def choose_cuts(
    duration_ms: int,
    silence_mids_ms: list[int],
    *,
    target_ms: int,
    min_ms: int,
    max_ms: int,
) -> list[int]:
    """Cut points (ms) splitting `duration_ms` into chunks of roughly
    `target_ms`, each between `min_ms` and `max_ms`. A cut lands on the silence
    midpoint nearest the target when one falls in range, else hard at the
    target. The last chunk is never shorter than `min_ms` (it absorbs the tail
    instead)."""
    cuts: list[int] = []
    pos = 0
    while duration_ms - pos > max_ms:
        window = [
            m
            for m in silence_mids_ms
            if pos + min_ms <= m <= pos + max_ms and m <= duration_ms - min_ms
        ]
        want = pos + target_ms
        cut = min(window, key=lambda m: abs(m - want)) if window else want
        cuts.append(cut)
        pos = cut
    return cuts


def _silence_midpoints_ms(audio_path: Path) -> list[int]:
    """Midpoints of the pauses ffmpeg's silencedetect finds in `audio_path`."""
    result = subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-nostdin", "-i", str(audio_path),
            "-af", "silencedetect=noise=-35dB:d=0.4", "-f", "null", "-",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    starts = [float(m) for m in re.findall(r"silence_start:\s*(-?\d+(?:\.\d+)?)", result.stderr)]
    ends = [float(m) for m in re.findall(r"silence_end:\s*(-?\d+(?:\.\d+)?)", result.stderr)]
    return [int((max(s, 0) + e) / 2 * 1000) for s, e in zip(starts, ends)]


def _cut_chunk(audio_path: Path, start_ms: int, end_ms: int, dest: Path) -> None:
    """Re-encode [start_ms, end_ms) to 16 kHz mono WAV (sample-accurate, unlike
    a stream copy of Opus pages)."""
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-nostdin", "-y",
            "-i", str(audio_path),
            "-ss", f"{start_ms / 1000:.3f}", "-to", f"{end_ms / 1000:.3f}",
            "-ac", "1", "-ar", "16000", str(dest),
        ],
        check=True,
        capture_output=True,
    )


def _post_segments(path: Path, mime: str, timeout: float) -> list[dict]:
    with path.open("rb") as fh:
        resp = httpx.post(
            f"{config.ANALYSIS_API_BASE}/transcribe-source",
            files={"audio": (path.name, fh, mime)},
            timeout=timeout,
        )
    resp.raise_for_status()
    return resp.json().get("segments") or []


def _offset_segment(seg: dict, offset_ms: int) -> dict:
    out = dict(seg)
    out["startMs"] = int(seg["startMs"]) + offset_ms
    out["endMs"] = int(seg["endMs"]) + offset_ms
    if seg.get("words"):
        out["words"] = [
            {**w, "startMs": int(w["startMs"]) + offset_ms, "endMs": int(w["endMs"]) + offset_ms}
            for w in seg["words"]
        ]
    return out


def _chunked_segments(
    audio_path: Path,
    duration_ms: int,
    checkpoint_dir: Path | None,
    on_progress: Callable[[str], None] | None,
) -> list[dict]:
    """Transcribe `audio_path` piece by piece. Each finished chunk is written
    to `checkpoint_dir`, so a retry after a timeout or restart skips it. The
    manifest is keyed on the source's size and duration; a different source
    discards stale chunks."""
    cuts = choose_cuts(
        duration_ms,
        _silence_midpoints_ms(audio_path),
        target_ms=int(config.ASR_CHUNK_TARGET_SECONDS * 1000),
        min_ms=int(config.ASR_CHUNK_TARGET_SECONDS * 500),
        max_ms=int(config.ASR_CHUNK_MAX_SECONDS * 1000),
    )
    bounds = list(zip([0, *cuts], [*cuts, duration_ms]))
    signature = f"{audio_path.stat().st_size}-{duration_ms}-{bounds}"
    if checkpoint_dir is not None:
        manifest = checkpoint_dir / "manifest.txt"
        if not manifest.is_file() or manifest.read_text() != signature:
            shutil.rmtree(checkpoint_dir, ignore_errors=True)
            checkpoint_dir.mkdir(parents=True, exist_ok=True)
            manifest.write_text(signature)

    segments: list[dict] = []
    for i, (start_ms, end_ms) in enumerate(bounds, 1):
        done = checkpoint_dir / f"chunk_{i}.json" if checkpoint_dir else None
        if done is not None and done.is_file():
            chunk = json.loads(done.read_text(encoding="utf-8"))
        else:
            if on_progress:
                on_progress(f"Transcribing audio… part {i} of {len(bounds)}")
            with tempfile.TemporaryDirectory() as tmp:
                piece = Path(tmp) / f"chunk_{i}.wav"
                _cut_chunk(audio_path, start_ms, end_ms, piece)
                chunk = _post_segments(piece, "audio/wav", config.ASR_CHUNK_TIMEOUT_SECONDS)
            chunk = [_offset_segment(seg, start_ms) for seg in chunk]
            if done is not None:
                done.write_text(json.dumps(chunk), encoding="utf-8")
        segments.extend(chunk)
    return segments


def transcribe_source(
    audio_path: Path,
    *,
    checkpoint_dir: Path | None = None,
    on_progress: Callable[[str], None] | None = None,
) -> list[Cue] | None:
    """ASR cues for `audio_path`, or None when ASR is disabled / the service
    is unreachable / it returned nothing — the caller then uses caption cues.

    Sources longer than `ASR_CHUNK_MIN_SECONDS` are transcribed in chunks cut at
    silences (see `_chunked_segments`); shorter ones are one request."""
    if not config.USE_ASR_TRANSCRIPT or not config.ANALYSIS_API_BASE:
        return None
    try:
        duration_ms = (
            clip.probe_duration_ms(audio_path) if config.ASR_CHUNK_MIN_SECONDS > 0 else 0
        )
        if duration_ms > config.ASR_CHUNK_MIN_SECONDS * 1000:
            segments = _chunked_segments(audio_path, duration_ms, checkpoint_dir, on_progress)
        else:
            segments = _post_segments(audio_path, "audio/ogg", config.ASR_TIMEOUT_SECONDS)
    except Exception as exc:  # noqa: BLE001 - any failure → caption fallback
        logger.warning("ASR transcript unavailable, using captions: %s", exc)
        return None

    def _low_confidence(seg: dict) -> bool:
        lp = seg.get("avgLogprob")
        ns = seg.get("noSpeechProb")
        return (lp is not None and lp < config.ASR_LOW_CONFIDENCE_LOGPROB) or (
            ns is not None and ns > config.ASR_HIGH_NO_SPEECH_PROB
        )

    def _words(seg: dict) -> list[CueWord] | None:
        raw = seg.get("words") or []
        out = [
            CueWord(text=str(w["text"]), startMs=int(w["startMs"]), endMs=int(w["endMs"]))
            for w in raw
            if str(w.get("text", "")).strip()
        ]
        return out or None

    cues = [
        Cue(
            index=i,
            startMs=int(seg["startMs"]),
            endMs=int(seg["endMs"]),
            text=str(seg["text"]).strip(),
            isAuto=True,
            lowConfidence=_low_confidence(seg),
            words=_words(seg),
        )
        for i, seg in enumerate(segments)
        if str(seg.get("text", "")).strip()
    ]
    if not cues:
        logger.warning("ASR returned no usable segments, using captions")
        return None
    return cues


def transcribe_clip(audio_bytes: bytes, mime_type: str) -> str | None:
    """Short-utterance ASR for a single sentence's reference-audio clip (a
    few seconds) — the lighter "base" diagnostic model behind `POST
    /transcribe`, not `transcribe_source`'s long-form `/transcribe-source`
    one. Used by `app/validate.py` to cross-check a sentence's stored
    Japanese against what's actually said in its clip. Returns None on any
    failure (service unreachable, empty result) — same
    "unavailable, not an error" contract as `transcribe_source`."""
    if not config.ANALYSIS_API_BASE:
        return None
    try:
        resp = httpx.post(
            f"{config.ANALYSIS_API_BASE}/transcribe",
            files={"audio": ("clip.m4a", audio_bytes, mime_type)},
            timeout=config.ASR_CLIP_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
        text = resp.json().get("text")
    except Exception as exc:  # noqa: BLE001 - any failure -> caller treats as unavailable
        logger.warning("Clip transcription unavailable: %s", exc)
        return None
    return text.strip() if isinstance(text, str) and text.strip() else None
