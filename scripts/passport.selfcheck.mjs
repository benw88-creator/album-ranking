// node scripts/passport.selfcheck.mjs
// Music Passport: origin matching never guesses, and the readings are built
// from the person's own data with the thresholds they claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ctx = {}; ctx.globalThis = ctx;
vm.runInNewContext(fs.readFileSync(path.join(here, '../assets/passport-core.js'), 'utf8'), ctx);
const P = ctx.PassportCore;
const J = x => JSON.parse(JSON.stringify(x));
let n = 0; const ok = (name, fn) => { fn(); n++; };
const names = { unitedkingdom: 'GB', unitedstates: 'US', japan: 'JP' };

ok('fold keeps other scripts and folds accents', () => {
  assert.equal(P.fold('Beyoncé'), 'beyonce');
  assert.equal(P.fold('JAŸ-Z'), 'jayz');
  assert.equal(P.fold('宇多田ヒカル'), '宇多田ヒカル');
  assert.equal(P.fold('The Beatles'), P.fold('Beatles'));
});
ok('lead artist: feat. splits, "&" and commas do not', () => {
  assert.equal(P.firstArtist('Daft Punk feat. Pharrell Williams'), 'Daft Punk');
  assert.equal(P.firstArtist('Simon & Garfunkel'), 'Simon & Garfunkel');
  assert.equal(P.firstArtist('Tyler, The Creator'), 'Tyler, The Creator');
  assert.equal(P.firstArtist('AC/DC'), 'AC/DC');
});
ok('pick: exact name, MusicBrainz country', () => {
  const r = P.pick([{ id: 'a', name: 'Drake', score: 100, country: 'CA' }, { id: 'b', name: 'Nick Drake', score: 87, country: 'GB' }], 'Drake', names);
  assert.equal(r.c, 'CA');
});
ok('pick: no exact name is no answer, not the nearest', () => {
  assert.equal(P.pick([{ id: 'b', name: 'Nick Drake', score: 95, country: 'GB' }], 'Drake', names), null);
});
ok('pick: an alias counts as the name', () => {
  assert.equal(P.pick([{ id: 'u', name: '宇多田ヒカル', score: 100, country: 'JP', aliases: [{ name: 'Hikaru Utada' }] }], 'Hikaru Utada', names).c, 'JP');
});
ok('pick: area that is a country is used when country is blank', () => {
  assert.equal(P.pick([{ id: 'a', name: 'X', score: 100, area: { type: 'Country', name: 'Japan' } }], 'X', names).c, 'JP');
  assert.equal(P.pick([{ id: 'a', name: 'X', score: 100, area: { type: 'City', name: 'Tokyo' } }], 'X', names).c, null);
});
ok('pick: two equal matches in two countries is ambiguous, never a coin toss', () => {
  const r = P.pick([{ id: 'a', name: 'Future', score: 100, country: 'US' }, { id: 'b', name: 'Future', score: 100, country: 'DE' }], 'Future', names);
  assert.ok(r.amb && r.amb.length === 2);
  // a clear winner is not ambiguous
  assert.equal(P.pick([{ id: 'a', name: 'Future', score: 100, country: 'US' }, { id: 'b', name: 'Future', score: 90, country: 'DE' }], 'Future', names).c, 'US');
});

const DAY = 864e5, T0 = Date.UTC(2024, 0, 10);
const A = {
  a1: { name: 'AM', artist: 'Arctic Monkeys', score: 90, genre: 'Rock', savedAt: T0 },
  a2: { name: 'Favourite Worst Nightmare', artist: 'Arctic Monkeys', score: 84, genre: 'Rock', savedAt: T0 + DAY },
  a3: { name: 'Blonde', artist: 'Frank Ocean', score: 95, genre: 'R&B', savedAt: Date.UTC(2025, 3, 1) },
  a4: { name: 'Homogenic', artist: 'Björk', score: 92, genre: 'Electronic', savedAt: Date.UTC(2026, 1, 1) },
  a5: { name: 'Mystery', artist: 'Nobody Knows', score: 60, savedAt: T0 },
  a6: { name: 'Pending', artist: 'Not Asked Yet', score: 70, savedAt: T0 }
};
const ORIG = { arcticmonkeys: 'GB', frankocean: 'US', bjork: 'IS', burnaboy: 'NG', nobodyknows: null };
const origin = name => { const k = P.fold(P.firstArtist(name)); return k in ORIG ? ORIG[k] : undefined; };
const geo = { GB: { n: 'United Kingdom', ct: 'Europe' }, US: { n: 'United States', ct: 'North America' }, IS: { n: 'Iceland', ct: 'Europe' }, NG: { n: 'Nigeria', ct: 'Africa' }, JP: { n: 'Japan', ct: 'Asia' } };
const listen = [{ artist: 'Burna Boy', track: 'Last Last', plays: 40, ms_played: 40 * 172000, first_played: '2025-06-01T10:00:00Z' }, { artist: 'Frank Ocean', track: 'Nikes', plays: 12, first_played: '2023-01-01T00:00:00Z' }];
const w = P.build({ albums: A, songs: {}, listen, origin, geo });

ok('countries, sources and continents', () => {
  assert.deepEqual(J(Object.keys(w.countries).sort()), ['GB', 'IS', 'NG', 'US']);
  assert.equal(w.countries.GB.src, 'rated');
  assert.equal(w.countries.NG.src, 'listened');
  assert.equal(w.countries.US.src, 'both');
  assert.deepEqual(J(Object.keys(w.continents).sort()), ['Africa', 'Europe', 'North America']);
});
ok('an unplaceable artist is unplaced, an unasked one is pending', () => {
  assert.deepEqual(J(w.unplaced.map(r => r.name)), ['Nobody Knows']);
  assert.deepEqual(J(w.pending.map(r => r.name)), ['Not Asked Yet']);
});
ok('first stamped is the earliest sign of an artist, including a play', () => {
  assert.equal(w.countries.US.when, Date.parse('2023-01-01T00:00:00Z'));
  assert.equal(w.list[0].cc, 'US');   // chronological
});
ok('love is shrunk: one 92 does not outrank two 87s from a big catalogue', () => {
  const f = P.favourites(w);
  assert.ok(f.loved.length === 1 && f.loved[0].cc === 'GB');      // only countries with 2+ rated
  assert.ok(w.countries.IS.love < w.countries.IS.avg);
});
ok('rare includes single-artist countries', () => {
  assert.ok(P.rare(w).some(c => c.cc === 'IS'));
});
ok('timeline puts new countries in the year they arrived', () => {
  const tl = P.timeline(w);
  const y2025 = tl.find(r => r.y === 2025);
  assert.ok(y2025.fresh.includes('NG'));
});
ok('recommendations skip countries you have and prefer a continent you know', () => {
  const recs = P.recommend(w, { GB: ['Radiohead'], NG: ['Wizkid'], JP: ['Cornelius'], IE: ['U2'] }, Object.assign({ IE: { n: 'Ireland', ct: 'Europe' } }, geo), 3);
  assert.ok(!recs.some(r => r.cc === 'GB' || r.cc === 'NG'));
  assert.equal(recs[0].near, true);
  assert.ok(recs.some(r => r.cc === 'JP'));
});
ok('genre spread needs 4 albums and 2 countries', () => {
  assert.equal(P.genreSpread(w).length, 0);
});

console.log(`passport.selfcheck: ${n} checks passed`);
