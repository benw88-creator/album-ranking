// /api/bid-war-create — starts a Bid War, valuing each record by its total
// Spotify streams: the sum of every track on the album.
//
// Why the value is computed here and not in Postgres or the browser:
//
//   * Postgres cannot make the HTTP calls this needs.
//   * The browser must not. A player who fetches the stream counts themselves
//     knows what every record is worth before bidding, which is the one thing
//     the whole design hides.
//
// Where the numbers come from:
//
//   Spotify does not expose stream counts in the Web API -- not per track, not
//   per album, and this app no longer receives even `popularity`. kworb.net
//   publishes per-track Spotify totals per artist, which is the same data
//   people quote when they say an album "did a billion". We fetch the artist's
//   track table, match it against the album's real tracklist from Spotify, and
//   sum. Cross-checked against 21 Savage's "american dream": 15/15 tracks
//   matched, 2.47B total.
//
//   An earlier version used Last.fm album playcount. That was wrong by roughly
//   a thousand times: scrobbles are not streams, and album-level scrobbles
//   undercount further because plays scatter across singles and reissues.
//
// Env vars (Vercel → Settings → Environment Variables):
//   SUPABASE_SERVICE_ROLE_KEY                  — service role, server-side only
//   SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET  — already set, reused here
//   SUPABASE_URL                               — optional, defaults below

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cqfxyebejpkyhswolrwi.supabase.co';
const STALE_DAYS = 14;      // stream totals creep; refetching often is waste
const NEEDED = 5;
const MIN_MATCH = 0.6;      // below this the sum is too incomplete to be fair

function svcHeaders(key, extra) {
  return Object.assign({
    apikey: key,
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json',
  }, extra || {});
}

// kworb and Spotify disagree on feature credits and punctuation more often
// than on the actual title, so both sides get flattened the same way.
function normTitle(s) {
  return String(s || '')
    .replace(/\((feat|with)[^)]*\)/gi, '')
    .replace(/\[(feat|with)[^\]]*\]/gi, '')
    .replace(/-\s*(feat|with)\b.*$/i, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

async function spotifyToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  try {
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64'),
      },
      body: 'grant_type=client_credentials',
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.access_token || null;
  } catch (e) { return null; }
}

