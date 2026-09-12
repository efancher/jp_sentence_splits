"""POST /validate-transcript — cross-check a sentence's stored Japanese
against a fresh ASR pass of its own reference-audio clip."""

from __future__ import annotations

import base64

from fastapi.testclient import TestClient

from app import validate
from app.main import app

client = TestClient(app)


def test_matching_clip_returns_high_similarity(monkeypatch):
    monkeypatch.setattr(validate, "generate_reading", lambda text: None)
    monkeypatch.setattr(validate.asr_client, "transcribe_clip", lambda *_: "今日は元気です")

    resp = client.post(
        "/validate-transcript",
        json={
            "audioBase64": base64.b64encode(b"fake-audio").decode("ascii"),
            "expectedText": "今日は元気です",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["asrText"] == "今日は元気です"
    assert body["similarity"] == 1.0
    assert body["reason"] is None


def test_mismatched_clip_returns_low_similarity(monkeypatch):
    monkeypatch.setattr(validate, "generate_reading", lambda text: None)
    monkeypatch.setattr(validate.asr_client, "transcribe_clip", lambda *_: "全然違う内容です")

    resp = client.post(
        "/validate-transcript",
        json={
            "audioBase64": base64.b64encode(b"fake-audio").decode("ascii"),
            "expectedText": "今日は元気です",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["similarity"] < 0.5


def test_asr_unavailable_returns_null_similarity_not_an_error(monkeypatch):
    monkeypatch.setattr(validate.asr_client, "transcribe_clip", lambda *_: None)

    resp = client.post(
        "/validate-transcript",
        json={
            "audioBase64": base64.b64encode(b"fake-audio").decode("ascii"),
            "expectedText": "何か",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["asrText"] is None
    assert body["similarity"] is None
    assert body["reason"]


def test_rejects_empty_expected_text():
    resp = client.post(
        "/validate-transcript",
        json={
            "audioBase64": base64.b64encode(b"fake-audio").decode("ascii"),
            "expectedText": "",
        },
    )
    assert resp.status_code == 422
