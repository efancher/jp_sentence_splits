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


def reclip_group(
    clips_b64: list[str], cuts: list[tuple[int, int]]
) -> list[tuple[str, int]]:
    """Concatenate the base64 m4a `clips_b64` (in order) and cut each
    `(start_ms, end_ms)` range out of the concatenation.

    Returns one `(base64_m4a, duration_ms)` per cut, in the same order.
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
            out.append(
                (base64.b64encode(cut_path.read_bytes()).decode("ascii"), duration_ms)
            )
        return out
