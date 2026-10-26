// Shared album valuation: total Spotify streams = the sum of every track.
//
// Not a route (the leading underscore keeps Vercel from serving it). Imported
// by bid-war-create.js and by album-streams.js, so the thing that values a
// record in a war is literally the same code you can query directly to check
// it. A valuation you cannot inspect is a valuation you cannot trust.

export const MIN_MATCH = 0.7;   // fraction of the tracklist that must match
export const MIN_TRACKS = 4;    // and this many at minimum, so a 3-track EP
                                // matching 2 cannot pass on percentage alone

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

// kworb indexes its tables by Spotify ARTIST id
// (kworb.net/spotify/artist/<id>_songs.html), and that id is the only thing
// valuation needs from the Spotify world. It used to come from Spotify's Web
// API (Client Credentials search), which put a game and a derived listenership
// metric on Spotify's developer terms. It now comes from open data, keyed on
// the DEEZER artist id the album already carries, so there is no name guessing:
//   1. Wikidata: the item with Deezer artist id P2722 -> its Spotify id P1902
//   2. MusicBrainz fallback: the deezer.com/artist URL -> artist -> spotify URL
// No Spotify credential is used anywhere any more. `token` arguments remain in
// the signatures only so callers did not have to change shape; they are ignored.
const UA = 'VINALL/1.0 (+https://vinall.xyz; vinall.support@gmail.com)';
const _artistIds = {};          // deezer artist id -> spotify artist id (or null)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cqfxyebejpkyhswolrwi.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxZnh5ZWJlanBreWhzd29scndpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMDI0MTYsImV4cCI6MjA5Njc3ODQxNn0.x9zL_qKAt465D-5Vw6bu8IIn-RxgUdfVbUoe1i4rsZs';

// Kept for callers; there is nothing to mint now.
export async function spotifyToken() { return 'unused'; }

function looseName(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '');
}

async function getJson(url, headers) {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': UA, ...(headers || {}) } });
  if (!r.ok) return null;
  return r.json();
}

/* A lookup that FAILED is not a lookup that found nothing. MusicBrainz
   rate-limits shared egress (every Vercel function shares a handful of IPs)
   with a 503, Wikidata answers a busy endpoint with a 429, and both time out.
   Those used to come back as null, were cached as "this artist has no
   Spotify id", and the record was shown as permanently unpriceable — which is
   how Demos Before Prom read "cannot be priced" on a day it priced fine on
   another. Throwing Transient lets the caller say "not just now" instead. */
