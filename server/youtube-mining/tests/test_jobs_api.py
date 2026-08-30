"""End-to-end job lifecycle test against the FastAPI app.

Network (yt-dlp) and ffmpeg/ffprobe calls are monkeypatched out so this
runs anywhere without those binaries/network access — the pure pipeline
logic (subtitle parsing, resegmentation, alignment, boundary math) is
exercised for real; only the I/O edges are faked.
"""

from __future__ import annotations

import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import asr_client, clip, jobs, youtube
from app.main import app

JA_VTT = """WEBVTT

00:00:00.000 --> 00:00:01.000
こんにちは。

00:00:01.000 --> 00:00:02.000
元気ですか。
"""

EN_VTT = """WEBVTT

00:00:00.000 --> 00:00:01.000
Hello.

00:00:01.000 --> 00:00:02.000
How are you?
"""


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(jobs.config, "JOBS_ROOT", str(tmp_path))

    def fake_fetch_audio(url: str, job_dir: Path) -> Path:
        audio_path = job_dir / "source_audio.m4a"
        audio_path.write_bytes(b"fake-audio")
        return audio_path

    def fake_download_subtitles(url: str, job_dir: Path, langs=None) -> list[Path]:
        subtitle_dir = job_dir / "subtitles"
        subtitle_dir.mkdir(parents=True, exist_ok=True)
        (subtitle_dir / "video.ja.vtt").write_text(JA_VTT, encoding="utf-8")
        (subtitle_dir / "video.en.vtt").write_text(EN_VTT, encoding="utf-8")
        return sorted(subtitle_dir.glob("*.vtt"))

    def fake_inspect_url(url: str) -> dict:
        return {
            "id": "vid12345678",
            "title": "Fixture Video",
            "channel": "Fixture Channel",
            "duration": 2.0,
            "webpage_url": url,
        }

    def fake_probe_duration_ms(path: Path) -> int:
        return 5000

    def fake_clip_audio(source_path, output_path, *, start_ms, end_ms, fade_ms=20) -> int:
        Path(output_path).write_bytes(b"fake-clip")
        return end_ms - start_ms

    monkeypatch.setattr(youtube, "fetch_audio", fake_fetch_audio)
    monkeypatch.setattr(youtube, "download_subtitles", fake_download_subtitles)
    monkeypatch.setattr(youtube, "inspect_url", fake_inspect_url)
    monkeypatch.setattr(clip, "probe_duration_ms", fake_probe_duration_ms)
    monkeypatch.setattr(clip, "clip_audio", fake_clip_audio)
    monkeypatch.setattr(clip, "probe_max_volume_db", lambda _path: -18.0)
    # Default: ASR unavailable → caption path. Individual tests override.
    monkeypatch.setattr(asr_client, "transcribe_source", lambda _path: None)

    return TestClient(app)


def _wait_until_ready(client: TestClient, job_id: str, timeout_s: float = 5.0) -> dict:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        response = client.get(f"/jobs/{job_id}")
        body = response.json()
        if body["status"] in ("ready", "error"):
            return body
        time.sleep(0.05)
    raise TimeoutError("job did not finish in time")


def test_job_lifecycle_fetch_to_clip(client: TestClient) -> None:
    create = client.post("/jobs", json={"url": "https://www.youtube.com/watch?v=vid12345678"})
    assert create.status_code == 200
    job_id = create.json()["jobId"]

    status = _wait_until_ready(client, job_id)
    assert status["status"] == "ready"
    assert status["source"]["title"] == "Fixture Video"
    assert [cue["japanese"] for cue in status["cues"]] == ["こんにちは。", "元気ですか。"]
    assert status["cues"][0]["englishGuess"] == "Hello."

    clip_response = client.post(
        f"/jobs/{job_id}/cues/0/clip",
        json={"japanese": "こんにちは。", "english": "Hello.", "generateKana": False},
    )
    assert clip_response.status_code == 200
    clip_body = clip_response.json()
    assert clip_body["japanese"] == "こんにちは。"
    assert clip_body["audio"]["durationMs"] > 0
    sentence_id = clip_body["sentenceId"]

    audio_response = client.get(f"/jobs/{job_id}/clips/{sentence_id}/audio")
    assert audio_response.status_code == 200
    assert audio_response.content == b"fake-clip"

    delete_response = client.delete(f"/jobs/{job_id}")
    assert delete_response.status_code == 200


