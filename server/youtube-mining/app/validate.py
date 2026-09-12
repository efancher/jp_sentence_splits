"""Cross-checks a sentence's stored Japanese against a fresh ASR pass of its
own reference-audio clip — catches transcript/segmentation slips like
sent_263ac750 (2026-09-11, docs/STATUS.md): a spurious leading word that was
never spoken, and cut boundaries landing mid-word. Not authoritative (ASR
errs too, especially on short/noisy clips) — a review-queue signal for a
human to judge, never an auto-fix.

Comparison runs on hiragana readings, not raw text: the same word can be
spelled with kanji or kana (色々/いろいろ) with zero character overlap but
identical pronunciation, so comparing raw text would flag the single most
common non-bug case in the corpus. `readings.generate_reading` (fugashi)
already exists for exactly this in the mining pipeline; reused here rather
than duplicated. Katakana is folded to hiragana too (independently of
`generate_reading`, which only fires on text containing kanji) — Whisper
routinely renders a name in katakana (サトウユージ) against a stored kanji+
hiragana spelling (佐藤ゆうじ), and without this fold that pair scores as a
near-total mismatch despite being the identical word (found live-testing
this module against prod data, 2026-09-12).
"""

from __future__ import annotations

import difflib

from app import asr_client
from app.readings import generate_reading

try:
    import jaconv

    _kata2hira = jaconv.kata2hira
except ImportError:  # pragma: no cover - same optional-dependency stance as readings.py
    _kata2hira = None

# Punctuation/whitespace the ASR and stored text differ on constantly for
# reasons that have nothing to do with content (comma placement, a trailing
# period the model didn't emit, a full-width space).
_STRIP_CHARS = "、。！？「」『』・…　 \n\t​"


def normalize_for_comparison(text: str) -> str:
    reading = generate_reading(text)
    base = reading if reading is not None else text
    if _kata2hira is not None:
        base = _kata2hira(base)
    return "".join(ch for ch in base if ch not in _STRIP_CHARS)


def validate_sentence_audio(
    audio_bytes: bytes, mime_type: str, expected_text: str
) -> dict:
    """Returns `{asrText, similarity, reason}`. `similarity` is a
    `difflib.SequenceMatcher` ratio in [0, 1] on the normalized (hiragana)
    forms — 1.0 is a perfect match. `asrText`/`similarity` are None when ASR
    was unreachable/empty; that's "couldn't validate", not "mismatch", so
    callers must not treat None as a low score."""
    asr_text = asr_client.transcribe_clip(audio_bytes, mime_type)
    if asr_text is None:
        return {"asrText": None, "similarity": None, "reason": "ASR unavailable or empty result"}
    similarity = difflib.SequenceMatcher(
        None, normalize_for_comparison(asr_text), normalize_for_comparison(expected_text)
    ).ratio()
    return {"asrText": asr_text, "similarity": similarity, "reason": None}
