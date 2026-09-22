// api/_artists.js — artist identity and release classification for Deezer data.
//
// A reusable module rather than a patch in the route, because new artist data
// keeps flowing through here: the Completion list, the artist hero, the
// recommendation seeds and the minigame pools all ask Deezer "who is this" and
// "what did they release", and every one of them was answering those questions
// differently or not at all.
//
// ============================================================================
// PROBLEM 1 — TWO ARTISTS, ONE NAME, AND WHOEVER CAME BACK FIRST WON
// ============================================================================
// Deezer files more than one artist under the same exact string. Measured:
//
//   /search/artist?q=Steve Lacy
//     13158489  "Steve Lacy"            395 fans     23 albums
//        65574  "Steve Lacy"        277,980 fans     24 albums
//      1202284  "Steve Lacy Quartet"     16 fans      2 albums
//
// Both of the first two are an exact match on the name. The route resolved a
// name with `.find(x => loose(x.name) === want)` — first hit wins — so it took
// the 395-fan entry, and every discography, hero image and completion list
// built from it belonged to a different musician. The client never saw an
// error: it got a perfectly valid artist with perfectly valid albums, none of
// which were the ones somebody had rated.
//
// The fix is to RANK rather than to find. An exact normalised match beats a
// prefix beats a substring, and among equals the one with the audience wins —
// `nb_fan` separates the canonical entry from a duplicate by three orders of
// magnitude and is the only field on a search result that carries that signal.
//
// **Ids are matched first and names only as a fallback**, because a name match
// is a guess and an id is not. Two rows with the same id are the same artist;
// two rows with the same name might be two people.
//
// ============================================================================
// PROBLEM 2 — SINGLES TYPED AS ALBUMS
// ============================================================================
// Deezer's `record_type` is not trustworthy on its own. Measured, from Travis
// Scott's real discography:
//
//   record_type  tracks  duration  title
//   album            19      73m   UTOPIA
//   album            17      58m   ASTROWORLD
//   album             1       3m   durag activity      <-- a single
//   ep                4      13m   K-POP (Chopped & Screwed)
//
// `durag activity` is one track and three minutes and Deezer calls it an
// album, so a completion list built on `record_type === 'album'` told people
// to go and rate a single. That is the reported bug, reproduced exactly.
//
// So the type is a HINT and the track count is the evidence. The thresholds
// are the Official Charts Company's, because VINALL is a UK app and there is
// no reason to invent a definition when the one the charts use is public:
//
//   single       up to 3 tracks and no more than 25 minutes
//   EP           4 to 6 tracks, or fewer over 25 minutes
//   album        7 or more tracks, or more than 25 minutes
//
// **EPs count toward completionist progress and singles do not** — decided
// with the owner rather than assumed, and `COMPLETIONIST_KINDS` is the single
// place that decision lives.
//
// The catch is that /artist/{id}/albums does NOT return nb_tracks — the field
// is simply absent from that endpoint, which is why nothing downstream could
// ever have told a single from an album. classify() says so rather than
// guessing: `confident` is false when it had only the type to go on, and the
// caller decides whether to spend a request finding out.
// ============================================================================

export const KIND = {
  ALBUM: 'album',
  EP: 'ep',
  SINGLE: 'single',
  COMPILATION: 'compilation',
  LIVE: 'live',
  REMIX: 'remix',
  OTHER: 'other',
};

// The one place the EP decision lives. Anything reading this is asking "does
// it count", and the answer has to be the same everywhere or two screens will
// disagree about how complete somebody is.
export const COMPLETIONIST_KINDS = [KIND.ALBUM, KIND.EP];

export function countsForCompletion(kind) {
  return COMPLETIONIST_KINDS.indexOf(kind) !== -1;
}

// ---------------------------------------------------------------- names
//
// Case, diacritics, punctuation and whitespace all go. Beyoncé and JAŸ-Z are
// the reason the accent fold comes BEFORE the strip: normalising after it
// turns them into `beyonc` and `jaz`, which match nothing — the exact bug that
// cost five covers in the artwork pass.
export function normName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '');
}

