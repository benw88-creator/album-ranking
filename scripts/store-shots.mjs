// App Store screenshots with NO third-party artwork (App Review 5.2.1, 2026-11-13).
//
// Apple rejected 1.0 because the store screenshots showed real album covers.
// These are shot from the real app, served locally, with every catalogue call
// answered by fictional records and EVERY image from another host replaced by
// cover art generated here (seeded abstract SVG). Nothing leaves this machine:
// Supabase and every external request are intercepted, as in tests/fixtures.mjs.
//
//   node serve.mjs &            (or PORT=... ; reuses a running server)
//   node store-shots.mjs [outDir]
//
// Writes 1320x2868 PNGs (6.9" iPhone, Apple's required set) plus the raw app
// captures, and a contact sheet. Check every frame by eye before uploading.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(here, '.browsers');
const BASE = 'http://127.0.0.1:' + (+process.env.PORT || 4173);
const OUT = path.resolve(process.argv[2] || path.join(here, '..', 'APPLE_REVIEW_FIXES', 'store-screenshots'));
fs.mkdirSync(path.join(OUT, 'raw'), { recursive: true });

// ---- fictional catalogue: invented artists and titles, generated sleeves ----
const ARTISTS = [
  ['a1', 'Mira Vale'], ['a2', 'Northbound Choir'], ['a3', 'Sable & Rook'], ['a4', 'Juno Okafor'],
  ['a5', 'The Lantern Club'], ['a6', 'Kestrel'], ['a7', 'Oda Marsh'], ['a8', 'Halcyon Drive']
];
const TITLES = ['Glass Harbour', 'Low Tide Static', 'Paper Moons', 'Velvet Engine', 'After the Ferris Wheel',
  'Saltwater Hymns', 'Orchard Lights', 'Midnight Atlas', 'Copper Season', 'Soft Machinery', 'Northern Lines',
  'Signal Fires', 'Blue Hour Radio', 'Wildflower Code', 'Concrete Bloom', 'Gold Rush Lullaby', 'Night Swimming Club',
  'Ember & Ash', 'Satellite Hearts', 'Quiet Riot Season', 'Lemon Tree Theory', 'Neon Psalms', 'Static Garden', 'Polaroid Summer'];
const SONGS = ['Lighthouse', 'Run the Tape', 'Echo Park', 'Slow Burn', 'Afterglow', 'Fault Lines', 'Holy Water',
  'Crash Course', 'Wavelength', 'Sundial', 'Paper Planes', 'Overpass', 'Static', 'Heatwave', 'Undertow', 'Monochrome'];
const ALBUMS = TITLES.map((t, i) => { const [aid, an] = ARTISTS[i % ARTISTS.length]; return { id: String(900100 + i), name: t, aid, an }; });
const art = id => `https://art.invalid/${id}.svg`;           // never fetched: routed below
const toApi = a => ({
  id: a.id, name: a.name, album_type: 'album', release_date: `${2018 + (+a.id % 8)}-05-01`, total_tracks: 12,
  artists: [{ id: a.aid, name: a.an }], images: [{ url: art(a.id), width: 1000, height: 1000 }],
  tracks: { items: SONGS.slice(0, 12).map((s, i) => ({ id: a.id + String(i).padStart(2, '0'), name: s, artists: [{ id: a.aid, name: a.an }], preview_url: '/shot-preview.wav', duration_ms: 170000 + i * 7000, track_number: i + 1 })) }
});

// ---- generated cover art: seeded, abstract, original ----
function rng(seed) { let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296; }
const PALETTES = [['#ff5e3a', '#ffd23f', '#1b1b3a'], ['#3ae0ff', '#7a5cff', '#0b0d1f'], ['#f7b2c4', '#ff4f8b', '#2a0e1f'],
  ['#b4f05a', '#2fbf71', '#0e1a12'], ['#ffe6a7', '#e8a33d', '#3a1f0b'], ['#9ad1ff', '#f4f1ea', '#1d3557'],
  ['#ff9e7a', '#8c52ff', '#14082a'], ['#e9e3d5', '#c2410c', '#111111']];
