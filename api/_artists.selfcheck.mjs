// node api/_artists.selfcheck.mjs — the smallest thing that fails if the
// release/artist classification breaks. No framework on purpose.
import assert from 'node:assert/strict';
import { dedupeReleases, classifyRelease, rankArtists, rankTracks } from './_artists.js';

const rel = [
  { id: 1, title: 'Sweet Boy',        release_date: '2024-04-05', record_type: 'album', nb_tracks: 16, duration: 2700 },
  { id: 2, title: 'Sweet Boy Pt. 2',  release_date: '2024-03-08', record_type: 'ep',    nb_tracks: 5,  duration: 780 },
  { id: 3, title: 'Sweet Boy Pt. 1',  release_date: '2024-02-02', record_type: 'ep',    nb_tracks: 5,  duration: 900 },
  { id: 4, title: 'Demos Before Prom',release_date: '2022-05-15', record_type: 'ep',    nb_tracks: 6,  duration: 660 },
  { id: 5, title: 'Rodeo',            release_date: '2015-01-01', record_type: 'album', nb_tracks: 14, duration: 3600 },
  { id: 6, title: 'Rodeo 2',          release_date: '2018-01-01', record_type: 'album', nb_tracks: 14, duration: 3600 },
  { id: 7, title: 'Utopia Pt. 2',     release_date: '2020-01-01', record_type: 'album', nb_tracks: 12, duration: 3000 },
];
const kept = dedupeReleases(rel).releases.map(r => r.title);
// The parts fold into the whole; a part with no whole beside it stays; and
// "Rodeo 2" is a different record from "Rodeo".
assert.deepEqual(kept, ['Sweet Boy', 'Demos Before Prom', 'Rodeo', 'Rodeo 2', 'Utopia Pt. 2']);

// "Demos" at the front of a title is a word; at the end it is a pressing.
assert.equal(classifyRelease(rel[3]).kind, 'ep');
assert.equal(classifyRelease({ title: 'The Basement Demos', nb_tracks: 10, duration: 2000 }).kind, 'other');

// Two artists named Drake: the one with the audience wins, and a search box
// never loses a result it merely did not match.
const ranked = rankArtists(
  [{ id: 1, name: 'Drake', nb_fan: 395 }, { id: 2, name: 'Drake', nb_fan: 29e6 },
   { id: 3, name: 'Drake Bell', nb_fan: 5000 }, { id: 4, name: 'Nick Drake', nb_fan: 9e5 }],
  'drake', { keepAll: true });
assert.equal(ranked[0].artist.nb_fan, 29e6);
assert.equal(ranked.length, 3);

// Song search: "Fancy" — Deezer leads with Iggy Azalea on track rank alone;
// the title ties, so the artist with seven times the audience wins. A slowed
// edit sits under the originals, and a song that merely contains the word
// sits under every exact title.
const fancy = [
  { title: 'Fancy', artist: { id: 1, name: 'Iggy Azalea' }, rank: 730046 },
  { title: 'Fancy', artist: { id: 2, name: 'Drake' }, rank: 636246 },
  { title: 'FANCY (Slowed)', title_short: 'FANCY', artist: { id: 5, name: 'Xlout' }, rank: 904018 },
  { title: 'Fancy Footwork', artist: { id: 3, name: 'Chromeo' }, rank: 900848 },
  { title: 'FANCY', artist: { id: 4, name: 'TWICE' }, rank: 597094 },
];
const fans = { 1: 3403143, 2: 24098041, 3: 400000, 4: 1357378, 5: 1022 };
assert.deepEqual(rankTracks(fancy, 'Fancy', fans).map(t => t.artist.name), ['Drake', 'Iggy Azalea', 'TWICE', 'Xlout', 'Chromeo']);
// Typing the artist too is still an exact answer.
assert.equal(rankTracks(fancy, 'fancy iggy azalea', fans)[0].artist.name, 'Iggy Azalea');
// No audiences known: it still ranks, on the tracks alone.
assert.equal(rankTracks(fancy, 'fancy')[0].artist.name, 'Iggy Azalea');

console.log('ok');
