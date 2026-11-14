// VINALL Value — what a record is worth in Bid Wars, Higher or Lower and the
// Collection. Not a route (the leading underscore keeps Vercel from serving
// it). Imported by album-streams.js, bid-war-create.js and collection-buy.js,
// so the value a war uses is literally the one you can query directly.
//
// It replaced kworb's Spotify stream totals (2026-11-13). Those were scraped
// with no licence, from figures kworb itself scrapes from Spotify, matched
// against tracklists from Deezer's API, which VINALL has no agreement for.
// App Review asked for documentary evidence of every third-party catalogue
// (5.2.3); this uses only:
//   - Wikipedia's article for the album and its reader count over the last
//     twelve months (Wikimedia pageviews, CC0: a public measure of how much the
//     world cares about a record, with a power-law spread like streams);
//   - VINALL's own crate_feed: how many people here have posted a rating of it,
//     as a capped uplift (at most +20%, so a ring of accounts cannot move a
//     price far).
// A record with no article is worth FLOOR plus its uplift: priced, and cheap.
//
// The NUMBER is the value itself, shown as "VINALL Value". It is not streams and
// nothing may call it streams. Prices come from it in collection-buy.js
// (priceFromValue), anchored so Views costs what it did.

export const SOURCE = 'vinall-value';   // the album_plays.source this writes
export const FLOOR = 1000;              // the value of a record with no article

// kworb and Spotify disagree about feature credits, remaster tags and
// punctuation far more often than about the actual title.
export function normTitle(s) {
  return String(s || '')
    .replace(/\((feat|with)[^)]*\)/gi, '')
    .replace(/\[(feat|with)[^\]]*\]/gi, '')
    .replace(/-\s*(feat|with)\b.*$/i, '')
    // A version tail after a spaced dash, with any words before the tag:
    // kworb lists Prince as "When Doves Cry - 2015 Paisley Park Remaster",
    // and requiring the tag straight after the dash matched 1 of Purple
    // Rain's 9 tracks.
    .replace(/\s-\s[^-]*?\b(remaster|remastered|remix|radio edit|single version|album version|mono|stereo)\b.*$/i, '')
    .replace(/-\s*(\d{4}\s*)?(remaster|remastered|remix|radio edit|single version|album version|mono|stereo)\b.*$/i, '')
    .replace(/\((\d{4}\s*)?(remaster|remastered|mono|stereo|album version|single version)[^)]*\)/gi, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}
const UA = 'VINALL/1.0 (+https://vinall.xyz; vinall.support@gmail.com)';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cqfxyebejpkyhswolrwi.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxZnh5ZWJlanBreWhzd29scndpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMDI0MTYsImV4cCI6MjA5Njc3ODQxNn0.x9zL_qKAt465D-5Vw6bu8IIn-RxgUdfVbUoe1i4rsZs';

// Kept for callers; there is nothing to mint.
export async function spotifyToken() { return 'unused'; }

/* A service that failed to ANSWER (network, 429, 5xx) is "not just now", never
   "this record cannot be priced": throwing Transient lets the caller say so and
   stops a failure being remembered as a fact. */
export class Transient extends Error {}
async function getJsonT(url, tries) {
  const n = tries || 2;
  for (let i = 0; i < n; i++) {
    let r;
    try { r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': UA, 'Api-User-Agent': UA } }); }
    catch (e) { if (i + 1 < n) { await new Promise((ok) => setTimeout(ok, 800)); continue; } throw new Transient('network'); }
    if (r.ok) return r.json();
    if (r.status === 404) return null;
    if (r.status === 429 || r.status >= 500) {
      if (i + 1 < n) { await new Promise((ok) => setTimeout(ok, 800)); continue; }
      throw new Transient('status ' + r.status);
    }
    return null;
  }
  throw new Transient('exhausted');
}
function loose(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/[^a-z0-9]+/g, '');
}

/* Which record an id is: the public crate_feed (one row per person per
   record), then Apple for an `am` id, and only then the caller's own name.
   The caller's name used to come FIRST, which let anybody value a famous id
   as nonsense (and cache that for everyone) or an obscure id as Thriller. A
   valuation that rests on the caller's word is marked `trusted: false`: it is
   never cached and never good enough for an album-pick claim. Never Deezer. */
