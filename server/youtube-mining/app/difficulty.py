"""Rough transcript-difficulty screening checkpoint.

Surfaced right after the mining wizard's Transcript stage (before spending
time on Segment/Translate/Commit) and on NHK Easy import — see
docs/ROADMAP.md, "Podcast mining" item 5. Deliberately one shared function
rather than a copy per pipeline; call sites tokenize however they already do
(UniDic, via app/morphology.py) and hand the grouped tokens here.

Not a calibrated CEFR-style placement — the thresholds in `_classify` are a
starting guess, good enough to flag "this is going to be a slog" before
committing 15-20 minutes of review, not a precise score.
"""

from __future__ import annotations

from app import morphology
from app.common_words import is_common_word
from app.models import DifficultyLevel, DifficultyScore, MorphemeToken
from app.subtitles import SENTENCE_END_CHARS

# Content POS classes only — particles/auxiliaries/symbols are
# near-universally JMDict-common and would flatten the ratio toward 1.0
# regardless of the transcript's real vocabulary difficulty.
_CONTENT_POS_PREFIXES = frozenset(
    {"名詞", "動詞", "形容詞", "形状詞", "副詞", "感動詞", "接頭辞", "接尾辞"}
)

# ゃゅょ (and their katakana forms) merge into the preceding kana as one
# mora (きゃ = 1 mora) rather than adding one of their own.
_NON_MORA_KANA = frozenset("ゃゅょャュョ")


def _is_content_token(token: MorphemeToken) -> bool:
    return token.pos.split("/", 1)[0] in _CONTENT_POS_PREFIXES


def _mora_count(reading: str) -> int:
    return sum(1 for ch in reading if ch not in _NON_MORA_KANA)


def _classify(common_word_ratio: float, avg_sentence_length: float | None) -> DifficultyLevel:
    length_penalty = 0
    if avg_sentence_length is not None:
        if avg_sentence_length >= 14:
            length_penalty = 2
        elif avg_sentence_length >= 9:
            length_penalty = 1

    if common_word_ratio >= 0.85 and length_penalty == 0:
        return "beginner"
    if common_word_ratio >= 0.65 and length_penalty <= 1:
        return "intermediate"
    return "advanced"


def _is_decimal_point(text: str, index: int) -> bool:
    """Same guard as app/nhk_easy.py's private copy (350.5ミリ shouldn't
    split mid-number) — duplicated rather than imported since that one is
    tuned to run after nhk_easy's own narrower SENTENCE_END_CHARS."""
    return (
        text[index] == "."
        and 0 < index < len(text) - 1
        and text[index - 1].isdigit()
        and text[index + 1].isdigit()
    )


def _split_sentences(text: str) -> list[str]:
    """Split raw, possibly-unpunctuated ASR/caption text on sentence-final
    punctuation (subtitles.py's ASR-tuned SENTENCE_END_CHARS, which — unlike
    nhk_easy.py's narrower set — includes closing brackets, a reasonable
    proxy for "quoted utterance, probably done" in noisy ASR text). Text
    with no sentence-final punctuation at all comes back as a single piece —
    the right fallback for unpunctuated ASR, where the caller then treats
    the whole segment as one "sentence" for the length average."""
    sentences: list[str] = []
    start = 0
    for index, char in enumerate(text):
        if char not in SENTENCE_END_CHARS or _is_decimal_point(text, index):
            continue
        sentences.append(text[start : index + 1])
        start = index + 1
    if start < len(text):
        sentences.append(text[start:])
    return [s.strip() for s in sentences if s.strip()]


def tokenize_segments_for_scoring(
    segments: list[tuple[str, int, int]],
) -> tuple[list[list[MorphemeToken]], float | None]:
    """`segments` is (text, startMs, endMs) triples — the wizard's raw
    Transcript-stage segments, pre-resegmentation. Splits each segment's
    text into sentence-like pieces (see `_split_sentences`) and tokenizes
    each with the existing UniDic pipeline. Duration is the outer span of
    every segment's timestamps, for the morae/second figure."""
    groups: list[list[MorphemeToken]] = []
    for text, _start_ms, _end_ms in segments:
        for piece in _split_sentences(text):
            tokens = morphology.tokenize_japanese(piece)
            if tokens:
                groups.append(tokens)
    if not segments:
        return groups, None
    duration_ms = max(end for _, _, end in segments) - min(start for _, start, _ in segments)
    duration_seconds = duration_ms / 1000 if duration_ms > 0 else None
    return groups, duration_seconds


def score_difficulty(
    sentences: list[list[MorphemeToken]],
    duration_seconds: float | None = None,
) -> DifficultyScore:
    """`sentences` groups UniDic tokens by sentence — or by whatever
    caller-defined chunk stands in for one when real sentence segmentation
    hasn't run yet (the wizard's Transcript stage groups by raw ASR/caption
    segment; NHK Easy import passes its already-final sentences)."""
    content_tokens = [t for group in sentences for t in group if _is_content_token(t)]
    if not content_tokens:
        return DifficultyScore()

    common_hits = sum(1 for t in content_tokens if is_common_word(t.lemma))
    common_word_ratio = common_hits / len(content_tokens)

    non_empty_groups = [g for g in sentences if g]
    avg_sentence_length = (
        sum(len(g) for g in non_empty_groups) / len(non_empty_groups) if non_empty_groups else None
    )

    morae_per_second = None
    if duration_seconds and duration_seconds > 0:
        total_morae = sum(
            _mora_count(t.reading or t.lemmaReading) for group in sentences for t in group
        )
        morae_per_second = total_morae / duration_seconds

    return DifficultyScore(
        commonWordRatio=common_word_ratio,
        avgSentenceLength=avg_sentence_length,
        moraePerSecond=morae_per_second,
        level=_classify(common_word_ratio, avg_sentence_length),
    )
