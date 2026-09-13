"""POST /difficulty — the stateless endpoint the mining wizard's Transcript
stage calls to preview a rough beginner/intermediate/advanced readout before
"Apply & segment" (see docs/ROADMAP.md, "Podcast mining" item 5)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.readings import reading_engine_available

client = TestClient(app)

pytestmark = pytest.mark.skipif(
    not reading_engine_available(),
    reason="fugashi + unidic-lite reading engine is not installed",
)


def test_difficulty_scores_a_simple_transcript() -> None:
    resp = client.post(
        "/difficulty",
        json={
            "segments": [
                {"text": "今日は晴れです。", "startMs": 0, "endMs": 2000},
                {"text": "明日も晴れでしょう。", "startMs": 2000, "endMs": 4000},
            ]
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["level"] in {"beginner", "intermediate", "advanced"}
    assert 0.0 <= body["commonWordRatio"] <= 1.0
    assert body["avgSentenceLength"] > 0
    assert body["moraePerSecond"] > 0


def test_difficulty_requires_at_least_one_segment() -> None:
    resp = client.post("/difficulty", json={"segments": []})
    assert resp.status_code == 422
