import pytest

from app.podcasts import parse_podcast_feed

# Trimmed shape of a real feed (Nihongo con Teppei), not synthetic —
# confirmed live 2026-09-13 against http://nihongoconteppei.com/feed/podcast.
SAMPLE_FEED = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel>
<title>Japanese podcast for beginners (Nihongo con Teppei)</title>
<item>
  <title>#1581「きみちゃんが新しい生徒を探しています！！」</title>
  <pubDate>Fri, 12 Sep 2026 00:00:00 +0000</pubDate>
  <enclosure url="http://media.blubrry.com/nihongo_con_teppei/Beginners-con-Teppei1581.mp3" length="7446098" type="audio/mpeg"/>
  <itunes:duration>5:32</itunes:duration>
</item>
<item>
  <title>#1580「ジムに行った次の日について！」</title>
  <pubDate>Thu, 11 Sep 2026 00:00:00 +0000</pubDate>
  <enclosure url="http://media.blubrry.com/nihongo_con_teppei/Beginners-con-Teppei1580.mp3" length="7000000" type="audio/mpeg"/>
  <itunes:duration>332</itunes:duration>
</item>
<item>
  <title>Show notes only, no audio</title>
  <pubDate>Wed, 10 Sep 2026 00:00:00 +0000</pubDate>
</item>
</channel>
</rss>
"""


def test_parse_podcast_feed_basic() -> None:
    feed = parse_podcast_feed(SAMPLE_FEED)
    assert feed.title == "Japanese podcast for beginners (Nihongo con Teppei)"
    # The enclosure-less item is skipped — nothing for the pipeline to mine.
    assert len(feed.episodes) == 2

    first = feed.episodes[0]
    assert first.title == "#1581「きみちゃんが新しい生徒を探しています！！」"
    assert first.url == "http://media.blubrry.com/nihongo_con_teppei/Beginners-con-Teppei1581.mp3"
    assert first.publishedAt == "Fri, 12 Sep 2026 00:00:00 +0000"
    assert first.durationSeconds == 5 * 60 + 32
    # A real podcast has no <description> body worth extracting — None,
    # not a crash. nhkeasier.com items do (see test_nhk_easy.py).
    assert first.descriptionHtml is None


def test_parse_podcast_feed_bare_seconds_duration() -> None:
    feed = parse_podcast_feed(SAMPLE_FEED)
    assert feed.episodes[1].durationSeconds == 332


def test_parse_podcast_feed_missing_duration() -> None:
    xml = """<rss><channel><title>T</title>
    <item><title>Ep</title><enclosure url="http://x/e.mp3" type="audio/mpeg"/></item>
    </channel></rss>"""
    feed = parse_podcast_feed(xml)
    assert feed.episodes[0].durationSeconds is None


def test_parse_podcast_feed_invalid_xml_raises() -> None:
    with pytest.raises(ValueError, match="Not a valid RSS/XML feed"):
        parse_podcast_feed("this is not xml")


def test_parse_podcast_feed_no_channel_raises() -> None:
    with pytest.raises(ValueError, match="no <channel>"):
        parse_podcast_feed("<rss></rss>")


def test_parse_podcast_feed_captures_description_html() -> None:
    xml = """<rss><channel><title>T</title>
    <item><title>Ep</title><enclosure url="http://x/e.mp3" type="audio/mpeg"/>
    <description>&lt;p&gt;&lt;ruby&gt;日&lt;rt&gt;にち&lt;/rt&gt;&lt;/ruby&gt;です。&lt;/p&gt;</description>
    </item>
    </channel></rss>"""
    feed = parse_podcast_feed(xml)
    assert feed.episodes[0].descriptionHtml == "<p><ruby>日<rt>にち</rt></ruby>です。</p>"


def test_fetch_podcast_feed_sends_browser_like_user_agent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Buzzsprout 403s httpx's default UA, so the fetch must override it."""
    import asyncio

    import httpx

    from app import podcasts

    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["ua"] = request.headers["user-agent"]
        if seen["ua"].startswith("python-httpx"):
            return httpx.Response(403)
        return httpx.Response(200, text="<rss><channel><title>Show</title></channel></rss>")

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        podcasts.httpx,
        "AsyncClient",
        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw),
    )

    feed = asyncio.run(podcasts.fetch_podcast_feed("https://feeds.example.com/1.rss"))
    assert feed.title == "Show"
    assert not seen["ua"].startswith("python-httpx")
