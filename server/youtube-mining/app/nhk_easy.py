"""NHK Easy News ingestion via the nhkeasier.com mirror.

NHK's own News Web Easy site was redesigned into a Next.js SPA behind an
authenticated API (verified 2026-09-13: https://www3.nhk.or.jp/news/easy/
redirects to a `news.web.nhk` React app, and its `api.web.nhk` backend
returns 403 on a plain unauthenticated request) — scraping NHK directly is
no longer practical the way the original plan assumed.

https://nhkeasier.com already republishes NHK Easy articles specifically
for language learners, as a standard RSS feed
(https://nhkeasier.com/feed/, confirmed live) where each item's
`<description>` carries the full furigana-annotated body as
`<ruby>漢字<rt>かな</rt></ruby>` HTML, plus an `<enclosure>` pointing at the
official NHK narration audio, hosted on nhkeasier.com's own media server.
This is the same podcast-shaped RSS `podcasts.py` already parses — feeding
an nhkeasier.com feed URL through `parse_podcast_feed` already yields
correct title/url/pubDate per article. What that generic parser can't give
is the article's *text*, which is the whole point here: unlike a real
podcast, this text is already correct (not ASR output), so a committed
sentence should be built by forced-aligning this known text against the
known audio — never by transcribing it. This module extracts that known
text; the alignment step itself reuses the same MFA service
`resegment.py`'s reference-audio path already calls, not built here.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass

from app.subtitles import SENTENCE_END_CHARS

_RUBY_RE = re.compile(r"<ruby>(?P<base>.*?)<rt>(?P<reading>.*?)</rt></ruby>", re.DOTALL)
_BRACKET_READING_RE = re.compile(r"\[[^\]]*\]")
_PARAGRAPH_RE = re.compile(r"<p>(.*?)</p>", re.DOTALL)
_TAG_RE = re.compile(r"<[^>]+>")


@dataclass(frozen=True)
class NhkEasySentence:
    """One sentence extracted from an nhkeasier.com article body.

    `japanese` is plain text (ruby readings discarded) — this app's
    `Sentence.japanese`. `inlineReading` is `漢字[かな]` markup — this app's
    `Sentence.inlineReading`, parsed client-side the same way Satori's own
    `漢字[かな]` exports are (`src/lib/parseInlineReadings.ts`).
    """

    japanese: str
    inline_reading: str


def _ruby_to_inline_reading(fragment: str) -> str:
    """`<ruby>漢字<rt>かな</rt></ruby>` -> `漢字[かな]`, leaving plain text and
    numerals (e.g. the `11` in `11<ruby>日<rt>にち</rt></ruby>`) untouched."""
    return _RUBY_RE.sub(lambda m: f"{m.group('base')}[{m.group('reading')}]", fragment)


def _is_decimal_point(text: str, index: int) -> bool:
    """NHK Easy articles routinely report measurements like `350.5ミリ` or
    `36.5度` — a halfwidth `.` flanked by digits is a decimal point, not a
    sentence end, even though `.` is otherwise in SENTENCE_END_CHARS
    (real 2026-09-13 finding: '勝山市で350.5ミリの雨が降りました' was getting
    cut into '...で350.' + '5ミリの雨が降りました。' before this guard)."""
    return (
        text[index] == "."
        and index > 0
        and index + 1 < len(text)
        and text[index - 1].isdigit()
        and text[index + 1].isdigit()
    )


def _split_sentences(inline_reading_text: str) -> list[str]:
    """Split on sentence-final punctuation. Safe to run on already-converted
    `漢字[かな]` text: kana readings never themselves contain punctuation, so
    a `。`/`！`/etc. is never hiding inside a `[...]` span."""
    sentences: list[str] = []
    start = 0
    for index, char in enumerate(inline_reading_text):
        if char not in SENTENCE_END_CHARS or _is_decimal_point(inline_reading_text, index):
            continue
        sentences.append(inline_reading_text[start : index + 1])
        start = index + 1
    if start < len(inline_reading_text):
        sentences.append(inline_reading_text[start:])
    return [s.strip() for s in sentences if s.strip()]


def parse_nhkeasier_description(description_html: str) -> list[NhkEasySentence]:
    """Extract sentence-level (japanese, inlineReading) pairs from an
    nhkeasier.com RSS item's `<description>`. Only text inside `<p>...</p>`
    blocks is article body — the surrounding `<img>`/`<audio>`/`<ul>`
    boilerplate (illustration, native audio player, Original/Permalink
    links) is ignored here; the audio URL comes from the RSS item's own
    `<enclosure>`, already handled by `podcasts.py`.
    """
    unescaped = html.unescape(description_html)
    sentences: list[NhkEasySentence] = []
    for paragraph in _PARAGRAPH_RE.findall(unescaped):
        inline_reading_paragraph = _TAG_RE.sub("", _ruby_to_inline_reading(paragraph))
        for chunk in _split_sentences(inline_reading_paragraph):
            japanese = _BRACKET_READING_RE.sub("", chunk)
            sentences.append(NhkEasySentence(japanese=japanese, inline_reading=chunk))
    return sentences
