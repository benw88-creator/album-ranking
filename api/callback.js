export default function handler(req, res) {
  const code = req.query.code;

  if (!code) {
    return res.status(400).send("No code from Spotify");
  }

  res.status(200).json({
    message: "Callback works",
    code: code
  });
}
