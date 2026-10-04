// /u/:name, /r/:id and /a/:id (rewritten here by vercel.json).
//
// THE LINK IS THE GROWTH LOOP. "Look what I gave Blonde" is the thing people
// actually send, and until now a VINALL link pasted into iMessage or WhatsApp
// unfurled as the same generic card whatever it pointed at — because the app is
// one static file and a crawler never runs its JavaScript.
//
// So every shareable thing gets a real page, rendered here:
//
//   /r/<crate_feed id>  somebody's rating + review of one record
//   /a/<album id>       a record, with the room's score and its best review
//   /u/<username>       a person: their top three and how much they've rated
//
// Each carries Open Graph tags whose IMAGE IS THE ALBUM SLEEVE at 1000px, which
// is the thing that makes a link in a group chat worth tapping — and the page
// itself is a proper card for whoever taps it without the app, ending in one
// button that drops them on that exact record or person inside VINALL.
//
// Everything read here is already public: crate_feed is publicly readable (the
// Crate shows every row to everybody) and so is profiles. Rankings set to
// private are honoured: a /u/ page for a private account shows the name and
// nothing it would otherwise reveal.

import { cors } from './_cors.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cqfxyebejpkyhswolrwi.supabase.co';
// The anon key is public by design — it is inlined in index.html for every
// visitor. RLS is what protects the data, not this string.
const ANON = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxZnh5ZWJlanBreWhzd29scndpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMDI0MTYsImV4cCI6MjA5Njc3ODQxNn0.x9zL_qKAt465D-5Vw6bu8IIn-RxgUdfVbUoe1i4rsZs';
const SITE = 'https://vinall.xyz';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sb(path) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, { headers: { apikey: ANON, Authorization: 'Bearer ' + ANON } });
  return r.ok ? r.json() : [];
}
async function dz(path) {
  // Same User-Agent the catalogue route sends; from a Vercel IP Deezer can
  // refuse a request without one, which read here as "no such record".
  try { const r = await fetch('https://api.deezer.com' + path, { headers: { 'User-Agent': 'VINALL/1.0 (+https://vinall.xyz)' } }); const j = await r.json(); return j && !j.error ? j : null; } catch (e) { return null; }
}

// Same ramp as albumColor() in index.html: red → amber → green.
export function scoreColor(s) {
  const stops = [[0, [226, 75, 74]], [50, [239, 185, 39]], [100, [79, 180, 119]]];
  let lo = stops[0], hi = stops[2];
  for (let i = 0; i < 2; i++) if (s >= stops[i][0] && s <= stops[i + 1][0]) { lo = stops[i]; hi = stops[i + 1]; break; }
  const t = (s - lo[0]) / (hi[0] - lo[0] || 1);
  const c = lo[1].map((v, i) => Math.round(v + (hi[1][i] - v) * t));
  return 'rgb(' + c.join(',') + ')';
}
// Deezer serves any size from the same path. 1000px is what a big link
// preview wants; Spotify-era art (i.scdn.co) is left as it is.
export function bigArt(u) {
  return String(u || '').replace(/\/(\d+)x\1-000000-80-0-0\.jpg$/, '/1000x1000-000000-80-0-0.jpg')
    // Spotify-era sleeves: 00001e02 is the 300px rendition, 0000b273 the 640px.
    .replace(/(i\.scdn\.co\/image\/ab67616d)00001e02/, '$10000b273');
}
const appLinkAlbum = (a, extra) => '/?album=' + encodeURIComponent(a.id) + '&n=' + encodeURIComponent(a.name || '') + '&ar=' + encodeURIComponent(a.artist || '') + (extra || '');
const words = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };

