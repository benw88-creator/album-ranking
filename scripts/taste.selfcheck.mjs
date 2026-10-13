// node scripts/taste.selfcheck.mjs
// Taste Match, Depth, About You and the Your Music queue: the properties
// that make them trustworthy, asserted on synthetic crates.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ctx = {}; ctx.globalThis = ctx;
vm.runInNewContext(fs.readFileSync(path.join(here, '../assets/taste.js'), 'utf8'), ctx);
const T = ctx.TasteCore;
const J = x => JSON.parse(JSON.stringify(x));
let n = 0; const ok = (name, fn) => { fn(); n++; };

const DAY = 864e5, NOW = Date.UTC(2026, 9, 13);
function crate(list, base = 0) {
  const o = {};
  list.forEach(([id, s, artist, genre, year], i) => {
    o[id] = { id, name: 'Album ' + id, artist: artist || 'Artist ' + (i % 7), genre: genre || '', year: year || '', score: s,
              history: [{ s, t: NOW - (base + i) * 3 * DAY }] };
  });
  return o;
}
const ids = Array.from({ length: 30 }, (_, i) => 'a' + i);

ok('identical taste is high, inverted taste is near zero, coincidence sits low', () => {
  const me = crate(ids.map((id, i) => [id, 40 + i * 2]));
  const twin = crate(ids.map((id, i) => [id, 40 + i * 2]));
  const inv = crate(ids.map((id, i) => [id, 98 - i * 2]));
  const a = T.match(me, twin), b = T.match(me, inv);
  assert.ok(a.enough && a.pct >= 90, 'twin ' + a.pct);
  assert.ok(b.pct <= 10, 'inverted ' + b.pct);
  assert.equal(a.level, 'high');
});

ok('rating inflation does not read as disagreement', () => {
  // Same ORDER and spacing, but one person scores everything 25 points higher.
  const me = crate(ids.map((id, i) => [id, 40 + i]));
  const generous = crate(ids.map((id, i) => [id, Math.min(100, 65 + i)]));
  assert.ok(T.match(me, generous).pct >= 85);
});

ok('sparse data is "not enough", never a low score', () => {
  const me = crate(ids.slice(0, 4).map((id, i) => [id, 60 + i]));
  const them = crate(ids.slice(0, 4).map((id, i) => [id, 90 - i]));
  const r = T.match(me, them);
  assert.equal(r.enough, false); assert.equal(r.pct, null); assert.equal(r.need, 1);
});

ok('a thin overlap is rounded to fives and marked low confidence', () => {
  const me = crate(ids.slice(0, 6).map((id, i) => [id, 50 + i * 7]));
  const them = crate(ids.slice(0, 6).map((id, i) => [id, 52 + i * 6]));
  const r = T.match(me, them);
  assert.equal(r.level, 'low'); assert.equal(r.pct % 5, 0);
});

ok('the same record under two ids still counts as shared', () => {
  const me = { x1: { id: 'x1', name: 'Blonde', artist: 'Frank Ocean', score: 94 } };
  const them = { '302127': { id: '302127', name: 'Blonde', artist: 'Frank Ocean', score: 90 } };
  assert.equal(T.match(me, them).shared, 1);
});

ok('the score is stable: same inputs, same answer, flat score maps included', () => {
  const me = crate(ids.map((id, i) => [id, 30 + ((i * 37) % 70)]));
  const flat = {}; ids.forEach((id, i) => { flat[id] = 35 + ((i * 53) % 60); });
  const meta = {}; ids.forEach(id => { meta[id] = { name: 'Album ' + id, artist: 'x' }; });
  assert.deepEqual(J(T.match(me, flat, meta)), J(T.match(me, flat, meta)));
});