export class Transient extends Error {}
async function getJsonT(url, headers, tries) {
  const n = tries || 1;
  for (let i = 0; i < n; i++) {
    let r;
    try { r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': UA, ...(headers || {}) } }); }
    catch (e) { if (i + 1 < n) { await new Promise((ok) => setTimeout(ok, 1200)); continue; } throw new Transient('network'); }
    if (r.ok) return r.json();
    if (r.status === 404) return null;
    if (r.status === 429 || r.status >= 500) {
      if (i + 1 < n) { await new Promise((ok) => setTimeout(ok, 1200)); continue; }
      throw new Transient('status ' + r.status);
    }
    return null;
  }
  throw new Transient('exhausted');
}

async function spotifyIdFor(deezerArtistId) {
  if (!/^\d+$/.test(deezerArtistId)) return null;
  if (_artistIds[deezerArtistId] !== undefined) return _artistIds[deezerArtistId];
  let id = null, transient = false;
  try {
    const q = 'SELECT ?sp WHERE { ?a wdt:P2722 "' + deezerArtistId + '"; wdt:P1902 ?sp. } LIMIT 2';
    const d = await getJsonT('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q),
      { Accept: 'application/sparql-results+json' }, 2);
    const b = (d && d.results && d.results.bindings) || [];
    if (b.length === 1) id = b[0].sp.value;   // two answers is ambiguous: take neither
  } catch (e) { if (e instanceof Transient) transient = true; }
  if (!id) {
    try {
      const u = await getJsonT('https://musicbrainz.org/ws/2/url?fmt=json&inc=artist-rels&resource='
        + encodeURIComponent('https://www.deezer.com/artist/' + deezerArtistId), null, 3);
      const rel = ((u && u.relations) || []).find(function (r) { return r.artist; });
      if (rel) {
        const a = await getJsonT('https://musicbrainz.org/ws/2/artist/' + rel.artist.id + '?fmt=json&inc=url-rels', null, 3);
        const sp = ((a && a.relations) || []).map(function (r) { return r.url && r.url.resource || ''; })
          .map(function (s) { const m = s.match(/open\.spotify\.com\/artist\/([A-Za-z0-9]{22})/); return m && m[1]; })
          .filter(Boolean);
        if (new Set(sp).size === 1) id = sp[0];
      }
      transient = false;   // MusicBrainz answered, so its answer stands
    } catch (e) { if (e instanceof Transient) transient = true; }
  }
  if (id && !/^[A-Za-z0-9]{22}$/.test(id)) id = null;
  // Only a real answer is remembered; a failed lookup is asked again next time.
  if (!id && transient) throw new Transient('artist lookup');
  _artistIds[deezerArtistId] = id;
  return id;
}

// A legacy Spotify base62 album id, still on records rated before the switch.
// Its name and artist are in the public crate_feed; the record is then found
// on Deezer by exact folded name + artist, and valued exactly like a new one.
async function deezerByName(name, artist) {
  if (!name) return null;
  const s = await getJsonT('https://api.deezer.com/search/album?limit=10&q='
    + encodeURIComponent((artist || '') + ' ' + name), null, 2);
  if (s && s.error) throw new Transient('deezer');
  const want = looseName(name), wa = looseName(artist);
  const hit = ((s && s.data) || []).find(function (a) {
    return looseName(a.title) === want && (!wa || looseName(a.artist && a.artist.name) === wa);
  });
  return hit ? String(hit.id) : null;
}

// A legacy Spotify base62 album id, still on records rated before the switch.
// Its name and artist come from the public crate_feed, or — for a record rated
// privately or never posted — from the caller's own name and artist. Either
// only chooses which Deezer record is valued, exactly as a numeric id does.
async function legacyToDeezer(albumId, hint) {
  let row = null;
  try {
    const rows = await getJson(SUPABASE_URL + '/rest/v1/crate_feed?select=album_name,album_artist&album_id=eq.'
      + encodeURIComponent(albumId) + '&limit=1', { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON });
    row = Array.isArray(rows) && rows[0];
  } catch (e) {}
  const name = (row && row.album_name) || (hint && hint.name);
  const artist = (row && row.album_artist) || (hint && hint.artist);
  return deezerByName(name, artist);
}

// { artistId, artist, name, tracks } | null when there is no such record or
// no way to value it, and throws Transient when a service it depends on
// failed rather than answered.
export async function albumInfoT(albumId, hint) {
  let id = String(albumId);
  if (!/^\d+$/.test(id)) id = await legacyToDeezer(id, hint);
  if (!id) return null;
  const d = await getJsonT('https://api.deezer.com/album/' + encodeURIComponent(id), null, 2);
  // Deezer answers a rate limit with a 200 and an error body (code 4).
  if (d && d.error) { if (d.error.code === 4 || d.error.code === 700) throw new Transient('deezer'); return null; }
  const tracks = ((d && d.tracks && d.tracks.data) || []).map(function (t) { return t.title_short || t.title; });
  if (!tracks.length) return null;
  const artistId = await spotifyIdFor(String((d.artist || {}).id || ''));
  if (!artistId) return null;
  return { artistId: artistId, artist: (d.artist || {}).name || '', name: d.title, tracks: tracks };
}

export async function albumInfo(albumId, hint) {
  try { return await albumInfoT(albumId, hint); } catch (e) { return null; }
}

// artistId -> { map: normalised title -> streams, base: title before " - " ->
// streams, rows }. `base` is a fallback only: kworb names versions
// "Song - 7" Single Edit; 2017 Remaster", and the first (biggest) row with a
// given stem stands for that song when no exact title matched.
export async function artistStreamTable(artistId, cache) {
  cache = cache || {};
  if (cache[artistId] !== undefined) return cache[artistId];
  let r;
  try {
    r = await fetch('https://kworb.net/spotify/artist/' + artistId + '_songs.html', { signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': 'vinall-bid-wars/1.0 (+https://vinall.xyz)' },
    });
  } catch (e) { throw new Transient('kworb network'); }
  if (r.status === 404) { cache[artistId] = null; return null; }
  if (!r.ok) throw new Transient('kworb ' + r.status);
  const html = await r.text();
  const re = /<tr><td class="text"><div>[^<]*(?:<a[^>]*>)?([^<]+)<\/a>?<\/div><\/td><td>([\d,]+)<\/td>/g;
  const map = {}, base = {};
  let m, rows = 0;
  while ((m = re.exec(html)) !== null) {
    const title = m[1].replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"');
    const k = normTitle(title);
    const v = parseInt(m[2].replace(/,/g, ''), 10);
    rows++;
    if (!Number.isFinite(v)) continue;
    // First occurrence wins: kworb lists the biggest version of a track first.
    if (k && map[k] === undefined) map[k] = v;
    const b = normTitle(title.split(' - ')[0]);
    if (b && base[b] === undefined) base[b] = v;
  }
  cache[artistId] = rows ? { map: map, base: base, rows: rows } : null;
  return cache[artistId];
}

// Returns a full breakdown, not just a number, so callers can log or show why
// an album was rejected instead of it failing silently. `transient: true`
// means a service failed to answer — "not just now", never "cannot be priced".
// `hint` is { name, artist }, used only to find a legacy id on Deezer.
export async function valueAlbum(albumId, token, cache, hint) {
  let info, t;
  try {
    info = await albumInfoT(albumId, hint);
    if (!info) return { ok: false, reason: 'no-album' };
    t = await artistStreamTable(info.artistId, cache);
  } catch (e) {
    if (e instanceof Transient) return { ok: false, transient: true, reason: 'lookup-failed' };
    return { ok: false, transient: true, reason: 'failed' };
  }
  if (!t) return { ok: false, reason: 'no-kworb-page', artist: info.artist, artistId: info.artistId };

  let total = 0;
  const matched = [], missed = [];
  info.tracks.forEach(function (name) {
    const k = normTitle(name);
    const v = t.map[k] || (t.base && t.base[normTitle(String(name).split(' - ')[0])]);
    if (v) { total += v; matched.push({ track: name, streams: v }); }
    else missed.push(name);
  });

  const ratio = matched.length / info.tracks.length;
  const ok = matched.length >= MIN_TRACKS && ratio >= MIN_MATCH;
  return {
    ok: ok,
    reason: ok ? null : (matched.length < MIN_TRACKS ? 'too-few-matched' : 'match-ratio'),
    album: info.name, artist: info.artist, artistId: info.artistId,
    tracks: info.tracks.length, matched: matched.length,
    ratio: Number(ratio.toFixed(2)), total: total,
    kworbRows: t.rows, missed: missed,
  };
}
