export default function handler(req, res) {
  res.status(200).json({
    client_id: process.env.SPOTIFY_CLIENT_ID || "MISSING",
    redirect_uri: process.env.REDIRECT_URI || "MISSING"
  });
}