ok('introductions go both ways and favour new artists, one per artist', () => {
  const me = crate([['a', 90, 'Radiohead'], ['b', 50, 'Drake'], ['c', 95, 'Radiohead'], ['d', 40, 'Muse'], ['e', 60, 'Blur'], ['f', 70, 'Oasis']]);
  const them = crate([['g', 95, 'SZA'], ['h', 92, 'SZA'], ['a', 60, 'Radiohead'], ['i', 40, 'Lorde']]);
  const r = T.match(me, them);
  assert.equal(r.unheard.length, 1); assert.equal(r.unheard[0].artist, 'SZA'); assert.ok(r.unheard[0].newArtist);
  assert.ok(r.introduce.some(x => x.artist === 'Radiohead'));
});

ok('depth needs data, and rating more of the same does not raise exploration', () => {
  assert.equal(T.depth(crate(ids.slice(0, 5).map((id, i) => [id, 70])), {}, { now: NOW }).ready, false);
  const varied = crate(ids.map((id, i) => [id, 70, 'Artist ' + i]));
  const same = crate(ids.map((id, i) => [id, 70, 'One Artist']));
  const dv = T.depth(varied, {}, { now: NOW }), ds = T.depth(same, {}, { now: NOW });
  assert.ok(dv.dims.exploration.score > ds.dims.exploration.score);
  assert.ok(ds.dims.commitment.score > dv.dims.commitment.score);
  assert.ok(dv.dims.diversity.score > ds.dims.diversity.score);
  assert.ok(dv.dims.exploration.score % 5 === 0);
  assert.equal(ds.identity.name, 'Loyalist', 'one artist, nothing new: loyal, not merely thorough');
  assert.ok(ds.identity.because.includes('%'));
});

ok('the About You contradiction appears only when the numbers support it', () => {
  const list = [];
  for (let i = 0; i < 12; i++) list.push(['r' + i, 70, 'R' + i, 'R&B', 2015]);
  for (let i = 0; i < 6; i++) list.push(['j' + i, 88, 'J' + i, 'Jazz', 1965]);
  const r = T.insights(crate(list), {}, { now: NOW });
  const g = r.list.find(x => x.id === 'genre');
  assert.ok(g && /R&B than anything, but Jazz/.test(g.headline), JSON.stringify(r.list.map(x => x.headline)));
  const flat = []; for (let i = 0; i < 18; i++) flat.push(['f' + i, 75, 'A' + i, i % 2 ? 'Rock' : 'Pop', 2000]);
  assert.ok(!T.insights(crate(flat), {}, { now: NOW }).list.some(x => x.id === 'genre'));
  assert.equal(T.insights(crate(flat.slice(0, 5)), {}, { now: NOW }).ready, false);
});

ok('listening insights only appear with listening data', () => {
  const list = []; for (let i = 0; i < 14; i++) list.push(['x' + i, i < 3 ? 50 : 80, i < 3 ? 'Drake' : 'Other ' + i]);
  const without = T.insights(crate(list), {}, { now: NOW });
  assert.ok(!without.list.some(x => x.id === 'played-low'));
  const withL = T.insights(crate(list), {}, { now: NOW, listen: [{ artist: 'Drake', plays: 640 }] });
  assert.ok(withL.list.some(x => x.id === 'played-low' && /640/.test(x.headline)));
});

ok('the Your Music queue leads with what you play and never repeats an artist back to back', () => {
  const items = [
    { id: 1, artist: 'A', plays: 500 }, { id: 2, artist: 'A', plays: 400 }, { id: 3, artist: 'A', plays: 300 },
    { id: 4, artist: 'B', plays: 2 }, { id: 5, artist: 'C', plays: 1 }, { id: 6, artist: 'D', plays: 0 }
  ];
  const q = J(T.queue(items, { now: NOW }));
  assert.equal(q[0].id, 1);
  for (let i = 1; i < q.length; i++) if (q[i].artist === q[i - 1].artist) assert.fail('back to back: ' + q.map(x => x.artist).join(''));
  assert.deepEqual(J(T.queue(items, { now: NOW })), q, 'deterministic');
});

console.log(`taste selfcheck: ${n} groups passed`);
