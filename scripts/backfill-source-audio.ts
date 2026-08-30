/**
 * Prime the youtube-mining service's persistent source-audio cache
 * (`server/youtube-mining/app/source_cache.py`) for shadowing books that
 * were imported before the cache existed.
 *
 * The cache lets a re-segment / audio-repair re-cut each sentence straight
 * from the pristine source (`applyResegmentation` → `POST /source-audio/clip`)
 * instead of concatenating lossy fragment clips. New mines populate it
 * automatically; this backfills the older books.
 *
 * For each distinct YouTube source URL across the user's non-deleted
 * `reference_audio` rows, calls `POST /source-audio {url}` — the service
 * downloads + transcodes + caches it (routed through the Tailscale exit
 * node). Idempotent: an already-cached source returns immediately.
 *
 * Dry-run by default; --apply to actually hit the service. Needs the mining
 * service reachable (tailnet) with a working YouTube path (exit node up).
 * Override the URL with MINING_API_BASE.
 *
 * Usage: npx tsx scripts/backfill-source-audio.ts [--apply] [--url <one-off>]
 */
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const API_BASE = (process.env.MINING_API_BASE ??
  'https://codex-dev.tailfbd89c.ts.net/youtube-mining').replace(/\/$/, '');

const YT_RE = /(?:v=|youtu\.be\/|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/;

async function main() {
  const argv = process.argv.slice(2);
  const apply = parseApplyFlag(argv);
  const oneOff = argv[argv.indexOf('--url') + 1];

  let urls: string[];
  if (argv.includes('--url') && oneOff) {
    urls = [oneOff];
  } else {
    const supabase = await createScriptSupabaseClient();
    const user = await requireAuthedUser(supabase);
    const { data, error } = await supabase
      .from('reference_audio')
      .select('source_url')
      .eq('owner_id', user.id)
      .is('deleted_at', null)
      .not('source_url', 'is', null);
    if (error) throw new Error(`fetch reference_audio: ${error.message}`);
    urls = [
      ...new Set(
        (data ?? [])
          .map((r) => String(r.source_url))
          .filter((u) => YT_RE.test(u)),
      ),
    ];
  }

  console.log(`${urls.length} distinct source URL(s) to ensure cached:\n`);
  for (const url of urls) console.log(`  ${url}`);
  if (!apply) {
    console.log('\nDry run — re-run with --apply to prime the cache.');
    return;
  }

  let ok = 0;
  for (const url of urls) {
    process.stdout.write(`\n${url} … `);
    try {
      const resp = await fetch(`${API_BASE}/source-audio`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!resp.ok) {
        console.log(`FAILED ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
        continue;
      }
      const info = (await resp.json()) as {
        videoId: string;
        durationMs: number;
        sizeBytes: number;
      };
      console.log(
        `cached ${info.videoId} (${(info.durationMs / 1000).toFixed(0)}s, ${(
          info.sizeBytes / 1024
        ).toFixed(0)} KiB)`,
      );
      ok += 1;
    } catch (err) {
      console.log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`\nDone. ${ok}/${urls.length} source(s) cached.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
