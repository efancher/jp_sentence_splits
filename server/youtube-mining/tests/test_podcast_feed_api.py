"""API-layer test for POST /podcast-feed — network fetch is monkeypatched
out (same convention as test_jobs_api.py), so this exercises routing/error
mapping only; test_podcasts.py covers the real parsing logic."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import podcasts
from app.main import app
from app.models import PodcastEpisode, PodcastFeed


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def test_podcast_feed_success(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_fetch(url: str) -> PodcastFeed:
        assert url == "https://example.com/feed.rss"
        return PodcastFeed(
            title="Example Show",
            episodes=[
                PodcastEpisode(title="Ep 1", url="https://example.com/1.mp3", durationSeconds=600)
            ],
        )

    monkeypatch.setattr(podcasts, "fetch_podcast_feed", fake_fetch)

    response = client.post("/podcast-feed", json={"url": "https://example.com/feed.rss"})
    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "Example Show"
    assert body["episodes"][0]["url"] == "https://example.com/1.mp3"


def test_podcast_feed_invalid_feed_returns_400(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def fake_fetch(url: str) -> PodcastFeed:
        raise ValueError("Not a valid RSS/XML feed: boom")

    monkeypatch.setattr(podcasts, "fetch_podcast_feed", fake_fetch)

    response = client.post("/podcast-feed", json={"url": "https://example.com/not-a-feed"})
    assert response.status_code == 400
    assert "Not a valid RSS" in response.json()["detail"]


def test_podcast_feed_network_error_returns_502(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def fake_fetch(url: str) -> PodcastFeed:
        raise RuntimeError("connection refused")

    monkeypatch.setattr(podcasts, "fetch_podcast_feed", fake_fetch)

    response = client.post("/podcast-feed", json={"url": "https://unreachable.example/feed.rss"})
    assert response.status_code == 502
    assert "Could not fetch feed" in response.json()["detail"]
