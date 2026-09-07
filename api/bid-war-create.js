// /api/bid-war-create — starts a Bid War, valuing each record by total plays.
//
// Why this is a server route rather than a Postgres function:
//
//   * Spotify does not expose stream counts, so the number comes from
//     Last.fm's album.getinfo playcount (total scrobbles = total plays).
//   * Postgres cannot make that HTTP call, and the browser must not: a player
//     who fetches the playcounts knows what every record is worth before
//     bidding, which is the one thing the whole design hides.
//
// So this route verifies the caller's Supabase session, picks candidates,
// values them with the service role, caches into album_plays, and hands the
// finished board to bid_war_create_from. The client never sees a value.
//
// Env vars (Vercel → Settings → Environment Variables):
//   SUPABASE_SERVICE_ROLE_KEY   — service role key, server-side only
//   LASTFM_API_KEY              — free key from last.fm/api/account/create
//   SUPABASE_URL                — optional, defaults to the project URL

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cqfxyebejpkyhswolrwi.supabase.co';
const STALE_DAYS = 14;   // playcounts move slowly; refetching daily is waste
const NEEDED = 5;

function svcHeaders(key, extra) {
  return Object.assign({
    apikey: key,
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json',
  }, extra || {});
}

// Last.fm matches loose titles well, but reissue furniture throws it off more
// often than it helps — "(Deluxe Edition)" rarely has its own scrobble count.
function cleanTitle(name) {
  return String(name || '')
    .replace(/\s*[\(\[][^\)\]]*(deluxe|remaster|remastered|expanded|anniversary|edition|version|reissue|bonus)[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*-\s*(deluxe|remaster(ed)?|expanded)\b.*$/i, '')
    .trim();
}

async function lastfmPlays(artist, album, key) {
  const url = 'https://ws.audioscrobbler.com/2.0/?method=album.getinfo'
    + '&artist=' + encodeURIComponent(artist)
    + '&album=' + encodeURIComponent(cleanTitle(album))
    + '&api_key=' + encodeURIComponent(key)
    + '&format=json&autocorrect=1';
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'vinal-bid-wars/1.0' } });
    if (!r.ok) return null;
    const d = await r.json();
    if (d.error || !d.album) return null;
    const n = parseInt(d.album.playcount, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch (e) { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const LASTFM = process.env.LASTFM_API_KEY;
  const missing = [];
  if (!SERVICE) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!LASTFM) missing.push('LASTFM_API_KEY');
  if (missing.length) {
    res.status(500).json({ error: 'Server not configured: missing ' + missing.join(', ') });
    return;
  }

  // ---- who is calling? Trust the Supabase session, never the body ---------
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
  } catch (e) {
    res.status(502).json({ error: 'Could not verify your session' }); return;
  }
  if (!userId) { res.status(401).json({ error: 'Not signed in' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const opponentId = body && body.opponent_id;
  if (!opponentId) { res.status(400).json({ error: 'No opponent given' }); return; }
  if (opponentId === userId) { res.status(400).json({ error: 'You cannot challenge yourself' }); return; }

  try {
    // ---- candidate records ------------------------------------------------
    const poolRes = await fetch(SUPABASE_URL + '/rest/v1/rpc/bid_war_pool', {
      method: 'POST', headers: svcHeaders(SERVICE), body: JSON.stringify({ p_limit: 24 }),
    });
    const pool = await poolRes.json();
    if (!Array.isArray(pool) || !pool.length) {
      res.status(400).json({ error: 'No records in The Crate yet — rate some albums first' });
      return;
    }

    // ---- cached playcounts ------------------------------------------------
    const ids = pool.map(function (p) { return p.album_id; });
    const cacheRes = await fetch(SUPABASE_URL + '/rest/v1/album_plays?select=album_id,plays,fetched_at'
      + '&album_id=in.(' + ids.map(function (i) { return '"' + i + '"'; }).join(',') + ')',
      { headers: svcHeaders(SERVICE) });
    const cached = {};
    const cacheRows = await cacheRes.json();
    if (Array.isArray(cacheRows)) {
      const cutoff = Date.now() - STALE_DAYS * 86400000;
      cacheRows.forEach(function (r) {
        if (r.plays && new Date(r.fetched_at).getTime() > cutoff) cached[r.album_id] = r.plays;
      });
    }

    // ---- fill the board, fetching only as far as we need ------------------
    const chosen = [];
    const toCache = [];
    for (let i = 0; i < pool.length && chosen.length < NEEDED; i++) {
      const p = pool[i];
      let plays = cached[p.album_id];
      if (!plays) {
        plays = await lastfmPlays(p.artist, p.name, LASTFM);
        if (plays) toCache.push({ album_id: p.album_id, name: p.name, artist: p.artist, plays: plays, source: 'lastfm', fetched_at: new Date().toISOString() });
      }
      if (plays) chosen.push({ album_id: p.album_id, name: p.name, artist: p.artist, art: p.art || '', value: plays });
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
      res.status(400).json({ error: 'Could not find play counts for enough records — try again in a moment' });
      return;
    }

    // ---- create it --------------------------------------------------------
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
