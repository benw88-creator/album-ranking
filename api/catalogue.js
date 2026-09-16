// /api/catalogue — Deezer, wearing the Spotify Web API's response shape.
//
// ---------------------------------------------------------------------------
// Why this exists
// ---------------------------------------------------------------------------
// "Spotify Content" is defined in the Developer Terms as "any content, data,
// information or material made available through the Spotify Platform ...
// cover art, musical works, podcasts, artist biographies, song lyrics,
// METADATA, playlists". Album names and artist names are Spotify Content.
//
// That single definition is what keeps four separate clauses live no matter
// how much artwork gets moved:
//
//   - "Do not create a game, including trivia quizzes."
//   - "Do not create any product or service which is integrated with streams
//      or content from another service."
//   - "Do not analyze the Spotify Content ... creating new or derived
//      listenership metrics ... or building profiles of users."
//   - "Do not store Spotify Content indefinitely." (Local caching is limited
//      to TEMPORARY caching of metadata and cover art.)
//
// VINALL is a ranking app. It has games, it computes Taste Match across
// people, and it must remember what you rated forever - those are not
// features that can be trimmed to fit, they are the product. So the only
// coherent answer is that the metadata stops being Spotify's.
//
// None of those clauses has a "unless you receive Spotify's written approval"
// carve-out. The games one especially: ringtones have that escape hatch,
// mimicking a core experience has it, trivia quizzes do not. There is nothing
// to ask for.
//
// ---------------------------------------------------------------------------
// Why it mimics Spotify's shape instead of changing the client
// ---------------------------------------------------------------------------
// index.html funnels every catalogue request through one function,
// spotifyGet(path), and reads Spotify's field names at a few dozen call
// sites. Rewriting those is a large diff across a 1.2MB single file with no
// tests, for no behaviour change. Emitting Spotify's shape from Deezer's data
// makes the switch one constant, and makes reverting it one constant too.
//
// The shape is a translation for compatibility, not an attempt to pass
// anything off as Spotify's - nothing here calls Spotify or claims to be it.
//
// ---------------------------------------------------------------------------
// Legacy ids
// ---------------------------------------------------------------------------
// Every record already in somebody's crate is keyed by a Spotify base62 id,
// and Deezer has never heard of it. Those ids stay as opaque keys - name,
// artist and artwork are already stored on the record, so ratings, the
// Collection and Certification keep working untouched. When a legacy album
// page is opened the client passes ?name=&artist= and this resolves it by
// name instead. New records get Deezer's numeric ids.
//
// That is what makes this a switch rather than a migration: no table is
// re-keyed and nobody's crate is rewritten.

const UA = 'VINALL/1.0 (+https://wildcrate.xyz)';
const WEEK = 'public, s-maxage=604800, stale-while-revalidate=86400';
const DAY  = 'public, s-maxage=86400, stale-while-revalidate=3600';

async function dz(path) {
  const r = await fetch('https://api.deezer.com' + path, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('deezer ' + r.status);
  const j = await r.json();
  if (j && j.error) throw new Error('deezer ' + (j.error.type || 'error'));
  return j;
}

const loose = s => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, '')
  .replace(/[^a-z0-9]+/g, '');

// Deezer gives four fixed cover sizes; Spotify's consumers expect a widest-first
// images array, which is what index.html reads as images[0].url.
function images(o) {
  return [
    o.cover_xl && { url: o.cover_xl, width: 1000, height: 1000 },
    o.cover_big && { url: o.cover_big, width: 500, height: 500 },
    o.cover_medium && { url: o.cover_medium, width: 250, height: 250 }
  ].filter(Boolean);
}

function albumLite(a) {
  return {
    id: String(a.id),
    name: a.title,
    album_type: (a.record_type === 'single' ? 'single' : a.record_type === 'compilation' ? 'compilation' : 'album'),
    total_tracks: a.nb_tracks || 0,
    release_date: a.release_date || '',
    images: images(a),
    artists: a.artist ? [{ id: String(a.artist.id), name: a.artist.name }] : [],
    external_urls: { spotify: a.link || '' },   // the field name the client reads; it is a Deezer link
    uri: 'deezer:album:' + a.id,
    source: 'deezer'
  };
}

function trackItem(t, i, artistFallback) {
  return {
    id: String(t.id),
    name: t.title_short || t.title,
    duration_ms: (t.duration || 0) * 1000,
    track_number: t.track_position || (i + 1),
    disc_number: t.disk_number || 1,
    preview_url: t.preview || null,          // Deezer ships the clip with the tracklist
    artists: [{ id: String((t.artist && t.artist.id) || ''), name: (t.artist && t.artist.name) || artistFallback || '' }],
    uri: 'deezer:track:' + t.id
  };
}

