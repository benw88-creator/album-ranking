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

// The valuation lives in _streams.js and is shared with /api/album-streams,
// so the number that decides a war is the same number you can query and
// check. They cannot drift apart.
import { spotifyToken, valueAlbum } from './_streams.js';
import { valueMarket, discogsToken } from './_discogs.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cqfxyebejpkyhswolrwi.supabase.co';
const STALE_DAYS = 14;
// Market prices move with what is actually for sale that week, where a stream
// total only goes up and a fortnight of drift is nothing. Different data,
// different shelf life.
const MARKET_STALE_DAYS = 3;
const NEEDED = 5;
const MODES = ['streams', 'market'];

function svcHeaders(key, extra) {
  return Object.assign({
    apikey: key,
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json',
  }, extra || {});
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

  const mode = (body && body.mode) || 'streams';
  if (MODES.indexOf(mode) === -1) { res.status(400).json({ error: 'Unknown mode' }); return; }

  const dgToken = mode === 'market' ? discogsToken() : null;
  if (mode === 'market' && !dgToken) {
    res.status(500).json({ error: 'Market wars are not configured: missing DISCOGS_TOKEN' });
    return;
  }

  try {
    // Spotify is still needed in both modes: the pool comes from The Crate and
    // market mode looks records up by their real name and artist.
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

    // Each mode caches into its own table with its own shelf life.
    const cached = {};
    const cacheTable = mode === 'market' ? 'album_market' : 'album_plays';
    const cacheCols = mode === 'market'
      ? 'album_id,score,price_minor,currency,fetched_at,source'
      : 'album_id,plays,fetched_at,source';
    try {
      const cacheRes = await fetch(SUPABASE_URL
        + '/rest/v1/' + cacheTable + '?select=' + cacheCols + '&album_id=in.(' + idList + ')',
        { headers: svcHeaders(SERVICE) });
      const cacheRows = await cacheRes.json();
      if (Array.isArray(cacheRows)) {
        const days = mode === 'market' ? MARKET_STALE_DAYS : STALE_DAYS;
        const cutoff = Date.now() - days * 86400000;
        cacheRows.forEach(function (r) {
          const fresh = new Date(r.fetched_at).getTime() > cutoff;
          if (mode === 'market') {
            if (r.score && r.source === 'discogs' && fresh) {
              cached[r.album_id] = r.score;
            }
          } else {
            // ignore anything cached by the old Last.fm valuation
            if (r.plays && r.source === 'kworb' && fresh) cached[r.album_id] = r.plays;
          }
        });
      }
    } catch (e) { /* a cold cache is slow, not broken */ }

    const chosen = [];
    const toCache = [];
    const artistCache = {};
    const rejected = [];
    for (let i = 0; i < pool.length && chosen.length < NEEDED; i++) {
      const p = pool[i];
      let value = cached[p.album_id];
      if (!value) {
        if (mode === 'market') {
          const v = await valueMarket(p.name, p.artist, dgToken);
          if (v.ok) {
            value = v.score;
            toCache.push({
              album_id: p.album_id, name: p.name, artist: p.artist,
              release_id: v.release_id, price_minor: v.price_minor, currency: v.currency, score: v.score,
              have: v.have, want: v.want, rating_avg: v.rating_avg, rating_count: v.rating_count,
              source: 'discogs', fetched_at: new Date().toISOString(),
            });
          } else {
            rejected.push({ album: p.name, reason: v.reason });
          }
        } else {
          const v = await valueAlbum(p.album_id, token, artistCache);
          if (v.ok) {
            value = v.total;
            toCache.push({
              album_id: p.album_id, name: p.name, artist: p.artist,
              plays: value, source: 'kworb', fetched_at: new Date().toISOString(),
            });
          } else {
            // Rejected albums are worth logging: a run of these is how a
            // broken kworb layout announces itself instead of quietly
            // producing nonsense totals.
            rejected.push({ album: p.name, reason: v.reason, matched: v.matched, of: v.tracks });
          }
        }
      }
      if (value) {
        const rec = {
          album_id: p.album_id, name: p.name, artist: p.artist,
          art: p.art || '', value: value,
        };
        // No currency any more: market mode is a score out of 100, not a
        // price, so there is nothing to denominate.
        chosen.push(rec);
      }
    }

    if (toCache.length) {
      // Best effort: a failed cache write must not fail the war.
      try {
        await fetch(SUPABASE_URL + '/rest/v1/' + cacheTable, {
          method: 'POST',
          headers: svcHeaders(SERVICE, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
          body: JSON.stringify(toCache),
        });
      } catch (e) {}
    }

    if (chosen.length < NEEDED) {
      res.status(400).json({
        error: mode === 'market'
          ? 'Could not price enough records on Discogs — try again in a moment'
          : 'Could not get stream counts for enough records — try again in a moment',
        rejected: rejected.slice(0, 8),
      });
      return;
    }

    const mk = await fetch(SUPABASE_URL + '/rest/v1/rpc/bid_war_create_from', {
      method: 'POST', headers: svcHeaders(SERVICE),
      body: JSON.stringify({ p_initiator: userId, p_opponent: opponentId, p_records: chosen, p_mode: mode }),
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
