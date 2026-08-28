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
JOB_TTL_SECONDS = int(os.environ.get("MINING_JOB_TTL_SECONDS", str(2 * 60 * 60)))
JOB_SWEEP_INTERVAL_SECONDS = int(
    os.environ.get("MINING_JOB_SWEEP_INTERVAL_SECONDS", "600")
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

# Passing cookies currently trips YouTube's "The page needs to be
# reloaded." error on yt-dlp's default/`web` player client (yt-dlp #17389
# / #17405), so we force a client list that excludes it. `web_safari`
# yields downloadable HLS audio; `mweb` is a fallback. Comma-separated;
# set to empty to let yt-dlp pick its own default once the upstream bug
# is fixed.
YTDLP_PLAYER_CLIENT = os.environ.get(
    "MINING_YTDLP_PLAYER_CLIENT", "web_safari,mweb"
).strip()

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
