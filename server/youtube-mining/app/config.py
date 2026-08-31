import os

API_HOST = os.environ.get("MINING_API_HOST", "127.0.0.1")
API_PORT = int(os.environ.get("MINING_API_PORT", "8003"))

# The jp_sentence_splits frontend (deployed origin + local dev). Safe to
# allow-list explicitly rather than wildcard — this service is also only
# reachable at all over the Tailscale tailnet (see shadowing-analysis-api's
# app/config.py for the same reasoning), CORS is an extra layer, not the
# only one.
ALLOWED_ORIGINS = os.environ.get(
    "MINING_ALLOWED_ORIGINS",
    "https://efancher.github.io,http://localhost:5173,http://127.0.0.1:5173",
).split(",")

# Where each job's scratch directory (downloaded audio, subtitles, clips)
# lives. One subdirectory per job id, swept on a timer (see app/jobs.py).
JOBS_ROOT = os.environ.get("MINING_JOBS_ROOT", "/tmp/youtube-mining-jobs")
# ~6 h: the staged mining wizard (docs/mining-wizard-spec.md) keeps a job
# live across an interactive review that can span a sitting. No disk
# checkpointing — a swept mid-wizard job means restarting the mine, and the
# source is cached so re-download is the only cost.
JOB_TTL_SECONDS = int(os.environ.get("MINING_JOB_TTL_SECONDS", str(6 * 60 * 60)))
JOB_SWEEP_INTERVAL_SECONDS = int(
    os.environ.get("MINING_JOB_SWEEP_INTERVAL_SECONDS", "600")
)

# Fail a job whose downloaded source audio peaks below this (dBFS) — it's
# silent. YouTube serves a valid-looking but silent stream to yt-dlp
# requests it doesn't trust (stale/untrusted cookies from a datacenter
# IP), and clipping that yields a book of soundless reference audio with
# no other error. -80 dB is well below real speech (~-20) and well above
# digital silence (~-91). Set to -inf to disable the check.
SILENT_SOURCE_MAX_DB = float(
    os.environ.get("MINING_SILENT_SOURCE_MAX_DB", "-80")
)

# YouTube blocks datacenter/cloud IPs (this box included) with a bot-check
# unless yt-dlp presents cookies from a real logged-in browser session —
# export a cookies.txt (e.g. the "Get cookies.txt LOCALLY" browser
# extension, or `yt-dlp --cookies-from-browser <browser> --cookies
# cookies.txt --skip-download <watch-url>`, which writes the jar to that
# file) and point this at it. Unset by default: most local-dev machines
# don't need
# it, only cloud-hosted deployments do.
YTDLP_COOKIES_FILE = os.environ.get("MINING_YTDLP_COOKIES_FILE") or None

# yt-dlp player client(s), comma-separated. Empty = let yt-dlp choose.
#
# History: `web`/`tv` hit "The page needs to be reloaded." (yt-dlp #17389)
# so this was pinned to `web_safari,mweb` — but those now only offer
# progressive audio behind a GVS PO token, so `bestaudio` falls through to
# a combined video format (or nothing). yt-dlp's own default currently
# resolves a real audio-only format (tested 2026-08-30). Revisit if the
# reload bug resurfaces on the default; `tv` is the usual next try but was
# still broken as of that date.
#
# If a job fails with "source audio is silent" (SILENT_SOURCE_MAX_DB),
# YouTube served a poison silent stream — refresh the cookies first.
YTDLP_PLAYER_CLIENT = os.environ.get(
    "MINING_YTDLP_PLAYER_CLIENT", ""
).strip()

# Cross-check a 固有名詞 (proper-noun) token's reading against JMnedict at
# tokenize time and prefer the dictionary's when it disagrees — UniDic-lite
# fumbles distinctive names and a re-mine never improves them. Data ships in
# app/data/name_readings.json.gz (see app/name_readings.py). Set
# MINING_NAME_READING_CHECK=0 to disable.
NAME_READING_CHECK = os.environ.get("MINING_NAME_READING_CHECK", "1") != "0"

