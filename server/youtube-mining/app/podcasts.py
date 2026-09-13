"""Podcast RSS feed parsing.

A show's RSS feed gives an episode's title/date, but never Japanese body
text to score for difficulty and never a YouTube-shaped id `youtube.py` can
key on — so this is deliberately its own small module, not an extension of
`youtube.py`. Fetching happens server-side (`fetch_podcast_feed`) because a
browser-side fetch of an arbitrary feed host would hit CORS; parsing itself
(`parse_podcast_feed`) is a pure function over the XML text so it's testable
without any network access, same convention as `subtitles.py`.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET

import httpx

from app.models import PodcastEpisode, PodcastFeed

FETCH_TIMEOUT_SECONDS = 15.0

_ITUNES_DURATION_TAG = "{http://www.itunes.com/dtds/podcast-1.0.dtd}duration"


def parse_podcast_feed(xml_text: str) -> PodcastFeed:
    """Parse RSS 2.0 XML into a feed title + its enclosure-bearing episodes.

    Items with no `<enclosure>` (show notes, video-only entries) are
    skipped — there's nothing for the mining pipeline to download.
    """
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise ValueError(f"Not a valid RSS/XML feed: {exc}") from exc

    channel = root.find("channel")
    if channel is None:
        raise ValueError("Not a valid RSS feed (no <channel> element)")

    feed_title = (channel.findtext("title") or "").strip()
    episodes: list[PodcastEpisode] = []
    for item in channel.findall("item"):
        enclosure = item.find("enclosure")
        url = enclosure.get("url") if enclosure is not None else None
        if not url:
            continue
        episodes.append(
            PodcastEpisode(
                title=(item.findtext("title") or "").strip(),
                url=url,
                publishedAt=item.findtext("pubDate"),
                durationSeconds=_parse_itunes_duration(item),
            )
        )
    return PodcastFeed(title=feed_title, episodes=episodes)


def _parse_itunes_duration(item: ET.Element) -> int | None:
    """`itunes:duration` is either a bare second count or HH:MM:SS/MM:SS."""
    raw = (item.findtext(_ITUNES_DURATION_TAG) or "").strip()
    if not raw:
        return None
    parts = raw.split(":")
    if not all(part.isdigit() for part in parts):
        return None
    seconds = 0
    for part in parts:
        seconds = seconds * 60 + int(part)
    return seconds


async def fetch_podcast_feed(url: str) -> PodcastFeed:
    """Download and parse a podcast's RSS feed. Raises on network/parse errors."""
    async with httpx.AsyncClient(
        timeout=FETCH_TIMEOUT_SECONDS, follow_redirects=True
    ) as client:
        response = await client.get(url)
        response.raise_for_status()
    return parse_podcast_feed(response.text)
