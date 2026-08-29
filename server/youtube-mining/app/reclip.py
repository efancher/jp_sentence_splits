"""Re-cut reference audio onto new sentence boundaries.

Used by the "Re-segment captions" flow (and its one-off backfill): when a
badly-segmented source is re-split, each new sentence's audio is a slice of
one or more of the *old* per-fragment clips. The browser / backfill script
already has those old clips (Dexie / Supabase Storage) and the new cue
timings (`/resegment`), so this endpoint only needs to concatenate the
handful of old clips a new sentence descends from and cut the requested
sub-ranges — no yt-dlp, no source download.

Reuses `app/clip.py`'s ffmpeg helpers. Stateless: everything runs in a
tempdir that's removed when the request returns.
"""

from __future__ import annotations

import base64
import subprocess
import tempfile
from pathlib import Path

from app import clip


def _concat_clips(clip_paths: list[Path], out_path: Path) -> None:
    """Concatenate same-timeline clips into one file (re-encoding via the
    concat filter, so mismatched AAC profiles / sample rates still join)."""
    if len(clip_paths) == 1:
        # ffmpeg copy keeps it a valid standalone file without a needless
        # re-encode.
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(clip_paths[0]), "-c", "copy", str(out_path)],
            check=True,
            capture_output=True,
            text=True,
        )
        return
    command = ["ffmpeg", "-y"]
    for path in clip_paths:
        command += ["-i", str(path)]
    streams = "".join(f"[{i}:a]" for i in range(len(clip_paths)))
    command += [
        "-filter_complex",
        f"{streams}concat=n={len(clip_paths)}:v=0:a=1[out]",
        "-map",
        "[out]",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        str(out_path),
    ]
    subprocess.run(command, check=True, capture_output=True, text=True)


_MIN_TRIMMED_MS = 300


def _trim_silence(src: Path, dst: Path) -> int:
    """Strip leading/trailing near-silence, keeping a short lead-in/out.

    "After Work"-era auto-caption cue *end* times overshoot the speech by
    seconds, so a proportional re-cut of those clips carries a lot of dead
    air — at the edges, and (when two overshooting cues were concatenated) in
    the middle too. Tighten to the spoken span and collapse any interior gap
    longer than ~0.7s down to that length, so natural pauses survive but a
    multi-second hole doesn't. Falls back to a plain copy if the trim would
    leave almost nothing (all-silent slice, or too aggressive).
    """
    chain = (
        "silenceremove=start_periods=1:start_silence=0.10:"
        "start_threshold=-35dB:detection=peak,"
        "areverse,"
        "silenceremove=start_periods=1:start_silence=0.15:"
        "start_threshold=-35dB:detection=peak,"
        "areverse,"
        "silenceremove=stop_periods=-1:stop_silence=0.7:"
        "stop_duration=0.7:stop_threshold=-38dB:detection=peak"
    )
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(src), "-af", chain, "-c:a", "aac", "-b:a", "192k", str(dst)],
        check=True,
        capture_output=True,
        text=True,
    )
    try:
        trimmed_ms = clip.probe_duration_ms(dst)
    except (KeyError, ValueError, subprocess.CalledProcessError):
        trimmed_ms = 0
    if trimmed_ms >= _MIN_TRIMMED_MS:
        return trimmed_ms
    # All-silent slice, or the trim ate everything — keep the untrimmed cut.
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(src), "-c", "copy", str(dst)],
        check=True,
        capture_output=True,
        text=True,
    )
    return clip.probe_duration_ms(dst)


def reclip_group(
    clips_b64: list[str],
    cuts: list[tuple[int, int]],
    *,
    trim_silence: bool = False,
) -> list[tuple[str, int]]:
    """Concatenate the base64 m4a `clips_b64` (in order) and cut each
    `(start_ms, end_ms)` range out of the concatenation.

    Returns one `(base64_m4a, duration_ms)` per cut, in the same order. With
    `trim_silence`, each cut is tightened to its spoken span.
    """
    if not clips_b64:
        raise ValueError("at least one clip is required")
    if not cuts:
        raise ValueError("at least one cut is required")

    with tempfile.TemporaryDirectory(prefix="reclip-") as tmp:
        tmp_dir = Path(tmp)
        clip_paths: list[Path] = []
        for i, data in enumerate(clips_b64):
            path = tmp_dir / f"in-{i:03d}.m4a"
            path.write_bytes(base64.b64decode(data))
            clip_paths.append(path)

        concat_path = tmp_dir / "concat.m4a"
        _concat_clips(clip_paths, concat_path)
        total_ms = clip.probe_duration_ms(concat_path)

        out: list[tuple[str, int]] = []
        for j, (start_ms, end_ms) in enumerate(cuts):
            start = max(0, min(start_ms, total_ms - 1))
            end = max(start + 1, min(end_ms, total_ms))
            cut_path = tmp_dir / f"out-{j:03d}.m4a"
            duration_ms = clip.clip_audio(
                concat_path, cut_path, start_ms=start, end_ms=end
            )
            if trim_silence:
                trimmed_path = tmp_dir / f"trim-{j:03d}.m4a"
                duration_ms = _trim_silence(cut_path, trimmed_path)
                cut_path = trimmed_path
            out.append(
                (base64.b64encode(cut_path.read_bytes()).decode("ascii"), duration_ms)
            )
        return out