# Transcribe the mined source with ASR (shadowing-analysis-api
# POST /transcribe-source) and use *that* as the cue text, not YouTube's
# Japanese auto-caption track (no reliable kanji, no punctuation — the
# latter being what resegment.py's merge/split needs). Falls back to the
# caption track whenever the analysis service is unreachable or slow.
# See app/asr_client.py. Set MINING_USE_ASR_TRANSCRIPT=0 to force captions.
ANALYSIS_API_BASE = (
    os.environ.get("MINING_ANALYSIS_API_BASE", "http://127.0.0.1:8002").rstrip("/")
)
USE_ASR_TRANSCRIPT = os.environ.get("MINING_USE_ASR_TRANSCRIPT", "1") != "0"
# large-v3-turbo runs ~1.5–3.6x realtime on the analysis box's CPU, and a
# music-heavy track triggers a second no-VAD pass — 30 min covers a long
# source with headroom.
ASR_TIMEOUT_SECONDS = float(os.environ.get("MINING_ASR_TIMEOUT_SECONDS", "1800"))
# An ASR segment is flagged low-confidence (→ review UI marks it) when its
# mean token log-prob is below this or its no-speech probability is above the
# next one. Whisper's typical clean-speech avg_logprob is ~-0.25 to -0.4.
ASR_LOW_CONFIDENCE_LOGPROB = float(
    os.environ.get("MINING_ASR_LOW_CONFIDENCE_LOGPROB", "-0.55")
)
ASR_HIGH_NO_SPEECH_PROB = float(
    os.environ.get("MINING_ASR_HIGH_NO_SPEECH_PROB", "0.6")
)

# Persistent per-video source-audio cache (app/source_cache.py). Unlike a
# job's scratch dir this is never swept: a re-segment / audio-repair pass
# months later re-cuts from the original source stashed here instead of from
# a lossy concat of fragment clips. Compressed Opus mono, ~250 KB/min at the
# default 32 kbps; LRU-evicted once the directory passes MAX_BYTES.
SOURCE_CACHE_ROOT = os.environ.get(
    "MINING_SOURCE_CACHE_ROOT",
    os.path.join(os.path.expanduser("~"), ".cache", "youtube-mining", "source-cache"),
)
SOURCE_CACHE_MAX_BYTES = int(
    os.environ.get("MINING_SOURCE_CACHE_MAX_BYTES", str(2 * 1024 * 1024 * 1024))
)
SOURCE_CACHE_OPUS_KBPS = int(os.environ.get("MINING_SOURCE_CACHE_OPUS_KBPS", "32"))

# Route yt-dlp + subtitle/info fetches through a Tailscale exit node for the
# duration of each download. YouTube bot-blocks this datacenter IP (see the
# cookies note above); a personal device on a home connection, already on
# the tailnet and advertising an exit node, gives yt-dlp a residential IP
# with none of the cookie fragility. The value is a Tailscale device name
# (as in `tailscale status`, e.g. "eds-macbook-pro") or IP. Requires the
# `tailscale` CLI on PATH and this service's user set as the Tailscale
# operator (`sudo tailscale set --operator=<user>`, one-time). Unset = no
# routing (local dev, or a box with a clean egress IP). See app/exit_node.py.
MINING_EXIT_NODE = os.environ.get("MINING_EXIT_NODE") or None
# Used when MINING_EXIT_NODE is offline / not advertising an exit node
# (laptop asleep → fall back to the phone). Optional.
MINING_EXIT_NODE_FALLBACK = os.environ.get("MINING_EXIT_NODE_FALLBACK") or None

# yt-dlp needs an external JavaScript runtime to solve YouTube's `n`
# signature challenge (required since yt-dlp 2025.11.12; without it every
# format is dropped and extraction fails). Node >= 22, Deno, Bun or
# QuickJS all work; the `yt-dlp-ejs` package (in requirements.txt) ships
# the solver scripts. Default runtime name is `node`. If the binary is
# not on the service's PATH, set MINING_YTDLP_JS_RUNTIME_PATH to its
# absolute path (the systemd unit does this for nvm-managed node). Set
# the name to empty to fall back to yt-dlp's own default (`deno`).
YTDLP_JS_RUNTIME = os.environ.get("MINING_YTDLP_JS_RUNTIME", "node").strip()
YTDLP_JS_RUNTIME_PATH = os.environ.get("MINING_YTDLP_JS_RUNTIME_PATH") or None