// Same fold, but keeping word boundaries — for anything that wants to compare
// or display words rather than one run of characters.
export function normWords(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Editions of one work. "UTOPIA", "UTOPIA (Deluxe)" and "UTOPIA - 10th
// Anniversary Edition" are one record somebody rates once.
const EDITION = /\s*[\(\[][^)\]]*\b(deluxe|expanded|anniversary|remaster(ed)?|reissue|edition|version|bonus|explicit|clean|special|complete|super|platinum|gold)\b[^)\]]*[\)\]]\s*/gi;
const EDITION_TAIL = /\s*[-–—:]\s*(the\s+)?(deluxe|expanded|anniversary|remaster(ed)?|reissue|special|complete|super|platinum|gold|\d+(st|nd|rd|th)\s+anniversary)\b.*$/i;

/* Edition words that are unambiguous as BARE words, outside brackets and
   without a dash in front of them. Measured cases this exists for, both of
   which survived the bracketed and dashed rules above and put a second copy
   of one record in the list:

     "Dangerous Woman (Edited)"                  -- `edited` was not listed
     "eternal sunshine deluxe: brighter days..." -- `deluxe` before the colon

   Kept deliberately short. `gold`, `platinum`, `special`, `complete` and
   `super` are NOT here and must not be: they are real words in real album
   titles, and they are safe in the two rules above only because brackets or a
   dash tell you they are describing a pressing. */
const EDITION_WORD = /\b(deluxe|remastere?d?|reissue|edited|expanded|extended)\b/gi;

export function baseTitle(s) {
  const raw = String(s || '');
  let t = raw.replace(EDITION, ' ').replace(EDITION_TAIL, '').replace(EDITION_WORD, ' ');
  const out = normName(t);
  /* If stripping left nothing, the title WAS the edition word — there are
     records genuinely called "Deluxe" — and an empty key is dropped by the
     caller, which would silently delete the record from somebody's
     discography. Fall back to the untouched title. */
  return out || normName(raw);
}

export function isEdition(s) {
  const raw = String(s || '');
  EDITION.lastIndex = 0; EDITION_WORD.lastIndex = 0;
  return EDITION.test(raw) || EDITION_TAIL.test(raw) || EDITION_WORD.test(raw);
}

// ---------------------------------------------------------------- releases
//
// Titles that are not a studio record however Deezer types them. Split by what
// they actually are, so a live album can be told apart from a remix record
// rather than both landing in one bucket called "not this".
const RE_LIVE = /\b(live|unplugged|in concert|mtv unplugged|at the (o2|apollo|bbc|royal|fillmore)|concert)\b/i;
const RE_REMIX = /\b(remix(es|ed)?|chopped\s*(&|and)\s*screwed|slowed|sped up|instrumental(s)?|acapella|a cappella|karaoke|tribute|covers?\s+of)\b/i;
const RE_COMP = /\b(greatest hits|best of|the collection|anthology|box ?set|compilation|b-?sides|rarities|essentials?|singles collection|hits)\b/i;
/* `demos` and `sessions` are REAL WORDS IN REAL ALBUM TITLES, and matching
   them anywhere cost Malcolm Todd's "Demos Before Prom" its place in his
   Completionist — the record simply was not in the list and nothing said why.
   Same shape as the note on EDITION_WORD: a word that describes a pressing
   when it is bracketed or trailing is a word like any other at the front of a
   title. So they only count at the END, or inside brackets. */
const RE_OTHER = /\b(commentary|interview|soundtrack score)\b|\((demos?|sessions?)\)|\b(demos?|sessions?)\s*$/i;

// Official Charts Company boundaries. See the header for why these and not
// something invented.
const SINGLE_MAX_TRACKS = 3;
const EP_MAX_TRACKS = 6;
const ALBUM_MIN_MINUTES = 25;

/**
 * Classify one Deezer release.
 *
 * @param {object} r  a Deezer album object. `nb_tracks` and `duration` are
 *                    absent on /artist/{id}/albums and present on /album/{id}.
 * @returns {{kind:string, confident:boolean, why:string[], tracks:number|null, minutes:number|null}}
 *
 * `confident` is the important half of the answer. False means the decision
 * rests on record_type alone, which is exactly the case that shipped a single
 * as an album — the caller can spend a request to settle it, or accept the
 * type, but it is never told a guess is a fact.
 */
