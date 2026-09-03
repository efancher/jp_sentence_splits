"""Server-side waveform + pause detection for the segmentation-boundary
editor (`SegmentationWaveform` in the web app).

The browser used to fetch the whole reviewed span — up to ~12 MB / 8 min
for a podcast — and run it through `AudioContext.decodeAudioData`, which
reliably fails on iOS Safari for a span that long. Now one ffmpeg pass
here decodes the span at a low rate for the display polyline and, in the
same invocation, runs `silencedetect` for the pause markers; the client
receives a few KB of JSON and draws it directly.
"""

from __future__ import annotations

import array
import re
import subprocess
import sys
from pathlib import Path

# Low sample rate — plenty for a ~600-px overview polyline, and it keeps
# both the PCM payload and the pure-Python bucketing trivial.
DISPLAY_SAMPLE_RATE = 1_000
DISPLAY_BUCKETS = 600

# `silencedetect` params. -35 dBFS / 120 ms mirrors the thresholds the old
# client-side `detectSilences` used (0.08 of peak ≈ ~22 dB below a typical
# speech peak; a 0.12 s minimum run).
SILENCE_NOISE_DB = -35
SILENCE_MIN_SECONDS = 0.12

_SILENCE_RE = re.compile(r"silence_(start|end):\s*(-?\d+(?:\.\d+)?)")


def _run_ffmpeg(
    source_path: Path, start_ms: int, end_ms: int
) -> subprocess.CompletedProcess[bytes]:
    """Decode [start_ms, end_ms) of `source_path` to low-rate mono s16le on
    stdout while `silencedetect` writes pause spans to stderr. `-ss` before
    `-i` (input seeking) resets the timeline to 0, so the silence times are
    span-relative — same reasoning as `clip.clip_audio`."""
    duration_s = max(0.0, (end_ms - start_ms) / 1000)
    return subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "info",  # silencedetect logs at info level
            "-ss",
            f"{start_ms / 1000:.3f}",
            "-i",
            str(source_path),
            "-t",
            f"{duration_s:.3f}",
            "-vn",
            "-ac",
            "1",
            "-af",
            f"silencedetect=noise={SILENCE_NOISE_DB}dB:d={SILENCE_MIN_SECONDS}",
            "-ar",
            str(DISPLAY_SAMPLE_RATE),
            "-f",
            "s16le",
            "-",
        ],
        check=True,
        capture_output=True,
    )


def _peaks_from_pcm(pcm: bytes, buckets: int) -> list[list[float]]:
    """[min, max] per bucket, each in -1..1, over signed-16 little-endian PCM."""
    samples = array.array("h")
    samples.frombytes(pcm[: len(pcm) - (len(pcm) % 2)])
    if sys.byteorder == "big":
        samples.byteswap()
    total = len(samples)
    if total == 0 or buckets <= 0:
        return []
    bucket_size = max(1, total // buckets)
    peaks: list[list[float]] = []
    for start in range(0, total, bucket_size):
        chunk = samples[start : start + bucket_size]
        if not chunk:
            break
        peaks.append([min(chunk) / 32768.0, max(chunk) / 32768.0])
        if len(peaks) == buckets:
            break
    return peaks


def _silence_mids_ms(stderr: bytes, start_ms: int, span_ms: int) -> list[int]:
    """Absolute (startMs-relative) midpoint of every detected pause."""
    starts: list[float] = []
    ends: list[float] = []
    for kind, value in _SILENCE_RE.findall(stderr.decode("utf-8", "replace")):
        (starts if kind == "start" else ends).append(float(value))
    mids: list[int] = []
    for i, silence_start in enumerate(starts):
        silence_end = ends[i] if i < len(ends) else span_ms / 1000
        mids.append(start_ms + round((silence_start + silence_end) / 2 * 1000))
    return mids


def waveform_for_span(
    source_path: Path,
    start_ms: int,
    end_ms: int,
    buckets: int = DISPLAY_BUCKETS,
) -> dict:
    """`{"peaks": [[min, max], ...], "silenceMidsMs": [...]}` for the span —
    see `WaveformResponse`."""
    if end_ms <= start_ms:
        raise ValueError("endMs must be greater than startMs")
    proc = _run_ffmpeg(source_path, start_ms, end_ms)
    return {
        "peaks": _peaks_from_pcm(proc.stdout, buckets),
        "silenceMidsMs": _silence_mids_ms(proc.stderr, start_ms, end_ms - start_ms),
    }
