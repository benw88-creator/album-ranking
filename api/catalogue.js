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
/* For any response carrying a Deezer preview url. Those are SIGNED and live
   about ten minutes (?hdnea=exp=<unix>), so a cache longer than that serves
   links that 403 — and deliberately NO stale-while-revalidate, because
   serving a stale copy here means serving an expired signature, which is
   precisely the failure. Four minutes leaves every url at least five of its
   ten remaining when it reaches somebody. */
const CLIP = 'public, s-maxage=240';

async function dz(path) {
  const r = await fetch('https://api.deezer.com' + path, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('deezer ' + r.status);
  const j = await r.json();
  if (j && j.error) throw new Error('deezer ' + (j.error.type || 'error'));
  return j;
}

// Titles that are not a studio record however Deezer types them.
const NOT_STUDIO = /\b(live|unplugged|in concert|at the|karaoke|tribute|instrumental|remix(es|ed)?|commentary|demos?|sessions?|b-?sides|rarities|greatest hits|best of|the collection|anthology|box ?set)\b/i;

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
    // `_kind` when the discography path has classified it properly, and
    // record_type otherwise. The client prints an "EP" chip off this, so it
    // must never be a guess dressed as a fact — album_type stays the coarse
    // Spotify-shaped field every existing caller reads, and `kind` is the new
    // precise one.
    album_type: (a.record_type === 'single' ? 'single' : a.record_type === 'compilation' ? 'compilation' : 'album'),
    kind: a._kind || null,
    kind_confident: a._confident === undefined ? null : !!a._confident,
    total_tracks: a.nb_tracks || a._tracks || 0,
    release_date: a.release_date || '',
    images: images(a),
    artists: a.artist ? [{ id: String(a.artist.id), name: a.artist.name }] : [],
    // external_urls.spotify is the field name the client already reads; `link`
    // is the honest one. Both carry the DEEZER url.
    external_urls: { spotify: a.link || '' },
    link: a.link || '',
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

import { cors } from './_cors.js';
import {
  pickArtist, classifyRelease, dedupeReleases, countsForCompletion,
} from './_artists.js';

export default async function handler(req, res) {
  // Answers the preflight and stops. Must be first: the method checks below
  // would 405 an OPTIONS, and three of these routes have one.
  if (cors(req, res)) return;
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
      // CLIP, not WEEK, and this is the whole reason CLIP exists. Everything
      // else about an album is immutable and cached for a week; the
      // preview_url on each track is not — Deezer signs it with an expiry
      // about ten minutes out (?hdnea=exp=...), after which it 403s. Cached
      // for a week, every record in the app went silent ten minutes after
      // somebody first opened it and stayed silent for seven days.
      res.setHeader('Cache-Control', CLIP);
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
        const items = (j.data || []).map(albumLite);
        // Deezer's album SEARCH carries no release_date — only /album/{id}
        // does — so search results had no year at all, and VINALL prints the
        // year beside every record it suggests. The top few are enriched in
        // parallel: one extra call each, only for what somebody will actually
        // look at, and the whole response is edge-cached per query so a repeat
        // of the same search costs nothing.
        await Promise.all(items.slice(0, 6).map(async (a) => {
          try {
            const d = await dz('/album/' + a.id);
            if (d && d.release_date) a.release_date = d.release_date;
          } catch (e) { /* a year is worth one try, never a failed search */ }
        }));
        out.albums = { items, total: j.total || 0 };
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
      let aid = String(q.id || '');
      // A legacy Spotify artist id resolves by name here exactly as it does
      // for an album and for the discography below. This branch was the one
      // that did not, so a fav_artist saved before the catalogue moved was
      // handed to Deezer as a base62 string, dz() threw, and the artist hero
      // lost its background to a 502 that named nothing useful.
      if (!/^\d+$/.test(aid)) {
        if (!q.name) { res.status(400).json({ error: { status: 400, message: 'name required to resolve a legacy artist id' } }); return; }
        // RANKED, not `.find`. Deezer files two artists under the exact string
        // "Steve Lacy" — 395 fans and 277,980 — and first-hit-wins took the
        // wrong one, which put somebody else's photograph on the hero and
        // somebody else's records in the completion list, with no error
        // anywhere. See api/_artists.js.
        const fa = await dz('/search/artist?limit=20&q=' + encodeURIComponent(String(q.name)));
        const picked = pickArtist(fa.data || [], String(q.name));
        picked.log.forEach(l => console.log('[catalogue:artist] ' + l));
        const hitA = picked.artist;
        // No match is a real answer: an artist with no picture, which the
        // caller already handles. It is not an error and must not gate the page.
        if (!hitA) {
          res.setHeader('Cache-Control', DAY);
          res.status(200).json({ id: aid, name: String(q.name), source: 'deezer', images: [], external_urls: { spotify: '' } });
          return;
        }
        aid = String(hitA.id);
      }
      const a = await dz('/artist/' + encodeURIComponent(aid));
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
      let id = String(q.id || '');
      // A legacy SPOTIFY artist id means nothing to Deezer, and every artist
      // in a crate from before the catalogue moved carries one. Without this
      // the discography 404s, the Completion list comes back empty, and every
      // record you have already rated reads as unrated. So the caller sends
      // the artist name too and it is resolved the same way a legacy album is.
      if (!/^\d+$/.test(id)) {
        if (!q.name) { res.status(400).json({ error: { status: 400, message: 'name required to resolve a legacy artist id' } }); return; }
        // Same ranking as the artist path — a discography resolved to the
        // wrong one of two identically named artists is the worse half of
        // that bug, because it silently reports records as unrated.
        const f = await dz('/search/artist?limit=20&q=' + encodeURIComponent(String(q.name)));
        const picked = pickArtist(f.data || [], String(q.name));
        picked.log.forEach(l => console.log('[catalogue:artist-albums] ' + l));
        const hit = picked.artist;
        if (!hit) { res.setHeader('Cache-Control', DAY); res.status(200).json({ items: [], total: 0 }); return; }
        id = String(hit.id);
      }
      const j = await dz('/artist/' + encodeURIComponent(id) + '/albums?limit=' + Math.min(parseInt(q.limit, 10) || 100, 100));
      let items = (j.data || []);

      if (String(q.include_groups || 'album') === 'album') {
        /* THE TRACK COUNT IS THE EVIDENCE AND record_type IS ONLY A HINT.
           Measured on Travis Scott: `durag activity` is ONE TRACK AND THREE
           MINUTES and Deezer types it `album`, so the old
           `record_type === 'album'` filter put a single in the Completion
           list and asked somebody to go and rate it.

           /artist/{id}/albums does not carry nb_tracks — the field is simply
           absent — which is why nothing downstream could ever tell. So the
           cheap filters run first, and only the survivors are enriched.

           The cost is bounded and small: after dropping the singles and the
           live/remix/compilation titles by name, a big discography is a dozen
           or two releases, they go in parallel batches, the whole response is
           edge-cached for a week per artist, and a release whose lookup fails
           keeps its unconfident classification rather than disappearing. */
        const rough = items.filter((a) => {
          const c = classifyRelease(a);
          if (c.kind === 'single') return false;              // Deezer is right about these
          return countsForCompletion(c.kind) || !c.confident; // keep anything still in doubt
        }).filter(a => !NOT_STUDIO.test(a.title || ''));

        const ENRICH_CAP = 40, BATCH = 8;
        const heads = rough.slice(0, ENRICH_CAP);
        const full = new Map();
        for (let i = 0; i < heads.length; i += BATCH) {
          const slice = heads.slice(i, i + BATCH);
          const got = await Promise.all(slice.map(a =>
            dz('/album/' + a.id).catch(() => null)));
          got.forEach((d, k) => { if (d && d.id) full.set(String(slice[k].id), d); });
        }

        const dropped = [];
        items = rough.filter((a) => {
          const d = full.get(String(a.id));
          const c = classifyRelease(d ? Object.assign({}, a, {
            nb_tracks: d.nb_tracks, duration: d.duration,
          }) : a);
          a._kind = c.kind;
          a._tracks = c.tracks;
          a._confident = c.confident;
          if (!countsForCompletion(c.kind)) { dropped.push(a.title + ' — ' + c.kind + ' [' + c.why.join('; ') + ']'); return false; }
          return true;
        });
        if (dropped.length) console.log('[catalogue:artist-albums] dropped ' + dropped.length + ': ' + dropped.join(' | '));

        // One entry per work: a deluxe and its plain pressing are one record
        // somebody rates once.
        const dd = dedupeReleases(items);
        dd.merges.forEach(m => console.log('[catalogue:artist-albums] merged edition: kept ' + m.kept + ', dropped ' + m.dropped + ' (' + m.why + ')'));
        items = dd.releases;
      }
      res.setHeader('Cache-Control', WEEK);
      res.status(200).json({ items: items.map(albumLite), total: items.length });
      return;
    }

    res.status(400).json({ error: { status: 400, message: 'unknown path' } });
  } catch (e) {
    // Mirror Spotify's error envelope so the client's existing handling works.
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: { status: 502, message: String((e && e.message) || e) } });
  }
}
