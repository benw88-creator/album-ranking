// ============================================================
// /api/callback.js  — Spotify redirects back here with a code,
// we exchange it for an access token, then bounce to the app.
// Hardened: readable errors instead of crashes, and the token is
// URL-encoded so '+' / '/' inside it don't get corrupted.
// Requires env vars: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, REDIRECT_URI
// NOTE: needs Node 18+ (for built-in fetch). Set in Vercel →
//       Settings → General → Node.js Version → 18.x or 20.x.
// ============================================================
export default async function handler(req, res) {
  try {
    const code = req.query.code;
    const client_id = process.env.SPOTIFY_CLIENT_ID;
    const client_secret = process.env.SPOTIFY_CLIENT_SECRET;
    const redirect_uri = process.env.REDIRECT_URI;

    const missing = [];
    if (!client_id) missing.push('SPOTIFY_CLIENT_ID');
    if (!client_secret) missing.push('SPOTIFY_CLIENT_SECRET');
    if (!redirect_uri) missing.push('REDIRECT_URI');
    if (missing.length) {
      res.status(500).send('Missing environment variable(s): ' + missing.join(', '));
      return;
    }
    if (!code) {
      res.status(400).send('No authorization code returned from Spotify.');
      return;
    }

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(client_id + ':' + client_secret).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirect_uri
      })
    });

    const data = await response.json();

    if (!data.access_token) {
      // Spotify rejected the exchange — show its reason (usually a REDIRECT_URI mismatch)
      res.status(500).send('Spotify token exchange failed: ' + JSON.stringify(data));
      return;
    }

    res.redirect('/?access_token=' + encodeURIComponent(data.access_token) +
      '&expires_in=' + (data.expires_in || 3600));
  } catch (e) {
    res.status(500).send('Callback crashed: ' + (e && e.message ? e.message : String(e)));
  }
}
