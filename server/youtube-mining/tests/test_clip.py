from __future__ import annotations

import subprocess
import wave
from pathlib import Path

import pytest

from app.clip import clip_audio, compute_boundaries, probe_max_volume_db


def test_compute_boundaries_pads() -> None:
    start, end, adjusted_start, adjusted_end = compute_boundaries(1000, 2000)
    assert start == 1000
    assert end == 2000
    assert adjusted_start == 700
    assert adjusted_end == 2250


def test_compute_boundaries_clamps_to_media_duration() -> None:
    _, _, adjusted_start, adjusted_end = compute_boundaries(
        100, 900, media_duration_ms=1000
    )
    assert adjusted_start == 0
    assert adjusted_end == 1000


def _ffmpeg_available() -> bool:
    try:
        subprocess.run(["ffmpeg", "-version"], check=True, capture_output=True)
        subprocess.run(["ffprobe", "-version"], check=True, capture_output=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


def _write_silent_wav(path: Path, seconds: float = 3.0, sample_rate: int = 16000) -> None:
    n = int(seconds * sample_rate)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(b"\x00\x00" * n)


@pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg/ffprobe required")
def test_clip_audio_roundtrip(tmp_path: Path) -> None:
    wav = tmp_path / "source.wav"
    _write_silent_wav(wav, seconds=3.0)
    m4a = tmp_path / "source.m4a"
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(wav), "-c:a", "aac", "-b:a", "128k", str(m4a)],
        check=True,
        capture_output=True,
    )

    output = tmp_path / "clip.m4a"
    duration_ms = clip_audio(m4a, output, start_ms=1000, end_ms=2000)
    assert output.exists()
    assert duration_ms > 0


@pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg/ffprobe required")
def test_probe_max_volume_db_detects_silence(tmp_path: Path) -> None:
    wav = tmp_path / "silent.wav"
    _write_silent_wav(wav, seconds=2.0)
    assert probe_max_volume_db(wav) < -80


@pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg/ffprobe required")
def test_probe_max_volume_db_detects_tone(tmp_path: Path) -> None:
    tone = tmp_path / "tone.wav"
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
         str(tone)],
        check=True,
        capture_output=True,
    )
    assert probe_max_volume_db(tone) > -20


@pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg/ffprobe required")
def test_clip_audio_keeps_sound_with_fade(tmp_path: Path) -> None:
    """Regression: -ss after -i + afade faded whole clips to -91 dBFS."""
    source = tmp_path / "tone.m4a"
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=30",
         "-c:a", "aac", "-b:a", "128k", str(source)],
        check=True,
        capture_output=True,
    )
    out = tmp_path / "clip.m4a"
    # A cut well away from t=0, where the bug silenced everything.
    clip_audio(source, out, start_ms=20_000, end_ms=23_000)
    assert probe_max_volume_db(out) > -20