export function classifyRelease(r) {
  const why = [];
  const title = String((r && (r.title || r.name)) || '');
  const type = String((r && r.record_type) || '').toLowerCase();
  const tracks = (r && typeof r.nb_tracks === 'number' && r.nb_tracks > 0) ? r.nb_tracks : null;
  const minutes = (r && typeof r.duration === 'number' && r.duration > 0) ? Math.round(r.duration / 60) : null;

  // 1. What the title says it is, first and unconditionally. A live record
  //    typed `album` with nineteen tracks is still a live record, and a
  //    completion list asking somebody to rank "Hail to the Thief (Live)"
  //    is asking them to rank one record twice.
  if (RE_LIVE.test(title))  { why.push('title says live');        return { kind: KIND.LIVE,        confident: true, why, tracks, minutes }; }
  if (RE_REMIX.test(title)) { why.push('title says remix/cover'); return { kind: KIND.REMIX,       confident: true, why, tracks, minutes }; }
  if (RE_COMP.test(title))  { why.push('title says compilation'); return { kind: KIND.COMPILATION, confident: true, why, tracks, minutes }; }
  if (RE_OTHER.test(title)) { why.push('title says non-studio');  return { kind: KIND.OTHER,       confident: true, why, tracks, minutes }; }

  // 2. Deezer's own compilation type is reliable in the one direction that
  //    matters: it does not call studio albums compilations.
  if (type === 'compilation') { why.push('record_type compilation'); return { kind: KIND.COMPILATION, confident: true, why, tracks, minutes }; }

  // 3. The track count, which is the evidence.
  if (tracks !== null) {
    if (tracks <= SINGLE_MAX_TRACKS && (minutes === null || minutes <= ALBUM_MIN_MINUTES)) {
      why.push(tracks + ' track' + (tracks === 1 ? '' : 's'));
      // Deezer calling a two-track release an EP does not make it one, but it
      // is worth recording that the source disagreed.
      if (type === 'ep') why.push('record_type said ep');
      return { kind: KIND.SINGLE, confident: true, why, tracks, minutes };
    }
    if (tracks <= EP_MAX_TRACKS && (minutes === null || minutes <= ALBUM_MIN_MINUTES)) {
      why.push(tracks + ' tracks');
      return { kind: KIND.EP, confident: true, why, tracks, minutes };
    }
    // Over the EP ceiling on tracks OR over the album floor on running time.
    // Deezer's `ep` type breaks the tie just above the boundary, because a
    // seven-track release the label calls an EP is an EP.
    if (type === 'ep' && tracks <= EP_MAX_TRACKS + 2) {
      why.push(tracks + ' tracks, record_type ep');
      return { kind: KIND.EP, confident: true, why, tracks, minutes };
    }
    why.push(tracks + ' tracks' + (minutes !== null ? ', ' + minutes + 'm' : ''));
    return { kind: KIND.ALBUM, confident: true, why, tracks, minutes };
  }

  // 4. No track count — /artist/{id}/albums does not carry one. The type is
  //    all there is, and the answer says so.
  why.push('record_type ' + (type || 'missing') + ', no track count');
  const kind = type === 'single' ? KIND.SINGLE
             : type === 'ep' ? KIND.EP
             : type === 'album' ? KIND.ALBUM
             : KIND.OTHER;
  return { kind, confident: false, why, tracks: null, minutes: null };
}

/**
 * Collapse editions of one work to a single canonical release.
 *
 * Keeps the plain edition over a deluxe, and the earliest year among equals —
 * a remaster reissued in 2015 is not a 2015 record, and listing both is how a
 * discography grows a second copy of every famous album.
 *
 * @returns {{releases: object[], merges: object[]}}
 */