async function recordFor(albumId, hint) {
  try {
    const rows = await getJsonT(SUPABASE_URL + '/rest/v1/crate_feed?select=album_name,album_artist&album_id=eq.'
      + encodeURIComponent(albumId) + '&limit=1&apikey=' + SUPABASE_ANON, 1);
    const row = Array.isArray(rows) && rows[0];
    if (row && row.album_name) return { name: row.album_name, artist: row.album_artist || '' };
  } catch (e) { /* fall through to Apple */ }
  const am = /^am(\d+)$/.exec(String(albumId));
  if (am) {
    const j = await getJsonT('https://itunes.apple.com/lookup?country=gb&id=' + am[1], 2);
    const c = j && j.results && j.results[0];
    if (c && c.collectionName) return { name: c.collectionName.replace(/ - (Single|EP)$/i, ''), artist: c.artistName || '' };
  }
  if (hint && hint.name) return { name: String(hint.name).slice(0, 200), artist: String(hint.artist || '').slice(0, 200), untrusted: true };
  return null;
}

/* The album's Wikipedia article, or null: a search whose result is titled with
   the record's name (an "(… album)" tail ignored) and described as a record by
   this artist. Strict on purpose — the wrong article is a wrong price that
   looks entirely plausible. */
export async function articleFor(name, artist) {
  const j = await getJsonT('https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1'
    + '&generator=search&gsrlimit=10&prop=description&gsrsearch=' + encodeURIComponent(name + ' ' + artist + ' album'));
  const pages = Object.values((j && j.query && j.query.pages) || {}).sort((a, b) => a.index - b.index);
  const wn = loose(name), wa = loose(artist);
  for (const p of pages) {
    const d = String(p.description || '');
    if (loose(p.title) !== wn) continue;
    if (!/\b(album|EP|mixtape|soundtrack|record)\b/i.test(d) && !/\(.*album\)/i.test(p.title)) continue;
    if (wa && loose(d).indexOf(wa) < 0 && loose(p.title).indexOf(wa) < 0) continue;
    return p.title;
  }
  return null;
}

// Readers over the last twelve complete months.
export async function readersOf(title) {
  const end = new Date(); end.setUTCDate(1);
  const start = new Date(end); start.setUTCMonth(start.getUTCMonth() - 12);
  const f = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const j = await getJsonT('https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/'
    + encodeURIComponent(title.replace(/ /g, '_')) + '/monthly/' + f(start) + '/' + f(end));
  return ((j && j.items) || []).reduce((s, i) => s + (i.views || 0), 0);
}

// People here who posted a rating of it (crate_feed: one row per person per record).
async function ratersOf(albumId) {
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/crate_feed?select=user_id&album_id=eq.' + encodeURIComponent(albumId),
      { signal: AbortSignal.timeout(5000), headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON, Prefer: 'count=exact', Range: '0-0' } });
    const m = /\/(\d+)$/.exec((r.headers && r.headers.get && r.headers.get('content-range')) || '');
    return m ? +m[1] : 0;
  } catch (e) { return 0; }   // the uplift is an ornament; its absence is not an outage
}
// ponytail: flat +2% a rater, capped at +20%; weight by account age if a ring ever matters.
export function uplift(raters) { return Math.min(0.2, 0.02 * Math.max(0, raters | 0)); }

/* The result shape the kworb valuation returned, so no caller changed: `ok` and
   `total` (the value), or `ok: false` with `reason` and `transient`. */
export async function valueAlbum(albumId, token, cache, hint) {
  let rec, title = null, readers = 0;
  try {
    rec = await recordFor(albumId, hint);
    if (!rec) return { ok: false, reason: 'no-album' };
    title = await articleFor(rec.name, rec.artist);
    if (title) readers = await readersOf(title);
  } catch (e) {
    return { ok: false, transient: true, reason: e instanceof Transient ? 'lookup-failed' : 'failed' };
  }
  const raters = await ratersOf(albumId);
  const total = Math.round(Math.max(FLOOR, readers) * (1 + uplift(raters)));
  return { ok: true, reason: null, album: rec.name, artist: rec.artist, article: title, readers, raters, total, source: SOURCE, trusted: !rec.untrusted };
}
