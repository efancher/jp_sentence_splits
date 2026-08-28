# YouTube mining API

Backend for jp_sentence_splits's "Import from YouTube" page
(`src/pages/YouTubeMinePage.tsx`): given a YouTube URL, downloads the
audio + subtitle tracks, splits them into sentence-sized cues (merging
cut-off captions, splitting bundled ones — see `app/resegment.py`), and
lets the frontend clip + review sentences one at a time before import.

Ported from `~/projects/shadowing/cli/src/shadowmine/` (a separate,
sibling repo's Python CLI) — copied, not imported, so this app has no
runtime dependency on that repo. See `docs/ARCHITECTURE.md` in the repo
root for how this fits into the rest of the app.

## Local development

```bash
cd server/youtube-mining
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
pytest
uvicorn app.main:app --reload --port 8003
```

System requirements beyond the Python packages: `ffmpeg` and `ffprobe` on
`PATH` (audio extraction/clipping), and a JS runtime for yt-dlp's YouTube
`n`-challenge solver — `node` >= 22 (or deno/bun) on `PATH`, or its path
in `MINING_YTDLP_JS_RUNTIME_PATH`. See "JavaScript runtime" under
"YouTube's bot-check" below. The kana-reading/morphology engine
(`fugashi`/`unidic-lite`/`jaconv`) is a soft dependency — if it fails to
import or initialize, readings/tokens are simply omitted rather than
erroring (same contract as the original CLI).

Point the frontend at a local instance via a dev override:

```bash
VITE_YOUTUBE_MINING_API_BASE=http://127.0.0.1:8003 npm run dev
```

## Deployment (tailnet-only, mirrors shadowing-analysis-api)

On the host (the user's Hetzner box, alongside `shadowing-analysis-api`):

```bash
cd ~/projects/jp_sentence_splits/server/youtube-mining
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

mkdir -p ~/.config/systemd/user
cp deploy/youtube-mining-api.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now youtube-mining-api
loginctl enable-linger "$USER"   # keep it running across logout/reboot
```

Expose it on the tailnet at its own path, alongside the other services:

```bash
tailscale serve --bg --set-path /youtube-mining http://127.0.0.1:8003
```

Requires root or the tailscale operator
(`sudo tailscale set --operator=$USER`, one-time). Verify with
`tailscale serve status` — this should coexist with
`/shadowing-analysis` and any other mounted path, not replace it. No
`funnel` — tailnet-only, matching this whole app ecosystem's privacy
posture.

### YouTube's bot-check (cloud/datacenter IPs)

YouTube blocks yt-dlp requests from most cloud/datacenter IPs (this box
included) with "Sign in to confirm you're not a bot" unless yt-dlp
presents cookies from a real logged-in browser session. Export one from
your own browser (already signed into YouTube) — e.g. the "Get
cookies.txt LOCALLY" extension, or on a machine with a real browser
profile:

```
yt-dlp --cookies-from-browser firefox --cookies youtube-cookies.txt \
  --skip-download "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

yt-dlp loads cookies from the browser and writes the jar out to the
`--cookies` path when it exits. Do **not** redirect stdout (`>`) — that
captures the log, not the cookies — and use a real watch URL, not the
bare homepage (which resolves to your recommended feed). The exported
file must start with `# Netscape HTTP Cookie File` and contain
`.youtube.com` auth lines (`__Secure-3PSID`, `LOGIN_INFO`); if those are
missing, that browser profile isn't actually signed into YouTube. On
macOS, avoid `--cookies-from-browser safari` — Safari's cookie store is
in an Apple-sandboxed container and yt-dlp gets `Operation not permitted`
unless the terminal has Full Disk Access; use Firefox or the extension
instead. Copy
it to `server/youtube-mining/youtube-cookies.txt` on this host (gitignored,
never commit it — it's equivalent to a session credential). The systemd
unit already points `MINING_YTDLP_COOKIES_FILE` at that path; without the
file present, mining jobs from this host will fail at the download step.
Cookies expire periodically — re-export and re-copy when jobs start
failing with the same bot-check error again.

**Use a secondary/throwaway Google account for this, not your primary
one.** YouTube sees requests carrying that account's session cookie
arriving from a datacenter IP via yt-dlp — not a real browser's
fingerprint/TLS handshake — which is exactly the pattern abuse detection
watches for, regardless of whether the cookies came from a one-off manual
export (as above) or a persistently logged-in browser. A one-off export
used sporadically is lower-risk than continuous automated use, but if the
account does get flagged, the worst case is a lock on that account, not
just expired cookies.

### Player-client and "The page needs to be reloaded."

With cookies attached, yt-dlp's default/`web` player client currently
fails every video with `ERROR: [youtube] <id>: The page needs to be
reloaded.` (yt-dlp #17389 / #17405). We work around it by forcing
`player_client=web_safari,mweb` (`MINING_YTDLP_PLAYER_CLIENT`), which
returns downloadable HLS audio. Revisit once the upstream bug is fixed.

### JavaScript runtime (required)

Since yt-dlp 2025.11.12, extracting YouTube formats requires an external
JS runtime to solve the `n` signature challenge — without one, yt-dlp
drops every format and the job fails. We use **node (>= 22)**, plus the
`yt-dlp-ejs` pip package (in `requirements.txt`) for the solver scripts.

The systemd user PATH doesn't include nvm's node, so the unit sets
`MINING_YTDLP_JS_RUNTIME_PATH=%h/.local/bin/node`. Create that symlink
once, and re-point it after nvm upgrades node:

```
ln -sfn "$(nvm which default)" ~/.local/bin/node
```

Verify: `node --version` >= v22, and `yt-dlp -v <url>` shows
`[youtube] ... Downloading player ...` followed by `[jsc:node] Solving JS
challenges using node` with no `n challenge solving failed` warning.

## Configuration (env vars, all optional)

- `MINING_API_HOST` / `MINING_API_PORT` — bind address (default
  `127.0.0.1:8003`).
- `MINING_ALLOWED_ORIGINS` — comma-separated CORS allow-list (default
  covers the deployed GitHub Pages origin + local Vite dev).
- `MINING_JOBS_ROOT` — scratch directory for in-progress jobs (default
  `/tmp/youtube-mining-jobs`).
- `MINING_JOB_TTL_SECONDS` / `MINING_JOB_SWEEP_INTERVAL_SECONDS` — how
  long an abandoned job's scratch directory (downloaded audio, clips)
  survives before automatic cleanup, and how often the sweep runs.
- `MINING_YTDLP_COOKIES_FILE` — path to a cookies.txt for yt-dlp; see
  "YouTube's bot-check" above. Unset by default.
- `MINING_YTDLP_PLAYER_CLIENT` — comma-separated yt-dlp
  `youtube:player_client` list (default `web_safari,mweb`); empty to use
  yt-dlp's own default. See "Player-client" above.
- `MINING_YTDLP_JS_RUNTIME` / `MINING_YTDLP_JS_RUNTIME_PATH` — JS runtime
  name (default `node`) and, if it's not on PATH, its absolute path. See
  "JavaScript runtime" above.
