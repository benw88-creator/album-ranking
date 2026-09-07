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

export default async function handler(req, res) {
  const q = (req.query && (req.query.q || req.query.album)) || '';
  if (!q) { res.status(400).json({ error: 'Pass ?album=<id> or ?q=<search>' }); return; }

  const token = await spotifyToken();
  if (!token) { res.status(502).json({ error: 'Could not reach Spotify' }); return; }

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
