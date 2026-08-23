"""WebVTT/SRT parsing and EN↔JA alignment, ported from shadowmine/subtitles.py.

Unchanged from the original except `load_project_cues`/`load_parallel_text`
now take a subtitle directory directly instead of a shadowmine "project"
directory (this service has no on-disk project/session concept — see
app/jobs.py).
"""

from __future__ import annotations

import re
from pathlib import Path
from unicodedata import east_asian_width

from app.models import Cue

TIMESTAMP_RE = re.compile(
    r"(?P<h>\d{1,2}):(?P<m>\d{2}):(?P<s>\d{2})[.,](?P<ms>\d{1,3})"
)
ARROW_RE = re.compile(r"\s-->\s")

# Rolling-caption handling (YouTube auto captions repeat the previous line
# and append new text in tiny overlapping cues).
ROLLING_DETECT_MIN_CUES = 6
ROLLING_DETECT_MIN_RATIO = 0.5
ROLLING_MERGE_MAX_GAP_MS = 200
ROLLING_FRAGMENT_MAX_MS = 1500
ROLLING_MERGED_CUE_MAX_MS = 20_000
LEGACY_ROLLING_MAX_GAP_MS = 500
PARALLEL_MIN_OVERLAP_RATIO = 0.2
SENTENCE_END_CHARS = "。｡．.！!？?…」』"


def _timestamp_to_ms(value: str) -> int:
    match = TIMESTAMP_RE.fullmatch(value.strip())
    if not match:
        raise ValueError(f"Invalid timestamp: {value}")
    hours = int(match.group("h"))
    minutes = int(match.group("m"))
    seconds = int(match.group("s"))
    ms = int(match.group("ms").ljust(3, "0")[:3])
    return ((hours * 60 + minutes) * 60 + seconds) * 1000 + ms


def _clean_text(text: str) -> str:
    cleaned = re.sub(r"<[^>]+>", "", text)
    cleaned = cleaned.replace("&nbsp;", " ").replace("&amp;", "&")
    return " ".join(cleaned.split()).strip()


def join_fragments(left: str, right: str) -> str:
    """Join text pieces, omitting the space between CJK characters."""
    if not left:
        return right
    if not right:
        return left
    if east_asian_width(left[-1]) in ("W", "F") or east_asian_width(right[0]) in ("W", "F"):
        return left + right
    return f"{left} {right}"


RawCue = tuple[int, int, list[str]]


def _parse_webvtt_raw(content: str) -> list[RawCue]:
    lines = content.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    raw: list[RawCue] = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        i += 1
        if not line or line.startswith("WEBVTT") or line.startswith("NOTE") or line.startswith("STYLE"):
            continue
        if "-->" not in line:
            if i < len(lines) and "-->" in lines[i]:
                line = lines[i].strip()
                i += 1
            else:
                continue
        parts = ARROW_RE.split(line)
        if len(parts) < 2:
            continue
        start_raw = parts[0].split()[0]
        end_raw = parts[1].split()[0]
        payload: list[str] = []
        while i < len(lines) and lines[i] != "" and "-->" not in lines[i]:
            payload.append(_clean_text(lines[i]))
            i += 1
        raw.append((_timestamp_to_ms(start_raw), _timestamp_to_ms(end_raw), payload))
    return raw


def _detect_rolling(raw: list[RawCue]) -> bool:
    if len(raw) < ROLLING_DETECT_MIN_CUES:
        return False
    matches = 0
    for (_, _, prev_lines), (_, _, curr_lines) in zip(raw, raw[1:]):
        if len(curr_lines) < 2:
            continue
        prev_last = next((line for line in reversed(prev_lines) if line), "")
        if curr_lines[0] == "" or curr_lines[0] == prev_last:
            matches += 1
    return matches / (len(raw) - 1) >= ROLLING_DETECT_MIN_RATIO


def _extract_rolling(raw: list[RawCue]) -> list[Cue]:
    events: list[tuple[int, int, str]] = []
    for start, end, payload in raw:
        new_text = payload[-1] if payload else ""
        if not new_text:
            continue
        events.append((start, end, new_text))

    merged: list[tuple[int, int, str]] = []
    for start, end, text in events:
        if merged:
            prev_start, prev_end, prev_text = merged[-1]
            gap_ms = start - prev_end
            prev_duration_ms = prev_end - prev_start
            merged_duration_ms = end - prev_start
            is_open_fragment = prev_text[-1] not in SENTENCE_END_CHARS
            if (
                is_open_fragment
                and gap_ms <= ROLLING_MERGE_MAX_GAP_MS
                and prev_duration_ms <= ROLLING_FRAGMENT_MAX_MS
                and merged_duration_ms <= ROLLING_MERGED_CUE_MAX_MS
            ):
                merged[-1] = (prev_start, end, join_fragments(prev_text, text))
                continue
        merged.append((start, end, text))

    return [
        Cue(index=index, startMs=start, endMs=end, text=text, isAuto=True)
        for index, (start, end, text) in enumerate(merged)
    ]


def parse_webvtt(content: str, *, is_auto: bool = False) -> list[Cue]:
    raw = _parse_webvtt_raw(content)
    if _detect_rolling(raw):
        return _extract_rolling(raw)
    cues: list[Cue] = []
    for start, end, payload in raw:
        text = ""
        for line in payload:
            text = join_fragments(text, line)
        if not text:
            continue
        cues.append(
            Cue(index=len(cues), startMs=start, endMs=end, text=text, isAuto=is_auto)
        )
    return cues


