// /api/album-market?q=<search>  (or ?name=<album>&artist=<artist>)
//
// Signed-in, read-only. Returns exactly what a market-mode Bid War would value an
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
import { cors } from './_cors.js';

export default async function handler(req, res) {
  // Answers the preflight and stops. Must be first: the method checks below
  // would 405 an OPTIONS, and three of these routes have one.
  if (cors(req, res)) return;
  // Signed in only. It spends the shared Discogs token (60 requests a minute)
  // on every call and nothing in the app calls it; it is a debugging aid.
  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!jwt || !svc) { res.status(401).json({ error: 'Not signed in' }); return; }
  try {
    const u = await fetch((process.env.SUPABASE_URL || 'https://cqfxyebejpkyhswolrwi.supabase.co') + '/auth/v1/user',
      { headers: { apikey: svc, Authorization: 'Bearer ' + jwt }, signal: AbortSignal.timeout(8000) });
    if (!u.ok) { res.status(401).json({ error: 'Session expired, log in again' }); return; }
  } catch (e) { res.status(502).json({ error: 'Could not verify your session' }); return; }
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