function page({ title, desc, image, url, body, cta }) {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:site_name" content="VINALL"><meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(SITE + url)}">
${image ? `<meta property="og:image" content="${esc(image)}"><meta property="og:image:width" content="1000"><meta property="og:image:height" content="1000"><meta name="twitter:image" content="${esc(image)}">` : ''}
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<meta name="theme-color" content="#0a0908"><link rel="icon" href="/assets/icons/icon-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet">
<style>
:root{--bg:#0a0908;--text:#f5efe6;--dim:rgba(245,239,230,.62);--faint:rgba(245,239,230,.4);--gold:#f5c842}
*{box-sizing:border-box;margin:0}
body{min-height:100vh;background:var(--bg);color:var(--text);font:15px/1.5 'IBM Plex Sans',system-ui,sans-serif;display:grid;place-items:center;padding:max(24px,env(safe-area-inset-top)) 16px max(24px,env(safe-area-inset-bottom));overflow-x:hidden}
.bed{position:fixed;inset:-20%;background:center/cover no-repeat;filter:blur(60px) saturate(1.3) brightness(.45);transform:scale(1.1);z-index:-1}
.card{width:100%;max-width:440px;text-align:center}
.cover{width:min(300px,72vw);aspect-ratio:1;border-radius:18px;object-fit:cover;box-shadow:0 30px 80px rgba(0,0,0,.6);background:#1a1714}
.who{display:flex;align-items:center;justify-content:center;gap:10px;margin:22px 0 6px;color:var(--dim);font-size:14px}
.who img{width:28px;height:28px;border-radius:50%;object-fit:cover}
h1{font:700 clamp(24px,7vw,32px)/1.1 'Instrument Sans',sans-serif;letter-spacing:-.02em}
.artist{color:var(--dim);margin-top:4px}
.score{display:inline-flex;align-items:baseline;gap:4px;margin:18px 0 4px;font:700 64px/1 'Instrument Sans',sans-serif;letter-spacing:-.04em}
.score small{font:500 16px 'IBM Plex Mono',monospace;color:var(--faint)}
.meta{font:500 12px 'IBM Plex Mono',monospace;color:var(--faint);letter-spacing:.04em}
blockquote{margin:18px auto 0;max-width:38ch;font-size:16px;line-height:1.55;color:var(--text);text-align:left;padding-left:14px;border-left:2px solid var(--c,var(--gold))}
.tops{display:flex;justify-content:center;gap:10px;margin-top:20px}
.tops img{width:31%;max-width:118px;aspect-ratio:1;border-radius:10px;object-fit:cover;box-shadow:0 12px 30px rgba(0,0,0,.5)}
.av{width:96px;height:96px;border-radius:50%;object-fit:cover;box-shadow:0 0 0 3px rgba(245,200,66,.35)}
.cta{display:inline-block;margin-top:28px;padding:15px 30px;border-radius:999px;background:linear-gradient(120deg,#f5c842,#ff7a4d);color:#0a0908;font:700 16px 'Instrument Sans',sans-serif;text-decoration:none}
.brand{margin-top:22px;font:700 13px 'Instrument Sans',sans-serif;letter-spacing:.24em;color:var(--faint)}
</style></head><body>
${image ? `<div class="bed" style="background-image:url('${esc(image)}')"></div>` : ''}
<main class="card">${body}<br><a class="cta" href="${esc(cta.href)}">${esc(cta.label)}</a><div class="brand">VINALL</div></main>
</body></html>`;
}

function notFound(res) {
  res.setHeader('Cache-Control', 'public, s-maxage=60');
  res.status(404).send(page({ title: 'VINALL', desc: 'The place for music.', image: '', url: '/', body: '<h1>That link has gone quiet.</h1>', cta: { href: '/', label: 'Open VINALL' } }));
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  const q = req.query || {};
  const t = String(q.t || ''), k = String(q.k || '').slice(0, 80);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  try {
    if (t === 'r' && /^[0-9a-f-]{36}$/i.test(k)) {
      const [row] = await sb('crate_feed?select=*&id=eq.' + k);
      if (!row || row.score == null) return notFound(res);
      const a = { id: row.album_id, name: row.album_name, artist: row.album_artist };
      const art = bigArt(row.album_art), col = scoreColor(row.score);
      const note = String(row.note || '').trim();
      const title = row.username + ' gave ' + row.album_name + ' ' + row.score;
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
      return res.status(200).send(page({
        title, image: art, url: '/r/' + k,
        desc: note ? '“' + words(note, 180) + '”' : row.album_artist + ' · rated on VINALL',
        body: `<img class="cover" src="${esc(art)}" alt="">
<div class="who">${row.avatar_url ? `<img src="${esc(row.avatar_url)}" alt="">` : ''}<span>${esc(row.username)} rated</span></div>
<h1>${esc(row.album_name)}</h1><div class="artist">${esc(row.album_artist)}</div>
<div class="score" style="color:${col}">${row.score}<small>/100</small></div>
${note ? `<blockquote style="--c:${col}">${esc(words(note, 600))}</blockquote>` : ''}`,
        cta: { href: appLinkAlbum(a, '&review=' + k + '#reviews'), label: 'What would you give it?' },
      }));
    }

    if (t === 'a' && k) {
      const rows = await sb('crate_feed?select=user_id,username,score,note,album_name,album_artist,album_art&album_id=eq.' + encodeURIComponent(k) + '&limit=500');
      let a = rows[0] ? { id: k, name: rows[0].album_name, artist: rows[0].album_artist, art: rows[0].album_art } : null;
      if (!a && /^\d+$/.test(k)) {
        const d = await dz('/album/' + k);
        if (d) a = { id: k, name: d.title, artist: d.artist && d.artist.name, art: d.cover_xl };
      }
      if (!a) return notFound(res);
      const scored = rows.filter((r) => r.score != null);
      const avg = scored.length ? Math.round(scored.reduce((n, r) => n + r.score, 0) / scored.length) : null;
      const best = scored.filter((r) => String(r.note || '').trim().length > 20).sort((x, y) => y.note.length - x.note.length)[0];
      const art = bigArt(a.art);
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
      return res.status(200).send(page({
        title: a.name + ' — ' + a.artist, image: art, url: '/a/' + k,
        desc: avg != null ? 'Scored ' + avg + '/100 across ' + scored.length + ' rating' + (scored.length === 1 ? '' : 's') + ' on VINALL' : 'Be the first to rate it on VINALL',
        body: `<img class="cover" src="${esc(art)}" alt="">
<h1 style="margin-top:22px">${esc(a.name)}</h1><div class="artist">${esc(a.artist)}</div>
${avg != null ? `<div class="score" style="color:${scoreColor(avg)}">${avg}<small>/100</small></div><div class="meta">${scored.length} RATING${scored.length === 1 ? '' : 'S'}</div>` : ''}
${best ? `<blockquote style="--c:${scoreColor(best.score)}">${esc(words(best.note, 400))}<div class="meta" style="margin-top:8px">— ${esc(best.username)}, ${best.score}</div></blockquote>` : ''}`,
        cta: { href: appLinkAlbum(a, '#reviews'), label: avg != null ? 'Add your score' : 'Be the first' },
      }));
    }

    if (t === 'u' && /^[A-Za-z0-9_]{3,20}$/.test(k)) {
      const [p] = await sb('profiles?select=id,username,bio,avatar_url,top3,ratings_visibility&username=ilike.' + k);
      if (!p) return notFound(res);
      const open = (p.ratings_visibility || 'public') === 'public';
      const top = open ? (p.top3 || []).filter(Boolean).slice(0, 3) : [];
      let n = 0;
      if (open) {
        const r = await fetch(SUPABASE_URL + '/rest/v1/crate_feed?select=id&user_id=eq.' + p.id, { headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, Prefer: 'count=exact', Range: '0-0' } });
        n = +(String(r.headers.get('content-range') || '').split('/')[1] || 0);
      }
      const image = top[0] ? bigArt(top[0].art) : (p.avatar_url || '');
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
      return res.status(200).send(page({
        title: p.username + ' on VINALL', image, url: '/u/' + p.username,
        desc: top.length ? 'Top 3: ' + top.map((x) => x.name).join(' · ') + (n ? ' — ' + n + ' records rated' : '') : (p.bio || 'Their taste, scored out of 100.'),
        body: `${p.avatar_url ? `<img class="av" src="${esc(p.avatar_url)}" alt="">` : ''}
<h1 style="margin-top:16px">${esc(p.username)}</h1>
${p.bio ? `<div class="artist">${esc(words(p.bio, 160))}</div>` : ''}
${n ? `<div class="meta" style="margin-top:10px">${n} RECORDS RATED</div>` : ''}
${top.length ? `<div class="tops">${top.map((x) => `<img src="${esc(bigArt(x.art))}" alt="${esc(x.name)}">`).join('')}</div>` : ''}`,
        cta: { href: '/?u=' + encodeURIComponent(p.id), label: 'How close is your taste?' },
      }));
    }
  } catch (e) { /* fall through */ }
  return notFound(res);
}
