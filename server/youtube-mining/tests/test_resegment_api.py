"""POST /resegment — the stateless endpoint the in-app "Re-segment captions"
flow calls to fix an already-imported source without re-downloading."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.readings import reading_engine_available

client = TestClient(app)


def test_resegment_merges_cutoff_fragment_then_splits() -> None:
    resp = client.post(
        "/resegment",
        json={
            "sentences": [
                {"japanese": "さすがです。水希。たったの", "startMs": 0, "endMs": 1000},
                {"japanese": "1ヶ月だよ。変わんないじゃん。", "startMs": 1000, "endMs": 2000},
            ],
            "generateKana": False,
        },
    )
    assert resp.status_code == 200
    cues = resp.json()
    assert [c["japanese"] for c in cues] == [
        "さすがです。",
        "水希。",
        "たったの1ヶ月だよ。",
        "変わんないじゃん。",
    ]
    assert all(c["sourceIndexes"] == [0, 1] for c in cues)
    # Contiguous timing that stays within the input span.
    assert cues[0]["startMs"] == 0
    assert cues[-1]["endMs"] == 2000


def test_resegment_annotate_only_leaves_punctuationless_lyrics_alone() -> None:
    resp = client.post(
        "/resegment",
        json={
            "sentences": [
                {"japanese": "なあ 全身全霊で", "startMs": 0, "endMs": 1000},
                {"japanese": "ぶつかろうぜ 輝くために", "startMs": 1000, "endMs": 2000},
            ],
            "merge": False,
            "split": False,
            "generateKana": False,
        },
    )
    assert resp.status_code == 200
    cues = resp.json()
    assert [c["japanese"] for c in cues] == ["なあ 全身全霊で", "ぶつかろうぜ 輝くために"]
    assert [c["sourceIndexes"] for c in cues] == [[0], [1]]


def test_resegment_rejects_empty_sentences() -> None:
    assert client.post("/resegment", json={"sentences": []}).status_code == 422


def test_resegment_generates_readings_and_tokens_when_available() -> None:
    resp = client.post(
        "/resegment",
        json={"sentences": [{"japanese": "映画を見た。", "startMs": 0, "endMs": 1000}]},
    )
    assert resp.status_code == 200
    cue = resp.json()[0]
    if reading_engine_available():
        assert cue["reading"] and "えいが" in cue["reading"]
        assert cue["tokens"] and any(t["surface"] == "映画" for t in cue["tokens"])
    else:
        assert cue["reading"] is None
        assert cue["tokens"] is None