def parse_srt(content: str, *, is_auto: bool = False) -> list[Cue]:
    blocks = re.split(r"\n\s*\n", content.replace("\r\n", "\n").replace("\r", "\n").strip())
    cues: list[Cue] = []
    for block in blocks:
        lines = [line for line in block.split("\n") if line.strip() != ""]
        if len(lines) < 2:
            continue
        timing_line = lines[0] if "-->" in lines[0] else lines[1]
        if "-->" not in timing_line:
            continue
        start_raw, end_raw = [part.strip() for part in timing_line.split("-->")]
        end_raw = end_raw.split()[0]
        text_lines = lines[1:] if "-->" in lines[0] else lines[2:]
        text = _clean_text("\n".join(text_lines))
        if not text:
            continue
        cues.append(
            Cue(
                index=len(cues),
                startMs=_timestamp_to_ms(start_raw.replace(",", ".")),
                endMs=_timestamp_to_ms(end_raw.replace(",", ".")),
                text=text,
                isAuto=is_auto,
            )
        )
    return cues


def parse_subtitle_file(path: Path) -> list[Cue]:
    content = path.read_text(encoding="utf-8", errors="replace")
    name = path.name.lower()
    is_auto = "auto" in name
    if name.endswith(".srt"):
        return parse_srt(content, is_auto=is_auto)
    return parse_webvtt(content, is_auto=is_auto)


def dedupe_rolling_captions(cues: list[Cue]) -> list[Cue]:
    if not cues:
        return []
    result: list[Cue] = []
    for cue in cues:
        if not result:
            result.append(cue)
            continue
        previous = result[-1]
        prev_text = previous.text
        curr_text = cue.text
        if curr_text == prev_text:
            result[-1] = previous.model_copy(update={"endMs": max(previous.endMs, cue.endMs)})
            continue
        if curr_text.startswith(prev_text) and len(curr_text) > len(prev_text):
            result[-1] = cue.model_copy(update={"startMs": previous.startMs, "index": previous.index})
            continue
        if (
            prev_text
            and curr_text.startswith(prev_text[: max(1, len(prev_text) // 2)])
            and cue.startMs <= previous.endMs + LEGACY_ROLLING_MAX_GAP_MS
        ):
            if len(curr_text) >= len(prev_text):
                result[-1] = cue.model_copy(update={"startMs": min(previous.startMs, cue.startMs), "index": previous.index})
                continue
        result.append(cue.model_copy(update={"index": len(result)}))
    return [cue.model_copy(update={"index": index}) for index, cue in enumerate(result)]


def _files_for_language(subtitle_dir: Path, language: str) -> list[Path]:
    suffixes = (
        f".{language}.vtt",
        f".{language}-orig.vtt",
        f".{language}.srt",
        f".{language}-orig.srt",
    )
    return sorted(
        path
        for path in subtitle_dir.iterdir()
        if path.is_file() and path.name.lower().endswith(suffixes)
    )


def load_cues_from_dir(subtitle_dir: Path, language: str = "ja") -> list[Cue]:
    if not subtitle_dir.exists():
        return []
    files = _files_for_language(subtitle_dir, language)
    if not files:
        return []
    preferred = [path for path in files if "orig" in path.name.lower() or "manual" in path.name.lower()]
    chosen = preferred[0] if preferred else files[0]
    cues = parse_subtitle_file(chosen)
    if any(cue.isAuto for cue in cues):
        cues = dedupe_rolling_captions(cues)
    return cues


def align_parallel_text(
    primary_cues: list[Cue],
    parallel_cues: list[Cue],
) -> dict[int, str]:
    """Assign each translated cue to its nearest overlapping primary cue."""
    matches_by_primary: dict[int, list[str]] = {}
    for parallel in parallel_cues:
        parallel_duration = max(1, parallel.endMs - parallel.startMs)
        parallel_midpoint = (parallel.startMs + parallel.endMs) / 2
        candidates: list[tuple[float, int]] = []
        for primary in primary_cues:
            overlap_ms = min(primary.endMs, parallel.endMs) - max(
                primary.startMs,
                parallel.startMs,
            )
            if overlap_ms <= 0:
                continue
            overlap_ratio = overlap_ms / parallel_duration
            if overlap_ratio < PARALLEL_MIN_OVERLAP_RATIO:
                continue
            primary_midpoint = (primary.startMs + primary.endMs) / 2
            candidates.append((abs(primary_midpoint - parallel_midpoint), primary.index))
        if not candidates:
            continue
        _, primary_index = min(candidates)
        matches = matches_by_primary.setdefault(primary_index, [])
        if parallel.text not in matches:
            matches.append(parallel.text)
    return {
        primary_index: " ".join(matches)
        for primary_index, matches in matches_by_primary.items()
    }


def load_parallel_text_from_dir(
    subtitle_dir: Path,
    primary_cues: list[Cue],
    language: str = "en",
) -> dict[int, str]:
    parallel_cues = load_cues_from_dir(subtitle_dir, language=language)
    return align_parallel_text(primary_cues, parallel_cues)
