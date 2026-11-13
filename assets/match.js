// Spotify → Deezer matching. Pure functions, no network: the route does the
// fetching and this decides. `node api/_match.selfcheck.mjs` checks it.
//
// The two catalogues are separate, so a match is a JUDGEMENT, not a lookup.
// A Spotify data export gives artist, title, album and the Spotify URI —
// no ISRC and no duration — so those three strings are the whole evidence.
//
// How a candidate is scored (0–100):
//
//   title     50  same song once both titles lose their feat. tails and
//                 edition noise ("- Remastered 2011", "(Deluxe)", "Explicit")
//   artist    35  same primary artist; 25 when one side's artist is credited
//                 inside the other's title or artist string (features)
//   album     10  same record once editions are stripped; 5 for a prefix
//   version  −30  live / remix / acoustic / instrumental / sped-up on one
//                 side and not the other — "Blinding Lights (Live)" is NOT a
//                 match for the studio cut, however close the words are
//
// ≥ 80 with clear daylight over the runner-up is a match. 55–79, or two
// candidates too close to call, is "check" — shown to the person with the
// alternatives. Under 55 is "none": said plainly, never guessed.

export function fold(s) {
  return String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

const FEAT = /\s*[\(\[]\s*(feat\.?|ft\.?|featuring|with)\s[^\)\]]*[\)\]]|\s+[-–]\s+(feat\.?|ft\.?|featuring)\s.*$|\s+(feat\.?|ft\.?)\s.*$/gi;
const EDITION = /\s*[\(\[][^\)\]]*\b(remaster(ed)?|deluxe|edition|expanded|anniversary|explicit|clean|bonus|version|mono|stereo|single|radio edit|original mix|from .+|taken from .+)\b[^\)\]]*[\)\]]|\s+[-–]\s+((\d{4}\s+)?remaster(ed)?(\s+\d{4})?|single version|radio edit|original mix|mono|stereo|explicit|clean|bonus track)(\s+version)?\s*$/gi;
const VERSIONS = ['live', 'remix', 'acoustic', 'instrumental', 'demo', 'sped up', 'slowed', 'karaoke', 'a cappella', 'acapella', 'unplugged', 'orchestral', 'reprise', 'rehearsal', 'alternate', 'cover', 'tribute', 'made famous', 'in the style of'];
// "(Single Version)" is the same recording; "(Boom Box Version)" and
// "(Devonshire Mix)" are not. A bracket or dash tail naming a version or a
// mix is a different take unless every word in it is one of these.
const BENIGN = /^(single|album|explicit|clean|radio|original|remaster(ed)?|\d{4}|mono|stereo|lp|main|edit|version|mix|mixed|the|digital|bonus|track|deluxe|extended)$/;
function variantTail(title) {
  const tails = [];
  String(title || '').replace(/[\(\[]([^\)\]]*)[\)\]]/g, (m, x) => { tails.push(x); return m; });
  const dash = /\s[-–]\s(.*)$/.exec(String(title || ''));
  if (dash) tails.push(dash[1]);
  return tails.some((t) => {
    const w = fold(t).split(' ').filter(Boolean);
    return /\b(version|mix)\b/.test(fold(t)) && !/\bfeat|\bwith\b/.test(fold(t)) && w.some((x) => !BENIGN.test(x));
  });
}

export function base(title) {
  return fold(String(title || '').replace(FEAT, '').replace(EDITION, '').replace(FEAT, ''));
}
export function versionsOf(title, albumOnly) {
  const f = fold(title);
  const out = VERSIONS.filter((v) => new RegExp('\\b' + v + '\\b').test(f));
  if (!albumOnly && variantTail(title)) out.push('variant');
  return out;
}
function words(s) { return new Set(fold(s).split(' ').filter((w) => w.length > 1)); }
function jaccard(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0; A.forEach((w) => { if (B.has(w)) n++; });
  return n / (A.size + B.size - n);
}

