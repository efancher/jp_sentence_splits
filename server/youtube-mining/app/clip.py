"""ffmpeg audio clipping, ported unchanged from shadowmine/clip.py's
probe_duration_ms/compute_boundaries/clip_audio (pure functions over file
paths — no changes needed for the HTTP-service context; orchestration
lives in app/jobs.py, replacing the original add_clip's JSON-file
persistence).
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

from app.constants import DEFAULT_END_PAD_MS, DEFAULT_FADE_MS, DEFAULT_START_PAD_MS


def probe_duration_ms(path: Path) -> int:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(result.stdout)
    duration = float(payload["format"]["duration"])
    return max(1, int(round(duration * 1000)))


def probe_max_volume_db(path: Path) -> float:
    """Peak volume of `path` in dBFS via ffmpeg's volumedetect filter.

    Digital silence reports about -91 dB. Returns -inf if the filter emits
    no max_volume line (e.g. a zero-sample stream). Used to reject a
    downloaded source whose audio track is silent — YouTube serves a
    valid-looking but silent stream to yt-dlp requests it doesn't trust,
    and clipping that produces a book full of soundless reference audio.
    """
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostdin",
            "-i",
            str(path),
            "-af",
            "volumedetect",
            "-f",
            "null",
            "-",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    match = re.search(r"max_volume:\s*(-?\d+(?:\.\d+)?) dB", result.stderr)
    return float(match.group(1)) if match else float("-inf")


def compute_boundaries(
    start_ms: int,
    end_ms: int,
    *,
    start_pad_ms: int = DEFAULT_START_PAD_MS,
    end_pad_ms: int = DEFAULT_END_PAD_MS,
    media_duration_ms: int | None = None,
) -> tuple[int, int, int, int]:
    if end_ms <= start_ms:
        raise ValueError("end must be after start")
    adjusted_start = max(0, start_ms - start_pad_ms)
    adjusted_end = end_ms + end_pad_ms
    if media_duration_ms is not None:
        adjusted_end = min(adjusted_end, media_duration_ms)
    if adjusted_end <= adjusted_start:
        raise ValueError("adjusted clip range is empty")
    return start_ms, end_ms, adjusted_start, adjusted_end


def clip_audio(
    source_path: Path,
    output_path: Path,
    *,
    start_ms: int,
    end_ms: int,
    fade_ms: int = DEFAULT_FADE_MS,
) -> int:
    duration_ms = end_ms - start_ms
    if duration_ms <= 0:
        raise ValueError("clip duration must be positive")
    start_s = start_ms / 1000
    duration_s = duration_ms / 1000
    fade_s = min(fade_ms / 1000, duration_s / 4) if fade_ms > 0 else 0
    af_parts: list[str] = []
    # Fade out only — an in-fade can erase short sentence-initial vowels.
    if fade_s > 0:
        af_parts.append(f"afade=t=out:st={max(0.0, duration_s - fade_s):.3f}:d={fade_s:.3f}")
    # -ss BEFORE -i (input seeking). With -ss *after* -i the decoded frames
    # keep their original ~start_s timestamps, so `afade`'s st= (relative to
    # 0) sits far in the filter's past and it fades the whole clip to
    # silence — every faded clip came out -91 dBFS. Input seeking resets the
    # timeline to 0; it's sample-accurate enough on the mp4/webm containers
    # yt-dlp produces (never raw ADTS here), and compute_boundaries already
    # pads 300 ms each side.
    command = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{start_s:.3f}",
        "-i",
        str(source_path),
        "-t",
        f"{duration_s:.3f}",
        "-vn",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
    ]
    if af_parts:
        command.extend(["-af", ",".join(af_parts)])
    command.append(str(output_path))
    subprocess.run(command, check=True, capture_output=True, text=True)
    return probe_duration_ms(output_path)
