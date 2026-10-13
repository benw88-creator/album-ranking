// node scripts/replay.selfcheck.mjs
// Holds Replay's arithmetic to account: period edges across British Summer
// Time, UTC parsing of Spotify's two export shapes, duplicate-import dedupe,
// per-day folding, crate statistics as they stood at period end, and Music
// DNA thresholds. Runs in Europe/London so the DST cases are real.
process.env.TZ = 'Europe/London';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ctx = { globalThis: {} };
ctx.globalThis = ctx;
vm.runInNewContext(fs.readFileSync(path.join(here, '../assets/replay-core.js'), 'utf8'), ctx);
const R = ctx.ReplayCore;
const L = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
let n = 0; const ok = (name, fn) => { fn(); n++; };

ok('weeks start on Monday, local midnight, across the October DST change', () => {
  const w = R.period('week', L(2026, 10, 28, 12));          // a Wednesday; clocks went back Sun 25 Oct
  assert.equal(w.startDay, '2026-10-26');
  assert.equal(w.endDay, '2026-11-01');
  assert.equal(new Date(w.start).getHours(), 0);
  const spanning = R.period('week', L(2026, 10, 25, 12));   // the Sunday of the change
  assert.equal(spanning.startDay, '2026-10-19');
  assert.equal(spanning.end - spanning.start, 7 * 864e5 + 3600e3, 'the DST week is an hour longer');
  assert.equal(R.next(spanning).startDay, '2026-10-26');
});

ok('months and years are half-open and keyed stably', () => {
  const m = R.period('month', L(2026, 3, 31, 23, 59));
  assert.equal(m.key, 'm2026-03'); assert.equal(m.endDay, '2026-03-31');
  assert.equal(R.fromKey('m2026-03').start, m.start);
  assert.equal(R.prev(R.period('month', L(2026, 1, 15))).key, 'm2025-12');
  const y = R.period('year', L(2026, 6, 1));
  assert.ok(L(2026, 12, 31, 23, 59) < y.end && L(2027, 1, 1) === y.end);
  assert.equal(R.fromKey('w2026-10-26').key, 'w2026-10-26');
  assert.equal(R.buckets(y).length, 12);
  assert.equal(R.buckets(R.period('week', L(2026, 10, 28))).length, 7);
  const mb = R.buckets(R.period('month', L(2026, 2, 10)));   // Feb 2026 starts on a Sunday
  assert.equal(new Date(mb[0].start).getDate(), 1);
  assert.equal(mb[mb.length - 1].end, R.period('month', L(2026, 2, 10)).end);
});

ok('Spotify timestamps are UTC whichever export they came from', () => {
  assert.equal(R.parseUtc('2026-03-29 00:30'), Date.UTC(2026, 2, 29, 0, 30));
  assert.equal(R.parseUtc('2026-06-30T23:30:12Z'), Date.UTC(2026, 5, 30, 23, 30, 12));
  // 23:30 UTC on 30 June is 00:30 BST on 1 July: it belongs to July locally.
  assert.equal(R.dayKey(R.parseUtc('2026-06-30 23:30')), '2026-07-01');
  assert.ok(isNaN(R.parseUtc('')));
});

const keyOf = (a, t) => (a + '|' + t).toLowerCase();
ok('the same play in both export files is counted once', () => {
  const basic = { artist: 'Frank Ocean', track: 'Nikes', ms: 300000, at: R.parseUtc('2026-05-01 20:14') };
  const ext = { artist: 'Frank Ocean', track: 'Nikes', ms: 300000, at: R.parseUtc('2026-05-01T20:14:42Z') };
  const later = { artist: 'Frank Ocean', track: 'Nikes', ms: 300000, at: R.parseUtc('2026-05-01T20:20:01Z') };
  const noTime = { artist: 'Frank Ocean', track: 'Nikes', ms: 300000, at: null };
  const out = R.dedupe([basic, ext, later, noTime, noTime], keyOf);
  assert.equal(out.length, 4, 'one duplicate removed, timeless events kept');
});

ok('days fold per local date and track; re-folding the same events is identical', () => {
  const ev = [
    { artist: 'A', track: 'x', ms: 60000, at: R.parseUtc('2026-07-01T10:00:00Z') },
    { artist: 'A', track: 'x', ms: 60000, at: R.parseUtc('2026-07-01T12:00:00Z') },
    { artist: 'A', track: 'x', ms: 60000, at: R.parseUtc('2026-06-30T23:30:00Z') },   // local 1 July
    { artist: 'B', track: 'y', ms: 45000, at: R.parseUtc('2026-07-02T09:00:00Z') },
    { artist: 'B', track: 'y', ms: 45000, at: null }
  ];
  const rows = R.foldDays(ev, keyOf);
  assert.equal(rows.length, 2);
  const a = rows.find(r => r.k === 'a|x');
  assert.equal(a.day, '2026-07-01'); assert.equal(a.plays, 3); assert.equal(a.ms, 180000);
  assert.deepEqual(JSON.parse(JSON.stringify(R.foldDays(ev, keyOf))), JSON.parse(JSON.stringify(rows)));
});

