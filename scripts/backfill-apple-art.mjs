// Rewrites stored Deezer sleeve URLs to Apple's, for the Apple build
// (assets/apple.js shows a blank sleeve for any Deezer image).
//
//   node scripts/backfill-apple-art.mjs --ref <project-ref>            dry run
//   node scripts/backfill-apple-art.mjs --ref <project-ref> --apply    writes
//
// A DATA CHANGE. On production it needs the owner's approval and a backup
// first (CLAUDE.md). Run it on the lab project and check the result before
// anything else.
//
// How: every Deezer cover URL carries the cover's hash
// (…dzcdn.net/images/cover/<32 hex>/<size>…). Each hash is paired with the
// album name and artist stored beside it (crate_feed, collection, album
// ratings), looked up once on Apple's iTunes Search API, and every URL with
// that hash, in every column below, plain or inside JSON, becomes Apple's
// 1000px sleeve. One transaction. A hash Apple cannot match is left alone and
// listed. Nothing else in a row changes.
//
// Uses the Supabase CLI's `db query --linked --project-ref`, so the ref is
// always explicit and nothing reads a linked default.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const ref = args[args.indexOf('--ref') + 1];
const APPLY = args.includes('--apply');
if (!ref || ref.startsWith('--')) { console.error('usage: --ref <project-ref> [--apply]'); process.exit(2); }

function sql(q) {
  const f = path.join(os.tmpdir(), 'vinall-backfill-' + process.pid + '.sql');
  fs.writeFileSync(f, q);
  const out = execFileSync('supabase', ['db', 'query', '--linked', '--project-ref', ref, '-f', f, '-o', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  fs.unlinkSync(f);
  return JSON.parse(out.slice(out.indexOf('{'))).rows || [];
}

// Text columns, and JSON columns that can hold a sleeve URL anywhere inside.
const TEXT = [['crate_feed', 'album_art'], ['collection', 'art'], ['liked_songs', 'art'], ['lore_answers', 'item_art'],
  ['moments', 'art'], ['suggestions', 'art']];
const JSONB = [['ratings', 'data'], ['lists', 'items'], ['profiles', 'top3'], ['profiles', 'top_songs_all'],
  ['profiles', 'top_songs_now'], ['bid_wars', 'records'], ['notifications', 'data'], ['app_state', 'value']];
const HASH = "dzcdn\\.net/images/cover/([0-9a-f]{32})/";

// 1. Hash -> album name + artist, from places that name the ALBUM.
const pairs = sql(`
  select distinct on (h) h, n, a from (
    select substring(album_art from '${HASH}') h, album_name n, album_artist a from public.crate_feed
    union all select substring(art from '${HASH}'), name, artist from public.collection
    union all select substring(data->>'art' from '${HASH}'), data->>'name', data->>'artist'
      from public.ratings where data ? 'art' and not (data ? 'albumId')
  ) x where h is not null and n is not null order by h`);
console.log(pairs.length + ' distinct Deezer sleeves with an album name');

// 2. Apple, ~20 calls a minute: one album+song search per hash, spaced.
const loose = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/ - (single|ep)$/i, '').replace(/[^a-z0-9]+/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function apple(name, artist) {
  const term = encodeURIComponent((artist + ' ' + name).trim());
  for (let i = 0; i < 5; i++) {
    let r;
    try { r = await fetch('https://itunes.apple.com/search?media=music&entity=song&limit=50&country=gb&term=' + term); }
    catch (e) { await sleep(3000); continue; }   // a dropped connection is retried, never read as a miss
    if (r.status === 403 || r.status === 429 || r.status >= 500) { await sleep(30000); continue; }
    const j = await r.json();
    const wn = loose(name), wa = loose(artist);
    const hit = (j.results || []).find((t) => loose(t.collectionName) === wn &&
      (!wa || loose(t.artistName) === wa || loose(t.collectionArtistName) === wa || loose(t.artistName).includes(wa)));
    return hit ? hit.artworkUrl100.replace(/\/\d+x\d+bb\.(jpg|png)$/, '/1000x1000bb.jpg') : null;
  }
  return null;
}
const map = [], missed = [];
for (const p of pairs) {
  const u = await apple(p.n, p.a);
  if (u && /^https:\/\/is\d-ssl\.mzstatic\.com\//.test(u)) map.push([p.h, u]); else missed.push(p.n + ' / ' + p.a);
  await sleep(3200);
}
console.log(map.length + ' matched on Apple; ' + missed.length + ' left as they are' + (missed.length ? ': ' + missed.join('; ') : ''));
if (!map.length) process.exit(0);

// 3. One statement per column: every URL with a matched hash, any size.
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const values = map.map(([h, u]) => '(' + lit(h) + ',' + lit(u) + ')').join(',\n  ');
const pat = () => `'https?://[a-z0-9.-]*dzcdn\\.net/images/cover/' || m.h || '/[^"\\s]*'`;
let body = `create temp table _art(h text primary key, u text) on commit drop;\ninsert into _art values\n  ${values};\n`;
for (const [t, c] of TEXT) body += `update public.${t} set ${c} = (select regexp_replace(${c}, ${pat()}, m.u) from _art m where ${c} ~ m.h limit 1) where ${c} ~ 'dzcdn\\.net/images/cover/' and exists (select 1 from _art m where ${c} ~ m.h);\n`;
// JSON: rewrite the text form once per matched hash present in the row.
for (const [t, c] of JSONB) body += `do $$ declare m record; begin for m in select * from _art loop
  update public.${t} set ${c} = regexp_replace(${c}::text, 'https?://[a-z0-9.-]*dzcdn\\.net/images/cover/' || m.h || '/[^"\\s]*', m.u, 'g')::jsonb
   where ${c}::text ~ m.h; end loop; end $$;\n`;
const count = () => sql(TEXT.map(([t, c]) => `select '${t}.${c}' k, count(*) n from public.${t} where ${c} ~ 'dzcdn'`)
  .concat(JSONB.map(([t, c]) => `select '${t}.${c}', count(*) from public.${t} where ${c}::text ~ 'dzcdn'`)).join(' union all '));
console.log('rows holding a Deezer sleeve before:', count().filter((r) => +r.n).map((r) => r.k + ' ' + r.n).join(', ') || 'none');
if (!APPLY) {
  // Dry run: the whole change inside a transaction that is rolled back.
  const after = sql('begin;\n' + body + `select sum(n)::int n from (${TEXT.map(([t, c]) => `select count(*) n from public.${t} where ${c} ~ 'dzcdn'`)
    .concat(JSONB.map(([t, c]) => `select count(*) from public.${t} where ${c}::text ~ 'dzcdn'`)).join(' union all ')}) s;\nrollback;`);
  console.log('dry run: rows still holding a Deezer sleeve afterwards would be', (after[0] || {}).n, '— nothing written. Add --apply to write.');
  process.exit(0);
}
sql('begin;\n' + body + 'commit;');
console.log('applied. rows holding a Deezer sleeve after:', count().filter((r) => +r.n).map((r) => r.k + ' ' + r.n).join(', ') || 'none');
