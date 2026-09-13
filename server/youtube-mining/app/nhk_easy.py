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

# Deliberately narrower than subtitles.py's SENTENCE_END_CHARS (which
# includes 」』): that set is tuned for noisy ASR/caption text, where a
# closing bracket is a reasonable proxy for "quoted utterance, probably the
# end." NHK Easy is edited prose that routinely embeds a quoted title or
# reported speech *mid*-sentence (「スター・ウォーズ」などたくさんの映画を
# 監督しています。; 区の人は「...」と話しています。) — real 2026-09-13 finding
# from a full-corpus dry run: treating 」/』 as sentence-final cut 88 of 471
# real sentences (19%) apart at the bracket, well before the actual 。. NHK
# Easy's controlled style always closes a real sentence with proper
# terminal punctuation even when it contains a quote, so dropping the
# bracket chars here doesn't cost any real splits.
SENTENCE_END_CHARS = "。｡．.！!？?…"

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


@dataclass(frozen=True)
class SentenceSpan:
    """A sentence's aligned position in the narration audio, in seconds."""

    start_seconds: float
    end_seconds: float


# Below this fraction of the transcript successfully anchored to a real
# (non-<eps>/<unk>) aligner word, treat the alignment as untrustworthy —
# see assign_sentence_spans.
_MIN_MATCHED_CHAR_RATIO = 0.6


def assign_sentence_spans(
    sentences: list[NhkEasySentence], words: list[dict]
) -> list[SentenceSpan] | None:
    """Map shadowing-analysis-api's `POST /align` word timings (seconds)
    back onto sentence boundaries.

    Real 2026-09-13 finding, from actually calling `/align` on a live
    nhkeasier.com article rather than assuming: forced-alignment word
    output isn't a clean concatenation of the input transcript the way
    Whisper ASR's word timings are (`resegment.py`'s `_split_ends_from_words`
    assumes exactly that, for that different input). MFA/kalpy interleaves
    `<eps>` (silence) and `<unk>` (out-of-vocabulary — on real data this was
    almost always a bare arabic numeral like the "11" in "11日", which the
    lexicon has no pronunciation entry for) tokens that don't correspond to
    any specific span of the known text. On that same real article, every
    *other* word (99/102) matched the known transcript as a literal,
    in-order substring — so this walks the transcript with a search cursor,
    anchors on each substring match, and simply skips `<eps>`/unmatched
    words rather than trusting their length. A sentence boundary lands on
    the first anchor reaching that sentence's cumulative character count,
    so a numeral near a boundary shifts it by at most that numeral's own
    duration, not into a different sentence entirely.

    Returns None — caller should skip audio for that one article rather
    than trust a guess — when too little of the transcript anchored to a
    real word at all (a genuine mismatch: wrong audio, garbled OCR-ish
    text, etc.), not just an OOV numeral or two.
    """
    transcript = "".join(s.japanese for s in sentences)
    if not transcript or not words:
        return None

    cursor = 0
    matched_chars = 0
    anchors: list[tuple[int, float]] = [(0, 0.0)]
    for word in words:
        text = str(word.get("text", ""))
        if text in ("<eps>", "<unk>", ""):
            continue
        found = transcript.find(text, cursor)
        if found == -1:
            continue
        cursor = found + len(text)
        matched_chars += len(text)
        anchors.append((cursor, float(word.get("end", anchors[-1][1]))))

    if matched_chars < len(transcript) * _MIN_MATCHED_CHAR_RATIO:
        return None

    def time_at(target_chars: int) -> float:
        for chars, seconds in anchors:
            if chars >= target_chars:
                return seconds
        return anchors[-1][1]

    spans: list[SentenceSpan] = []
    sentence_start_char = 0
    prev_end = 0.0
    for sentence in sentences:
        full_end_char = sentence_start_char + len(sentence.japanese)
        # Trailing 。！？ etc. is never itself a spoken/aligned word (real
        # finding: looking for the *full* sentence length landed on the
        # next sentence's first matched word instead, since nothing anchors
        # exactly at the punctuation's own position) — the last real anchor
        # sits at the sentence's last non-punctuation character.
        stripped_length = len(sentence.japanese.rstrip(SENTENCE_END_CHARS))
        target_char = sentence_start_char + stripped_length
        end_time = time_at(target_char)
        if end_time < prev_end:
            return None
        spans.append(SentenceSpan(start_seconds=prev_end, end_seconds=end_time))
        prev_end = end_time
        sentence_start_char = full_end_char
    return spans


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
