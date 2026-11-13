// node scripts/rocketrun.selfcheck.mjs — RocketRun rules: daily sets and answer checks.
import assert from 'node:assert/strict';
import { questionsFor, evaluate, albumFacts, artistFacts, firstLetter, words, hasNumber, hasColour, dayNumber } from '../assets/rocketrun-rules.js';

// Every day for ten years builds five prompts with one or two artist prompts,
// rising tiers, no repeated template, and the same set every time it is asked.
const seen = {};
for (let d = dayNumber(Date.UTC(2026, 0, 1)); d < dayNumber(Date.UTC(2036, 0, 1)); d++) {
  const qs = questionsFor(d);
  assert.equal(qs.length, 5);
  assert.deepEqual(qs.map((q) => q.tier), [1, 1, 2, 2, 3]);
  assert.equal(new Set(qs.map((q) => q.tpl)).size, 5);
  const a = qs.filter((q) => q.kind === 'artist').length;
  assert.ok(a >= 1 && a <= 2, 'artist prompts ' + a);
  assert.deepEqual(qs, questionsFor(d));
  qs.forEach((q) => { seen[q.tpl] = (seen[q.tpl] || 0) + 1; });
}
assert.ok(Object.keys(seen).length >= 18, 'templates used: ' + Object.keys(seen).join(','));
assert.notDeepEqual(questionsFor(3000), questionsFor(3001));

// Shapes copied from real MusicBrainz responses.
const ok = albumFacts({ id: 'b1392450-e666-3926-a536-22c65f834433', title: 'OK Computer', 'primary-type': 'Album', 'secondary-types': [], 'first-release-date': '1997-05-21', 'artist-credit': [{ name: 'Radiohead', joinphrase: '', artist: { id: 'a74b', name: 'Radiohead', type: 'Group', country: 'GB' } }], rating: { 'votes-count': 89 } });
const Q = (kind, conds) => ({ kind, conds });
assert.equal(ok.year, 1997); assert.equal(ok.credit, 'Radiohead'); assert.equal(ok.votes, 89);
assert.equal(evaluate(Q('album', [['year', 1997]]), ok).ok, true);
assert.equal(evaluate(Q('album', [['between', 1990, 1999], ['starts', 'O']]), ok).ok, true);
assert.equal(evaluate(Q('album', [['byCountry', 'GB']]), ok).ok, true);
assert.equal(evaluate(Q('album', [['byCountry', 'US']]), ok).ok, false);
assert.equal(evaluate(Q('album', [['byGroup']]), ok).ok, true);
assert.equal(evaluate(Q('album', [['bySolo']]), ok).ok, false);
assert.equal(evaluate(Q('album', [['words', 2]]), ok).ok, true);
assert.match(evaluate(Q('album', [['year', 2016]]), ok).why, /1997/);
assert.equal(evaluate(Q('artist', [['starts', 'R']]), ok).ok, false, 'an album is not an artist');

const comp = albumFacts({ id: 'x', title: 'Greatest Hits', 'primary-type': 'Album', 'secondary-types': ['Compilation'], 'first-release-date': '1981', 'artist-credit': [] });
assert.equal(evaluate(Q('album', [['before', 1990]]), comp).ok, false);
const live = albumFacts({ id: 'x', title: 'At Fillmore East', 'primary-type': 'Album', 'secondary-types': ['Live'], 'first-release-date': '1971-07', 'artist-credit': [{ name: 'The Allman Brothers Band', artist: { id: 'y', name: 'The Allman Brothers Band', type: 'Group', country: 'US' } }] });
assert.equal(evaluate(Q('album', [['live'], ['between', 1970, 1979]]), live).ok, true);
assert.equal(evaluate(Q('album', [['live']]), ok).ok, false);
const single = albumFacts({ id: 'x', title: 'Hey Jude', 'primary-type': 'Single', 'first-release-date': '1968', 'artist-credit': [] });
assert.equal(evaluate(Q('album', [['year', 1968]]), single).ok, false);

