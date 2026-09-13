"""Client for shadowing-analysis-api's `POST /align` — forced alignment of
a *known* transcript against *known* audio (MFA via kalpy), confirmed live
against `~/projects/shadowing-analysis-api` on this box (port 8002,
`app/main.py`'s `align_audio`). Distinct from `asr_client.py`'s ASR calls
(audio -> unknown text): this is text -> timestamps for text already known
correct — e.g. an NHK Easy article's furigana-sourced sentences
(`app/nhk_easy.py`) against its narration audio, the "known text, need
audio boundaries" shape `ResegmentSourcePage` already uses per-sentence
from the frontend (`src/lib/alignmentCache.ts`), scaled up here to a whole
short article in one call rather than one aligner call per sentence.
"""

from __future__ import annotations

import logging

import httpx

from app import config

logger = logging.getLogger("youtube_mining_api.align")


def align_audio(audio_bytes: bytes, mime_type: str, transcript: str) -> list[dict] | None:
    """Word-level alignment of `transcript` against `audio_bytes` — each
    returned dict is `{"start": float, "end": float, "text": str, "phones":
    [...]}`, seconds. `text` is the aligner's own tokenization, not
    guaranteed to reproduce `transcript` verbatim (real finding, see
    `app/nhk_easy.py`'s `assign_sentence_spans`: numerals commonly come back
    as `<unk>`, silence as `<eps>`). Returns None on any failure (service
    unreachable/unavailable, blank transcript) — same "unavailable, not an
    error" contract as `asr_client.py`, so a caller degrades (e.g. import
    the article as text-only, no audio) rather than fail the whole import.
    """
    if not config.ANALYSIS_API_BASE or not transcript.strip():
        return None
    try:
        resp = httpx.post(
            f"{config.ANALYSIS_API_BASE}/align",
            files={"audio": ("audio.m4a", audio_bytes, mime_type)},
            data={"transcript": transcript},
            timeout=config.ALIGN_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
        words = resp.json().get("words")
        return words if isinstance(words, list) else None
    except Exception as exc:  # noqa: BLE001 - any failure -> caller degrades
        logger.warning("Alignment unavailable: %s", exc)
        return None
