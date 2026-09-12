// /api/album-streams?album=<spotify album id>  (or ?q=<search text>)
//
// Returns exactly what the Bid War valuation would compute for an album,
// including which tracks matched and which did not. It exists so a wrong
// number can be diagnosed in one request rather than guessed at — the first
// time these totals looked wrong there was no way to tell whether the
// algorithm, the cache or the stored war was at fault.
//
// Add &debug=1 for the per-track breakdown.
//
// ---------------------------------------------------------------------------
// This used to be public, and that quietly unsealed Bid Wars
// ---------------------------------------------------------------------------
// A war hides what each record is worth. This endpoint returned exactly that
// number for any album id, to anyone — so a player could price all five
// records on their own board before bidding, and the seal only held against
// whoever did not think to check the network tab.
//
// Two rules now:
//
//   * A Supabase JWT is required. Anonymous callers get nothing.
//   * An album sitting on one of the caller's own pending boards is refused,
//     via my_sealed_albums(). Other people's wars are none of your business
//     and are not consulted — the function only ever sees your own.
//
// Higher or Lower is unaffected in practice: it prices records from your own
// crate, and the rare overlap with a live board comes back `sealed` and is
// dropped from the pool like any other unusable album.

import { spotifyToken, valueAlbum } from './_streams.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cqfxyebejpkyhswolrwi.supabase.co';
// Defaulted rather than required, like SUPABASE_URL above. The anon key is
// public by design and is already inlined in index.html; depending on an env
// var that has never been set in Vercel would break this route on deploy.
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxZnh5ZWJlanBreWhzd29scndpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMDI0MTYsImV4cCI6MjA5Njc3ODQxNn0.x9zL_qKAt465D-5Vw6bu8IIn-RxgUdfVbUoe1i4rsZs';

// How many albums one batch request will value. The ceiling is there because
// each unmatched artist costs a kworb page fetch, and a serverless function
// that runs for thirty seconds is a serverless function that times out.
const BATCH_MAX = 12;

// The ids this caller may not price, because they are live on a board of
// theirs. Fails closed: if the lookup errors we refuse nothing rather than
// silently unsealing, so the caller still needs a valid session to get here
// at all — but a Supabase outage does not take the diagnostic down with it.
async function sealedFor(jwt) {
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/my_sealed_albums', {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: 'Bearer ' + jwt,
        'Content-Type': 'application/json',
      },
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

export default async function handler(req, res) {
  const q = (req.query && (req.query.q || req.query.album || req.query.albums)) || '';
  if (!q) { res.status(400).json({ error: 'Pass ?album=<id>, ?albums=<id,id,…> or ?q=<search>' }); return; }

  // Signed in, or nothing.
  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) { res.status(401).json({ error: 'Sign in to check a valuation' }); return; }
  let userId = null;
  try {
    const u = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + jwt },
    });
    if (!u.ok) { res.status(401).json({ error: 'Session expired — log in again' }); return; }
    const uj = await u.json();
    userId = uj && uj.id;
  } catch (e) { res.status(502).json({ error: 'Could not verify your session' }); return; }
  if (!userId) { res.status(401).json({ error: 'Not signed in' }); return; }

  const sealed = await sealedFor(jwt);

  const token = await spotifyToken();
  if (!token) { res.status(502).json({ error: 'Could not reach Spotify' }); return; }

  /* Batch. Higher or Lower needs a pool of values before the first round, and
     asking for them one request at a time is a dozen cold starts and a visible
     wait. Valuing them together also shares one `cache` object across the
     whole batch, so albums by the same artist fetch that artist's kworb table
     once rather than once each — which for a personal library, where the same
     artists recur constantly, is most of the cost. */
  if (req.query.albums) {
    const ids = String(req.query.albums).split(',')
      .map((s) => s.trim()).filter(Boolean).slice(0, BATCH_MAX);
    if (!ids.length) { res.status(400).json({ error: 'No album ids' }); return; }
    const cache = {};
    const results = [];
    for (const id of ids) {
      if (sealed && sealed.has(id)) {
        // On one of your own boards. Higher or Lower drops it from the pool
        // like any other album it cannot price.
        results.push({ album_id: id, ok: false, reason: 'sealed' });
        continue;
      }
      try {
        const v = await valueAlbum(id, token, cache);
        v.album_id = id;
        delete v.missed;
        results.push(v);
      } catch (e) {
        results.push({ album_id: id, ok: false, reason: 'failed' });
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ results: results });
    return;
  }

  let albumId = req.query.album || '';
  if (!albumId) {
    try {
      const s = await fetch('https://api.spotify.com/v1/search?type=album&limit=1&q=' + encodeURIComponent(q),
        { headers: { Authorization: 'Bearer ' + token } });
      const d = await s.json();
      const it = d.albums && d.albums.items && d.albums.items[0];
      if (!it) { res.status(404).json({ error: 'No album found for that search' }); return; }
      albumId = it.id;
    } catch (e) { res.status(502).json({ error: 'Search failed' }); return; }
  }

  if (sealed && sealed.has(albumId)) {
    res.status(403).json({
      ok: false, reason: 'sealed', album_id: albumId,
      error: 'That record is on one of your live Bid War boards. Resolve the war first.',
    });
    return;
  }

  const out = await valueAlbum(albumId, token, {});
  if (!req.query.debug) { delete out.missed; }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(out);
}
