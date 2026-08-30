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
included) with "Sign in to confirm you're not a bot". Two ways around it:
a **Tailscale exit node** (preferred — no credentials, no rotation) or
**cookies** (fallback). They stack; configure whichever you can.

#### Tailscale exit node (preferred)

If a personal device already on the tailnet (laptop, phone) advertises a
Tailscale exit node, the service routes each download through it — yt-dlp
then sees that device's residential IP. `app/exit_node.py` flips the box's
exit node on just around the audio/subtitle/info fetches and clears it
after, so the rest of the box's traffic only detours for a minute or two
per job. Concurrent jobs are serialized.

Setup:

1. **On the device(s):** enable "run as exit node" — macOS: Tailscale menu
   bar → *Exit Nodes* → *Run as Exit Node*; iOS/Android: Tailscale app →
   the device's settings → *Use as exit node*. Approve each in the
   [admin console](https://login.tailscale.com/admin/machines) (or
   auto-approve via an ACL `autoApprovers` rule).
2. **On this box, one-time:** `sudo tailscale set --operator=$USER` so the
   service (running as your user, not root) may switch exit nodes without
   sudo.
3. **Config:** the systemd unit sets `MINING_EXIT_NODE=eds-macbook-pro`
   (primary) and `MINING_EXIT_NODE_FALLBACK=iphone174` (used when the
   laptop is offline). Values are device names as shown in
   `tailscale status`. Unset both to disable routing.

Behaviour when it can't route: if neither configured node is online and
advertising an exit node, the job logs a warning and downloads direct
(then usually fails the silent-stream check). Wake the laptop / foreground
the phone's Tailscale app and retry — or fall back to cookies below. The
device must stay connected for the whole download (~50–200 MB); a phone on
cellular spends mobile data, and iOS may suspend the VPN extension in the
background.

#### Cookies (fallback)

Export one from
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
failing with the same bot-check error again. They can also rotate within
minutes of first use from a datacenter IP, so export and run promptly.

**Silent audio.** If a job *fails* with "source audio is silent"
(`SILENT_SOURCE_MAX_DB` in `app/config.py`, ~-80 dBFS), the download's
audio track is silent. Usual cause: stale/untrusted cookies from this IP.
Refresh the cookies and retry; verify a raw download's volume with:

```
yt-dlp --cookies youtube-cookies.txt -f bestaudio -o /tmp/probe.m4a "<watch-url>"
ffmpeg -hide_banner -i /tmp/probe.m4a -af volumedetect -f null - 2>&1 | grep max_volume
```

(A `clip_audio` bug that silenced *every faded clip* regardless of the
source — `-ss` after `-i` moving the `afade` window out of range — was
fixed 2026-08-30. If soundless clips reappear, re-check that first.)

**Future: PO-token provider.** The cookie fragility on this datacenter IP
(instant rotation, 429s, formats gated behind a GVS PO token) is best
solved long-term by running [`bgutil-ytdlp-pot-provider`](https://github.com/Brainicism/bgutil-ytdlp-pot-provider):
a small Node service that runs YouTube's BotGuard VM to mint Proof-of-Origin
tokens, plus a `pip install bgutil-ytdlp-pot-provider` plugin that yt-dlp
auto-discovers. With it, public videos need few/no cookies and sessions
last. Cost: another systemd unit to keep updated (BotGuard breaks it every
few months). Not set up yet — revisit if mining keeps failing here.

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

The `tv` (and historically `web`) player client fails every video with
`ERROR: [youtube] <id>: The page needs to be reloaded.` (yt-dlp #17389 /
#17405). We were pinned to `player_client=web_safari,mweb` to dodge it,
but those clients' audio now needs a GVS PO token, so `bestaudio` came up
empty. As of 2026-08-30 yt-dlp's own default resolves a real audio-only
format (opus, format 251), so `MINING_YTDLP_PLAYER_CLIENT` now defaults to
empty (let yt-dlp choose). Set it back to a specific client here if the
default regresses.

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
- `MINING_EXIT_NODE` / `MINING_EXIT_NODE_FALLBACK` — Tailscale device
  name(s) to route each download through (primary, then fallback if the
  primary is offline). See "Tailscale exit node" above. Unset by default.
- `MINING_YTDLP_COOKIES_FILE` — path to a cookies.txt for yt-dlp; see
  "YouTube's bot-check" above. Unset by default.
- `MINING_YTDLP_PLAYER_CLIENT` — comma-separated yt-dlp
  `youtube:player_client` list (default `web_safari,mweb`); empty to use
  yt-dlp's own default. See "Player-client" above.
- `MINING_YTDLP_JS_RUNTIME` / `MINING_YTDLP_JS_RUNTIME_PATH` — JS runtime
  name (default `node`) and, if it's not on PATH, its absolute path. See
  "JavaScript runtime" above.
