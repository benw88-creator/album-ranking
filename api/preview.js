// /api/preview?artist=<artist>&album=<album>
//
// Returns the 30-second preview clips for one album, so VINALL can play a
// record itself instead of throwing the listener out into the Spotify app.
//
// Why Deezer and not Apple. Apple's iTunes Search API answers CORS and needs
// no key, so the first version called it straight from the browser — but its
// catalogue thins out badly on streaming-first records. Measured coverage:
// In Rainbows 100%, Graduation 100%, Blonde 65%, IGOR 17%, about 70% overall.
// Deezer returned 100% on all three of the albums tested, including both of
// the ones Apple could not do.
//
// The cost is that Deezer sends no CORS headers, so it cannot be called from
// the page and needs this route. That would normally be the worse trade —
// every listener then shares one IP and one rate limit (~50 requests per 5
// seconds) — except that an album's preview list is public, identical for
// everybody and effectively immutable, so it is cached at the edge for a
// week. Deezer is hit about once per album, ever, not once per listener.
//
// Apple stays as the client-side fallback in the player: if this route is
// down or a record is missing from Deezer, the browser can still find the
// record on its own with no server involved.
//
// Raw titles are returned rather than a normalised map on purpose. The
// player already has a `norm()` and matching it here would be two copies of
// one rule waiting to drift apart — the same mistake LADDER against v_ladder
// is written up to avoid.

const UA = 'VINALL/1.0 (+https://wildcrate.xyz)';

function clean(s) {
  return String(s || '')
    .replace(/\((feat|with)[^)]*\)/gi, '')
    .replace(/\s*-\s*(the\s+)?(deluxe|expanded|remaster(ed)?|anniversary)\b.*$/i, '')
    .trim();
}
function loose(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }

async function dz(path) {
  const r = await fetch('https://api.deezer.com' + path, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('deezer ' + r.status);
  return r.json();
}

import { cors } from './_cors.js';

export default async function handler(req, res) {
  // Answers the preflight and stops. Must be first: the method checks below
  // would 405 an OPTIONS, and three of these routes have one.
  if (cors(req, res)) return;
  const artist = String((req.query && req.query.artist) || '').slice(0, 120);
  const album = String((req.query && req.query.album) || '').slice(0, 160);
  if (!artist || !album) {
    res.status(400).json({ error: 'artist and album are required' });
    return;
  }

  try {
    const q = clean(artist) + ' ' + clean(album);
    const found = await dz('/search/album?limit=10&q=' + encodeURIComponent(q));

    // Deezer ranks loosely, so the album is chosen rather than taken from the
    // top: title must match and the artist has to look like the right one.
    // Without this a search for a common album name lands on a tribute act,
    // which is exactly the failure Apple's results are full of.
    const wantAlb = loose(clean(album)), wantArt = loose(artist);
    let best = null, bestScore = 0;
    for (const r of (found.data || [])) {
      const t = loose(r.title), a = loose(r.artist && r.artist.name);
      let s = 0;
      if (t === wantAlb) s += 5; else if (t.startsWith(wantAlb) || wantAlb.startsWith(t)) s += 3; else continue;
      if (a === wantArt) s += 3; else if (a.includes(wantArt) || wantArt.includes(a)) s += 2; else continue;
      if (s > bestScore) { bestScore = s; best = r; }
    }
    if (!best) {
      // A miss is cacheable too — otherwise a record Deezer does not carry
      // re-spends the rate limit on every visitor who opens it.
      res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=3600');
      res.status(200).json({ source: 'deezer', album: null, tracks: [] });
      return;
    }

    const list = await dz('/album/' + best.id + '/tracks?limit=100');
    const tracks = (list.data || [])
      .filter(function (t) { return t && t.preview; })
      .map(function (t) { return { title: t.title, preview: t.preview, ms: (t.duration || 0) * 1000 }; });

    res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=86400');
    // `cover` rides along because the album was resolved anyway. VINALL needs a
    // non-Spotify sleeve for the two surfaces Spotify's brand guidelines will
    // not allow theirs on — the Certification finishes, which paint over the
    // art, and the game rounds drawn from your own crate. One lookup serves
    // both that and the previews, and the edge cache makes the second caller
    // free.
    res.status(200).json({
      source: 'deezer', album: best.title, artist: best.artist && best.artist.name,
      link: best.link, cover: best.cover_xl || best.cover_big || null, tracks: tracks
    });
  } catch (e) {
    // Never 500 into the player. An empty list means "use the Apple fallback",
    // and a record that will not play is a row that hands off to Spotify —
    // both are ordinary states, not errors worth breaking a page over.
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ source: 'deezer', album: null, tracks: [], error: String((e && e.message) || e) });
  }
}