// want: { a: artist, t: title, b: album }   cand: a Deezer /search/track row
export function scoreTrack(want, cand) {
  const ct = cand.title || '', ca = (cand.artist && cand.artist.name) || '', cb = (cand.album && cand.album.title) || '';
  const wt = base(want.t), xt = base(ct);
  let s = 0;
  if (wt && wt === xt) s += 50;
  else if (wt && xt && (wt.startsWith(xt + ' ') || xt.startsWith(wt + ' '))) s += 32;
  else s += Math.round(jaccard(wt, xt) * 34);

  const wa = fold(want.a), xa = fold(ca);
  if (wa && wa === xa) s += 35;
  else if (wa && xa && (fold(ct).includes(wa) || fold(want.t).includes(xa) || wa.includes(xa) || xa.includes(wa))) s += 25;

  const wb = base(want.b), xb = base(cb);
  if (wb && wb === xb) s += 10;
  else if (wb && xb && (wb.startsWith(xb) || xb.startsWith(wb))) s += 5;

  // Version words count in the title and the album ("Live at Reading");
  // the version-or-mix tail rule only in the title.
  const v1 = [...new Set(versionsOf(want.t).concat(versionsOf(want.b, true)))].sort(), v2 = [...new Set(versionsOf(ct).concat(versionsOf(cb, true)))].sort();
  if (v1.join() !== v2.join()) s -= 30;
  return s;
}

export function scoreAlbum(want, cand) {
  const ct = cand.title || '', ca = (cand.artist && cand.artist.name) || '';
  const wb = base(want.b), xb = base(ct);
  let s = 0;
  if (wb && wb === xb) s += 60;
  else if (wb && xb && (wb.startsWith(xb + ' ') || xb.startsWith(wb + ' '))) s += 38;
  else s += Math.round(jaccard(wb, xb) * 40);
  const wa = fold(want.a), xa = fold(ca);
  if (wa && wa === xa) s += 40;
  else if (wa && xa && (wa.includes(xa) || xa.includes(wa))) s += 28;
  if (versionsOf(want.b).join() !== versionsOf(ct).join()) s -= 30;
  return s;
}

// Rank candidates and decide. Ties on score go to Deezer's popularity, so the
// canonical upload beats a re-upload with the same words.
export function decide(scored) {
  const sortedAll = scored.slice().sort((x, y) => (y.s - x.s) || ((y.c.rank || y.c.fans || 0) - (x.c.rank || x.c.fans || 0)));
  // One recording on an album and on its deluxe/remastered edition is ONE
  // answer: keep the stronger copy, or every catalogue classic would tie with
  // itself and ask.
  const seen = new Set(), list = sortedAll.filter((x) => {
    const k = base(x.c.title) + "|" + fold(x.c.artist && x.c.artist.name) + "|" + base((x.c.album && x.c.album.title) || "");
    if (seen.has(k)) return false; seen.add(k); return true;
  });
  const best = list[0];
  if (!best || best.s < 55) return { status: 'none', best: null, alts: [] };
  // Without durations two songs with the same title by the same artist are
  // only told apart by the album, so the runner-up counts even when its words
  // are identical: no daylight between them means ask.
  const second = list[1];
  const clear = !second || best.s - second.s >= 8 || second.s < 70;
  const status = best.s >= 80 && clear ? 'ok' : 'check';
  return { status, best: best.c, alts: list.filter((x) => x.s >= 45).slice(0, 4).map((x) => x.c) };
}

// What goes back to the browser: only what VINALL keeps for a song.
export function trackOut(c) {
  if (!c) return null;
  return { id: String(c.id), name: c.title, artist: (c.artist && c.artist.name) || '', album: (c.album && c.album.title) || '',
    albumId: c.album && c.album.id ? String(c.album.id) : '', art: (c.album && (c.album.cover_medium || c.album.cover_big)) || '' };
}
export function albumOut(c) {
  if (!c) return null;
  return { id: String(c.id), name: c.title, artist: (c.artist && c.artist.name) || '', art: c.cover_medium || c.cover_big || '' };
}
