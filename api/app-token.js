// /api/app-token — mints an APP-LEVEL Spotify token (Client Credentials flow).
// This lets ANY visitor use search/albums/artists without logging in ("guest mode").
// It can only read public catalogue data — it can never touch anyone's account.
// Uses the same SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET env vars as /api/login.

let cached = { token: null, exp: 0 };

export default async function handler(req, res) {
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
