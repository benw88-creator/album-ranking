// /api/collection-buy — buy a record for your collection.
//
// The price is computed here and nowhere else. A browser that could name its
// own price could buy a twelve-billion-stream record for one Disc, which is
// the same reason wallet_buy takes a key and never a cost and why
// bid_war_create_from is service-role only.
//
// Body: { album_id, name, artist, art }
//   name/artist/art are for display on the collection page. They are cosmetic
//   and unverified; the album_id is what gets valued, and the value is the
//   only thing that costs anything.

import { spotifyToken, valueAlbum } from './_streams.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cqfxyebejpkyhswolrwi.supabase.co';
const STALE_DAYS = 14;

/* Streams to Discs.
 *
 * Raw totals are unusable as a price: Views is 12.81 billion streams, and at
 * one-to-one nobody buys anything ever. Divided by 1.25 million it becomes a
 * ladder that fits what people actually earn — roughly 1,200 Discs on a normal
 * day, 3,600 if they do everything:
 *
 *     Views (Drake)    12.81B  -> 10,248    about a week of normal play
 *     Blonde            9.39B  ->  7,512
 *     In Rainbows       2.32B  ->  1,856    a day or two
 *     The Money Store    180M  ->    144    same session
 *
 * Linear rather than compressed, deliberately: the hundred-to-one spread is
 * what makes a famous record feel like a target and an obscure one feel
 * affordable. A square-root curve would flatten exactly the thing that gives
 * the collection a shape.
 */
const DISCS_PER_STREAM_DIVISOR = 1250000;
const MIN_PRICE = 40;

export function priceFromStreams(streams) {
  const n = Number(streams) || 0;
  if (n <= 0) return null;
  return Math.max(MIN_PRICE, Math.round(n / DISCS_PER_STREAM_DIVISOR));
}

function svcHeaders(key, extra) {
  return Object.assign({
    apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
  }, extra || {});
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE) { res.status(500).json({ error: 'Server not configured' }); return; }

  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
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
  const albumId = body && body.album_id;
  if (!albumId) { res.status(400).json({ error: 'No album given' }); return; }

  try {
    // The cache first. A record already valued for a Bid War costs nothing to
    // price again, which is most of them.
    let streams = null;
    try {
      const c = await fetch(SUPABASE_URL
        + '/rest/v1/album_plays?select=plays,fetched_at,source&album_id=eq.' + encodeURIComponent(albumId),
        { headers: svcHeaders(SERVICE) });
      const rows = await c.json();
      const row = Array.isArray(rows) && rows[0];
      if (row && row.plays && row.source === 'kworb'
          && new Date(row.fetched_at).getTime() > Date.now() - STALE_DAYS * 86400000) {
        streams = row.plays;
      }
    } catch (e) { /* a cold cache is slow, not broken */ }

    if (!streams) {
      const token = await spotifyToken();
      if (!token) { res.status(502).json({ error: 'Could not reach Spotify' }); return; }
      const v = await valueAlbum(albumId, token, {});
      if (!v.ok) {
        res.status(400).json({
          error: 'That record cannot be priced — not enough of its tracks matched.',
          reason: v.reason,
        });
        return;
      }
      streams = v.total;
      try {
        await fetch(SUPABASE_URL + '/rest/v1/album_plays', {
          method: 'POST',
          headers: svcHeaders(SERVICE, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
          body: JSON.stringify([{
            album_id: albumId, name: body.name || null, artist: body.artist || null,
            plays: streams, source: 'kworb', fetched_at: new Date().toISOString(),
          }]),
        });
      } catch (e) {}
    }

    const price = priceFromStreams(streams);
    if (!price) { res.status(400).json({ error: 'That record has no stream count to price.' }); return; }

    const buy = await fetch(SUPABASE_URL + '/rest/v1/rpc/collection_buy_from', {
      method: 'POST', headers: svcHeaders(SERVICE),
      body: JSON.stringify({
        p_user: userId, p_album_id: albumId,
        p_name: body.name || 'Unknown', p_artist: body.artist || null, p_art: body.art || null,
        p_price: price,
      }),
    });
    const out = await buy.json();
    if (!buy.ok) {
      res.status(400).json({ error: (out && (out.message || out.hint)) || 'Could not buy that' });
      return;
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(Object.assign({ streams: streams }, out));
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
