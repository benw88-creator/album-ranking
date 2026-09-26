// /api/app-token — mints an APP-LEVEL Spotify token (Client Credentials flow).
// This lets ANY visitor use search/albums/artists without logging in ("guest mode").
// It can only read public catalogue data — it can never touch anyone's account.
// Uses the same SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET env vars as /api/login.

let cached = { token: null, exp: 0 };

// This route hands a real, working Spotify bearer token to WHOEVER calls it —
// no auth, because guest browsing needs that. A browser calling it through
// the app is indistinguishable from a script calling the URL directly, so a
// rate limit is the only lever available short of closing guest mode.
//
// Per-IP, fixed 60s window, in-memory. ponytail: this resets on every cold
// start and is per warm instance, not global across Vercel's fleet — a
// determined caller spread across enough function instances or IPs is not
// stopped by it. It stops the actual cost here, which is casual scraping and
// a single caller looping this endpoint, not a coordinated attacker; that
// ceiling is the honest one for a route with no user identity to key on.
// Upgrade path if this route is ever actually abused: a shared store
// (Upstash/Vercel KV) keyed the same way.
const RATE = new Map();
const RATE_WINDOW_MS = 60000;
const RATE_MAX = 20;
function limited(req) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const row = RATE.get(ip);
  if (!row || now > row.reset) { RATE.set(ip, { count: 1, reset: now + RATE_WINDOW_MS }); return false; }
  row.count++;
  return row.count > RATE_MAX;
}
// The map only grows if nothing ever prunes it. Swept opportunistically
// rather than on a timer — no timer to leak across cold starts, and this
// route is called often enough that a sweep is never far away.
function sweep(now) {
  for (const [ip, row] of RATE) if (now > row.reset) RATE.delete(ip);
}

import { cors } from './_cors.js';

export default async function handler(req, res) {
  // Answers the preflight and stops. Must be first: the method checks below
  // would 405 an OPTIONS, and three of these routes have one.
  if (cors(req, res)) return;
  const now = Date.now();
  if (RATE.size > 500) sweep(now);
  if (limited(req)) { res.status(429).json({ error: 'Too many requests' }); return; }
  try {
    const id = process.env.SPOTIFY_CLIENT_ID;
    const secret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!id || !secret) {
      res.status(500).json({ error: 'Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET env vars' });
      return;
    }

    // serve a cached token while it's still fresh (saves Spotify calls)
    if (cached.token && Date.now() < cached.exp - 60000) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ access_token: cached.token, expires_in: Math.floor((cached.exp - Date.now()) / 1000) });
      return;
    }

    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64'),
      },
      body: 'grant_type=client_credentials',
    });

    if (!r.ok) {
      const text = await r.text();
      res.status(502).json({ error: 'Spotify token request failed', detail: text.slice(0, 200) });
      return;
    }

    const data = await r.json();
    cached = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ access_token: data.access_token, expires_in: data.expires_in || 3600 });
  } catch (e) {
    res.status(500).json({ error: 'app-token error', detail: String((e && e.message) || e) });
  }
}
