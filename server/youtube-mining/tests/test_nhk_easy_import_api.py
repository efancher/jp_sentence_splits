"""API-layer test for POST /nhk-easy/import. Network (audio fetch, the
align service) and ffmpeg are monkeypatched out — same convention as
test_jobs_api.py — so this exercises the orchestration (parse -> fetch ->
align -> clip -> degrade) rather than real I/O; test_nhk_easy.py covers the
real parsing/alignment-math logic against real fixtures."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import align_client, clip
from app.main import app
import httpx as httpx_module

DESCRIPTION = (
    "<p><ruby>今日<rt>きょう</rt></ruby>は<ruby>晴<rt>は</rt></ruby>れです。</p>"
    "<p><ruby>明日<rt>あした</rt></ruby>も<ruby>晴<rt>は</rt></ruby>れでしょう。</p>"
)


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def test_full_import_with_successful_alignment(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_get(url, timeout=None, follow_redirects=None):
        return httpx_module.Response(200, content=b"fake-audio-bytes", request=httpx_module.Request("GET", url))

    def fake_align_audio(audio_bytes, mime_type, transcript):
        assert audio_bytes == b"fake-audio-bytes"
        assert transcript == "今日は晴れです。明日も晴れでしょう。"
        return [
            {"start": 0.0, "end": 1.0, "text": "今日"},
            {"start": 1.0, "end": 2.0, "text": "は"},
            {"start": 2.0, "end": 3.0, "text": "晴れ"},
            {"start": 3.0, "end": 3.2, "text": "です"},
            {"start": 3.2, "end": 3.4, "text": "<eps>"},
            {"start": 3.4, "end": 4.0, "text": "明日"},
            {"start": 4.0, "end": 4.2, "text": "も"},
            {"start": 4.2, "end": 5.0, "text": "晴れ"},
            {"start": 5.0, "end": 5.5, "text": "でしょう"},
        ]

    def fake_clip_audio(source_path: Path, output_path: Path, *, start_ms, end_ms, fade_ms=20) -> int:
        Path(output_path).write_bytes(b"fake-clip")
        return end_ms - start_ms

    monkeypatch.setattr(httpx_module, "get", fake_get)
    monkeypatch.setattr(align_client, "align_audio", fake_align_audio)
    monkeypatch.setattr(clip, "clip_audio", fake_clip_audio)

    response = client.post(
        "/nhk-easy/import",
        json={
            "title": "Weather",
            "descriptionHtml": DESCRIPTION,
            "audioUrl": "https://nhkeasier.com/media/mp3/x.mp3",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["audioAligned"] is True
    assert len(body["sentences"]) == 2
    assert body["sentences"][0]["japanese"] == "今日は晴れです。"
    assert body["sentences"][0]["inlineReading"] == "今日[きょう]は晴[は]れです。"
    assert body["sentences"][0]["audioBase64"]
    assert body["sentences"][1]["japanese"] == "明日も晴れでしょう。"
    assert body["sentences"][1]["audioBase64"]


def test_degrades_to_text_only_when_audio_fetch_fails(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_get(url, timeout=None, follow_redirects=None):
        raise httpx_module.ConnectError("boom", request=httpx_module.Request("GET", url))

    monkeypatch.setattr(httpx_module, "get", fake_get)

    response = client.post(
        "/nhk-easy/import",
        json={
            "title": "Weather",
            "descriptionHtml": DESCRIPTION,
            "audioUrl": "https://nhkeasier.com/media/mp3/x.mp3",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["audioAligned"] is False
    assert len(body["sentences"]) == 2
    assert all(s["audioBase64"] is None for s in body["sentences"])


def test_degrades_to_text_only_when_alignment_does_not_line_up(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_get(url, timeout=None, follow_redirects=None):
        return httpx_module.Response(200, content=b"fake-audio-bytes", request=httpx_module.Request("GET", url))

    def fake_align_audio(audio_bytes, mime_type, transcript):
        return [{"start": 0.0, "end": 1.0, "text": "全然違う"}]

    monkeypatch.setattr(httpx_module, "get", fake_get)
    monkeypatch.setattr(align_client, "align_audio", fake_align_audio)

    response = client.post(
        "/nhk-easy/import",
        json={"title": "Weather", "descriptionHtml": DESCRIPTION, "audioUrl": "https://x/y.mp3"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["audioAligned"] is False


def test_no_audio_url_is_text_only(client: TestClient) -> None:
    response = client.post(
        "/nhk-easy/import",
        json={"title": "Weather", "descriptionHtml": DESCRIPTION},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["audioAligned"] is False
    assert len(body["sentences"]) == 2


def test_no_sentences_returns_400(client: TestClient) -> None:
    response = client.post(
        "/nhk-easy/import",
        json={"title": "Empty", "descriptionHtml": "<img src=\"x.jpg\">"},
    )
    assert response.status_code == 400


def test_one_sentence_clip_failure_does_not_fail_the_whole_import(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_get(url, timeout=None, follow_redirects=None):
        return httpx_module.Response(200, content=b"fake-audio-bytes", request=httpx_module.Request("GET", url))

    def fake_align_audio(audio_bytes, mime_type, transcript):
        return [
            {"start": 0.0, "end": 1.0, "text": "今日"},
            {"start": 1.0, "end": 2.0, "text": "は"},
            {"start": 2.0, "end": 3.0, "text": "晴れ"},
            {"start": 3.0, "end": 3.2, "text": "です"},
            {"start": 3.4, "end": 4.0, "text": "明日"},
            {"start": 4.0, "end": 4.2, "text": "も"},
            {"start": 4.2, "end": 5.0, "text": "晴れ"},
            {"start": 5.0, "end": 5.5, "text": "でしょう"},
        ]

    call_count = {"n": 0}

    def flaky_clip_audio(source_path: Path, output_path: Path, *, start_ms, end_ms, fade_ms=20) -> int:
        call_count["n"] += 1
        if call_count["n"] == 1:
            raise RuntimeError("ffmpeg boom")
        Path(output_path).write_bytes(b"fake-clip")
        return end_ms - start_ms

    monkeypatch.setattr(httpx_module, "get", fake_get)
    monkeypatch.setattr(align_client, "align_audio", fake_align_audio)
    monkeypatch.setattr(clip, "clip_audio", flaky_clip_audio)

    response = client.post(
        "/nhk-easy/import",
        json={"title": "Weather", "descriptionHtml": DESCRIPTION, "audioUrl": "https://x/y.mp3"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["audioAligned"] is True
    assert body["sentences"][0]["audioBase64"] is None
    assert body["sentences"][1]["audioBase64"]