async function pickAlbum(name, artist) {
  const q = (artist ? artist + ' ' : '') + name;
  const found = await dz('/search/album?limit=15&q=' + encodeURIComponent(q));
  const wa = loose(name), war = loose(artist);
  let best = null, bs = 0;
  for (const r of (found.data || [])) {
    const t = loose(r.title), a = loose(r.artist && r.artist.name);
    let s = 0;
    if (t === wa) s += 5; else if (t.startsWith(wa) || wa.startsWith(t)) s += 3; else continue;
    if (!war) s += 1;
    else if (a === war) s += 3;
    else if (a.includes(war) || war.includes(a)) s += 2;
    else continue;
    if (s > bs) { bs = s; best = r; }
  }
  return best;
}

async function fullAlbum(id) {
  const a = await dz('/album/' + encodeURIComponent(id));
  const out = albumLite(a);
  out.genres = ((a.genres && a.genres.data) || []).map(g => g.name);
  out.label = a.label || '';
  out.tracks = {
    items: ((a.tracks && a.tracks.data) || []).map((t, i) => trackItem(t, i, a.artist && a.artist.name)),
    total: a.nb_tracks || 0
  };
  return out;
}

export default async function handler(req, res) {
  const q = req.query || {};
  const path = String(q.path || '');
  try {
    // ---- album -----------------------------------------------------------
    // /api/catalogue?path=album&id=<deezer id>
    // /api/catalogue?path=album&id=<legacy spotify id>&name=..&artist=..
    if (path === 'album') {
      const id = String(q.id || '');
      const numeric = /^\d+$/.test(id);
      let dzId = numeric ? id : null;
      if (!dzId) {
        if (!q.name) { res.status(400).json({ error: { status: 400, message: 'name required to resolve a legacy id' } }); return; }
        const m = await pickAlbum(String(q.name), String(q.artist || ''));
        if (!m) { res.setHeader('Cache-Control', DAY); res.status(404).json({ error: { status: 404, message: 'not found' } }); return; }
        dzId = m.id;
      }
      const out = await fullAlbum(dzId);
      out.legacy_id = numeric ? null : id;      // so the client keeps its key
      res.setHeader('Cache-Control', WEEK);
      res.status(200).json(out);
      return;
    }

    // ---- search ----------------------------------------------------------
    if (path === 'search') {
      const term = String(q.q || '').slice(0, 200);
      // Deezer's limit is generous; Spotify dev mode caps at 10, and the
      // client already assumes small pages, so this keeps the same feel.
      const limit = Math.min(parseInt(q.limit, 10) || 10, 25);
      if (!term) { res.status(400).json({ error: { status: 400, message: 'q required' } }); return; }
      const type = String(q.type || 'album');
      const out = {};
      if (/album/.test(type)) {
        const j = await dz('/search/album?limit=' + limit + '&q=' + encodeURIComponent(term));
        out.albums = { items: (j.data || []).map(albumLite), total: j.total || 0 };
      }
      if (/artist/.test(type)) {
        const j = await dz('/search/artist?limit=' + limit + '&q=' + encodeURIComponent(term));
        out.artists = {
          items: (j.data || []).map(a => ({
            id: String(a.id), name: a.name, source: 'deezer',
            images: [a.picture_xl && { url: a.picture_xl, width: 1000, height: 1000 }].filter(Boolean)
          })),
          total: j.total || 0
        };
      }
      res.setHeader('Cache-Control', DAY);
      res.status(200).json(out);
      return;
    }

    // ---- artist ----------------------------------------------------------
    if (path === 'artist') {
      const a = await dz('/artist/' + encodeURIComponent(String(q.id || '')));
      res.setHeader('Cache-Control', WEEK);
      res.status(200).json({
        id: String(a.id), name: a.name, source: 'deezer',
        images: [a.picture_xl && { url: a.picture_xl, width: 1000, height: 1000 }].filter(Boolean),
        external_urls: { spotify: a.link || '' }
      });
      return;
    }

    // ---- artist albums (the Completion list) -----------------------------
    if (path === 'artist-albums') {
      const id = String(q.id || '');
      const j = await dz('/artist/' + encodeURIComponent(id) + '/albums?limit=' + Math.min(parseInt(q.limit, 10) || 50, 100));
      let items = (j.data || []);
      // include_groups=album is what the discography asks Spotify for: studio
      // records only, or the Completion list fills up with singles and live sets.
      if (String(q.include_groups || 'album') === 'album') items = items.filter(a => a.record_type === 'album');
      res.setHeader('Cache-Control', WEEK);
      res.status(200).json({ items: items.map(albumLite), total: j.total || items.length });
      return;
    }

    res.status(400).json({ error: { status: 400, message: 'unknown path' } });
  } catch (e) {
    // Mirror Spotify's error envelope so the client's existing handling works.
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: { status: 502, message: String((e && e.message) || e) } });
  }
}
