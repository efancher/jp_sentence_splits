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
`PATH` (audio extraction/clipping). The kana-reading/morphology engine
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
profile: `yt-dlp --cookies-from-browser chrome --cookies -
https://www.youtube.com > youtube-cookies.txt` — and copy it to
`server/youtube-mining/youtube-cookies.txt` on this host (gitignored,
never commit it — it's equivalent to a session credential). The systemd
unit already points `MINING_YTDLP_COOKIES_FILE` at that path; without the
file present, mining jobs from this host will fail at the download step.
Cookies expire periodically — re-export and re-copy when jobs start
failing with the same bot-check error again.

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