// A small crate with history. Scores are recorded as of the period's end.
const t = (y, m, d) => L(y, m, d, 12);
const crate = {
  albums: {
    a1: { id: 'a1', name: 'Blonde', artist: 'Frank Ocean', genre: 'r&b', year: '2016', art: 'u1', score: 94,
          history: [{ s: 82, t: t(2025, 11, 3) }, { s: 94, t: t(2026, 3, 9) }] },
    a2: { id: 'a2', name: 'channel ORANGE', artist: 'Frank Ocean', genre: 'r&b', year: '2012', art: 'u2', score: 90,
          history: [{ s: 90, t: t(2026, 3, 2) }] },
    a3: { id: 'a3', name: 'IGOR', artist: 'Tyler, The Creator', genre: 'hip hop', year: '2019', art: 'u3', score: 70,
          history: [{ s: 88, t: t(2026, 3, 3) }, { s: 70, t: t(2026, 4, 20) }] },
    a4: { id: 'a4', name: 'Old', artist: 'Someone', score: 60, savedAt: t(2024, 1, 1) }          // pre-history record
  },
  songs: {
    s1: { id: 's1', name: 'Nikes', artist: 'Frank Ocean', albumId: 'a1', score: 9, history: [{ s: 9, t: t(2026, 3, 4) }] }
  },
  liked: {}
};
ok('crate stats for a month use the score as it stood at month end', () => {
  const mar = R.period('month', t(2026, 3, 15));
  const c = R.crateStats(crate, mar);
  assert.equal(c.albums, 2, 'channel ORANGE and IGOR were first rated in March');
  assert.equal(c.songs, 1);
  const igor = c.topAlbums.find(a => a.id === 'a3');
  assert.equal(igor.score, 88, 'the April re-rate does not leak back into March');
  assert.equal(c.rerates, 1, 'Blonde was re-rated in March');
  assert.equal(c.moves[0].id, 'a1'); assert.equal(c.moves[0].from, 82); assert.equal(c.moves[0].to, 94);
  assert.equal(c.topArtists[0].name, 'Frank Ocean');
  assert.equal(c.topArtists[0].n, 2, 'most RATED: one album and one song in March');
  assert.equal(c.discoveryCount, 1, 'Tyler first appears in March; Frank was already in the crate');
  assert.equal(c.discoveries[0].name, 'Tyler');
  assert.equal(c.streak, 3, '2, 3 and 4 March are consecutive');
  assert.deepEqual(JSON.parse(JSON.stringify(c.genres.map(g => g.name))), ['Hip-Hop', 'R&B']);
});

ok('April sees the change of mind on IGOR, and an empty month is empty', () => {
  const apr = R.crateStats(crate, R.period('month', t(2026, 4, 1)));
  assert.equal(apr.albums, 0); assert.equal(apr.moves[0].from, 88); assert.equal(apr.moves[0].to, 70);
  const may = R.crateStats(crate, R.period('month', t(2026, 5, 1)));
  assert.equal(may.albums + may.songs + may.rerates, 0);
  assert.equal(R.dna(may, null, R.period('month', t(2026, 5, 1))), null, 'no data, no personality');
});

ok('milestones count crossings inside the period, including legacy records', () => {
  const big = { albums: {}, songs: {}, liked: {} };
  for (let i = 0; i < 12; i++) big.albums['x' + i] = { id: 'x' + i, name: 'R' + i, artist: 'A' + i, score: 70, history: [{ s: 70, t: t(2026, 2, 1 + i) }] };
  const feb = R.crateStats(big, R.period('month', t(2026, 2, 1)));
  assert.ok(feb.milestones.some(m => m.kind === 'albums' && m.n === 10));
  assert.ok(feb.milestones.some(m => m.kind === 'albums' && m.n === 1));
  assert.ok(!R.crateStats(big, R.period('month', t(2026, 3, 1))).milestones.length);
});

ok('Music DNA needs evidence over a threshold and explains itself', () => {
  const y = R.period('year', t(2026, 1, 1));
  const diver = { albums: {}, songs: {}, liked: {} };
  for (let i = 0; i < 6; i++) diver.albums['d' + i] = { id: 'd' + i, name: 'R' + i, artist: 'Radiohead', genre: 'alternative', year: '1997', score: 85, history: [{ s: 85, t: t(2026, 1 + i, 3) }] };
  const c = R.crateStats(diver, y);
  const d = R.dna(c, null, y);
  assert.equal(d.primary.id, 'diver');
  assert.ok(d.primary.evidence[0].includes('6 records by Radiohead'));
  assert.ok(d.all.some(x => x.id === 'nostalgic'), '29-year-old median record also qualifies');
  // Loyal Listener only ever comes from listening data.
  assert.ok(!d.all.some(x => x.id === 'loyal'));
  const Ldata = { plays: 400, ms: 1000, top_artists: [{ artist: 'X', ms: 400 }, { artist: 'Y', ms: 200 }, { artist: 'Z', ms: 50 }, { artist: 'W', ms: 50 }, { artist: 'V', ms: 50 }] };
  assert.ok(R.dna(c, Ldata, y).all.some(x => x.id === 'loyal'));
  // A thin month gets the honest fallback, not an invented trait.
  const one = { albums: { o: { id: 'o', name: 'One', artist: 'Solo', score: 75, history: [{ s: 75, t: t(2026, 6, 6) }] } }, songs: {}, liked: {} };
  const jun = R.period('month', t(2026, 6, 1));
  const f = R.dna(R.crateStats(one, jun), null, jun);
  assert.equal(f.primary.id, 'curator'); assert.ok(f.primary.fallback);
});

ok('listening is usable only above a floor, and coverage says when it ends early', () => {
  const m = R.period('month', t(2026, 9, 1));
  assert.ok(!R.listeningUsable({ plays: 10 }, m));
  assert.ok(R.listeningUsable({ plays: 400 }, m));
  const cov = R.coverage({ data_from: '2025-01-01', data_to: '2026-09-14' }, m);
  assert.ok(cov.endsEarly && !cov.full && /14 Sep 2026/.test(cov.note));
  assert.ok(!R.listeningDiscoveriesValid({ data_from: '2026-08-20' }, m), 'an export starting just before the period cannot call anything new');
  assert.ok(R.listeningDiscoveriesValid({ data_from: '2025-01-01' }, m));
});

console.log(`replay selfcheck: ${n} groups passed`);
