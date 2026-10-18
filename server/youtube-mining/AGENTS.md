# Mining and assistant-run backend

Apply root guidance. This is the Python FastAPI service; the MFA/transcription
service is a separate repository. Paths and Python commands here are relative
to `server/youtube-mining`.

- Use a Python virtual environment and `requirements-dev.txt` for tests. CI
  uses Python 3.12 and installs ffmpeg; audio tests need ffmpeg/ffprobe on PATH.
  Run `python -m pytest -m "not slow" -q` for the offline suite, or a relevant
  file under `tests/`. The `slow` marker denotes real YouTube/yt-dlp networking.
- Tests should redirect job/cache paths to `tmp_path`, fake assistant subprocesses
  and mock external HTTP/download/alignment boundaries. Preserve tests that use
  local ffmpeg to validate actual clip/waveform behavior.
- Keep API shapes in `app/models.py` consistent with frontend clients and parsers
  such as the root `src/lib/miningApi.ts`. Distinguish source timing, clip timing
  and transcript provenance when editing segmentation or commit behavior.
- Jobs and assistant runs survive tab closure and process restart through
  checkpoints. Preserve resumability, partial-result recovery and bounded
  retries; test failures and restart/reload paths when changing this machinery.
- Source-cache Storage backup is best-effort and optional. A backup error must
  not break a local cache write. Preserve the distinction between local cache
  eviction and durable source availability.
- Read configuration from `app/config.py`; do not assume this development
  checkout is the running service. Service units, tailnet configuration and
  deployment instructions are in [README.md](README.md) and `deploy/`.
  Keep the service's tailnet-only exposure and optional morphology fallback.

Changes spanning `scripts/assist-run.ts` or frontend import logic also require
their relevant TypeScript checks from the repository root. Report local tests
and live-service verification separately.
