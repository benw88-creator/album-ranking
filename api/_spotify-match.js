// /api/catalogue?path=spotify-match — Spotify library rows (from the person's own data
// download, never Spotify's API) → the same records on Deezer.
//
// POST { kind: 'track' | 'album', items: [{ u, a, t, b }] }   (max 10)
//   u  spotify:track:… / spotify:album:…   a artist   t title   b album
// →    { results: [{ u, status: 'ok'|'check'|'none'|'retry', m, alts }] }
//
// MATCHED ONCE FOR EVERYBODY. Answers are cached by Spotify URI in
// spotify_matches (..._20261005100000_spotify_matches.sql), which holds no
// personal data — "this Spotify id is this Deezer id" is a fact about two
// catalogues. The second person to import Blonde costs Deezer nothing. A
// "none" is re-asked after 30 days, because catalogues gain records.
//
// Deezer allows ~50 requests per 5 seconds per IP and every VINALL visitor
// shares this one, so a batch is small, runs three at a time, and a Deezer
// refusal comes back as 'retry' for the browser to send again later rather
// than as a "no match" it would believe.

import { scoreTrack, scoreAlbum, decide, trackOut, albumOut, base } from './_match.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cqfxyebejpkyhswolrwi.supabase.co';
const UA = 'VINALL/1.0 (+https://vinall.xyz)';
const NONE_TTL = 30 * 864e5;

async function dz(path) {
  const r = await fetch('https://api.deezer.com' + path, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('deezer ' + r.status);
  const j = await r.json();
  if (j && j.error) throw new Error('deezer ' + (j.error.code || j.error.type));
  return (j && j.data) || [];
}
function sb(path, opts = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return Promise.resolve(null);
  return fetch(SUPABASE_URL + '/rest/v1/' + path, { ...opts,
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...(opts.headers || {}) } })
    .then((r) => (r.ok ? r : null)).catch(() => null);
}

async function matchOne(kind, it) {
  const want = { a: String(it.a || '').slice(0, 200), t: String(it.t || '').slice(0, 300), b: String(it.b || '').slice(0, 300) };
  const q = (s) => encodeURIComponent(s);
  if (kind === 'album') {
    let cands = await dz('/search/album?limit=10&q=' + q(want.a + ' ' + base(want.b)));
    let d = decide(cands.map((c) => ({ c, s: scoreAlbum(want, c) })));
    if (d.status !== 'ok') {
      cands = await dz('/search/album?limit=10&q=' + q('artist:"' + want.a + '" album:"' + base(want.b) + '"'));
      const d2 = decide(cands.map((c) => ({ c, s: scoreAlbum(want, c) })));
      if (d2.status === 'ok' || (d.status === 'none' && d2.status === 'check')) d = d2;
    }
    return { status: d.status, m: albumOut(d.best), alts: d.status === 'check' ? d.alts.map(albumOut) : [] };
  }
  // Plain words first — Deezer's advanced syntax returns an empty list for
  // some queries (see Recall in CLAUDE.md) — then the strict form if unsure.
  // Three asks at most, widest first. Deezer's plain search does not always
  // put the studio cut in its top results ("Beyoncé Halo" leads with a live
  // version and a remix), so the album name is the second ask; the strict
  // syntax, which sometimes answers nothing at all, is the last.
  const asks = [
    '/search/track?limit=25&q=' + q(want.a + ' ' + base(want.t)),
    want.b ? '/search/track?limit=12&q=' + q(want.a + ' ' + base(want.t) + ' ' + base(want.b)) : null,
    '/search/track?limit=12&q=' + q('artist:"' + want.a + '" track:"' + base(want.t) + '"'),
  ].filter(Boolean);
  let d = { status: 'none', best: null, alts: [] };
  for (const path of asks) {
    const d2 = decide((await dz(path)).map((c) => ({ c, s: scoreTrack(want, c) })));
    if (d2.status === 'ok') { d = d2; break; }
    if (d.status === 'none' && d2.status === 'check') d = d2;
  }
  return { status: d.status, m: trackOut(d.best), alts: d.status === 'check' ? d.alts.map(trackOut) : [] };
}

// Served through /api/catalogue (path=spotify-match), which has already
// answered CORS. It is not its own route because Vercel Hobby allows twelve
// functions and this would be the thirteenth — see the note in CLAUDE.md.
export async function spotifyMatch(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const kind = body && body.kind === 'album' ? 'album' : 'track';
  const items = (Array.isArray(body && body.items) ? body.items : []).slice(0, 10)
    .filter((it) => it && /^spotify:(track|album):[A-Za-z0-9]{10,40}$/.test(String(it.u || '')) && (it.t || it.b) && it.a);
  if (!items.length) { res.status(400).json({ error: 'no items' }); return; }

  // Cache first.
  const known = {};
  const cr = await sb('spotify_matches?select=uri,status,match,alts,matched_at&uri=in.(' + items.map((i) => '"' + i.u + '"').join(',') + ')');
  if (cr) (await cr.json()).forEach((row) => {
    if (row.status === 'none' && Date.now() - new Date(row.matched_at).getTime() > NONE_TTL) return;
    known[row.uri] = { u: row.uri, status: row.status, m: row.match, alts: row.alts || [] };
  });

  const todo = items.filter((i) => !known[i.u]);
  const fresh = [];
  let next = 0;
  async function worker() {
    while (next < todo.length) {
      const it = todo[next++];
      try { const r = await matchOne(kind, it); fresh.push({ u: it.u, ...r }); }
      catch (e) { fresh.push({ u: it.u, status: 'retry', m: null, alts: [] }); }
    }
  }
  await Promise.all([worker(), worker(), worker()]);

  const save = fresh.filter((r) => r.status !== 'retry');
  if (save.length) {
    await sb('spotify_matches?on_conflict=uri', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(save.map((r) => ({ uri: r.u, kind, status: r.status, match: r.m, alts: r.alts, matched_at: new Date().toISOString() }))) });
  }
  const byU = {}; fresh.forEach((r) => { byU[r.u] = r; });
  res.status(200).json({ results: items.map((i) => known[i.u] || byU[i.u]) });
}
