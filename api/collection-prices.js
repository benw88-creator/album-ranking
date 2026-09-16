// /api/collection-prices — what the market costs today.
//
// Returns the Bid War pool with a Disc price against each record, so the
// Collection page can paint a full shelf in one request instead of pricing
// twenty albums one at a time.
//
// GET returns cached rows only, deliberately. Anything not already in
// `album_plays` comes back with `price: null`. Valuing twenty uncached albums
// inline would mean twenty kworb fetches in a single serverless invocation,
// which times out.
//
// ---------------------------------------------------------------------------
// POST { album_ids: [...] } — value a few of them, properly
// ---------------------------------------------------------------------------
// Those nulls used to be the player's problem. The card said "price on
// request" and the button said "Price it", and pressing it did not price the
// record — it priced it AND BOUGHT IT, because "Price it" was the Buy button
// wearing a different word. One tap, no number shown first, Discs gone. A
// control that names one action and performs two is not a shortcut.
//
// So the page fills the nulls in by itself, a few at a time, and the button
// only ever appears with a real number on it.
//
// It is a route rather than client arithmetic because `priceFromStreams` and
// its divisor are the server's, and the divisor moves with the economy — it
// has gone 5,000,000 -> 1,250,000 -> 250,000, each time in lockstep with a
// migration. A second copy in the browser is a second copy to forget, and the
// failure is every record in the market being priced wrong at once.
//
// BATCH is small on purpose: each album whose artist is not already in the
// per-request cache costs one kworb page fetch, and a serverless function that
// runs for thirty seconds is a serverless function that times out. The caller
// walks the list in chunks rather than asking for the lot.
//
// Every valuation is written back to `album_plays`, so the work is done once
// for everybody and the next render of the same crate reads it from the GET.

import { priceFromStreams } from './collection-buy.js';
import { spotifyToken, valueAlbum } from './_streams.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cqfxyebejpkyhswolrwi.supabase.co';
// Defaulted rather than required, exactly as /api/album-streams does it. The
// anon key is public by design and already inlined in index.html; depending on
// an env var that has never been set in Vercel would break this on deploy.
// my_sealed_albums() has to be called AS THE USER, so it needs this and not
// the service key.
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxZnh5ZWJlanBreWhzd29scndpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMDI0MTYsImV4cCI6MjA5Njc3ODQxNn0.x9zL_qKAt465D-5Vw6bu8IIn-RxgUdfVbUoe1i4rsZs';
const STALE_DAYS = 14;
/* Five, which is what /api/bid-war-create already values in one invocation
   and the only batch size on this stack with a track record. Each album whose
   artist is not already in the per-request cache costs a kworb page fetch on
   top of the catalogue lookup, and a function that runs for thirty seconds is
   a function that times out.

   `PRICE_CHUNK` in the Collection module mirrors it. Change one and you must
   change the other — the same arrangement as LADDER against v_ladder. Ids
   past this point are SLICED OFF rather than refused, so a client sending
   more would get a short answer and a 200; the client marks anything it asked
   for and did not hear back about, so a drift shows on the card instead of
   leaving it saying "counting streams…" for good. */
const BATCH = 5;

function svcHeaders(key, extra) {
  return Object.assign({
    apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
  }, extra || {});
}

/* Which of these the caller may not price, because they are live on one of
   their own Bid War boards. A war hides what each record is worth, and a
   market card printing that exact number beside it would unseal it just as
   surely as the public /api/album-streams did — the reason that endpoint now
   needs a JWT and consults my_sealed_albums(). Same seal, same function.

   Fails CLOSED: a lookup that errors returns null and the caller refuses to
   price anything, rather than quietly valuing a sealed board. */
async function sealedFor(jwt) {
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/my_sealed_albums', {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!r.ok) return null;
    const rows = await r.json();
    const set = new Set();
    (Array.isArray(rows) ? rows : []).forEach((x) => {
      const id = typeof x === 'string' ? x : (x && x.album_id);
      if (id) set.add(id);
    });
    return set;
  } catch (e) { return null; }
}

async function verify(jwt, SERVICE) {
  try {
    const u = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: SERVICE, Authorization: 'Bearer ' + jwt },
    });
    if (!u.ok) return null;
    const uj = await u.json();
    return (uj && uj.id) || null;
  } catch (e) { return null; }
}

/* Value up to BATCH albums and cache what came back.

   One `cache` object across the whole batch, so albums by the same artist
   fetch that artist's kworb table once rather than once each — which for a
   market drawn from one community's crate, where the same artists recur
   constantly, is most of the cost.

   An album that cannot be priced is reported as such and NOT written. A row
   saying zero plays would read as a real valuation of zero on every future
   request, and a wrong stream total reads as a bug. */
async function valueBatch(ids, SERVICE, sealed) {
  const token = await spotifyToken();
  if (!token) return { error: 'Could not reach Spotify' };

  const cache = {};
  const out = {};
  const writes = [];
  for (const id of ids) {
    if (sealed && sealed.has(id)) { out[id] = { price: null, reason: 'sealed' }; continue; }
    try {
      const v = await valueAlbum(id, token, cache);
      if (!v.ok || !v.total) { out[id] = { price: null, reason: v.reason || 'unpriceable' }; continue; }
      out[id] = { price: priceFromStreams(v.total), reason: null };
      writes.push({
        album_id: id, name: v.album || null, artist: v.artist || null,
        plays: v.total, source: 'kworb', fetched_at: new Date().toISOString(),
      });
    } catch (e) {
      out[id] = { price: null, reason: 'failed' };
    }
  }

  if (writes.length) {
    try {
      await fetch(SUPABASE_URL + '/rest/v1/album_plays', {
        method: 'POST',
        headers: svcHeaders(SERVICE, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(writes),
      });
    } catch (e) { /* the price is still correct for this response */ }
  }
  return { prices: out };
}

export default async function handler(req, res) {
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE) { res.status(500).json({ error: 'Server not configured' }); return; }

  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) { res.status(401).json({ error: 'Not signed in' }); return; }

  if (req.method === 'POST') {
    const userId = await verify(jwt, SERVICE);
    if (!userId) { res.status(401).json({ error: 'Session expired — log in again' }); return; }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    const ids = Array.isArray(body && body.album_ids)
      ? body.album_ids.map((s) => String(s || '').trim()).filter(Boolean).slice(0, BATCH)
      : [];
    if (!ids.length) { res.status(400).json({ error: 'No album ids' }); return; }

    const sealed = await sealedFor(jwt);
    // Fails closed — see sealedFor. Nothing is priced rather than a live
    // board being valued by accident.
    if (sealed === null) { res.status(503).json({ error: 'Could not check your live wars' }); return; }

    const r = await valueBatch(ids, SERVICE, sealed);
    if (r.error) { res.status(502).json({ error: r.error }); return; }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ prices: r.prices });
    return;
  }

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
