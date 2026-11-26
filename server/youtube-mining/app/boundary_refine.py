"""Refine a sentence's cut points with forced alignment.

Whisper's word timestamps (cross-attention DTW) and especially auto-caption
cues drift by a few morae, worst on fast speech and on held sounds ("んー").
Here the sentence text is *known*, so we cut a window around the proposed
span, force-align the text against it (MFA via `align_client`), and move the
start/end to the first/last aligned speech word.

Safety first: a wrong "refinement" is worse than a slightly loose cut, so
the result is only applied when the alignment looks sane, and every
suspicious clip is flagged so the UI can ask for a human look.
"""

from __future__ import annotations

import re
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from app import align_client, clip

WINDOW_PAD_MS = 1000
# Speech touching the window edge means the sentence continues outside it.
EDGE_TOLERANCE_MS = 60
# Plausible Japanese speech is ~100–250 ms per character (kana ≈ mora).
MIN_MS_PER_CHAR = 60
MAX_MS_PER_CHAR = 500
HELD_WORD_MS = 1200
LARGE_SHIFT_MS = 400
MAX_SHIFT_MS = 1500
MIN_SPEECH_MS = 150

_SILENCE_TOKENS = {"", "<eps>", "<sil>", "sil", "sp", "spn"}
_UNKNOWN_TOKENS = {"<unk>", "unk"}
_PUNCTUATION = re.compile(r"[\s、。，．,.!?！？「」『』（）()\[\]【】〈〉《》・:：;；\"'“”‘’]+")
_ELONGATION = re.compile(r"([ーー〜～…])\1+")


@dataclass
class RefineResult:
    status: str  # "refined" | "unchanged" | "skipped"
    start_ms: int
    end_ms: int
    flags: list[str] = field(default_factory=list)
    shift_start_ms: int = 0
    shift_end_ms: int = 0
    reason: str | None = None


def prepare_transcript(text: str) -> str:
    """Strip what MFA cannot align (punctuation, spacing) and collapse held
    sounds written as runs of ー/〜/… so they don't become `<unk>` islands."""
    text = _ELONGATION.sub(r"\1", _PUNCTUATION.sub("", text))
    return text.replace("〜", "ー").replace("～", "ー").replace("…", "")


def _is_speech(word: dict) -> bool:
    return str(word.get("text", "")).strip().lower() not in _SILENCE_TOKENS


def refine_from_words(
    words: list[dict],
    *,
    transcript: str,
    window_start_ms: int,
    window_end_ms: int,
    start_ms: int,
    end_ms: int,
) -> RefineResult:
    """Pure decision step: given the aligner's words (seconds, relative to the
    window start), pick refined cut points or explain why not."""
    unchanged = RefineResult("unchanged", start_ms, end_ms)
    speech = [w for w in words if _is_speech(w)]
    if not speech or not transcript:
        unchanged.status = "skipped"
        unchanged.reason = "no-speech-aligned"
        return unchanged

    first_ms = window_start_ms + round(float(speech[0]["start"]) * 1000)
    last_ms = window_start_ms + round(float(speech[-1]["end"]) * 1000)
    flags: list[str] = []

    unknown = sum(
        1 for w in speech if str(w.get("text", "")).strip().lower() in _UNKNOWN_TOKENS
    )
    if unknown / len(speech) > 0.3:
        flags.append("unknown-words")

    for w in speech:
        dur = (float(w["end"]) - float(w["start"])) * 1000
        phones = w.get("phones")
        n_phones = len(phones) if isinstance(phones, list) and phones else max(1, len(str(w.get("text", ""))))
        if dur > HELD_WORD_MS and dur / n_phones > 400:
            flags.append("held-sound")
            break

    span_ms = last_ms - first_ms
    per_char = span_ms / max(1, len(transcript))
    if span_ms < MIN_SPEECH_MS:
        flags.append("too-short")
    elif per_char > MAX_MS_PER_CHAR:
        flags.append("stretched")  # text forced over extra speech/music
    elif per_char < MIN_MS_PER_CHAR:
        flags.append("compressed")  # text squeezed into too little audio

    if (
        first_ms - window_start_ms <= EDGE_TOLERANCE_MS and window_start_ms > 0
    ) or (window_end_ms - last_ms <= EDGE_TOLERANCE_MS):
        flags.append("hit-window-edge")  # speech runs on outside the window

    shift_start = first_ms - start_ms
    shift_end = last_ms - end_ms
    if abs(shift_start) > MAX_SHIFT_MS or abs(shift_end) > MAX_SHIFT_MS:
        flags.append("shift-too-large")
    elif abs(shift_start) > LARGE_SHIFT_MS or abs(shift_end) > LARGE_SHIFT_MS:
        flags.append("large-shift")

    untrusted = {
        "unknown-words",
        "too-short",
        "stretched",
        "compressed",
        "hit-window-edge",
        "shift-too-large",
    }
    if untrusted & set(flags):
        return RefineResult(
            "unchanged", start_ms, end_ms, flags=flags, reason="alignment-not-trusted"
        )
    return RefineResult(
        "refined",
        first_ms,
        last_ms,
        flags=flags,
        shift_start_ms=shift_start,
        shift_end_ms=shift_end,
    )


def refine_span(
    source_path: Path,
    text: str,
    start_ms: int,
    end_ms: int,
    *,
    media_duration_ms: int | None = None,
) -> RefineResult:
    """Cut a padded window around the span, align `text` against it, and
    return refined (start, end). Any failure degrades to the original span
    ("skipped") — the aligner being down must never block clipping."""
    transcript = prepare_transcript(text)
    original = RefineResult("skipped", start_ms, end_ms)
    if not transcript:
        original.reason = "empty-transcript"
        return original
    window_start = max(0, start_ms - WINDOW_PAD_MS)
    window_end = end_ms + WINDOW_PAD_MS
    if media_duration_ms is not None:
        window_end = min(window_end, media_duration_ms)
    if window_end <= window_start:
        original.reason = "empty-window"
        return original
    try:
        with tempfile.TemporaryDirectory(prefix="refine-") as tmp:
            window_path = Path(tmp) / "window.m4a"
            clip.clip_audio(
                source_path, window_path, start_ms=window_start, end_ms=window_end, fade_ms=0
            )
            words = align_client.align_audio(
                window_path.read_bytes(), "audio/mp4", transcript
            )
    except Exception:  # noqa: BLE001 - never block clipping on refinement
        original.reason = "window-failed"
        return original
    if not words:
        original.reason = "aligner-unavailable"
        return original
    return refine_from_words(
        words,
        transcript=transcript,
        window_start_ms=window_start,
        window_end_ms=window_end,
        start_ms=start_ms,
        end_ms=end_ms,
    )
