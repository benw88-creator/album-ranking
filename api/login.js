// ============================================================
// /api/login.js  — sends the user to Spotify to authorise.
// Hardened: returns a readable message instead of crashing (500).
// Requires env vars: SPOTIFY_CLIENT_ID, REDIRECT_URI
// ============================================================
export default function handler(req, res) {
  try {
    const client_id = process.env.SPOTIFY_CLIENT_ID;
    const redirect_uri = process.env.REDIRECT_URI;

    const missing = [];
    if (!client_id) missing.push('SPOTIFY_CLIENT_ID');
    if (!redirect_uri) missing.push('REDIRECT_URI');
    if (missing.length) {
      res.status(500).send('Missing environment variable(s): ' + missing.join(', ') +
        '. Add them in Vercel → Project → Settings → Environment Variables, then redeploy.');
      return;
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: client_id,
      redirect_uri: redirect_uri,
      scope: ''   // album/track search needs no special scopes
    });
    res.redirect('https://accounts.spotify.com/authorize?' + params.toString());
  } catch (e) {
    res.status(500).send('Login crashed: ' + (e && e.message ? e.message : String(e)));
  }
}