export function dedupeReleases(list) {
  const byWork = {};
  const merges = [];
  (list || []).forEach((r) => {
    if (!r || !(r.title || r.name)) return;
    const key = baseTitle(r.title || r.name);
    if (!key) return;
    const year = parseInt(String(r.release_date || '').slice(0, 4), 10) || 9999;
    const cand = { row: r, year, edition: isEdition(r.title || r.name) };
    const ex = byWork[key];
    if (!ex) { byWork[key] = cand; return; }
    // Plain beats an edition; among equals the earlier year wins.
    const better = (ex.edition && !cand.edition)
      || (ex.edition === cand.edition && cand.year < ex.year);
    const win = better ? cand : ex, lose = better ? ex : cand;
    merges.push({
      work: key,
      kept: win.row.title + ' (' + win.year + ')',
      dropped: lose.row.title + ' (' + lose.year + ')',
      why: ex.edition !== cand.edition ? 'edition' : 'later pressing',
    });
    if (better) byWork[key] = cand;
  });
  /* A second pass for editions that RENAME rather than annotate.
     "eternal sunshine deluxe: brighter days ahead" is the deluxe of "eternal
     sunshine" and does not reduce to the same key however the words are
     stripped, because it carries a subtitle of its own.

     So: an entry whose title is flagged as an edition AND whose base key
     starts with another entry's whole base key is folded into that one. The
     edition flag is what makes this safe — without it "Rodeo" would swallow a
     record genuinely called "Rodeo 2", which is a different album. */
  /* MULTI-PART RELEASES. "Sweet Boy Pt. 1" and "Sweet Boy Pt. 2" are two
     halves of "Sweet Boy" and the Completionist listed all three, so somebody
     who had rated the album was told they were two records short of finishing
     it.

     The fold only happens when a SIBLING EXISTS — another entry whose base key
     is the part's key without the part marker. A record genuinely called
     "Utopia Pt. 2" with no "Utopia" beside it keeps its own entry, which is
     the same discipline that stops "Rodeo" swallowing "Rodeo 2" below. The
     WHOLE always wins over a part, whatever the years say: the album is the
     record and the parts are how it was rolled out. */
  const PART_TAIL = /[,:\-–—\s]*\(?\s*(pt\.?|part)\s*(\d{1,2}|one|two|three|four|i{1,3}|iv|v)\s*\)?\s*$/i;
  Object.keys(byWork).forEach((key) => {
    const raw = String(byWork[key].row.title || byWork[key].row.name || '');
    if (!PART_TAIL.test(raw)) return;
    const whole = baseTitle(raw.replace(PART_TAIL, ''));
    if (!whole || whole === key || !byWork[whole]) return;
    merges.push({
      work: whole,
      kept: byWork[whole].row.title,
      dropped: raw,
      why: 'part of the same record',
    });
    delete byWork[key];
  });

  const keys = Object.keys(byWork).sort((a, b) => a.length - b.length);
  const gone = {};
  keys.forEach((long) => {
    if (gone[long]) return;
    if (!byWork[long].edition) return;
    const host = keys.find(sh => sh !== long && !gone[sh] && sh.length < long.length && long.startsWith(sh));
    if (!host) return;
    merges.push({
      work: host,
      kept: byWork[host].row.title + ' (' + byWork[host].year + ')',
      dropped: byWork[long].row.title + ' (' + byWork[long].year + ')',
      why: 'retitled edition of the same record',
    });
    gone[long] = true;
  });

  return {
    releases: Object.keys(byWork).filter(k => !gone[k]).map(k => byWork[k].row),
    merges,
  };
}

// ---------------------------------------------------------------- artists
//
/**
 * Dedupe a list of Deezer artists.
 *
 * BY ID FIRST, and by normalised name only where an id is missing or repeated
 * — an id is an identity and a name is a guess, and merging two different
 * musicians who share a name is a worse outcome than showing both.
 *
 * @returns {{artists: object[], merges: object[]}}
 */