// The album's real tracklist, plus the artist we need for the kworb lookup.
async function albumTracks(albumId, token) {
  try {
    const r = await fetch('https://api.spotify.com/v1/albums/' + encodeURIComponent(albumId), {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!r.ok) return null;
    const d = await r.json();
    const artistId = d.artists && d.artists[0] && d.artists[0].id;
    const tracks = ((d.tracks && d.tracks.items) || []).map(function (t) { return t.name; });
    if (!artistId || !tracks.length) return null;
    return { artistId: artistId, tracks: tracks };
  } catch (e) { return null; }
}

// artistId -> Map(normalised title -> total streams). Cached per invocation so
// several albums by one artist cost a single fetch.
async function artistStreamTable(artistId, cache) {
  if (cache[artistId]) return cache[artistId];
  try {
    const r = await fetch('https://kworb.net/spotify/artist/' + artistId + '_songs.html', {
      headers: { 'User-Agent': 'vinal-bid-wars/1.0 (+https://wildcrate.xyz)' },
    });
    if (!r.ok) { cache[artistId] = null; return null; }
    const html = await r.text();
    const re = /<tr><td class="text"><div>[^<]*(?:<a[^>]*>)?([^<]+)<\/a>?<\/div><\/td><td>([\d,]+)<\/td>/g;
    const map = {};
    let m;
    while ((m = re.exec(html)) !== null) {
      const k = normTitle(m[1]);
      const v = parseInt(m[2].replace(/,/g, ''), 10);
      // first occurrence wins: kworb lists the biggest version first
      if (k && Number.isFinite(v) && map[k] === undefined) map[k] = v;
    }
    cache[artistId] = Object.keys(map).length ? map : null;
    return cache[artistId];
  } catch (e) { cache[artistId] = null; return null; }
}

async function albumStreams(albumId, token, cache) {
  const info = await albumTracks(albumId, token);
  if (!info) return null;
  const table = await artistStreamTable(info.artistId, cache);
  if (!table) return null;
  let sum = 0, hit = 0;
  info.tracks.forEach(function (name) {
    const v = table[normTitle(name)];
    if (v) { sum += v; hit++; }
  });
  // A half-matched tracklist would undervalue the record against one that
  // matched fully, so drop it and let the pool offer another.
  if (!hit || hit / info.tracks.length < MIN_MATCH) return null;
  return sum;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE) { res.status(500).json({ error: 'Server not configured: missing SUPABASE_SERVICE_ROLE_KEY' }); return; }

  const auth = req.headers.authorization || '';
  const jwt = auth.replace(/^Bearer\s+/i, '');
  if (!jwt) { res.status(401).json({ error: 'Not signed in' }); return; }

  let userId = null;
  try {
    const u = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: SERVICE, Authorization: 'Bearer ' + jwt },
    });
    if (!u.ok) { res.status(401).json({ error: 'Session expired — log in again' }); return; }
    const uj = await u.json();
    userId = uj && uj.id;
  } catch (e) { res.status(502).json({ error: 'Could not verify your session' }); return; }
  if (!userId) { res.status(401).json({ error: 'Not signed in' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const opponentId = body && body.opponent_id;
  if (!opponentId) { res.status(400).json({ error: 'No opponent given' }); return; }
  if (opponentId === userId) { res.status(400).json({ error: 'You cannot challenge yourself' }); return; }

  try {
    const token = await spotifyToken();
    if (!token) { res.status(502).json({ error: 'Could not reach Spotify to read tracklists' }); return; }

    const poolRes = await fetch(SUPABASE_URL + '/rest/v1/rpc/bid_war_pool', {
      method: 'POST', headers: svcHeaders(SERVICE), body: JSON.stringify({ p_limit: 24 }),
    });
    const pool = await poolRes.json();
    if (!Array.isArray(pool) || !pool.length) {
      res.status(400).json({ error: 'No records in The Crate yet — rate some albums first' });
      return;
    }

    const ids = pool.map(function (p) { return p.album_id; });
    const idList = ids.map(function (i) { return '"' + i + '"'; }).join(',');
    const cacheRes = await fetch(SUPABASE_URL
      + '/rest/v1/album_plays?select=album_id,plays,fetched_at,source&album_id=in.(' + idList + ')',
      { headers: svcHeaders(SERVICE) });
    const cached = {};
    const cacheRows = await cacheRes.json();
    if (Array.isArray(cacheRows)) {
      const cutoff = Date.now() - STALE_DAYS * 86400000;
      cacheRows.forEach(function (r) {
        // ignore anything cached by the old Last.fm valuation
        if (r.plays && r.source === 'kworb' && new Date(r.fetched_at).getTime() > cutoff) {
          cached[r.album_id] = r.plays;
        }
      });
    }

    const chosen = [];
    const toCache = [];
    const artistCache = {};
    for (let i = 0; i < pool.length && chosen.length < NEEDED; i++) {
      const p = pool[i];
      let streams = cached[p.album_id];
      if (!streams) {
        streams = await albumStreams(p.album_id, token, artistCache);
        if (streams) {
          toCache.push({
            album_id: p.album_id, name: p.name, artist: p.artist,
            plays: streams, source: 'kworb', fetched_at: new Date().toISOString(),
          });
        }
      }
      if (streams) {
        chosen.push({
          album_id: p.album_id, name: p.name, artist: p.artist,
          art: p.art || '', value: streams,
        });
      }
    }

    if (toCache.length) {
      // Best effort: a failed cache write must not fail the war.
      try {
        await fetch(SUPABASE_URL + '/rest/v1/album_plays', {
          method: 'POST',
          headers: svcHeaders(SERVICE, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
          body: JSON.stringify(toCache),
        });
      } catch (e) {}
    }

    if (chosen.length < NEEDED) {
      res.status(400).json({ error: 'Could not get stream counts for enough records — try again in a moment' });
      return;
    }

    const mk = await fetch(SUPABASE_URL + '/rest/v1/rpc/bid_war_create_from', {
      method: 'POST', headers: svcHeaders(SERVICE),
      body: JSON.stringify({ p_initiator: userId, p_opponent: opponentId, p_records: chosen }),
    });
    const war = await mk.json();
    if (!mk.ok) {
      res.status(400).json({ error: (war && (war.message || war.hint)) || 'Could not start that war' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(war);
  } catch (e) {
    res.status(500).json({ error: 'Bid war creation failed: ' + String((e && e.message) || e) });
  }
}
