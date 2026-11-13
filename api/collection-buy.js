// /api/collection-buy — buy a record for your collection.
//
// The price is computed here and nowhere else. A browser that could name its
// own price could buy a twelve-billion-stream record for one Disc, which is
// the same reason wallet_buy takes a key and never a cost and why
// bid_war_create_from is service-role only.
//
// Body: { album_id, name, artist, art, pick }
//   name/artist/art are for display on the collection page. They are cosmetic
//   and unverified; the album_id is what gets valued, and the value is the
//   only thing that costs anything.
//
//   `pick: true` spends one of the album picks a Mythic draw grants, instead
//   of Discs. It still goes through the same valuation — a picked record is
//   stored at its real price, because a free record worth nothing would make
//   "3 albums of your choice" a prize you would not want. The entitlement is
//   checked server-side in collection_claim_pick_from; this route only decides
//   which function to call, never whether the caller has a pick.

import { valueAlbum, SOURCE } from './_streams.js';
import { cors } from './_cors.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cqfxyebejpkyhswolrwi.supabase.co';
// my_sealed_albums() is called AS THE USER, so it needs the anon key and the
// caller's JWT, never the service role (which would see nobody's wars).
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxZnh5ZWJlanBreWhzd29scndpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMDI0MTYsImV4cCI6MjA5Njc3ODQxNn0.x9zL_qKAt465D-5Vw6bu8IIn-RxgUdfVbUoe1i4rsZs';

/* Is this record on one of the caller's own live Bid War boards? This route
   prices before it charges, and both the "price changed" refusal and a
   successful buy say the number — exactly what a war hides. Same seal and
   same function as /api/collection-prices and /api/album-streams. Fails
   CLOSED: null means the check could not run, and nothing is priced. */
async function isSealed(jwt, albumId) {
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/my_sealed_albums', {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!r.ok) return null;
    const rows = await r.json();
    return (Array.isArray(rows) ? rows : []).some((x) => (typeof x === 'string' ? x : (x && x.album_id)) === String(albumId));
  } catch (e) { return null; }
}
const STALE_DAYS = 14;

/* VINALL Value to Discs (api/_streams.js says what the value is).
 *
 * A curve, not a straight line. Wikipedia readership is far flatter than
 * streams (Thriller has ~250x the readers of a record with a small article,
 * where its streams were thousands of times more), and the first straight-line
 * version pushed nine of 43 sampled albums onto its 100,000 ceiling, where they
 * all cost the same. This rises steeply at the bottom, so obscure, cult and
 * popular records separate, and bends over smoothly at the top, so iconic
 * records stay ordered among themselves instead of tying at a cap:
 *
 *     price = MAX * x / (1 + x),   x = (value / K) ^ P
 *
 * Measured on 43 real albums (readers a year -> Discs):
 *
 *     no article (Demos Before Prom, Bliss Release)  ->     200
 *     Bon Iver, Bon Iver    8,312 ->     960   Process (Sampha)  12,106 ->  1,570
 *     Sweet Boy            26,578 ->   4,320   French Exit       32,012 ->  5,490
 *     The Money Store      64,640 ->  13,410   Ctrl              93,721 -> 21,290
 *     Currents            113,831 ->  27,000   SOS              162,076 -> 41,120
 *     Views               233,763 ->  62,290   Blonde           284,642 -> 76,970
 *     To Pimp a Butterfly 335,564 ->  91,140   Purple Rain      449,036 -> 120,470
 *     Nevermind           645,657 -> 163,450   Rumours          880,907 -> 203,420
 *     Abbey Road        1,277,215 -> 250,600   Thriller       2,050,995 -> 302,550
 *
 * Against a realistic week of ~70,000 Discs: a cult record is an afternoon,
 * a modern classic a week, an all-time one a month. Stored collection.price
 * rows are what somebody paid and are never re-priced; sales refund 70% of
 * that, so no balance or shelf moves when this changes.
 *
 * **These constants move with the economy and nothing enforces it**, as the
 * stream divisor did across two inflation passes. Change the earning rates
 * without them and every record goes free or unbuyable.
 */
const PRICE_MAX = 400000;   // the asymptote; no record reaches it
const PRICE_K = 858000;     // the value at which a record costs half of MAX
const PRICE_P = 1.3;        // steepness at the bottom
const MIN_PRICE = 200;

export function priceFromValue(value) {
  const n = Number(value) || 0;
  if (n <= 0) return null;
  const x = Math.pow(n / PRICE_K, PRICE_P);
  return Math.max(MIN_PRICE, Math.round(PRICE_MAX * x / (1 + x) / 10) * 10);
}

function svcHeaders(key, extra) {
  return Object.assign({
    apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
  }, extra || {});
}

