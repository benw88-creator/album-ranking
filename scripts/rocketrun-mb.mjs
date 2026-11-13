// Test helper: find real MusicBrainz answers for a RocketRun prompt, the way a
// player would, and count how many exist. Used by the route test and the
// answerability check. Keeps to MusicBrainz's one request a second.
import { evaluate, albumFacts, artistFacts } from '../assets/rocketrun-rules.js';

const UA = 'VINALL-tests/1.0 ( https://vinall-lab.vercel.app )';
import fs from "node:fs";
import os from "node:os";
import pathMod from "node:path";
const CACHE = pathMod.join(os.tmpdir(), "rocketrun-mb-cache.json");
let cache = {}; try { cache = JSON.parse(fs.readFileSync(CACHE, "utf8")); } catch (e) {}
let last = 0;
export async function mb(path) {
  if (cache[path]) return cache[path];
  for (let i = 0; i < 6; i++) {
    const wait = last + 1100 - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const r = await fetch('https://musicbrainz.org/ws/2/' + path, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (r.ok) { const j = await r.json(); cache[path] = j; try { fs.writeFileSync(CACHE, JSON.stringify(cache)); } catch (e) {} return j; }
    console.error("  musicbrainz", r.status, "retrying");
    await new Promise((ok) => setTimeout(ok, 4000 * (i + 1)));
  }
  throw new Error('musicbrainz ' + path);
}
const enc = encodeURIComponent;

// Lucene for the conditions MusicBrainz can index; evaluate() does the rest.
function rgQuery(conds) {
  const p = ['primarytype:album', 'NOT secondarytype:compilation'];
  for (const [op, a, b] of conds) {
    if (op === 'year') p.push(`firstreleasedate:[${a} TO ${a}-12-31]`);
    if (op === 'between') p.push(`firstreleasedate:[${a} TO ${b}-12-31]`);
    if (op === 'before') p.push(`firstreleasedate:[1900 TO ${a - 1}-12-31]`);
    if (op === 'after') p.push(`firstreleasedate:[${a + 1} TO 2100]`);
    if (op === 'starts') p.push(`releasegroup:${a.toLowerCase()}*`);
    if (op === 'live') p.push('secondarytype:live');
    if (op === 'colour') p.push('releasegroup:(red OR blue OR black OR white OR green)');
    if (op === 'number') p.push('releasegroup:(one OR two OR three OR 1 OR 2 OR 3)');
  }
  return p.join(' AND ');
}
function arQuery(conds) {
  const p = [];
  for (const [op, a, b] of conds) {
    if (op === 'country') p.push(`country:${a}`);
    if (op === 'starts') p.push(`artist:${a.toLowerCase()}*`);
    if (op === 'group') p.push('type:group');
    if (op === 'person') p.push('type:person');
    if (op === 'formed') p.push(`begin:[${a} TO ${b}-12-31]`);
  }
  return p.join(' AND ') || 'type:group';
}

// -> { count, answers: [facts...] } — answers already pass evaluate() on search data.
export async function findAnswers(q, want = 3) {
  const byArtist = q.conds.find(([op]) => ['byCountry', 'byGroup', 'bySolo'].includes(op));
  if (q.kind === 'album' && byArtist) {
    const aq = byArtist[0] === 'byCountry' ? `country:${byArtist[1]} AND type:group` : `type:${byArtist[0] === 'byGroup' ? 'group' : 'person'} AND country:GB`;
    const as = await mb(`artist/?fmt=json&limit=10&query=${enc(aq)}`);
    const out = [];
    for (const a of as.artists.slice(0, 4)) {
      const rgs = await mb(`release-group?fmt=json&limit=50&type=album&artist=${a.id}`);
      for (const rg of rgs['release-groups'] || []) {
        rg['artist-credit'] = [{ name: a.name, artist: { id: a.id, name: a.name, type: a.type, country: a.country } }];
        const f = albumFacts(rg);
        if (evaluate(q, f).ok === true) out.push(f);
        if (out.length >= want) return { count: as.count, answers: out };
      }
    }
    return { count: as.count, answers: out };
  }
  if (q.kind === 'album') {
    const j = await mb(`release-group/?fmt=json&limit=60&query=${enc(rgQuery(q.conds))}`);
    const fs = (j['release-groups'] || []).map(albumFacts).filter((f) => evaluate(q, f).ok === true);
    return { count: j.count, answers: fs.slice(0, want) };
  }
  const j = await mb(`artist/?fmt=json&limit=60&query=${enc(arQuery(q.conds))}`);
  const fs = (j.artists || []).map(artistFacts).filter((f) => evaluate(q, f).ok === true);
  return { count: j.count, answers: fs.slice(0, want) };
}
