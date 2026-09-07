// Shared album valuation: total Spotify streams = the sum of every track.
//
// Not a route (the leading underscore keeps Vercel from serving it). Imported
// by bid-war-create.js and by album-streams.js, so the thing that values a
// record in a war is literally the same code you can query directly to check
// it. A valuation you cannot inspect is a valuation you cannot trust.

export const MIN_MATCH = 0.7;   // fraction of the tracklist that must match
export const MIN_TRACKS = 4;    // and this many at minimum, so a 3-track EP
                                // matching 2 cannot pass on percentage alone

// kworb and Spotify disagree about feature credits, remaster tags and
// punctuation far more often than about the actual title.
export function normTitle(s) {
  return String(s || '')
    .replace(/\((feat|with)[^)]*\)/gi, '')
    .replace(/\[(feat|with)[^\]]*\]/gi, '')
    .replace(/-\s*(feat|with)\b.*$/i, '')
    .replace(/-\s*(\d{4}\s*)?(remaster|remastered|remix|radio edit|single version|album version|mono|stereo)\b.*$/i, '')
    .replace(/\((\d{4}\s*)?(remaster|remastered|mono|stereo|album version|single version)[^)]*\)/gi, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

export async function spotifyToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  try {
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64'),
      },
      body: 'grant_type=client_credentials',
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.access_token || null;
  } catch (e) { return null; }
}

export async function albumInfo(albumId, token) {
  try {
    const r = await fetch('https://api.spotify.com/v1/albums/' + encodeURIComponent(albumId), {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!r.ok) return null;
    const d = await r.json();
    const artistId = d.artists && d.artists[0] && d.artists[0].id;
    const tracks = ((d.tracks && d.tracks.items) || []).map(function (t) { return t.name; });
    if (!artistId || !tracks.length) return null;
    return { artistId: artistId, artist: (d.artists[0] || {}).name || '', name: d.name, tracks: tracks };
  } catch (e) { return null; }
}

// artistId -> { map: normalised title -> streams, rows }
export async function artistStreamTable(artistId, cache) {
  cache = cache || {};
  if (cache[artistId] !== undefined) return cache[artistId];
  try {
    const r = await fetch('https://kworb.net/spotify/artist/' + artistId + '_songs.html', {
      headers: { 'User-Agent': 'vinall-bid-wars/1.0 (+https://wildcrate.xyz)' },
    });
    if (!r.ok) { cache[artistId] = null; return null; }
    const html = await r.text();
    const re = /<tr><td class="text"><div>[^<]*(?:<a[^>]*>)?([^<]+)<\/a>?<\/div><\/td><td>([\d,]+)<\/td>/g;
    const map = {};
    let m, rows = 0;
    while ((m = re.exec(html)) !== null) {
      const k = normTitle(m[1]);
      const v = parseInt(m[2].replace(/,/g, ''), 10);
      rows++;
      // First occurrence wins: kworb lists the biggest version of a track first.
      if (k && Number.isFinite(v) && map[k] === undefined) map[k] = v;
    }
    cache[artistId] = rows ? { map: map, rows: rows } : null;
    return cache[artistId];
  } catch (e) { cache[artistId] = null; return null; }
}

// Returns a full breakdown, not just a number, so callers can log or show why
// an album was rejected instead of it failing silently.
export async function valueAlbum(albumId, token, cache) {
  const info = await albumInfo(albumId, token);
  if (!info) return { ok: false, reason: 'no-album' };
  const t = await artistStreamTable(info.artistId, cache);
  if (!t) return { ok: false, reason: 'no-kworb-page', artist: info.artist, artistId: info.artistId };

  let total = 0;
  const matched = [], missed = [];
  info.tracks.forEach(function (name) {
    const v = t.map[normTitle(name)];
    if (v) { total += v; matched.push({ track: name, streams: v }); }
    else missed.push(name);
  });

  const ratio = matched.length / info.tracks.length;
  const ok = matched.length >= MIN_TRACKS && ratio >= MIN_MATCH;
  return {
    ok: ok,
    reason: ok ? null : (matched.length < MIN_TRACKS ? 'too-few-matched' : 'match-ratio'),
    album: info.name, artist: info.artist, artistId: info.artistId,
    tracks: info.tracks.length, matched: matched.length,
    ratio: Number(ratio.toFixed(2)), total: total,
    kworbRows: t.rows, missed: missed,
  };
}