def test_clip_unknown_cue_returns_404(client: TestClient) -> None:
    create = client.post("/jobs", json={"url": "https://www.youtube.com/watch?v=vid12345678"})
    job_id = create.json()["jobId"]
    _wait_until_ready(client, job_id)

    response = client.post(
        f"/jobs/{job_id}/cues/99/clip",
        json={"japanese": "test", "generateKana": False},
    )
    assert response.status_code == 404


def test_uses_asr_transcript_over_captions_when_available(
    client: TestClient, monkeypatch
) -> None:
    from app.models import Cue

    monkeypatch.setattr(
        jobs.asr_client,
        "transcribe_source",
        lambda _path: [
            Cue(index=0, startMs=0, endMs=1800, text="全然違う文だよ。", isAuto=True),
            Cue(index=1, startMs=1800, endMs=3600, text="キャプションじゃない。", isAuto=True),
        ],
    )
    create = client.post("/jobs", json={"url": "https://www.youtube.com/watch?v=vid12345678"})
    job_id = create.json()["jobId"]
    status = _wait_until_ready(client, job_id)
    assert status["status"] == "ready"
    # The ASR text, not こんにちは。/ 元気ですか。 from the caption fixture.
    assert [c["japanese"] for c in status["cues"]] == [
        "全然違う文だよ。",
        "キャプションじゃない。",
    ]


def test_cue_preview_audio(client: TestClient) -> None:
    create = client.post("/jobs", json={"url": "https://www.youtube.com/watch?v=vid12345678"})
    job_id = create.json()["jobId"]
    _wait_until_ready(client, job_id)

    resp = client.get(f"/jobs/{job_id}/cues/0/audio")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "audio/mp4"
    assert resp.content == b"fake-clip"
    # Cached — a second request serves the same file without re-clipping.
    assert client.get(f"/jobs/{job_id}/cues/0/audio").status_code == 200
    assert client.get(f"/jobs/{job_id}/cues/99/audio").status_code == 404


def test_unknown_job_returns_404(client: TestClient) -> None:
    response = client.get("/jobs/does-not-exist")
    assert response.status_code == 404


def test_clip_range_without_cue(client: TestClient) -> None:
    create = client.post("/jobs", json={"url": "https://www.youtube.com/watch?v=vid12345678"})
    job_id = create.json()["jobId"]
    _wait_until_ready(client, job_id)

    response = client.post(
        f"/jobs/{job_id}/clip",
        json={"japanese": "佐藤ゆうじです。", "startMs": 1500, "endMs": 3200, "generateKana": False},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["startMs"] == 1500
    assert body["endMs"] == 3200
    assert body["audio"]["durationMs"] > 0

    audio_response = client.get(f"/jobs/{job_id}/clips/{body['sentenceId']}/audio")
    assert audio_response.status_code == 200
    assert audio_response.content == b"fake-clip"


def test_silent_source_fails_job(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(jobs.clip, "probe_max_volume_db", lambda _path: -91.0)
    create = client.post("/jobs", json={"url": "https://www.youtube.com/watch?v=vid12345678"})
    job_id = create.json()["jobId"]
    status = _wait_until_ready(client, job_id)
    assert status["status"] == "error"
    assert "silent" in status["error"].lower()


def test_clip_range_requires_timings(client: TestClient) -> None:
    create = client.post("/jobs", json={"url": "https://www.youtube.com/watch?v=vid12345678"})
    job_id = create.json()["jobId"]
    _wait_until_ready(client, job_id)

    response = client.post(
        f"/jobs/{job_id}/clip",
        json={"japanese": "test", "startMs": 1000, "generateKana": False},
    )
    assert response.status_code == 409
