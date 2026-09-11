// /api/album-market?q=<search>  (or ?name=<album>&artist=<artist>)
//
// Public, read-only. Returns exactly what a market-mode Bid War would value an
// album at, plus the Discogs release it matched and the community counts. The
// twin of /api/album-streams, and it exists for the same reason: the first time
// these numbers look wrong you need a way to tell a broken match from a broken
// algorithm from stale stored data, and guessing is not that way.
//
// It imports the same _discogs.js the war route does, so the two cannot drift.
//
// Values are now shown to both players at war creation, so nothing here leaks
// anything a player could not already see on their own board.

import { valueMarket, discogsToken } from './_discogs.js';

export default async function handler(req, res) {
  const token = discogsToken();
  if (!token) { res.status(500).json({ error: 'Server not configured: missing DISCOGS_TOKEN' }); return; }

  const name = (req.query && (req.query.name || req.query.q)) || '';
  const artist = (req.query && req.query.artist) || '';
  if (!name) { res.status(400).json({ error: 'Pass ?q=<album> or ?name=<album>&artist=<artist>' }); return; }

  let out;
  try {
    out = await valueMarket(name, artist, token);
  } catch (e) {
    res.status(502).json({ error: 'Discogs lookup failed: ' + String((e && e.message) || e) });
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(out);
}