// Unknown is not wrong.
const undated = albumFacts({ id: 'x', title: 'Demo Tape', 'primary-type': 'Album', 'artist-credit': [{ name: 'Z', artist: { id: 'z', name: 'Z' } }] });
assert.equal(evaluate(Q('album', [['year', 2001]]), undated).ok, null);
assert.equal(evaluate(Q('album', [['byCountry', 'GB']]), undated).ok, null);
// A duet counts if either credited artist fits.
const duet = albumFacts({ id: 'x', title: 'Watch the Throne', 'primary-type': 'Album', 'first-release-date': '2011-08-08', 'artist-credit': [{ name: 'JAY-Z', joinphrase: ' & ', artist: { id: '1', name: 'JAY-Z', type: 'Person', country: 'US' } }, { name: 'Kanye West', artist: { id: '2', name: 'Kanye West', type: 'Person', country: null } }] });
assert.equal(duet.credit, 'JAY-Z & Kanye West');
assert.equal(evaluate(Q('album', [['byCountry', 'US']]), duet).ok, true);
assert.equal(evaluate(Q('album', [['byCountry', 'GB']]), duet).ok, null);

// Titles.
assert.equal(firstLetter('The Wall'), 'W'); assert.equal(firstLetter('A Night at the Opera'), 'N');
assert.equal(firstLetter('An Awesome Wave'), 'A'); assert.equal(firstLetter('Theatre Is Evil'), 'T');
assert.equal(firstLetter('“Heroes”'), 'H'); assert.equal(firstLetter('÷'), '');
assert.equal(words('22, A Million').length, 3); assert.equal(words('Sgt. Pepper’s Lonely Hearts Club Band').length, 6);
assert.equal(words("Don't Kill the Magic").length, 4);
assert.ok(hasNumber('1989')); assert.ok(hasNumber('Seven Swans')); assert.ok(!hasNumber('Someone New'));
assert.ok(hasColour('Kind of Blue')); assert.ok(!hasColour('Blonde')); assert.ok(!hasColour('Reddish Fog'));
assert.equal(evaluate(Q('album', [['selfTitled']]), albumFacts({ title: 'Weezer', 'primary-type': 'Album', 'artist-credit': [{ name: 'Weezer', artist: { id: 'w', name: 'Weezer' } }] })).ok, true);
assert.equal(evaluate(Q('album', [['selfTitled']]), albumFacts({ title: 'Björk', 'primary-type': 'Album', 'artist-credit': [{ name: 'Bjork', artist: { id: 'b', name: 'Björk' } }] })).ok, true);

// Artists: aliases count, articles do not, country from area codes.
const mos = artistFacts({ id: 'm', name: 'Yasiin Bey', type: 'Person', country: 'US', aliases: [{ name: 'Mos Def', type: 'Artist name' }, { name: 'mos def x', type: 'Search hint' }], 'life-span': { begin: '1973-12-11' } });
assert.equal(evaluate(Q('artist', [['starts', 'M']]), mos).ok, true);
assert.equal(evaluate(Q('artist', [['starts', 'Y']]), mos).ok, true);
assert.equal(evaluate(Q('artist', [['person']]), mos).ok, true);
const beatles = artistFacts({ id: 'b', name: 'The Beatles', type: 'Group', area: { 'iso-3166-2-codes': ['GB-ENG'] }, 'life-span': { begin: '1960' } });
assert.equal(beatles.country, 'GB');
assert.equal(evaluate(Q('artist', [['starts', 'B']]), beatles).ok, true);
assert.equal(evaluate(Q('artist', [['group'], ['formed', 1960, 1969]]), beatles).ok, true);
assert.equal(evaluate(Q('artist', [['formed', 1970, 1979]]), beatles).ok, false);
const nowhere = artistFacts({ id: 'n', name: 'Nobody', area: { name: 'Manchester' } });
assert.equal(evaluate(Q('artist', [['country', 'GB']]), nowhere).ok, null);

console.log('rocketrun.selfcheck: ok (' + Object.keys(seen).length + ' templates in rotation)');
