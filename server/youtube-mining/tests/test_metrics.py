"""app/metrics.py + the /status endpoints."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import config, metrics, status_page
from app.main import app


@pytest.fixture(autouse=True)
def _tmp_log(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "METRICS_LOG", str(tmp_path / "metrics.jsonl"))
    monkeypatch.setattr(config, "METRICS_RETENTION_DAYS", 3)


def _write(rows: list[dict]) -> None:
    with open(config.METRICS_LOG, "w") as fh:
        for r in rows:
            fh.write(json.dumps(r) + "\n")


def _row(days_ago: float, used_gb: float = 2.0) -> dict:
    return {
        "t": (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat(timespec="seconds"),
        "mem": {"total": 8 * 1024**3, "available": (8 - used_gb) * 1024**3, "used": used_gb * 1024**3},
        "swap": {"total": 4 * 1024**3, "used": 1 * 1024**3},
        "disk": {"total": 80 * 1024**3, "used": 30 * 1024**3, "free": 50 * 1024**3},
        "services": {"aligner": {"mem": int(used_gb * 1024**3), "active": True, "uptime_s": 100}},
        "caches": {"source_audio": 1024**3},
    }


def test_sample_has_expected_shape():
    snap = metrics.sample()
    assert set(snap) >= {"t", "mem", "swap", "disk", "services", "caches"}
    assert snap["mem"]["total"] > 0
    assert snap["disk"]["total"] > 0
    # configured units are all represented (mem may be None if inactive)
    assert set(snap["services"]) == {"aligner", "mining"}


def test_record_appends_and_trims_old_rows():
    _write([_row(days_ago=10), _row(days_ago=5), _row(days_ago=1)])
    metrics.record()
    rows = metrics.load()
    # the 10- and 5-day-old rows are outside the 3-day retention; 1-day + new stay
    assert len(rows) == 2
    assert all(
        datetime.fromisoformat(r["t"]) >= datetime.now(timezone.utc) - timedelta(days=3)
        for r in rows
    )


def test_load_days_filter():
    _write([_row(days_ago=2.5), _row(days_ago=0.5)])
    assert len(metrics.load(days=1)) == 1
    assert len(metrics.load(days=5)) == 2


def test_load_skips_corrupt_lines(tmp_path):
    with open(config.METRICS_LOG, "w") as fh:
        fh.write("not json\n")
        fh.write(json.dumps(_row(days_ago=0.1)) + "\n")
        fh.write('{"no":"t key"}\n')
    assert len(metrics.load()) == 1


def test_status_page_renders_without_samples():
    html = status_page.render([])
    assert "No samples yet" in html
    assert "<!doctype html>" in html


def test_status_page_renders_trend():
    html = status_page.render([_row(2, 2.0), _row(1, 3.0), _row(0, 4.0)])
    assert "<svg" in html
    assert "RAM used" in html
    assert "aligner" in html


def test_status_endpoints():
    _write([_row(days_ago=0.2), _row(days_ago=0.1)])
    client = TestClient(app)
    r = client.get("/status")
    assert r.status_code == 200
    assert "box status" in r.text
    j = client.get("/status.json").json()
    assert "current" in j and "samples" in j
    assert len(j["samples"]) == 2
