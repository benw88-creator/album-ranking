/* RocketRun rules — one file for the game (browser module) and /api/rocketrun.
 *
 * Every prompt is a list of conditions over MusicBrainz facts (CC0 core data):
 * release-group title, primary/secondary type, first-release-date and the
 * credited artists' type and country; for artist prompts the artist's name,
 * "Artist name" aliases, type, country and begin date. Nothing subjective
 * (cover colours, genres, "best") is ever asked, because nothing here could
 * check it.
 *
 * evaluate() answers true / false / null. null means MusicBrainz does not say
 * (no release date, no country) and is never scored as wrong.
 *
 * The server evaluates with fresh lookups and is the only judge; the browser
 * runs the same function on search results to say "doesn't fit" instantly.
 * Rarity, grades and distance are decided in SQL (rr_submit), not here.
 */

export const EPOCH = Date.UTC(2020, 0, 1);
// Same numbering as Boards.day() and game_bests.day, but on the UTC calendar:
// the server owns the day, so everybody in every zone plays the same five.
export function dayNumber(ms = Date.now()) { return Math.floor((ms - EPOCH) / 86400000); }
export function dayLabel(day) {
  return new Date(EPOCH + day * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function fold(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[‘’ʼ`]/g, "'").replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ß/g, 'ss');
}
export function squash(s) { return fold(s).replace(/&/g, 'and').replace(/[^a-z0-9]/g, ''); }
// Words as a person would count them: "OK Computer" 2, "22, A Million" 3, "÷" 0.
export function words(s) { return fold(s).replace(/['.]/g, '').split(/[^a-z0-9]+/).filter(Boolean); }
const ARTICLE = /^(the|a|an)\s+/;
// "The Wall" starts with W; said so in every starts-with prompt.
export function firstLetter(s) {
  const t = fold(s).trim().replace(ARTICLE, '').replace(/^[^a-z0-9]+/, '');
  return t.charAt(0).toUpperCase();
}

const NUMBER_WORDS = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million'.split(' ');
export const COLOURS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'violet', 'indigo', 'pink', 'black', 'white', 'grey', 'gray', 'brown', 'gold', 'silver', 'scarlet', 'crimson'];
export function hasNumber(t) { return /\d/.test(t) || words(t).some((w) => NUMBER_WORDS.includes(w)); }
export function hasColour(t) { return words(t).some((w) => COLOURS.includes(w)); }

// Compilations are not albums for this game; live, soundtrack, remix and
// mixtape albums are. Every album prompt's hint says so.
const NOT_ALBUM = ['Compilation', 'DJ-mix', 'Interview', 'Audiobook', 'Audio drama', 'Spokenword', 'Field recording', 'Demo'];
export function isAlbum(f) { return f && f.type === 'Album' && !(f.secondary || []).some((s) => NOT_ALBUM.includes(s)); }

export const COUNTRIES = {
  GB: 'the UK', US: 'the US', CA: 'Canada', AU: 'Australia', IE: 'Ireland', FR: 'France', DE: 'Germany',
  SE: 'Sweden', JP: 'Japan', JM: 'Jamaica', IS: 'Iceland', NG: 'Nigeria', NZ: 'New Zealand', NO: 'Norway',
  KR: 'South Korea', BR: 'Brazil', IT: 'Italy', NL: 'the Netherlands', ZA: 'South Africa', MX: 'Mexico'
};

/* ---- facts ---------------------------------------------------------------- */

function year(d) { const m = /^(\d{4})/.exec(d || ''); return m ? +m[1] : null; }
function artistBits(a) {
  return { id: a.id, name: a.name, type: a.type || null, country: a.country || null };
}
// A release-group from search or lookup (inc=artist-credits+ratings).
export function albumFacts(rg) {
  const ac = rg['artist-credit'] || [];
  return {
    kind: 'album', id: rg.id, title: rg.title,
    type: rg['primary-type'] || null, secondary: rg['secondary-types'] || [],
    year: year(rg['first-release-date']),
    credit: ac.map((c) => (c.name || (c.artist && c.artist.name) || '') + (c.joinphrase || '')).join('').trim(),
    artists: ac.filter((c) => c.artist).map((c) => artistBits(c.artist)),
    votes: rg.rating && rg.rating['votes-count'] != null ? rg.rating['votes-count'] : null,
    releases: rg.count != null ? rg.count : null
  };
}
function countryOf(a) {
  if (a.country) return a.country;
  const ar = a.area || {};
  if ((ar['iso-3166-1-codes'] || [])[0]) return ar['iso-3166-1-codes'][0];
  const sub = (ar['iso-3166-2-codes'] || [])[0];
  return sub ? sub.slice(0, 2) : null;
}
// An artist from search or lookup (inc=aliases+ratings).
export function artistFacts(a) {
  const ls = a['life-span'] || {};
  return {
    kind: 'artist', id: a.id, name: a.name, type: a.type || null, country: countryOf(a),
    begin: year(ls.begin), disambiguation: a.disambiguation || '',
    aliases: (a.aliases || []).filter((x) => x.type === 'Artist name' || x.primary).map((x) => x.name).slice(0, 12),
    votes: a.rating && a.rating['votes-count'] != null ? a.rating['votes-count'] : null
  };
}

/* ---- conditions ------------------------------------------------------------ */

const DECADE = (d) => `the ${d}s`;
function names(f) { return [f.name, ...(f.aliases || [])]; }
// A credited artist settles it if ANY credited artist meets it (a duet with a
// British singer is "by an artist from the UK"). Unknown only if nobody is known.
function anyArtist(f, test) {
  const as = f.artists || [];
  let unknown = false;
  for (const a of as) { const r = test(a); if (r === true) return true; if (r == null) unknown = true; }
  return unknown || !as.length ? null : false;
}

const OPS = {
  album: { test: (f) => isAlbum(f), why: () => 'isn’t an album (compilations and singles don’t count)' },
  year: { test: (f, [y]) => (f.year == null ? null : f.year === y), why: (f) => `came out in ${f.year}` },
  between: { test: (f, [a, b]) => (f.year == null ? null : f.year >= a && f.year <= b), why: (f) => `came out in ${f.year}` },
  before: { test: (f, [y]) => (f.year == null ? null : f.year < y), why: (f) => `came out in ${f.year}` },
  after: { test: (f, [y]) => (f.year == null ? null : f.year > y), why: (f) => `came out in ${f.year}` },
  starts: { test: (f, [l]) => firstLetter(f.kind === 'album' ? f.title : f.name) === l || (f.kind === 'artist' && (f.aliases || []).some((n) => firstLetter(n) === l)), why: (f) => `starts with ${firstLetter(f.kind === 'album' ? f.title : f.name) || 'a symbol'}` },
  words: { test: (f, [n]) => (f.kind === 'album' ? words(f.title).length === n : names(f).some((x) => words(x).length === n)), why: (f) => { const n = words(f.kind === 'album' ? f.title : f.name).length; return `has ${n} word${n === 1 ? '' : 's'}`; } },
  number: { test: (f) => (f.kind === 'album' ? hasNumber(f.title) : names(f).some(hasNumber)), why: () => 'has no number in it' },
  colour: { test: (f) => hasColour(f.title), why: () => 'has no colour word in it' },
  selfTitled: { test: (f) => (f.artists || []).some((a) => squash(a.name) === squash(f.title)), why: () => 'isn’t named after its artist' },
  live: { test: (f) => (f.secondary || []).includes('Live'), why: () => 'isn’t a live album' },
  byCountry: { test: (f, [c]) => anyArtist(f, (a) => (a.country ? a.country === c : null)), why: (f) => { const c = (f.artists || []).map((a) => a.country).filter(Boolean)[0]; return c ? `is by an artist from ${COUNTRIES[c] || c}` : 'has no country on MusicBrainz'; } },
  byGroup: { test: (f) => anyArtist(f, (a) => (a.type ? a.type === 'Group' : null)), why: () => 'is by a solo artist' },
  bySolo: { test: (f) => anyArtist(f, (a) => (a.type ? a.type === 'Person' : null)), why: () => 'is by a band' },
  country: { test: (f, [c]) => (f.country ? f.country === c : null), why: (f) => `is from ${COUNTRIES[f.country] || f.country}` },
  group: { test: (f) => (f.type ? f.type === 'Group' : null), why: () => 'isn’t a band' },
  person: { test: (f) => (f.type ? f.type === 'Person' : null), why: () => 'is a band, not a solo artist' },
  formed: { test: (f, [a, b]) => (f.begin == null ? null : f.begin >= a && f.begin <= b), why: (f) => `started in ${f.begin}` }
};
const UNKNOWN = {
  year: 'MusicBrainz has no release date for it', between: 'MusicBrainz has no release date for it',
  before: 'MusicBrainz has no release date for it', after: 'MusicBrainz has no release date for it',
  byCountry: 'MusicBrainz doesn’t say where its artist is from', country: 'MusicBrainz doesn’t say where they’re from',
  byGroup: 'MusicBrainz doesn’t say whether it’s a band', bySolo: 'MusicBrainz doesn’t say whether it’s a band',
  group: 'MusicBrainz doesn’t say whether they’re a band', person: 'MusicBrainz doesn’t say whether they’re a band',
  formed: 'MusicBrainz has no start date for them'
};

// -> { ok: true|false|null, why }  (why is a phrase about the answer)
export function evaluate(q, f) {
  if (!f || f.kind !== q.kind) return { ok: false, why: q.kind === 'album' ? 'isn’t an album' : 'isn’t an artist' };
  const conds = q.kind === 'album' ? [['album'], ...q.conds] : q.conds;
  let unknown = null;
  for (const [op, ...args] of conds) {
    const r = OPS[op].test(f, args);
    if (r === false) return { ok: false, why: OPS[op].why(f, args) };
    if (r == null && !unknown) unknown = UNKNOWN[op] || 'MusicBrainz can’t confirm it';
  }
  return unknown ? { ok: null, why: unknown } : { ok: true, why: '' };
}

/* ---- the daily five ---------------------------------------------------------- */

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const EASY_L = 'ABCDLMPRST'.split('');
const MID_L = 'BCDFGHLMNPRSTW'.split('');
const BIG_C = ['GB', 'US', 'CA', 'AU', 'SE', 'IE', 'FR', 'DE', 'JP', 'JM'];
const SMALL_C = ['IS', 'NG', 'NZ', 'NO', 'KR', 'BR', 'IT', 'NL', 'ZA', 'MX'];
const ALBUM_HINT = 'Studio, live and soundtrack albums count. Compilations don’t.';
const LETTER_HINT = '“The”, “A” and “An” at the start don’t count.';

// Each template: tier 1 (huge answer pool) to 3 (narrower, still thousands).
const TEMPLATES = [
  { id: 'year', tier: 1, kind: 'album', make: (r) => { const y = 1967 + Math.floor(r() * 57); return { text: `Name an album first released in ${y}.`, hint: ALBUM_HINT, conds: [['year', y]] }; } },
  { id: 'decade', tier: 1, kind: 'album', make: (r) => { const d = pick(r, [1960, 1970, 1980, 1990, 2000, 2010]); return { text: `Name an album from ${DECADE(d)}.`, hint: ALBUM_HINT, conds: [['between', d, d + 9]] }; } },
  { id: 'oneword', tier: 1, kind: 'album', make: () => ({ text: 'Name an album with a one-word title.', hint: 'Numbers count as words. ' + ALBUM_HINT, conds: [['words', 1]] }) },
  { id: 'aletter', tier: 1, kind: 'artist', make: (r) => { const l = pick(r, EASY_L); return { text: `Name an artist whose name starts with ${l}.`, hint: LETTER_HINT + ' Solo artists and bands both count.', conds: [['starts', l]] }; } },
  { id: 'band', tier: 1, kind: 'album', make: () => ({ text: 'Name an album by a band.', hint: 'A group, not a solo artist. ' + ALBUM_HINT, conds: [['byGroup']] }) },
  { id: 'before', tier: 2, kind: 'album', make: (r) => { const y = pick(r, [1975, 1980, 1985]); return { text: `Name an album released before ${y}.`, hint: ALBUM_HINT, conds: [['before', y]] }; } },
  { id: 'tletter', tier: 2, kind: 'album', make: (r) => { const l = pick(r, MID_L); return { text: `Name an album whose title starts with ${l}.`, hint: LETTER_HINT + ' ' + ALBUM_HINT, conds: [['starts', l]] }; } },
  { id: 'colour', tier: 2, kind: 'album', make: () => ({ text: 'Name an album with a colour in its title.', hint: 'The word itself: red, blue, black, white, gold, grey… ' + ALBUM_HINT, conds: [['colour']] }) },
  { id: 'self', tier: 2, kind: 'album', make: () => ({ text: 'Name a self-titled album.', hint: 'The title is the artist’s own name. ' + ALBUM_HINT, conds: [['selfTitled']] }) },
  { id: 'number', tier: 2, kind: 'album', make: () => ({ text: 'Name an album with a number in its title.', hint: 'Digits or words: 21, Seven, A Hundred… ' + ALBUM_HINT, conds: [['number']] }) },
  { id: 'acountry', tier: 2, kind: 'album', make: (r) => { const c = pick(r, BIG_C); return { text: `Name an album by an artist from ${COUNTRIES[c]}.`, hint: 'Where MusicBrainz says the artist is from. ' + ALBUM_HINT, conds: [['byCountry', c]] }; } },
  { id: 'arcountry', tier: 2, kind: 'artist', make: (r) => { const c = pick(r, BIG_C); return { text: `Name an artist from ${COUNTRIES[c]}.`, hint: 'Solo artists and bands both count.', conds: [['country', c]] }; } },
  { id: 'formed', tier: 2, kind: 'artist', make: (r) => { const d = pick(r, [1960, 1970, 1980, 1990, 2000]); return { text: `Name a band that formed in ${DECADE(d)}.`, hint: 'A group, not a solo artist, going by when MusicBrainz says it began.', conds: [['group'], ['formed', d, d + 9]] }; } },
  { id: 'decletter', tier: 3, kind: 'album', make: (r) => { const d = pick(r, [1970, 1980, 1990, 2000, 2010]); const l = pick(r, 'BCDLMPST'.split('')); return { text: `Name an album from ${DECADE(d)} whose title starts with ${l}.`, hint: LETTER_HINT + ' ' + ALBUM_HINT, conds: [['between', d, d + 9], ['starts', l]] }; } },
  { id: 'live', tier: 3, kind: 'album', make: (r) => { const d = pick(r, [1960, 1970, 1980, 1990]); return { text: `Name a live album from ${DECADE(d)}.`, hint: 'Recorded in front of an audience, going by MusicBrainz.', conds: [['live'], ['between', d, d + 9]] }; } },
  { id: 'smallcountry', tier: 3, kind: 'album', make: (r) => { const c = pick(r, SMALL_C); return { text: `Name an album by an artist from ${COUNTRIES[c]}.`, hint: 'Where MusicBrainz says the artist is from. ' + ALBUM_HINT, conds: [['byCountry', c]] }; } },
  { id: 'threewords', tier: 3, kind: 'album', make: (r) => { const d = pick(r, [1970, 1980, 1990, 2000, 2010]); return { text: `Name an album from ${DECADE(d)} with exactly three words in its title.`, hint: ALBUM_HINT, conds: [['between', d, d + 9], ['words', 3]] }; } },
  { id: 'soloafter', tier: 3, kind: 'album', make: (r) => { const y = pick(r, [1995, 2005, 2015]); return { text: `Name an album by a solo artist released after ${y}.`, hint: 'One person, not a band. ' + ALBUM_HINT, conds: [['bySolo'], ['after', y]] }; } },
  { id: 'colourold', tier: 3, kind: 'album', make: () => ({ text: 'Name an album released before 1990 with a colour in its title.', hint: 'The word itself: red, blue, black, white, gold, grey…', conds: [['before', 1990], ['colour']] }) },
  { id: 'countryletter', tier: 3, kind: 'artist', make: (r) => { const c = pick(r, ['GB', 'US']); const l = pick(r, MID_L); return { text: `Name an artist from ${COUNTRIES[c]} whose name starts with ${l}.`, hint: LETTER_HINT, conds: [['country', c], ['starts', l]] }; } }
];

export const VERSION = 1;
// Five prompts, easy to hard, never the same template twice, at least one
// artist prompt and at least three album prompts.
export function questionsFor(day) {
  const r = rng(day * 2654435761 + 7);
  const tiers = [1, 1, 2, 2, 3];
  for (let attempt = 0; attempt < 50; attempt++) {
    const used = new Set();
    const out = tiers.map((t) => {
      const pool = TEMPLATES.filter((x) => x.tier === t && !used.has(x.id));
      const tpl = pick(r, pool); used.add(tpl.id);
      return { tpl: tpl.id, tier: t, kind: tpl.kind, ...tpl.make(r) };
    });
    const artists = out.filter((q) => q.kind === 'artist').length;
    const both = (a, b) => used.has(a) && used.has(b);
    if (artists >= 1 && artists <= 2 && !both('year', 'decade') && !both('colour', 'colourold')) return out;
  }
  throw new Error('questionsFor: no valid set');
}

/* ---- display only ---------------------------------------------------------- */
// Gains MIRROR rr_grade() in supabase/migrations/*_rocketrun.sql: the server
// decides grade and distance; these are for the help sheet and the reveal.
export const GRADES = [
  { name: 'BASIC', color: '#d8d3e8', gain: 500, power: 0.28 },
  { name: 'UNCOMMON', color: '#9de279', gain: 1200, power: 0.45 },
  { name: 'RARE', color: '#e599ff', gain: 2500, power: 0.65 },
  { name: 'LEGENDARY', color: '#ffd17d', gain: 5000, power: 0.85 },
  { name: 'IMPOSSIBLE', color: '#ff9be4', gain: 9000, power: 1 }
];