/* ONE price for a record, shared by the card and the till.

   /api/collection-prices (what the card prints) and this route (what is
   charged) used to price separately: the card from a fresh cache row or a
   valuation, the till from a fresh row or ANOTHER valuation, and a failure in
   either was reported as "cannot be priced". Now both call this:

     1. a cached valuation under 14 days old;
     2. otherwise value the record now and cache it;
     3. if that valuation could not RUN (Wikipedia or Apple failed to
        answer), the last valuation we ever made, however old — the record was
        priceable then, and an old price beats a dead Buy button;
     4. otherwise no price, with `transient` saying whether that is "not just
        now" or a real "too few tracks matched".

   Nothing is charged without a price: the buy route refuses on (4). */
export async function priceAlbum(albumId, SERVICE, opts) {
  opts = opts || {};
  let cached = null;
  try {
    const c = await fetch(SUPABASE_URL
      + '/rest/v1/album_plays?select=plays,fetched_at,source&album_id=eq.' + encodeURIComponent(albumId),
      { headers: svcHeaders(SERVICE) });
    const rows = await c.json();
    const row = Array.isArray(rows) && rows[0];
    if (row && row.plays > 0 && row.source === SOURCE) cached = row;
  } catch (e) { /* a cold cache is slow, not broken */ }
  if (cached && new Date(cached.fetched_at).getTime() > Date.now() - STALE_DAYS * 86400000) {
    return { price: priceFromValue(cached.plays), streams: cached.plays, reason: null };
  }
  const v = await valueAlbum(albumId, 'unused', opts.cache || {}, opts.hint);
  if (v.ok && v.total > 0 && v.trusted === false) {
    // Named only by the caller: priced for this request, never stored.
    return { price: priceFromValue(v.total), streams: v.total, reason: null, untrusted: true };
  }
  if (v.ok && v.total > 0) {
    try {
      await fetch(SUPABASE_URL + '/rest/v1/album_plays', {
        method: 'POST',
        headers: svcHeaders(SERVICE, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify([{
          album_id: albumId, name: v.album || (opts.hint && opts.hint.name) || null,
          artist: v.artist || (opts.hint && opts.hint.artist) || null,
          plays: v.total, source: SOURCE, fetched_at: new Date().toISOString(),
        }]),
      });
    } catch (e) { /* the price is still right for this request */ }
    return { price: priceFromValue(v.total), streams: v.total, reason: null };
  }
  if (v.transient && cached) {
    return { price: priceFromValue(cached.plays), streams: cached.plays, reason: null, stale: true };
  }
  return { price: null, streams: null, reason: v.reason || 'unpriceable', transient: !!v.transient };
}

export default async function handler(req, res) {
  // Answers the preflight and stops. Must be first: the method checks below
  // would 405 an OPTIONS, and three of these routes have one.
  if (cors(req, res)) return;
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

  const sealed = await isSealed(jwt, albumId);
  if (sealed === null) { res.status(503).json({ error: 'Could not check your live Bid Wars — nothing was charged. Try again in a moment.' }); return; }
  if (sealed) { res.status(409).json({ error: 'That record is on one of your live Bid Wars. It can be bought once the war is over.', reason: 'sealed' }); return; }

  try {
    const pr = await priceAlbum(albumId, SERVICE, { hint: { name: body.name, artist: body.artist } });
    if (!pr.price) {
      // Nothing is charged without a price, and a failure to reach a service
      // is said as one: "cannot be priced" is reserved for a real answer.
      if (pr.transient) {
        res.status(503).json({ error: 'Pricing is unavailable just now — nothing was charged. Try again in a moment.', reason: pr.reason });
      } else {
        res.status(400).json({ error: 'That record cannot be priced — not enough of its tracks matched.', reason: pr.reason });
      }
      return;
    }
    // A free record must be the record it says it is.
    if (body.pick && pr.untrusted) {
      res.status(409).json({ error: 'Rate this record first, then claim it with a pick.', reason: 'unnamed' });
      return;
    }
    const price = pr.price, streams = pr.streams;
    /* The card's number is the most the buyer agreed to. A record revalued
       between showing and buying (its cache aged out and kworb now counts
       more) is refused, with the new figure, rather than charged a price
       nobody saw. Cheaper than shown is fine — that is never a surprise. */
    const expect = Number(body.expect);
    if (!body.pick && Number.isFinite(expect) && expect > 0 && price > expect) {
      res.status(409).json({ error: 'The price changed to ' + price.toLocaleString('en-GB') + ' Discs — nothing was charged.', price: price });
      return;
    }

    const fn = body.pick ? 'collection_claim_pick_from' : 'collection_buy_from';
    const buy = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
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
