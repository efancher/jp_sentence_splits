"""POST /reclip — re-cut reference audio onto new sentence boundaries after
the "Re-segment captions" flow re-splits a source."""

from __future__ import annotations

import base64
import subprocess
import wave
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.clip import probe_duration_ms
from app.main import app

client = TestClient(app)


def _ffmpeg_available() -> bool:
    try:
        subprocess.run(["ffmpeg", "-version"], check=True, capture_output=True)
        subprocess.run(["ffprobe", "-version"], check=True, capture_output=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


pytestmark = pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg/ffprobe required")


def _m4a(tmp_path: Path, name: str, seconds: float) -> bytes:
    wav = tmp_path / f"{name}.wav"
    n = int(seconds * 16000)
    with wave.open(str(wav), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(16000)
        wf.writeframes(b"\x00\x00" * n)
    m4a = tmp_path / f"{name}.m4a"
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(wav), "-c:a", "aac", "-b:a", "128k", str(m4a)],
        check=True,
        capture_output=True,
    )
    return m4a.read_bytes()


def _m4a_tone_in_silence(tmp_path: Path, name: str, total_s: float, tone_s: float) -> bytes:
    """A `tone_s` sine burst centred in `total_s` of silence."""
    pad = (total_s - tone_s) / 2
    m4a = tmp_path / f"{name}.m4a"
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-t", f"{total_s}", "-i", "anullsrc=r=16000:cl=mono",
            "-f", "lavfi", "-t", f"{tone_s}", "-i", "sine=frequency=440:r=16000",
            "-filter_complex",
            f"[1:a]adelay={int(pad * 1000)}|{int(pad * 1000)}[t];[0:a][t]amix=inputs=2:duration=first",
            "-c:a", "aac", "-b:a", "128k", str(m4a),
        ],
        check=True,
        capture_output=True,
    )
    return m4a.read_bytes()


def test_reclip_splits_a_single_clip(tmp_path: Path) -> None:
    clip = base64.b64encode(_m4a(tmp_path, "a", 6.0)).decode()
    resp = client.post(
        "/reclip",
        json={
            "clipsBase64": [clip],
            "cuts": [{"startMs": 0, "endMs": 2000}, {"startMs": 2000, "endMs": 6000}],
        },
    )
    assert resp.status_code == 200
    clips = resp.json()["clips"]
    assert len(clips) == 2
    for out, expected in zip(clips, (2000, 4000)):
        assert out["mimeType"] == "audio/mp4"
        raw = base64.b64decode(out["audioBase64"])
        path = tmp_path / "check.m4a"
        path.write_bytes(raw)
        assert abs(probe_duration_ms(path) - expected) < 300


def test_reclip_concatenates_a_merge_group(tmp_path: Path) -> None:
    a = base64.b64encode(_m4a(tmp_path, "a", 3.0)).decode()
    b = base64.b64encode(_m4a(tmp_path, "b", 3.0)).decode()
    resp = client.post(
        "/reclip",
        json={
            "clipsBase64": [a, b],
            "cuts": [{"startMs": 1000, "endMs": 5000}],
        },
    )
    assert resp.status_code == 200
    clips = resp.json()["clips"]
    assert len(clips) == 1
    path = tmp_path / "merged.m4a"
    path.write_bytes(base64.b64decode(clips[0]["audioBase64"]))
    assert abs(probe_duration_ms(path) - 4000) < 400


def test_reclip_clamps_out_of_range_cut(tmp_path: Path) -> None:
    clip = base64.b64encode(_m4a(tmp_path, "a", 2.0)).decode()
    resp = client.post(
        "/reclip",
        json={"clipsBase64": [clip], "cuts": [{"startMs": 0, "endMs": 99999}]},
    )
    assert resp.status_code == 200
    path = tmp_path / "c.m4a"
    path.write_bytes(base64.b64decode(resp.json()["clips"][0]["audioBase64"]))
    assert abs(probe_duration_ms(path) - 2000) < 300


def test_reclip_trim_silence_tightens_to_speech(tmp_path: Path) -> None:
    clip = base64.b64encode(_m4a_tone_in_silence(tmp_path, "a", total_s=8.0, tone_s=2.0)).decode()
    resp = client.post(
        "/reclip",
        json={
            "clipsBase64": [clip],
            "cuts": [{"startMs": 0, "endMs": 8000}],
            "trimSilence": True,
        },
    )
    assert resp.status_code == 200
    out = resp.json()["clips"][0]
    # ~2s tone + up to ~0.25s retained lead/out, well under the 8s input.
    assert 1500 < out["durationMs"] < 3500


def test_reclip_trim_silence_falls_back_on_all_silent(tmp_path: Path) -> None:
    clip = base64.b64encode(_m4a(tmp_path, "a", 3.0)).decode()
    resp = client.post(
        "/reclip",
        json={
            "clipsBase64": [clip],
            "cuts": [{"startMs": 0, "endMs": 3000}],
            "trimSilence": True,
        },
    )
    assert resp.status_code == 200
    # Nothing to keep -> plain copy rather than a near-empty file.
    assert resp.json()["clips"][0]["durationMs"] > 2000


def test_reclip_rejects_empty() -> None:
    assert client.post("/reclip", json={"clipsBase64": [], "cuts": []}).status_code == 422
