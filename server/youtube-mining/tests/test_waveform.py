"""app/waveform.py — server-side peak buckets + pause detection for the
segmentation-boundary editor."""

from __future__ import annotations

import struct
import subprocess
from pathlib import Path

import pytest

from app import waveform


def _pcm(samples: list[int]) -> bytes:
    return struct.pack(f"<{len(samples)}h", *samples)


def test_peaks_from_pcm_reports_bucket_min_max_in_unit_range():
    pcm = _pcm([0, 16384, -16384, 32767, -32768, 0])
    peaks = waveform._peaks_from_pcm(pcm, buckets=3)
    assert peaks == [
        [0.0, 16384 / 32768],
        [-16384 / 32768, 32767 / 32768],
        [-1.0, 0.0],
    ]


def test_peaks_from_pcm_empty_input():
    assert waveform._peaks_from_pcm(b"", 10) == []


def test_peaks_from_pcm_never_exceeds_requested_buckets():
    pcm = _pcm(list(range(-500, 500)))
    assert len(waveform._peaks_from_pcm(pcm, buckets=32)) <= 32


def test_silence_mids_pairs_start_end_and_closes_trailing_run():
    stderr = (
        b"[silencedetect @ 0x1] silence_start: 1.5\n"
        b"[silencedetect @ 0x1] silence_end: 2.5 | silence_duration: 1.0\n"
        b"[silencedetect @ 0x1] silence_start: 4\n"
    )
    mids = waveform._silence_mids_ms(stderr, start_ms=1000, span_ms=6000)
    # (1.5 + 2.5) / 2 = 2.0 s  ->  1000 + 2000
    # trailing unmatched start runs to the span end (6.0 s): (4 + 6) / 2 = 5.0 s
    assert mids == [3000, 6000]


def test_waveform_for_span_rejects_empty_range():
    with pytest.raises(ValueError):
        waveform.waveform_for_span(Path("x.m4a"), 100, 100)


def test_waveform_for_span_combines_ffmpeg_output(monkeypatch):
    def fake_run(source_path, start_ms, end_ms):
        return subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout=_pcm([0, 32767, -32768, 0]),
            stderr=b"silence_start: 0.5\nsilence_end: 0.7\n",
        )

    monkeypatch.setattr(waveform, "_run_ffmpeg", fake_run)
    result = waveform.waveform_for_span(Path("x.m4a"), 200, 1800, buckets=2)
    assert len(result["peaks"]) == 2
    assert result["silenceMidsMs"] == [200 + 600]  # midpoint 0.6 s


def _ffmpeg_available() -> bool:
    try:
        subprocess.run(["ffmpeg", "-version"], check=True, capture_output=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


@pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg required")
def test_waveform_for_span_end_to_end_detects_a_real_gap(tmp_path):
    src = tmp_path / "gap.m4a"
    # 330 Hz tone for 0–1 s, silence 1–2 s, tone 2–3 s.
    subprocess.run(
        [
            "ffmpeg", "-y", "-nostdin", "-v", "error",
            "-f", "lavfi",
            "-i", r"aevalsrc=sin(2*PI*330*t)*lt(mod(t\,2)\,1):d=3:s=16000",
            "-c:a", "aac", "-b:a", "96k", str(src),
        ],
        check=True,
        capture_output=True,
    )
    result = waveform.waveform_for_span(src, 0, 3000)
    assert len(result["peaks"]) > 0
    assert len(result["silenceMidsMs"]) == 1
    assert 1300 <= result["silenceMidsMs"][0] <= 1700
