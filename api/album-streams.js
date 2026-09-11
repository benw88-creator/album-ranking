// /api/album-streams?album=<spotify album id>  (or ?q=<search text>)
//
// Public, read-only. Returns exactly what the Bid War valuation would compute
// for an album, including which tracks matched and which did not. This exists
// so a wrong number can be diagnosed in one request rather than guessed at —
// the first time these totals looked wrong there was no way to tell whether
// the algorithm, the cache or the stored war was at fault.
//
// Add &debug=1 for the per-track breakdown.

import { spotifyToken, valueAlbum } from './_streams.js';

// How many albums one batch request will value. The ceiling is there because
// each unmatched artist costs a kworb page fetch, and a serverless function
// that runs for thirty seconds is a serverless function that times out.
const BATCH_MAX = 12;

export default async function handler(req, res) {
  const q = (req.query && (req.query.q || req.query.album || req.query.albums)) || '';
  if (!q) { res.status(400).json({ error: 'Pass ?album=<id>, ?albums=<id,id,…> or ?q=<search>' }); return; }

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

  const out = await valueAlbum(albumId, token, {});
  if (!req.query.debug) { delete out.missed; }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(out);
}
