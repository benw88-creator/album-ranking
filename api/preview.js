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

// ?track= — ONE song, looked up as a song
//
// The album sweep above is the right shape for a tracklist: one request, every
// clip on the record. It is the wrong shape for Recall, which wants a single
// song and does not care what record it came off — and measured over the 118
// songs in the game pool, asking Deezer for the ALBUM found 112 and asking for
// the TRACK found 117. They miss different records (the album path has 21 and
// Metallica, the track path has HUMBLE., which Deezer's track index answers
// with nothing but remixes, karaoke and an 8-bit cover), so the caller tries
// this first and falls back to the album sweep. Together: 118 of 118.
//
// Deezer's advanced query syntax is a trap here: artist:"Metallica"
// track:"Enter Sandman" returns a 200 and an EMPTY list, where the same words
// as a plain query return the record. Measured, not assumed.
//
// The scoring is the whole of this branch. A plain track search for HUMBLE.
// returns a Skrillex remix, a parody, an 8-bit emulation, a string-orchestra
// arrangement and two karaoke versions before anything else — so a covers
// guard is not politeness, it is the difference between a music game and a
// karaoke game. Same rule `collectionName` plays for Apple and the album-match
// score plays above.

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

/* A cover, a karaoke backing or a tribute carries the right title and the
   wrong record, which is worse than no clip at all — the player would be
   asked to name a song it is not playing. BAD is refused outright; LIVE is
   only ever outscored, because a live album is a legitimate record and the
   pool may one day hold one. */
const BAD = /\b(karaoke|tribute|instrumental|made popular|originally performed|in the style of|backing track|parody|8-bit|8 bit)\b/i;
const LIVE = /\b(live|remix|sped up|slowed|acoustic version|demo|re-?recorded)\b/i;

// Mirrors norm() in the Recall module. Two copies of one rule is exactly what
// the note above says to avoid — but the guard cannot run in the browser (the
// browser never sees the rejected candidates) and the browser's cannot run
// here, so each side normalises what it is looking at and only the CLIP
// crosses between them.
function nm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2019\u02bc]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

async function oneTrack(res, artist, title) {
  const j = await dz('/search/track?limit=25&q=' + encodeURIComponent(artist + ' ' + title));
  const wt = nm(title), wa = nm(artist);
  let best = null, bestScore = -1;
  for (const t of (j.data || [])) {
    if (!t || !t.preview) continue;
    if (nm(t.title) !== wt) continue;
    const ta = nm(t.artist && t.artist.name);
    if (ta !== wa && !ta.includes(wa) && !wa.includes(ta)) continue;
    const alb = (t.album && t.album.title) || '';
    if (BAD.test(t.title) || BAD.test((t.artist && t.artist.name) || '') || BAD.test(alb)) continue;
    let s = 0;
    if (ta === wa) s += 4;
    if (!/[([]/.test(t.title)) s += 3;                       // the plain pressing
    if (!LIVE.test(t.title) && !LIVE.test(alb)) s += 3;
    if (s > bestScore) { bestScore = s; best = t; }
  }
  // Same four minutes and the same reason: these urls are signed and expire.
  res.setHeader('Cache-Control', best ? 'public, s-maxage=240' : 'public, s-maxage=86400, stale-while-revalidate=3600');
  res.status(200).json(best ? {
    source: 'deezer', mode: 'track',
    album: (best.album && best.album.title) || null,
    artist: (best.artist && best.artist.name) || null,
    cover: (best.album && (best.album.cover_xl || best.album.cover_big)) || null,
    link: best.link || null,
    tracks: [{ title: best.title, preview: best.preview, ms: (best.duration || 0) * 1000 }]
  } : { source: 'deezer', mode: 'track', album: null, tracks: [] });
}

import { cors } from './_cors.js';

export default async function handler(req, res) {
  // Answers the preflight and stops. Must be first: the method checks below
  // would 405 an OPTIONS, and three of these routes have one.
  if (cors(req, res)) return;
  const artist = String((req.query && req.query.artist) || '').slice(0, 120);
  const album = String((req.query && req.query.album) || '').slice(0, 160);
  const track = String((req.query && req.query.track) || '').slice(0, 160);
  if (!artist || (!album && !track)) {
    res.status(400).json({ error: 'artist plus album or track is required' });
    return;
  }

  try {
    if (track) { await oneTrack(res, artist, track); return; }
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

    /* Four minutes, not a week, and no stale-while-revalidate. The comment at
       the top of this file said an album's preview list is "public, identical
       for everybody and effectively immutable" — the first two are true and
       the third is not. Deezer SIGNS each clip url with an expiry roughly ten
       minutes out, so a week-long cache hands out links that 403 and a stale
       revalidate hands out expired ones on purpose.

       The cost is real and is the right way round: Deezer gets hit per album
       per four minutes rather than per album ever. A rate limit is a bad
       minute; a cached dead link is an album that cannot be played for seven
       days and gives no reason why. */
    res.setHeader('Cache-Control', 'public, s-maxage=240');
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
