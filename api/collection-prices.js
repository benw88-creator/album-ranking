// /api/collection-prices — what the market costs today.
//
// Returns the Bid War pool with a Disc price against each record, so the
// Collection page can paint a full shelf in one request instead of pricing
// twenty albums one at a time.
//
// Cached rows only, deliberately. Anything not already in `album_plays` is
// returned with `price: null` and the page shows it as "price on request" —
// one tap then values it. Valuing twenty uncached albums inline would mean
// twenty kworb fetches in a single serverless invocation, which times out.

import { priceFromStreams } from './collection-buy.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cqfxyebejpkyhswolrwi.supabase.co';
const STALE_DAYS = 14;

function svcHeaders(key) {
  return { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
}

export default async function handler(req, res) {
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE) { res.status(500).json({ error: 'Server not configured' }); return; }

  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) { res.status(401).json({ error: 'Not signed in' }); return; }

  try {
    const poolRes = await fetch(SUPABASE_URL + '/rest/v1/rpc/bid_war_pool', {
      method: 'POST', headers: svcHeaders(SERVICE),
      body: JSON.stringify({ p_limit: Math.min(Number(req.query.limit) || 30, 60) }),
    });
    const pool = await poolRes.json();
    if (!Array.isArray(pool)) { res.status(502).json({ error: 'Could not read the crate' }); return; }
    if (!pool.length) { res.status(200).json({ items: [] }); return; }

    const idList = pool.map((p) => '"' + p.album_id + '"').join(',');
    const priced = {};
    try {
      const c = await fetch(SUPABASE_URL
        + '/rest/v1/album_plays?select=album_id,plays,fetched_at,source&album_id=in.(' + idList + ')',
        { headers: svcHeaders(SERVICE) });
      const rows = await c.json();
      const cutoff = Date.now() - STALE_DAYS * 86400000;
      (Array.isArray(rows) ? rows : []).forEach((r) => {
        if (r.plays && r.source === 'kworb' && new Date(r.fetched_at).getTime() > cutoff) {
          priced[r.album_id] = priceFromStreams(r.plays);
        }
      });
    } catch (e) {}

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      items: pool.map((p) => ({
        album_id: p.album_id, name: p.name, artist: p.artist, art: p.art,
        price: priced[p.album_id] || null,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
