"""Client for shadowing-analysis-api's `POST /transcribe-source`.

YouTube's Japanese auto-caption track has no reliable kanji and no
punctuation — the latter being exactly what `resegment.py`'s merge/split
keys on, so the segmenter is inert on the input that needs it most. A
Whisper transcript of the audio has both. When the analysis service is
reachable we use its transcript as the cue source; otherwise we fall back
to the caption track (`app/subtitles.py`), same as before.
"""

from __future__ import annotations

import logging
from pathlib import Path

import httpx

from app import config
from app.models import Cue

logger = logging.getLogger("youtube_mining_api.asr")


def transcribe_source(audio_path: Path) -> list[Cue] | None:
    """ASR cues for `audio_path`, or None when ASR is disabled / the service
    is unreachable / it returned nothing — the caller then uses caption cues."""
    if not config.USE_ASR_TRANSCRIPT or not config.ANALYSIS_API_BASE:
        return None
    try:
        with audio_path.open("rb") as fh:
            resp = httpx.post(
                f"{config.ANALYSIS_API_BASE}/transcribe-source",
                files={"audio": (audio_path.name, fh, "audio/ogg")},
                timeout=config.ASR_TIMEOUT_SECONDS,
            )
        resp.raise_for_status()
        segments = resp.json().get("segments") or []
    except Exception as exc:  # noqa: BLE001 - any failure → caption fallback
        logger.warning("ASR transcript unavailable, using captions: %s", exc)
        return None

    def _low_confidence(seg: dict) -> bool:
        lp = seg.get("avgLogprob")
        ns = seg.get("noSpeechProb")
        return (lp is not None and lp < config.ASR_LOW_CONFIDENCE_LOGPROB) or (
            ns is not None and ns > config.ASR_HIGH_NO_SPEECH_PROB
        )

    cues = [
        Cue(
            index=i,
            startMs=int(seg["startMs"]),
            endMs=int(seg["endMs"]),
            text=str(seg["text"]).strip(),
            isAuto=True,
            lowConfidence=_low_confidence(seg),
        )
        for i, seg in enumerate(segments)
        if str(seg.get("text", "")).strip()
    ]
    if not cues:
        logger.warning("ASR returned no usable segments, using captions")
        return None
    return cues