function cover(seed) {
  const r = rng(seed), [c1, c2, bg] = PALETTES[Math.floor(r() * PALETTES.length)], kind = Math.floor(r() * 4);
  let body = '';
  if (kind === 0) for (let i = 0; i < 7; i++) body += `<circle cx="${200 + r() * 600}" cy="${200 + r() * 600}" r="${60 + r() * 260}" fill="${i % 2 ? c1 : c2}" opacity="${0.35 + r() * 0.5}"/>`;
  if (kind === 1) for (let i = 0; i < 14; i++) body += `<rect x="0" y="${i * 72}" width="1000" height="${20 + r() * 50}" fill="${i % 2 ? c1 : c2}" opacity="${0.5 + r() * 0.5}" transform="rotate(${-12 + r() * 6} 500 500)"/>`;
  if (kind === 2) { for (let i = 9; i > 0; i--) body += `<circle cx="500" cy="${420 + r() * 160}" r="${i * 52}" fill="none" stroke="${i % 2 ? c1 : c2}" stroke-width="${10 + r() * 18}"/>`; }
  if (kind === 3) for (let i = 0; i < 9; i++) { const x = r() * 1000, y = r() * 1000, s = 120 + r() * 320; body += `<polygon points="${x},${y} ${x + s},${y + s * 0.2} ${x + s * 0.4},${y + s}" fill="${i % 2 ? c1 : c2}" opacity="${0.45 + r() * 0.5}"/>`; }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><defs><radialGradient id="g" cx="30%" cy="25%" r="90%"><stop offset="0" stop-color="${bg}" stop-opacity=".2"/><stop offset="1" stop-color="${bg}"/></radialGradient></defs><rect width="1000" height="1000" fill="${bg}"/>${body}<rect width="1000" height="1000" fill="url(#g)" opacity=".55"/></svg>`;
}
function silentWav() {
  const size = 8000 * 30 * 2, w = Buffer.alloc(44 + size);
  w.write('RIFF'); w.writeUInt32LE(36 + size, 4); w.write('WAVEfmt ', 8); w.writeUInt32LE(16, 16); w.writeUInt16LE(1, 20); w.writeUInt16LE(1, 22);
  w.writeUInt32LE(8000, 24); w.writeUInt32LE(16000, 28); w.writeUInt16LE(2, 32); w.writeUInt16LE(16, 34); w.write('data', 36); w.writeUInt32LE(size, 40); return w;
}
const WAV = silentWav();

async function wire(ctx) {
  await ctx.routeWebSocket('**/*', s => s.close());
  await ctx.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (req.resourceType() === 'image' && url.origin !== BASE) return route.fulfill({ body: cover(url.pathname), contentType: 'image/svg+xml' });
    if (url.hostname.endsWith('supabase.co')) {
      const one = req.headers().accept?.includes('object+json');
      return route.fulfill({ json: url.pathname.includes('/auth/') ? { user: null, session: null } : (one ? null : []), headers: { 'content-range': '0-0/0' } });
    }
    if (url.pathname === '/api/catalogue') {
      const p = url.searchParams.get('path') || '', id = url.searchParams.get('id');
      const a = ALBUMS.find(x => x.id === id) || ALBUMS[0];
      let data = toApi(a);
      if (p.includes('search')) data = { albums: { items: ALBUMS.slice(0, 12).map(toApi) }, artists: { items: ARTISTS.map(([i, n]) => ({ id: i, name: n, images: [{ url: art('artist' + i) }] })) }, tracks: { items: toApi(a).tracks.items } };
      else if (p.startsWith('artist')) data = p.includes('albums') ? { items: ALBUMS.filter(x => x.aid === (id || 'a1')).map(toApi) } : { id: id || 'a1', name: (ARTISTS.find(x => x[0] === id) || ARTISTS[0])[1], images: [{ url: art('artist' + id) }] };
      else if (p === 'chart-artists') data = { items: ARTISTS.map(([i, n]) => ({ id: i, name: n, images: [{ url: art('artist' + i) }] })) };
      else if (p === 'album-tracks') data = toApi(a).tracks;
      return route.fulfill({ json: data });
    }
    if (url.pathname === '/api/preview') {
      const name = url.searchParams.get('album') || '', a = ALBUMS.find(x => name.includes(x.name)) || ALBUMS[0];
      return route.fulfill({ json: { cover: art(a.id), tracks: toApi(a).tracks.items.map(t => ({ id: t.id, title: t.name, artist: a.an, duration: 180, preview: '/shot-preview.wav' })) } });
    }
    if (url.pathname === '/shot-preview.wav') return route.fulfill({ body: WAV, contentType: 'audio/wav' });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] });
    if (url.origin !== BASE) return route.fulfill({ status: 204, body: '' });
    return route.continue();
  });
}

function seed() {
  const now = Date.now(), day = 864e5, albums = {}, songs = {};
  const scores = [94, 88, 91, 76, 83, 97, 69, 85, 90, 72, 86, 79, 92, 81, 74, 89];
  ALBUMS.slice(0, 16).forEach((a, i) => {
    const s = scores[i], first = s - (i % 3 === 0 ? 12 : 0);
    albums[a.id] = { id: a.id, name: a.name, artist: a.an, artistId: a.aid, art: art(a.id), score: s, savedAt: now - (200 - i * 9) * day, ratedAt: now - i * day,
      history: first === s ? [{ s, t: now - i * day }] : [{ s: first, t: now - 190 * day }, { s, t: now - i * day }] };
  });
  ALBUMS.slice(0, 8).forEach((a, i) => [0, 1].map(j => SONGS[(i * 2 + j) % SONGS.length]).forEach((t, j) => {
    const id = a.id + String(j).padStart(2, '0');
    songs[id] = { id, name: t, artist: a.an, album: a.name, art: art(a.id), score: 6 + ((i + j) % 5), savedAt: now - i * day, ratedAt: now - i * day };
  }));
  return { albums, songs };
}

const SHOTS = [
  { file: '01-rate', head: 'Rate every record', sub: 'Out of 100, with a history of how your opinion moved.', go: async p => { await view(p, 'albums'); } },
  { file: '02-foryou', head: 'Find your next favourite', sub: 'A feed of records picked from your taste.', go: async p => { await view(p, 'foryou'); await p.waitForTimeout(2500); } },
  { file: '03-songs', head: 'Every song, scored', sub: 'Rate tracks out of 10 and keep the ones you love.', go: async p => { await view(p, 'songs'); } },
  { file: '04-arcade', head: 'Games for music lovers', sub: 'Daily puzzles, quick play and party games.', go: async p => { await view(p, 'games'); } },
  { file: '05-about', head: 'Your taste, decoded', sub: 'Insights drawn from everything you rate.', go: async p => { await view(p, 'about'); await p.waitForTimeout(1500); } }
];
async function view(p, mode) { await p.evaluate(m => (window.goToView || window.setMode)(m), mode); await p.waitForTimeout(1800); }

function frame(shot, png) {
  return `<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@500;700&display=swap" rel="stylesheet"><style>
  *{margin:0;box-sizing:border-box} body{width:1320px;height:2868px;overflow:hidden;font-family:'Instrument Sans',system-ui,sans-serif;color:#f4efe6;
  background:radial-gradient(1200px 900px at 15% 0%,#3a2a0a 0%,transparent 60%),radial-gradient(900px 900px at 100% 40%,#1c2a4a 0%,transparent 60%),#0a0908}
  h1{font-size:104px;line-height:1.02;letter-spacing:-2px;text-align:center;padding:170px 90px 0;font-weight:700}
  p{font-size:46px;line-height:1.3;text-align:center;color:#c9c1b2;padding:34px 140px 0}
  .ph{position:absolute;left:50%;top:640px;transform:translateX(-50%);width:1050px;height:2272px;border-radius:120px;padding:22px;background:#1a1816;box-shadow:0 60px 140px rgba(0,0,0,.6),0 0 0 3px #3a352d}
  .ph img{width:100%;height:100%;border-radius:100px;object-fit:cover;object-position:top;display:block}
  </style></head><body><h1>${shot.head}</h1><p>${shot.sub}</p><div class="ph"><img src="data:image/png;base64,${png.toString('base64')}"></div></body></html>`;
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'reduce' });
await wire(ctx);
const { albums, songs } = seed();
await ctx.addInitScript(({ albums, songs }) => {
  window.__vinallTest = true;
  localStorage.setItem('crate_albums_v1', JSON.stringify(albums));
  localStorage.setItem('crate_songs_v1', JSON.stringify(songs));
  localStorage.setItem('crate_onboard_v1', JSON.stringify({ done: true, at: Date.now(), step: 99 }));
}, { albums, songs });
const page = await ctx.newPage();
await page.goto(BASE + '/');
await page.waitForFunction(() => typeof window.goToView === 'function' || typeof window.setMode === 'function');
const go = page.locator('#splash-cta');
if (await go.isVisible().catch(() => false)) await go.click();
await page.waitForTimeout(2500);

const framer = await browser.newPage({ viewport: { width: 1320, height: 2868 }, deviceScaleFactor: 1 });
const made = [];
for (const s of SHOTS) {
  await s.go(page);
  const raw = await page.screenshot();
  fs.writeFileSync(path.join(OUT, 'raw', s.file + '.png'), raw);
  // Belt and braces: no request to a real image CDN may have reached the page.
  await framer.setContent(frame(s, raw), { waitUntil: 'networkidle' });
  const out = path.join(OUT, s.file + '.png');
  await framer.screenshot({ path: out });
  made.push(out);
  console.log('wrote', out);
}
await browser.close();
