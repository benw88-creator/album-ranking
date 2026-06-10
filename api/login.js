export default function handler(req, res) {
  const client_id = process.env.SPOTIFY_CLIENT_ID;
  const redirect_uri = process.env.REDIRECT_URI;

  const scope = "user-read-email";

  const params = new URLSearchParams({
    response_type: "code",
    client_id,
    scope,
    redirect_uri,
  });

  res.redirect("https://accounts.spotify.com/authorize?" + params.toString());
}