export function dedupeArtists(list) {
  const byId = {};
  const merges = [];
  const order = [];

  (list || []).forEach((a) => {
    if (!a) return;
    const id = a.id != null ? String(a.id) : '';
    if (!id) return;
    if (byId[id]) {
      merges.push({ by: 'id', id, name: a.name, why: 'same Deezer id' });
      // Keep whichever row carries more of an audience, so a thin duplicate
      // row cannot overwrite a full one.
      if ((a.nb_fan || 0) > (byId[id].nb_fan || 0)) byId[id] = a;
      return;
    }
    byId[id] = a; order.push(id);
  });

  // Now the name fallback, and only between rows that are exact normalised
  // matches. "Steve Lacy" and "Steve Lacy Quartet" are not the same artist and
  // must never be merged — they do not match here, which is the point of
  // comparing the whole normalised string rather than a prefix.
  const byName = {};
  const keep = [];
  order.forEach((id) => {
    const a = byId[id];
    const n = normName(a.name);
    if (!n) { keep.push(a); return; }
    const ex = byName[n];
    if (!ex) { byName[n] = a; keep.push(a); return; }
    const winner = (a.nb_fan || 0) > (ex.nb_fan || 0) ? a : ex;
    const loser = winner === a ? ex : a;
    merges.push({
      by: 'name', name: a.name,
      kept: String(winner.id), kept_fans: winner.nb_fan || 0,
      dropped: String(loser.id), dropped_fans: loser.nb_fan || 0,
      why: 'same normalised name, different ids — kept the larger audience',
    });
    if (winner === a) {
      byName[n] = a;
      keep.splice(keep.indexOf(ex), 1, a);
    }
  });

  return { artists: keep, merges };
}

/**
 * Rank Deezer artist search results against the name that was asked for.
 *
 * Scoring, highest first:
 *   100  exact normalised name
 *    45  the wanted name is a prefix of theirs, or theirs of it
 *    18  one contains the other
 *     0  neither — dropped
 *
 * Ties break on `nb_fan`, which is what separates the canonical "Steve Lacy"
 * (277,980) from the duplicate (395). Without that tiebreak the list is in
 * whatever order Deezer returned, which is how this went wrong.
 */
export function rankArtists(list, wantedName, opts) {
  const keepAll = !!(opts && opts.keepAll);
  const want = normName(wantedName);
  if (!want) return [];
  const { artists } = dedupeArtists(list);
  return artists.map((a) => {
    const n = normName(a.name);
    let score = 0, how = 'none';
    if (n === want) { score = 100; how = 'exact'; }
    else if (n.startsWith(want)) { score = 60; how = 'prefix'; }
    else if (want.startsWith(n)) { score = 45; how = 'prefix'; }
    else if (n.indexOf(want) !== -1 || want.indexOf(n) !== -1) { score = 18; how = 'contains'; }
    else if (!keepAll) return null;
    return { artist: a, score, how, fans: a.nb_fan || 0 };
  }).filter(Boolean)
    .sort((x, y) => (y.score - x.score) || (y.fans - x.fans));
}

/**
 * The one artist a name resolves to, and why.
 *
 * @returns {{artist: object|null, how: string, considered: number, log: string[]}}
 *
 * `log` names every decision, because this function silently picking the
 * wrong one of two identically named artists is the failure that started all
 * of this and it left no trace anywhere.
 */
export function pickArtist(list, wantedName) {
  const log = [];
  /* Dedupe HERE rather than leaving it to rankArtists, so the merge decisions
     reach the caller's log. They did not at first: dedupeArtists correctly
     collapsed the two "Steve Lacy" rows and recorded why, rankArtists then saw
     one candidate and had no contest to report, and pickArtist returned an
     empty log — the merge happened and nothing anywhere said so, which is the
     exact property this whole module exists to remove. */
  const pre = dedupeArtists(list);
  pre.merges.forEach((m) => {
    log.push(m.by === 'id'
      ? 'merged duplicate row for id ' + m.id + ' (' + m.name + ')'
      : 'two artists named "' + m.name + '": kept ' + m.kept + ' (' + m.kept_fans +
        ' fans) over ' + m.dropped + ' (' + m.dropped_fans + ')');
  });
  const ranked = rankArtists(pre.artists, wantedName);
  if (!ranked.length) {
    log.push('no candidate matched "' + wantedName + '" out of ' + ((list || []).length) + ' results');
    return { artist: null, how: 'none', considered: (list || []).length, log };
  }
  const top = ranked[0];
  // Only worth saying anything when there was actually a contest.
  const rivals = ranked.filter(r => r.score === top.score);
  if (rivals.length > 1) {
    log.push('"' + wantedName + '": ' + rivals.length + ' ' + top.how + ' matches — took ' +
      top.artist.id + ' (' + (top.fans) + ' fans) over ' +
      rivals.slice(1).map(r => r.artist.id + ' (' + r.fans + ')').join(', '));
  }
  return { artist: top.artist, how: top.how, considered: ranked.length, log };
}
