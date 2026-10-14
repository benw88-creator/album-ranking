/* ================================================================
   MUSIC PASSPORT — the arithmetic. Pure: no DOM, no network, no storage.
   `node scripts/passport.selfcheck.mjs` holds it to account.

   WHERE AN ARTIST IS FROM comes from MusicBrainz, never from a guess:
   its `country` field (the country MusicBrainz associates the artist
   with), or its area when that area IS a country. A name MusicBrainz
   cannot match exactly, or matches to two artists in two different
   countries with nothing to tell them apart, is left UNPLACED and said
   so — a wrong stamp is worse than a missing one.
   ================================================================ */
(function (root) {
  'use strict';

  function fold(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/^the\s+/, '').replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, '');   // accents fold; other scripts survive (宇多田ヒカル is not "")
  }
  // "Daft Punk feat. Pharrell" -> the lead artist. Deliberately NOT split on
  // commas, "&" or "/": Tyler, The Creator, Simon & Garfunkel and AC/DC are
  // one artist each, and the catalogue already gives one lead name.
  function firstArtist(s) {
    return String(s || '').split(/\s*(?:;|\(?\bfeat\.?\s|\(?\bft\.?\s|\(?\bfeaturing\s)\s*/i)[0].trim() || String(s || '').trim();
  }

  /* ---- matching one MusicBrainz artist search ----------------------------
     results: the `artists` array of /ws/2/artist?query=artist:"NAME".
     names:   { folded country name -> ISO code } for the area fallback.
     Returns { c, id, name } | { amb: [candidates] } | null.               */
  function countryOf(a, names) {
    if (a.country && /^[A-Z]{2}$/.test(a.country)) return a.country === 'XE' || a.country === 'XW' ? null : a.country;
    if (a.area && a.area.type === 'Country' && names) return names[fold(a.area.name)] || null;
    return null;
  }
  function pick(results, query, names) {
    var want = fold(query); if (!want || !results || !results.length) return null;
    var exact = results.filter(function (a) {
      if (fold(a.name) === want) return true;
      return (a.aliases || []).some(function (al) { return fold(al.name) === want; });
    }).filter(function (a) { return (a.score || 0) >= 85; });
    if (!exact.length) return null;
    var top = exact[0], topS = top.score || 0;
    var rivals = exact.filter(function (a) { return a !== top && (a.score || 0) >= topS - 2; });
    var c = countryOf(top, names);
    // Two equally good matches in different countries: not ours to choose.
    var clash = rivals.some(function (a) { var rc = countryOf(a, names); return rc && rc !== c; });
    if (clash) return { amb: exact.slice(0, 5).map(function (a) { return { id: a.id, c: countryOf(a, names) }; }) };
    return c ? { c: c, id: top.id, name: top.name } : { c: null, id: top.id, name: top.name };
  }

  /* ---- rarity: how often a country turns up in the world's charts --------
     A design tier, printed as such, not a claim about the person.          */
  function set(s) { var o = {}; s.split(' ').forEach(function (k) { o[k] = 1; }); return o; }
  var COMMON = set('US GB CA'), UNCOMMON = set('AU IE FR DE SE JM NG KR JP BR PR MX ES IT NL NZ CO NO DK BE ZA');
  var RARE = set('AR CL CU DO IS FI PL AT CH PT GR IN TR IL CZ RU UA GH CM SN ML BB TT VE PE RO HU HR RS KE');
  function rarity(cc) { return COMMON[cc] ? 1 : UNCOMMON[cc] ? 2 : RARE[cc] ? 3 : 4; }
  var TIERS = ['', 'Common', 'Uncommon', 'Rare', 'Far-flung'];

  /* ---- the world ------------------------------------------------------------ */
  // Accumulate everything we know about each artist from the crate, the
  // songs and imported listening, then pin each artist to a country.
  function build(input) {
    var A = input.albums || {}, S = input.songs || {}, L = input.listen || [];
    var origin = input.origin || function () { return undefined; };
    var geo = input.geo || {};          // cc -> { n, ct }
    var now = input.now || Date.now();
    var artists = {};
    function art(name) {
      var lead = firstArtist(name), k = fold(lead); if (!k) return null;
      return artists[k] || (artists[k] = { k: k, name: lead, albums: [], songs: [], plays: 0, ms: 0, tracks: [], first: Infinity, scores: [] });
    }
    function seen(t) { return typeof t === 'number' && t > 0 ? t : (typeof t === 'string' ? Date.parse(t) || Infinity : Infinity); }
    Object.keys(A).forEach(function (id) {
      var a = A[id]; if (!a || typeof a.score !== 'number') return;
      var r = art(a.artist); if (!r) return;
      r.albums.push({ id: id, name: a.name, artist: a.artist, art: a.art, score: a.score, genre: a.genre || '', year: a.year || '', t: seen(a.savedAt || a.ratedAt) });
      r.scores.push(a.score);
      r.first = Math.min(r.first, seen(a.savedAt || a.ratedAt));
    });
    Object.keys(S).forEach(function (id) {
      var s = S[id]; if (!s || typeof s.score !== 'number') return;
      var r = art(s.artist); if (!r) return;
      r.songs.push({ id: id, name: s.name, art: s.art, score: s.score, album: s.album || '', t: seen(s.savedAt || s.ratedAt) });
      r.first = Math.min(r.first, seen(s.savedAt || s.ratedAt));
    });
    L.forEach(function (p) {
      var r = art(p.artist); if (!r) return;
      r.plays += p.plays || 0; r.ms += p.ms_played || 0;
      r.tracks.push({ name: p.track, album: p.album || '', plays: p.plays || 0 });
      r.first = Math.min(r.first, seen(p.first_played));
    });

    var countries = {}, unplaced = [], pending = [];
    Object.keys(artists).forEach(function (k) {
      var r = artists[k], o = origin(r.name);
      r.rated = r.albums.length + r.songs.length;
      r.avg = r.scores.length ? r.scores.reduce(function (t, x) { return t + x; }, 0) / r.scores.length : null;
      r.weight = r.rated * 40 + Math.log(1 + r.plays) * 10;
      r.tracks.sort(function (a, b) { return b.plays - a.plays; });
      r.albums.sort(function (a, b) { return b.score - a.score; });
      r.art = (r.albums[0] && r.albums[0].art) || (r.songs[0] && r.songs[0].art) || '';
      if (o === undefined) { pending.push(r); return; }
      if (!o) { unplaced.push(r); return; }
      r.cc = o;
      var c = countries[o] || (countries[o] = { cc: o, n: (geo[o] && geo[o].n) || o, ct: (geo[o] && geo[o].ct) || '', artists: [], albums: 0, songs: 0, plays: 0, ms: 0, first: Infinity, scores: [], rated: 0, listened: 0 });
      c.artists.push(r);
      c.albums += r.albums.length; c.songs += r.songs.length; c.plays += r.plays; c.ms += r.ms;
      c.first = Math.min(c.first, r.first);
      r.scores.forEach(function (s) { c.scores.push(s); });
      if (r.rated) c.rated++;
      if (r.plays) c.listened++;
    });

    var all = [], mine = [];
    Object.keys(artists).forEach(function (k) { mine = mine.concat(artists[k].scores); });
    var myMean = mine.length ? mine.reduce(function (t, x) { return t + x; }, 0) / mine.length : 70;
    Object.keys(countries).forEach(function (cc) {
      var c = countries[cc];
      c.artists.sort(function (a, b) { return b.weight - a.weight; });
      c.src = c.rated && c.listened ? 'both' : c.rated ? 'rated' : 'listened';
      c.avg = c.scores.length ? c.scores.reduce(function (t, x) { return t + x; }, 0) / c.scores.length : null;
      // Shrunk towards your own average, so one 95 from one record does not
      // make Iceland your favourite country.
      c.love = c.scores.length ? (c.scores.reduce(function (t, x) { return t + x; }, 0) + myMean * 3) / (c.scores.length + 3) : null;
      c.rarity = rarity(cc);
      c.when = isFinite(c.first) ? c.first : null;
      all.push(c);
    });
    all.sort(function (a, b) { return (a.when || now) - (b.when || now) || a.cc.localeCompare(b.cc); });

    var conts = {};
    all.forEach(function (c) { if (c.ct) (conts[c.ct] = conts[c.ct] || []).push(c.cc); });

    return {
      artists: artists, countries: countries, list: all, continents: conts,
      unplaced: unplaced, pending: pending, myMean: myMean,
      placedArtists: all.reduce(function (t, c) { return t + c.artists.length; }, 0)
    };
  }

  /* ---- the readings ----------------------------------------------------------- */
  function favourites(w) {
    var byLove = w.list.filter(function (c) { return c.scores.length >= 2; }).sort(function (a, b) { return b.love - a.love; });
    var byPlays = w.list.filter(function (c) { return c.plays > 0; }).sort(function (a, b) { return b.plays - a.plays; });
    var byDepth = w.list.slice().sort(function (a, b) { return b.artists.length - a.artists.length || (b.plays - a.plays); });
    return { loved: byLove.slice(0, 3), played: byPlays.slice(0, 3), deepest: byDepth.slice(0, 3) };
  }
  // A genre is geographically diverse when its records come from many
  // countries AND are spread across them, not 30 from one and 1 from two.
  function genreSpread(w) {
    var g = {};
    w.list.forEach(function (c) {
      c.artists.forEach(function (r) {
        r.albums.forEach(function (al) { if (!al.genre) return; var x = g[al.genre] || (g[al.genre] = { genre: al.genre, n: 0, by: {} }); x.n++; x.by[c.cc] = (x.by[c.cc] || 0) + 1; });
      });
    });
    return Object.keys(g).map(function (k) {
      var x = g[k], ccs = Object.keys(x.by), H = 0;
      ccs.forEach(function (cc) { var p = x.by[cc] / x.n; H -= p * Math.log(p); });
      return { genre: x.genre, n: x.n, countries: ccs.length, ccs: ccs.sort(function (a, b) { return x.by[b] - x.by[a]; }), spread: ccs.length > 1 ? H / Math.log(ccs.length) : 0 };
    }).filter(function (x) { return x.n >= 4 && x.countries >= 2; })
      .sort(function (a, b) { return b.countries - a.countries || b.spread - a.spread; });
  }
  // Rare finds: the far-flung stamps, and countries you reach through
  // exactly one artist — the thread that one record is holding.
  function rare(w) {
    return w.list.filter(function (c) { return c.rarity >= 3 || c.artists.length === 1; })
      .sort(function (a, b) { return b.rarity - a.rarity || a.artists.length - b.artists.length; });
  }
  // When the world opened up: one row per year with the countries first
  // reached that year, and the continental mix of what you rated in it.
  function timeline(w) {
    var years = {};
    w.list.forEach(function (c) { if (!c.when) return; var y = new Date(c.when).getUTCFullYear(); (years[y] = years[y] || { y: y, fresh: [], mix: {}, total: 0 }).fresh.push(c.cc); });
    w.list.forEach(function (c) {
      c.artists.forEach(function (r) {
        r.albums.concat(r.songs).forEach(function (it) {
          if (!isFinite(it.t)) return; var y = new Date(it.t).getUTCFullYear();
          var row = years[y] || (years[y] = { y: y, fresh: [], mix: {}, total: 0 });
          row.mix[c.ct || '?'] = (row.mix[c.ct || '?'] || 0) + 1; row.total++;
        });
      });
    });
    return Object.keys(years).map(function (y) { return years[y]; }).sort(function (a, b) { return a.y - b.y; });
  }
  // Where to go next. Only countries you have not reached, only artists
  // MusicBrainz itself places there. Nearby first (a continent you already
  // know), then one leap somewhere new, so the list is a route, not a raffle.
  function recommend(w, recs, geo, n) {
    n = n || 6;
    var have = w.countries, known = w.continents;
    var cand = Object.keys(recs || {}).filter(function (cc) { return !have[cc] && recs[cc] && recs[cc].length; }).map(function (cc) {
      var ct = (geo[cc] && geo[cc].ct) || '';
      return { cc: cc, n: (geo[cc] && geo[cc].n) || cc, ct: ct, artists: recs[cc], near: !!known[ct], rarity: rarity(cc) };
    });
    function h(s) { var x = 0; for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return x; }
    var seed = w.list.length;
    cand.sort(function (a, b) { return (b.near - a.near) || ((h(a.cc + seed) & 1023) - (h(b.cc + seed) & 1023)); });
    var near = cand.filter(function (c) { return c.near; }), far = cand.filter(function (c) { return !c.near; });
    var out = [], usedCt = {};
    // one per continent first, then fill
    near.concat(far).forEach(function (c) { if (out.length < n && !usedCt[c.ct]) { out.push(c); usedCt[c.ct] = 1; } });
    near.concat(far).forEach(function (c) { if (out.length < n && out.indexOf(c) < 0) out.push(c); });
    return out;
  }

  var CONTINENTS = ['Europe', 'North America', 'South America', 'Africa', 'Asia', 'Oceania'];

  root.PassportCore = { fold: fold, firstArtist: firstArtist, pick: pick, countryOf: countryOf, rarity: rarity, TIERS: TIERS,
    build: build, favourites: favourites, genreSpread: genreSpread, rare: rare, timeline: timeline, recommend: recommend, CONTINENTS: CONTINENTS };
})(typeof window !== 'undefined' ? window : globalThis);
