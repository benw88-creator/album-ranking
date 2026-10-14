// node scripts/passport/seed.mjs
// Builds assets/passport-seed.json:
//   origins — MusicBrainz countries for the artists in the static game pools,
//             so a first Passport visit is not a minute of waiting on artists
//             everybody has rated.
//   recs    — "where to go next" artists per country. The list below is a
//             CANDIDATE list; an artist only ships if MusicBrainz itself places
//             them in that country, through the same pick() the browser uses.
// MusicBrainz allows one request a second; this takes a few minutes.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '../..');
const ctx = {}; ctx.globalThis = ctx;
vm.runInNewContext(fs.readFileSync(path.join(repo, 'assets/passport-core.js'), 'utf8'), ctx);
const P = ctx.PassportCore;
const world = JSON.parse(fs.readFileSync(path.join(repo, 'assets/passport-world.json'), 'utf8'));
const names = {};
for (const [cc, v] of Object.entries({ ...world.shapes, ...world.extra })) names[P.fold(v.n)] = cc;
Object.assign(names, { [P.fold('United States')]: 'US', [P.fold('United Kingdom')]: 'GB', [P.fold('South Korea')]: 'KR', [P.fold('Russia')]: 'RU', [P.fold("Côte d'Ivoire")]: 'CI', [P.fold('Czechia')]: 'CZ' });

const CANDIDATES = {
  NG: ['Burna Boy', 'Wizkid', 'Fela Kuti', 'Tems', 'Rema'], GH: ['Black Sherif', 'Amaarae', 'Ebo Taylor'],
  ZA: ['Black Coffee', 'Tyla', 'Hugh Masekela', 'Miriam Makeba'], ML: ['Ali Farka Touré', 'Amadou & Mariam', 'Oumou Sangaré', 'Tinariwen'],
  SN: ["Youssou N'Dour", 'Baaba Maal'], CD: ['Fally Ipupa'], ET: ['Mulatu Astatke'], KE: ['Sauti Sol'], EG: ['Umm Kulthum'],
  CV: ['Cesária Évora'], TZ: ['Diamond Platnumz'], CM: ['Manu Dibango'], CI: ['Alpha Blondy'], BJ: ['Angélique Kidjo'], ZW: ['Thomas Mapfumo'],
  JM: ['Bob Marley & The Wailers', 'Sean Paul', 'Koffee', 'Shabba Ranks'], TT: ['Machel Montano'], BB: ['Rihanna'],
  CU: ['Buena Vista Social Club', 'Celia Cruz'], PR: ['Bad Bunny', 'Rauw Alejandro'], DO: ['Juan Luis Guerra'],
  MX: ['Natalia Lafourcade', 'Peso Pluma', 'Café Tacvba'], CO: ['Shakira', 'J Balvin', 'Karol G'],
  BR: ['Jorge Ben Jor', 'Caetano Veloso', 'Anitta', 'Os Mutantes', 'Gilberto Gil'], AR: ['Soda Stereo', 'Mercedes Sosa', 'Bizarrap'],
  CL: ['Mon Laferte', 'Víctor Jara'], PE: ['Susana Baca'], VE: ['Arca'],
  JP: ['Cornelius', 'Hikaru Utada', 'Yellow Magic Orchestra', 'Fishmans', 'Ryuichi Sakamoto'], KR: ['BTS', 'NewJeans', 'BLACKPINK'],
  TW: ['Jay Chou'], IN: ['A. R. Rahman', 'Ravi Shankar'], PK: ['Nusrat Fateh Ali Khan'], ID: ['NIKI', 'Rich Brian'],
  PH: ['Ben&Ben', 'Eraserheads'], MN: ['The HU'], IL: ['Ofra Haza'], TR: ['Sezen Aksu', 'Barış Manço'], IR: ['Googoosh'],
  LB: ['Fairuz', "Mashrou' Leila"], IS: ['Björk', 'Sigur Rós', 'Of Monsters and Men'], NO: ['a-ha', 'Röyksopp', 'AURORA'],
  SE: ['ABBA', 'Robyn', 'The Knife'], FI: ['Nightwish'], DK: ['MØ'], NL: ['Tiësto', 'Altın Gün'], BE: ['Stromae', 'Soulwax'],
  FR: ['Daft Punk', 'Air', 'Christine and the Queens', 'Serge Gainsbourg'], DE: ['Kraftwerk', 'Can', 'Rammstein'],
  AT: ['Falco'], CH: ['Yello'], IT: ['Ennio Morricone', 'Måneskin'], ES: ['ROSALÍA', 'Paco de Lucía'], PT: ['Amália Rodrigues'],
  GR: ['Vangelis'], RU: ['t.A.T.u.'], UA: ['DakhaBrakha', 'Go_A'], IE: ['U2', 'My Bloody Valentine', 'Fontaines D.C.', "Sinéad O'Connor"],
  AU: ['Tame Impala', 'AC/DC', 'Kylie Minogue'], NZ: ['Lorde', "Fat Freddy's Drop"], EE: ['Arvo Pärt'], HR: ['2CELLOS'],
  SI: ['Laibach'], KZ: ['Dimash Kudaibergen'], CA: ['Drake', 'Joni Mitchell', 'Arcade Fire'], GB: ['Radiohead', 'Little Simz'],
  US: ['Frank Ocean', 'Kendrick Lamar'], PL: ['Krzysztof Komeda'], HU: ['Thy Catafalque'], RO: ['Inna'], CZ: ['Plastic People of the Universe'],
  DZ: ['Khaled'], MA: ['Hindi Zahra'], AO: ['Bonga'], MG: ['Rossy'], HT: ['Boukman Eksperyans'], VN: ['Khánh Ly'], TH: ['Phum Viphurit'],
  MY: ['Yuna'], SG: ['Gentle Bones'], CN: ['Faye Wong'], AM: ['Tigran Hamasyan'], GE: ['Nino Katamadze'], RS: ['Bajaga i Instruktori'],
  LV: ['Brainstorm'], LT: ['Andrius Mamontovas'], BG: ['Le Mystère des Voix Bulgares']
};

