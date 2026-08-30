"""General sentence-boundary resegmentation for subtitle cues.

shadowmine's own rolling-caption handling (app/subtitles.py's
`_extract_rolling`/`dedupe_rolling_captions`) only fixes the specific
YouTube auto-caption rendering artifact where captions grow line-by-line.
It does not help with two much more common problems, on *any* caption
track (manual or auto):

  1. A caption cue ends mid-sentence because the line wrapped for length,
     not because the sentence ended — the next cue continues it.
  2. A caption cue contains more than one complete sentence, because the
     source track batches short sentences into one caption box.

This module runs as a pass over the fully-parsed cue list (after
`subtitles.load_cues_from_dir`, before English alignment) to fix both:
merge cues that don't end on sentence-final punctuation into the following
cue(s), then split any cue that still contains multiple sentence-final
boundaries into one cue per sentence. Timing for a split cue is divided
proportionally by character count — an approximation, not a forced
alignment — the per-cue review UI lets the user nudge boundaries further.
"""

from __future__ import annotations

import re

from app.models import Cue
from app.subtitles import join_fragments

_TERMINAL_CHARS = "。｡．.！!？?…"
_CLOSER_CHARS = "」』）)”’\"'"

_SPLIT_RE = re.compile(
    r"[^" + re.escape(_TERMINAL_CHARS) + r"]*[" + re.escape(_TERMINAL_CHARS) + r"]+["
    + re.escape(_CLOSER_CHARS) + r"]*"
)


def _ends_sentence(text: str) -> bool:
    stripped = text.rstrip()
    if not stripped:
        return False
    index = len(stripped) - 1
    while index >= 0 and stripped[index] in _CLOSER_CHARS:
        index -= 1
    return index >= 0 and stripped[index] in _TERMINAL_CHARS


def _source_indexes(cue: Cue) -> list[int]:
    """Which original-input positions a cue descends from.

    Populated as cues are merged/split so a caller (the /resegment endpoint)
    can map each resulting sentence back to the request sentences that fed
    it — needed to migrate study progress. Falls back to the cue's own
    `index` for a cue that has not been through a provenance-tracking pass.
    """
    return list(cue.sourceIndexes) if cue.sourceIndexes is not None else [cue.index]


def merge_incomplete_cues(cues: list[Cue]) -> list[Cue]:
    """Merge consecutive cues until each merged cue ends on a sentence boundary.

    A trailing fragment with no terminal punctuation (end of the subtitle
    track) is kept as its own cue rather than dropped.
    """
    merged: list[Cue] = []
    buffer_text = ""
    buffer_start: int | None = None
    buffer_end: int | None = None
    buffer_auto = False
    buffer_low_conf = False
    buffer_sources: list[int] = []

    def flush() -> None:
        nonlocal buffer_text, buffer_start, buffer_auto, buffer_low_conf
        nonlocal buffer_sources
        merged.append(
            Cue(
                index=len(merged),
                startMs=buffer_start,
                endMs=buffer_end,
                text=buffer_text,
                isAuto=buffer_auto,
                lowConfidence=buffer_low_conf,
                sourceIndexes=sorted(set(buffer_sources)),
            )
        )
        buffer_text = ""
        buffer_start = None
        buffer_auto = False
        buffer_low_conf = False
        buffer_sources = []

    for cue in cues:
        if buffer_start is None:
            buffer_start = cue.startMs
        buffer_text = join_fragments(buffer_text, cue.text)
        buffer_end = cue.endMs
        buffer_auto = buffer_auto or cue.isAuto
        buffer_low_conf = buffer_low_conf or cue.lowConfidence
        buffer_sources.extend(_source_indexes(cue))
        if _ends_sentence(buffer_text):
            flush()

    if buffer_text and buffer_start is not None and buffer_end is not None:
        flush()
    return merged


def split_multi_sentence_cues(cues: list[Cue]) -> list[Cue]:
    """Split a cue containing several complete sentences into one cue each."""
    result: list[Cue] = []
    for cue in cues:
        pieces = [piece.strip() for piece in _SPLIT_RE.findall(cue.text) if piece.strip()]
        consumed_len = sum(len(piece) for piece in _SPLIT_RE.findall(cue.text))
        remainder = cue.text[consumed_len:].strip()
        if remainder:
            pieces.append(remainder)
        sources = _source_indexes(cue)
        if len(pieces) <= 1:
            result.append(
                Cue(
                    index=len(result),
                    startMs=cue.startMs,
                    endMs=cue.endMs,
                    text=cue.text,
                    isAuto=cue.isAuto,
                    lowConfidence=cue.lowConfidence,
                    sourceIndexes=sources,
                )
            )
            continue

        total_chars = sum(len(piece) for piece in pieces) or 1
        duration_ms = cue.endMs - cue.startMs
        cursor = cue.startMs
        for position, piece in enumerate(pieces):
            is_last = position == len(pieces) - 1
            piece_end = (
                cue.endMs
                if is_last
                else cursor + round(duration_ms * len(piece) / total_chars)
            )
            piece_end = max(piece_end, cursor + 1)
            result.append(
                Cue(
                    index=len(result),
                    startMs=cursor,
                    endMs=piece_end,
                    text=piece,
                    isAuto=cue.isAuto,
                    lowConfidence=cue.lowConfidence,
                    sourceIndexes=list(sources),
                )
            )
            cursor = piece_end
    return result


def resegment_cues(
    cues: list[Cue], *, merge: bool = True, split: bool = True
) -> list[Cue]:
    """Merge cut-off cues, then split any that still bundle multiple sentences.

    `merge=False` for punctuation-free text (song lyrics) — `merge_incomplete_cues`
    would otherwise fuse every line into one cue, since none ends on 。
    """
    out = merge_incomplete_cues(cues) if merge else list(cues)
    if split:
        out = split_multi_sentence_cues(out)
    return [cue.model_copy(update={"index": index}) for index, cue in enumerate(out)]
