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

async function deezerAlbum(albumId) {
  const d = await getJson('https://api.deezer.com/album/' + encodeURIComponent(albumId));
  if (!d || d.error) return null;
  const tracks = ((d.tracks && d.tracks.data) || []).map(function (t) { return t.title_short || t.title; });
  if (!tracks.length) return null;
  return { artist: (d.artist || {}).name || '', artistDz: String((d.artist || {}).id || ''), name: d.title, tracks: tracks };
}

async function spotifyIdFor(deezerArtistId) {
  if (!/^\d+$/.test(deezerArtistId)) return null;
  if (_artistIds[deezerArtistId] !== undefined) return _artistIds[deezerArtistId];
  let id = null;
  try {
    const q = 'SELECT ?sp WHERE { ?a wdt:P2722 "' + deezerArtistId + '"; wdt:P1902 ?sp. } LIMIT 2';
    const d = await getJson('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q),
      { Accept: 'application/sparql-results+json' });
    const b = (d && d.results && d.results.bindings) || [];
    if (b.length === 1) id = b[0].sp.value;   // two answers is ambiguous: take neither
  } catch (e) {}
  if (!id) {
    try {
      const u = await getJson('https://musicbrainz.org/ws/2/url?fmt=json&inc=artist-rels&resource='
        + encodeURIComponent('https://www.deezer.com/artist/' + deezerArtistId));
      const rel = ((u && u.relations) || []).find(function (r) { return r.artist; });
      if (rel) {
        const a = await getJson('https://musicbrainz.org/ws/2/artist/' + rel.artist.id + '?fmt=json&inc=url-rels');
        const sp = ((a && a.relations) || []).map(function (r) { return r.url && r.url.resource || ''; })
          .map(function (s) { const m = s.match(/open\.spotify\.com\/artist\/([A-Za-z0-9]{22})/); return m && m[1]; })
          .filter(Boolean);
        if (new Set(sp).size === 1) id = sp[0];
      }
    } catch (e) {}
  }
  if (id && !/^[A-Za-z0-9]{22}$/.test(id)) id = null;
  _artistIds[deezerArtistId] = id;
  return id;
}

// A legacy Spotify base62 album id, still on records rated before the switch.
// Its name and artist are in the public crate_feed; the record is then found
// on Deezer by exact folded name + artist, and valued exactly like a new one.
async function legacyToDeezer(albumId) {
  const rows = await getJson(SUPABASE_URL + '/rest/v1/crate_feed?select=album_name,album_artist&album_id=eq.'
    + encodeURIComponent(albumId) + '&limit=1', { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON });
  const row = Array.isArray(rows) && rows[0];
  if (!row || !row.album_name) return null;
  const s = await getJson('https://api.deezer.com/search/album?limit=10&q='
    + encodeURIComponent((row.album_artist || '') + ' ' + row.album_name));
  const want = looseName(row.album_name), wa = looseName(row.album_artist);
  const hit = ((s && s.data) || []).find(function (a) {
    return looseName(a.title) === want && (!wa || looseName(a.artist && a.artist.name) === wa);
  });
  return hit ? String(hit.id) : null;
}

export async function albumInfo(albumId) {
  try {
    let id = String(albumId);
    if (!/^\d+$/.test(id)) id = await legacyToDeezer(id);
    if (!id) return null;
    const dz = await deezerAlbum(id);
    if (!dz) return null;
    const artistId = await spotifyIdFor(dz.artistDz);
    if (!artistId) return null;
    return { artistId: artistId, artist: dz.artist, name: dz.name, tracks: dz.tracks };
  } catch (e) { return null; }
}

// artistId -> { map: normalised title -> streams, rows }
export async function artistStreamTable(artistId, cache) {
  cache = cache || {};
  if (cache[artistId] !== undefined) return cache[artistId];
  try {
    const r = await fetch('https://kworb.net/spotify/artist/' + artistId + '_songs.html', { signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': 'vinall-bid-wars/1.0 (+https://vinall.xyz)' },
    });
    if (!r.ok) { cache[artistId] = null; return null; }
    const html = await r.text();
    const re = /<tr><td class="text"><div>[^<]*(?:<a[^>]*>)?([^<]+)<\/a>?<\/div><\/td><td>([\d,]+)<\/td>/g;
    const map = {};
    let m, rows = 0;
    while ((m = re.exec(html)) !== null) {
      const k = normTitle(m[1]);
      const v = parseInt(m[2].replace(/,/g, ''), 10);
      rows++;
      // First occurrence wins: kworb lists the biggest version of a track first.
      if (k && Number.isFinite(v) && map[k] === undefined) map[k] = v;
    }
    cache[artistId] = rows ? { map: map, rows: rows } : null;
    return cache[artistId];
  } catch (e) { cache[artistId] = null; return null; }
}

// Returns a full breakdown, not just a number, so callers can log or show why
// an album was rejected instead of it failing silently.
export async function valueAlbum(albumId, token, cache) {
  const info = await albumInfo(albumId, token);
  if (!info) return { ok: false, reason: 'no-album' };
  const t = await artistStreamTable(info.artistId, cache);
  if (!t) return { ok: false, reason: 'no-kworb-page', artist: info.artist, artistId: info.artistId };

  let total = 0;
  const matched = [], missed = [];
  info.tracks.forEach(function (name) {
    const v = t.map[normTitle(name)];
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