// Artists from the static game pools, which are the records people rate most.
const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const pool = new Set();
for (const m of html.matchAll(/^\s*\['[^']*(?:\\'[^']*)*', '((?:[^'\\]|\\.)*)', (?:1|2)\d{3},/gm)) pool.add(m[1].replace(/\\'/g, "'"));

if (process.argv.includes('--dry')) { console.log(pool.size, [...pool].slice(0, 12)); process.exit(0); }
const UA = 'VINALL/1.0 (vinall.support@gmail.com)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let last = 0;
async function mb(url) {
  for (let tries = 0; tries < 4; tries++) {
    const wait = Math.max(0, last + 1100 - Date.now()); if (wait) await sleep(wait);
    last = Date.now();
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (r.status === 503) { await sleep(2500); continue; }
    if (!r.ok) return null;
    return r.json();
  }
  return null;
}
async function origin(name) {
  const q = 'artist:"' + name.replace(/["\\]/g, '') + '"';
  const j = await mb('https://musicbrainz.org/ws/2/artist?fmt=json&limit=8&query=' + encodeURIComponent(q));
  if (!j) return undefined;
  const p = P.pick(j.artists || [], name, names);
  if (!p || p.amb) return null;
  return p.c || null;
}

const out = { v: 1, built: new Date().toISOString().slice(0, 10), origins: {}, recs: {} };
const dropped = [];
for (const [cc, list] of Object.entries(CANDIDATES)) {
  for (const a of list) {
    const c = await origin(a);
    if (c !== undefined) out.origins[P.fold(P.firstArtist(a))] = c;
    if (c === cc) (out.recs[cc] = out.recs[cc] || []).push(a); else dropped.push(`${a} (${cc} → ${c})`);
    process.stdout.write('.');
  }
}
for (const a of pool) {
  const k = P.fold(P.firstArtist(a)); if (k in out.origins) continue;
  const c = await origin(P.firstArtist(a));
  if (c !== undefined) out.origins[k] = c;
  process.stdout.write(',');
}
fs.writeFileSync(path.join(repo, 'assets/passport-seed.json'), JSON.stringify(out));
console.log('\norigins', Object.keys(out.origins).length, 'rec countries', Object.keys(out.recs).length, '\ndropped:', dropped.join('; '));
