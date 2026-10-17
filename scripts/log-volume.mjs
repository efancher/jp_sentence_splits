// Log volume by source and day via the Supabase Management API (ClickHouse `logs` endpoint;
// all sources live in one `logs` table, filtered by source_name).
//
//   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/log-volume.mjs [--days 14 | --day 2026-10-03]
//   node scripts/log-volume.mjs --sql "select ..." [--days 1]     # run one custom query per day
//
// Token: https://supabase.com/dashboard/account/tokens (personal access token).
// Project ref is derived from VITE_SUPABASE_URL in .env. Read-only.

import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('Set SUPABASE_ACCESS_TOKEN (personal access token from the Supabase dashboard).');
  process.exit(1);
}

const ref = process.env.SUPABASE_PROJECT_REF ?? new URL(process.env.VITE_SUPABASE_URL).hostname.split('.')[0];
const days = Number(flag('days', '14'));
const customSql = flag('sql');
// The endpoint rejects windows longer than 24h, so query one day at a time.
async function query(sql, start, end) {
  const url = new URL(`https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs`);
  url.searchParams.set('sql', sql);
  url.searchParams.set('iso_timestamp_start', start.toISOString());
  url.searchParams.set('iso_timestamp_end', end.toISOString());
  let res;
  let body;
  for (let attempt = 0; attempt < 6; attempt++) {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    body = await res.text();
    if (res.status !== 429) break;
    await new Promise((resolve) => setTimeout(resolve, 3000 * (attempt + 1)));
  }
  if (!res.ok) throw new Error(`${res.status} ${body.slice(0, 400)}`);
  const json = JSON.parse(body);
  if (json.error) throw new Error(JSON.stringify(json.error).slice(0, 400));
  return json.result ?? [];
}

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
// --day YYYY-MM-DD queries that UTC calendar day; otherwise rolling 24h windows back from now.
const day = flag('day');
const windows = day
  ? [{ start: new Date(`${day}T00:00:00Z`), end: new Date(`${day}T23:59:59Z`), label: day }]
  : Array.from({ length: days }, (_, i) => {
      const end = new Date(now - i * DAY);
      return { start: new Date(end.getTime() - DAY), end, label: end.toISOString().slice(0, 10) };
    });

if (customSql) {
  for (const w of windows) {
    try {
      console.log(`--- ${w.label}`);
      console.log(JSON.stringify(await query(customSql, w.start, w.end), null, 2));
    } catch (error) {
      console.error(`${w.label}: ${error.message}`);
    }
  }
  process.exit(0);
}

// Size = message plus attributes; billing counts the whole record, not just event_message.
const sql =
  'select source, count(*) as n, sum(length(event_message) + length(toString(log_attributes))) as chars from logs group by source';
const rows = [];
const sources = new Set();
for (const w of windows) {
  const bySource = {};
  try {
    for (const r of await query(sql, w.start, w.end)) {
      bySource[r.source] = { n: Number(r.n), mb: Number(r.chars) / 1e6 };
      sources.add(r.source);
    }
  } catch (error) {
    console.error(`${w.label}: ${error.message}`);
  }
  rows.push({ label: w.label, bySource });
}
const cols = [...sources].sort();
const cell = (c) => (c ? `${c.n} (${c.mb.toFixed(1)}MB)` : '-').padStart(22);
console.log(['day'.padEnd(11), ...cols.map((c) => c.padStart(22))].join(' '));
for (const r of rows) console.log([r.label.padEnd(11), ...cols.map((c) => cell(r.bySource[c]))].join(' '));
