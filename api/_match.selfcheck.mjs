// node api/_match.selfcheck.mjs — the Spotify→Deezer judgement, on cases
// that look alike and are not, and cases that look different and are.
import assert from 'node:assert/strict';
import { base, versionsOf, scoreTrack, scoreAlbum, decide } from './_match.js';

const T = (title, artist, album, rank = 500000) => ({ id: title + artist + album, title, artist: { name: artist }, album: { title: album }, rank });

// Edition noise folds away; features and versions are recognised.
assert.equal(base('Nikes - 2016 Remaster'), 'nikes');
assert.equal(base('Dreams (2004 Remaster)'), 'dreams');
assert.equal(base('Sicko Mode (feat. Drake)'), 'sicko mode');
assert.equal(base('One Dance (Explicit)'), 'one dance');
assert.deepEqual(versionsOf('Blinding Lights - Live'), ['live']);
assert.deepEqual(versionsOf('Blinding Lights'), []);

// Spotify title vs Deezer title for the same recording → a clear match.
const want = { a: 'Fleetwood Mac', t: 'Dreams - 2004 Remaster', b: 'Rumours (Super Deluxe)' };
let d = decide([T('Dreams', 'Fleetwood Mac', 'Rumours'), T('Dreams (Live)', 'Fleetwood Mac', 'The Dance'), T('Dreams', 'The Cranberries', 'Everybody Else')]
  .map((c) => ({ c, s: scoreTrack(want, c) })));
assert.equal(d.status, 'ok'); assert.equal(d.best.album.title, 'Rumours');

// A live cut is NOT the studio track, however close the words.
d = decide([T('Blinding Lights (Live)', 'The Weeknd', 'Live at SoFi')].map((c) => ({ c, s: scoreTrack({ a: 'The Weeknd', t: 'Blinding Lights', b: 'After Hours' }, c) })));
assert.notEqual(d.status, 'ok');

// A cover by somebody else is never a match.
d = decide([T('Nikes', 'Some Tribute Band', 'Ocean Covers')].map((c) => ({ c, s: scoreTrack({ a: 'Frank Ocean', t: 'Nikes', b: 'Blonde' }, c) })));
assert.equal(d.status, 'none');

// Features: Spotify credits the primary artist; Deezer may list it in the title.
d = decide([T('SICKO MODE', 'Travis Scott', 'ASTROWORLD')].map((c) => ({ c, s: scoreTrack({ a: 'Travis Scott', t: 'SICKO MODE', b: 'ASTROWORLD' }, c) })));
assert.equal(d.status, 'ok');

// Two different songs with the same title by the same artist and no album
// to break the tie → ask, don't guess.
d = decide([T('Intro', 'The xx', 'xx'), T('Intro', 'The xx', 'I See You')].map((c) => ({ c, s: scoreTrack({ a: 'The xx', t: 'Intro', b: 'Something Else' }, c) })));
assert.equal(d.status, 'check');

// The same song on an album and its deluxe edition is one answer, not a tie.
d = decide([T('Dreams', 'Fleetwood Mac', 'Rumours'), T('Dreams - 2004 Remaster', 'Fleetwood Mac', 'Rumours (Super Deluxe)')].map((c) => ({ c, s: scoreTrack({ a: 'Fleetwood Mac', t: 'Dreams', b: 'Rumours' }, c) })));
assert.equal(d.status, 'ok');

// A named alternate take is a different recording; "(Single Version)" is not.
assert.ok(versionsOf('Come As You Are (Boom Box Version)').includes('variant'));
assert.ok(versionsOf('Come As You Are (Devonshire Mix)').includes('variant'));
assert.deepEqual(versionsOf('Come As You Are (Single Version)'), []);
assert.deepEqual(versionsOf('Dreams - 2004 Remaster'), []);
d = decide([T('Come As You Are', 'Nirvana', 'Nevermind (Remastered)'), T('Come As You Are (Boom Box Version)', 'Nirvana', 'Sliver - The Best Of The Box')]
  .map((c) => ({ c, s: scoreTrack({ a: 'Nirvana', t: 'Come As You Are', b: 'Nevermind' }, c) })));
assert.equal(d.status, 'ok'); assert.equal(d.best.album.title, 'Nevermind (Remastered)');

// A cover that names the original artist in its title is still a cover.
assert.ok(scoreTrack({ a: 'Beyoncé', t: 'Halo', b: 'I AM...SASHA FIERCE' }, T('Halo (Beyoncé Cover)', 'Veneno', 'Veneno - EP')) < 55);

// Accents fold, never strip.
assert.equal(scoreTrack({ a: 'Beyoncé', t: 'HOLD UP', b: 'Lemonade' }, T('HOLD UP', 'Beyonce', 'Lemonade')), 95);

// Albums: deluxe folds into the record; a different record by the artist does not.
assert.ok(scoreAlbum({ a: 'Kendrick Lamar', b: 'good kid, m.A.A.d city (Deluxe)' }, { title: 'good kid, m.A.A.d city', artist: { name: 'Kendrick Lamar' } }) >= 90);
assert.ok(scoreAlbum({ a: 'Kendrick Lamar', b: 'DAMN.' }, { title: 'DAMN. COLLECTORS EDITION.', artist: { name: 'Kendrick Lamar' } }) >= 55);
assert.ok(scoreAlbum({ a: 'Kendrick Lamar', b: 'DAMN.' }, { title: 'Mr. Morale & The Big Steppers', artist: { name: 'Kendrick Lamar' } }) < 55);

console.log('ok');
