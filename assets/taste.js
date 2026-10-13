/* ================================================================
   VINALL TASTE — the arithmetic behind Taste Match, Depth, About You and
   the Your Music queue. Pure functions: no DOM, no network, no storage.
   `node scripts/taste.selfcheck.mjs` holds it to account.

   Ground rules, the same as Replay's:
     * Every number comes from the person's own data and can be traced back
       to it. Every insight carries its evidence and a threshold it had to
       clear; below the threshold there is no insight, never a guess.
     * Scores are read RELATIVE TO THE PERSON. A 75 from somebody who gives
       everything 90 is a low mark; from somebody who averages 55 it is a
       rave. So comparisons use each person's own z-scores (their score minus
       their mean, over their spread), which removes rating inflation.
     * Sparse data is not disagreement. Below the data floor the answer is
       "not enough yet", and above it a confidence figure travels with the
       number so 74% on six records never reads like 74% on ninety.
   ================================================================ */
(function (root) {
  'use strict';

  function fold(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/&/g, ' and ').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function firstArtist(s) { return String(s || '').split(/,\s+|\s+&\s+|\s+feat\.?\s+|\s+x\s+/i)[0].trim(); }
  function recKey(name, artist) { return fold(name) + '|' + fold(firstArtist(artist)); }
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }
  function sdOf(a, m) { if (a.length < 2) return 0; m = m == null ? mean(a) : m; return Math.sqrt(mean(a.map(function (x) { return (x - m) * (x - m); }))); }
  function clamp(x, lo, hi) { return Math.max(lo == null ? 0 : lo, Math.min(hi == null ? 1 : hi, x)); }
  function r5(x) { return Math.round(x / 5) * 5; }
  function genreName(g) { g = String(g || '').trim(); if (!g) return ''; return g.replace(/\b([a-z])/g, function (m) { return m.toUpperCase(); }).replace(/\bHip Hop\b|Hip-hop|Rap\/hip Hop/i, 'Hip-Hop'); }
  function decadeOf(y) { y = parseInt(y, 10); return y > 1900 && y < 2100 ? Math.floor(y / 10) * 10 : null; }
  function firstT(it) { var h = it && Array.isArray(it.history) && it.history[0]; return (h && h.t) || it.savedAt || it.ratedAt || 0; }

  /* A person's ratings as a list, with each score ALSO expressed relative to
     their own habits. The spread has a floor of 8: somebody who scores
     everything 70-85 would otherwise have every small difference blown up. */
  var SD_FLOOR = 8;
  function prep(map, meta) {
    var out = [];
    Object.keys(map || {}).forEach(function (id) {
      var v = map[id];
      var it = (v && typeof v === 'object') ? v : { score: v };
      var s = Number(it.score);
      if (!(s > 0)) return;
      var m = (meta && meta[id]) || {};
      var name = it.name || m.name || '', artist = it.artist || m.artist || '';
      out.push({ id: String(it.id || id), k: recKey(name, artist), name: name, artist: artist, art: it.art || m.art || '',
                 s: s, genre: genreName(it.genre), year: parseInt(it.year, 10) || null, t: firstT(it), history: it.history || null,
                 albumId: it.albumId || '' });
    });
    var sc = out.map(function (x) { return x.s; }), mu = mean(sc), sd = Math.max(SD_FLOOR, sdOf(sc, mu));
    out.forEach(function (x) { x.z = (x.s - mu) / sd; });
    out.mean = mu; out.sd = sd;
    return out;
  }

  // Spearman's rank correlation, with averaged ranks for ties.
  function ranks(v) {
    var idx = v.map(function (x, i) { return [x, i]; }).sort(function (a, b) { return a[0] - b[0]; });
    var r = new Array(v.length), i = 0;
    while (i < idx.length) {
      var j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      var avg = (i + j) / 2 + 1;
      for (var k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  }
  function spearman(a, b) {
    if (a.length < 3) return 0;
    var ra = ranks(a), rb = ranks(b), ma = mean(ra), mb = mean(rb), num = 0, da = 0, db = 0;
    for (var i = 0; i < ra.length; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) * (ra[i] - ma); db += (rb[i] - mb) * (rb[i] - mb); }
    return da && db ? num / Math.sqrt(da * db) : 0;
  }
  function cosine(a, b) {
    var keys = {}, dot = 0, na = 0, nb = 0;
    Object.keys(a).concat(Object.keys(b)).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) { var x = a[k] || 0, y = b[k] || 0; dot += x * y; na += x * x; nb += y * y; });
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
  }
  function share(list, f) {
    var c = {}, n = 0;
    list.forEach(function (x) { var k = f(x); if (k == null || k === '') return; c[k] = (c[k] || 0) + 1; n++; });
    Object.keys(c).forEach(function (k) { c[k] /= n; });
    c._n = n; return c;
  }
  function strip(o) { var c = {}; Object.keys(o).forEach(function (k) { if (k !== '_n') c[k] = o[k]; }); return c; }

  /* ================================================================
     TASTE MATCH
     The headline number is built ONLY from ratings, because ratings are
     the one thing every surface that shows a match has: a profile, a chip
     on a Crate card, a Groove. The same two crates therefore give the same
     number everywhere. Genre, era and rarity are shown beside it as
     context, never folded in.

       agreement   rank order of the shared records (Spearman), shrunk toward
                   zero for small overlaps; plus how close the two RELATIVE
                   scores sit, measured against chance (two strangers' z-scores
                   differ by ~1.13 on average, so that is 0, identical is 1)
       favourites  of the shared records either of you rates well above your
                   own average, how many you BOTH do
       artists     the same closeness test, per artist you have both rated
       clashes     one of you loves it, the other rates it well below their
                   own average — subtracted

     Confidence grows with the overlap (1 - e^-n/12: 5 shared ≈ .34, 12 ≈
     .63, 30 ≈ .92). Below .5 the percentage is rounded to the nearest 5,
     because a precise number on a thin overlap is misleading precision.
     ================================================================ */
  var MIN_SHARED = 5, FAV_Z = 0.75, CHANCE = 1.13;
  function match(mineMap, theirsMap, meta, opts) {
    opts = opts || {};
    var A = prep(mineMap), B = prep(theirsMap, meta);
    var bId = {}, bKey = {}, aId = {}, aKey = {};
    B.forEach(function (x) { bId[x.id] = x; if (x.k.length > 2) bKey[x.k] = x; });
    A.forEach(function (x) { aId[x.id] = x; if (x.k.length > 2) aKey[x.k] = x; });
    var pairs = [];
    A.forEach(function (a) { var b = bId[a.id] || bKey[a.k]; if (b) pairs.push({ a: a, b: b }); });
    var n = pairs.length;
    var res = { enough: n >= MIN_SHARED, shared: n, need: Math.max(0, MIN_SHARED - n), mine: A.length, theirs: B.length };
    // What each could hand the other, available even before there is overlap.
    function intro(from, toId, toKey, toArtists) {
      return from.filter(function (x) { return x.z >= 0.9 && !toId[x.id] && !toKey[x.k]; })
        .sort(function (x, y) { return y.z - x.z || y.s - x.s; })
        .reduce(function (acc, x) {   // one per artist: a list of five Radiohead records is one suggestion
          var ak = fold(firstArtist(x.artist)); if (acc.seen[ak]) return acc; acc.seen[ak] = 1;
          acc.list.push({ id: x.id, name: x.name, artist: x.artist, art: x.art, them: x.s, score: x.s, newArtist: !toArtists[ak] });
          return acc;
        }, { seen: {}, list: [] }).list.slice(0, 6);
    }
    var aArtists = {}, bArtists = {};
    A.forEach(function (x) { aArtists[fold(firstArtist(x.artist))] = 1; });
    B.forEach(function (x) { bArtists[fold(firstArtist(x.artist))] = 1; });
    res.unheard = intro(B, aId, aKey, aArtists);       // theirs, for you
    res.introduce = intro(A, bId, bKey, bArtists);     // yours, for them
    if (!res.enough) { res.pct = null; res.confidence = 0; res.level = 'none'; return res; }

    var za = pairs.map(function (p) { return p.a.z; }), zb = pairs.map(function (p) { return p.b.z; });
    var rho = spearman(za, zb), rhoS = rho * n / (n + 10);
    var mad = mean(pairs.map(function (p) { return Math.abs(p.a.z - p.b.z); }));
    var close = clamp(1 - mad / CHANCE);
    var sAgree = 0.5 * Math.max(0, rhoS) + 0.5 * close;

    var favA = pairs.filter(function (p) { return p.a.z >= FAV_Z; }), favB = pairs.filter(function (p) { return p.b.z >= FAV_Z; });
    var both = pairs.filter(function (p) { return p.a.z >= FAV_Z && p.b.z >= FAV_Z; });
    var either = favA.length + favB.length - both.length;
    var sFav = either ? both.length / either : null;
    var clashes = pairs.filter(function (p) { return (p.a.z >= FAV_Z && p.b.z <= -FAV_Z) || (p.b.z >= FAV_Z && p.a.z <= -FAV_Z); });
    var clashRate = clashes.length / n;
    var dislikes = pairs.filter(function (p) { return p.a.z <= -FAV_Z && p.b.z <= -FAV_Z; });

    // Per artist: each person's mean relative score for the artists both rated.
    var artA = {}, artB = {};
    A.forEach(function (x) { var k = fold(firstArtist(x.artist)); (artA[k] = artA[k] || { n: x.artist, z: [] }).z.push(x.z); });
    B.forEach(function (x) { var k = fold(firstArtist(x.artist)); (artB[k] = artB[k] || { n: x.artist, z: [] }).z.push(x.z); });
    var artPairs = Object.keys(artA).filter(function (k) { return artB[k]; }).map(function (k) {
      return { name: firstArtist(artA[k].n), a: mean(artA[k].z), b: mean(artB[k].z), na: artA[k].z.length, nb: artB[k].z.length };
    });
    var sArt = artPairs.length >= 3 ? clamp(1 - mean(artPairs.map(function (p) { return Math.abs(p.a - p.b); })) / CHANCE) : null;

    var parts = [{ k: 'agree', w: 0.55, s: sAgree }];
    if (sFav != null && either >= 3) parts.push({ k: 'fav', w: 0.25, s: sFav });
    if (sArt != null) parts.push({ k: 'artists', w: 0.20, s: sArt });
    var W = parts.reduce(function (t, p) { return t + p.w; }, 0);
    var S = parts.reduce(function (t, p) { return t + p.w * p.s; }, 0) / W;
    S = clamp(S - 0.25 * clashRate);

    var conf = 1 - Math.exp(-n / 12);
    var pct = Math.round(S * 100);
    if (conf < 0.5) pct = r5(pct);
    res.pct = pct;
    res.confidence = Math.round(conf * 100) / 100;
    res.level = conf >= 0.75 ? 'high' : conf >= 0.45 ? 'medium' : 'low';
    res.components = {
      rankAgreement: Math.round(rho * 100) / 100, closeness: Math.round(close * 100),
      sharedFavourites: both.length, eitherFavourite: either, clashes: clashes.length, sharedDislikes: dislikes.length,
      artistsCompared: artPairs.length, artistCloseness: sArt == null ? null : Math.round(sArt * 100)
    };

    function row(p) { return { id: p.a.id, name: p.a.name || p.b.name, artist: p.a.artist || p.b.artist, art: p.a.art || p.b.art, you: p.a.s, them: p.b.s, d: p.b.s - p.a.s }; }
    // Furthest apart, in RELATIVE terms, but printed in each person's real scores.
    var sorted = pairs.slice().sort(function (x, y) { return Math.abs(y.a.z - y.b.z) - Math.abs(x.a.z - x.b.z); });
    res.splits = sorted.filter(function (p, i) { return i === 0 || Math.abs(p.a.s - p.b.s) >= 10; }).slice(0, 3).map(row);
    res.agreed = pairs.filter(function (p) { return Math.abs(p.a.s - p.b.s) <= 4; })
      .sort(function (x, y) { return Math.min(y.a.s, y.b.s) - Math.min(x.a.s, x.b.s); }).slice(0, 2).map(row);
    res.overlaps = both.sort(function (x, y) { return (y.a.z + y.b.z) - (x.a.z + x.b.z); }).slice(0, 4).map(row);
    res.dislikes = dislikes.slice(0, 3).map(row);
    res.gap = Math.round(mean(pairs.map(function (p) { return Math.abs(p.a.s - p.b.s); })) * 10) / 10;

    // Rare shared favourites: only when the caller knows how many people rated each record.
    if (opts.raters) {
      res.gems = both.filter(function (p) { var r = opts.raters[p.a.id] || opts.raters[p.b.id]; return r != null && r <= 3; })
        .slice(0, 3).map(function (p) { var o = row(p); o.raters = opts.raters[p.a.id] || opts.raters[p.b.id]; return o; });
    }
    // Context, not part of the number.
    var gA = share(A, function (x) { return x.genre; }), gB = share(B, function (x) { return x.genre; });
    if (gA._n >= 8 && gB._n >= 8) res.genreSimilarity = Math.round(cosine(strip(gA), strip(gB)) * 100);
    var eA = share(A, function (x) { return decadeOf(x.year); }), eB = share(B, function (x) { return decadeOf(x.year); });
    if (eA._n >= 8 && eB._n >= 8) res.eraSimilarity = Math.round(cosine(strip(eA), strip(eB)) * 100);
    // A surprise: a record you both love that sits outside BOTH your usual genres.
    if (gA._n >= 8 && gB._n >= 8) {
      var topG = function (g) { return Object.keys(strip(g)).sort(function (x, y) { return g[y] - g[x]; }).slice(0, 2); };
      var ta = topG(gA), tb = topG(gB);
      var sur = res.overlaps.length ? both.filter(function (p) { var g = p.a.genre || p.b.genre; return g && ta.indexOf(g) < 0 && tb.indexOf(g) < 0; })[0] : null;
      if (sur) { res.surprise = row(sur); res.surprise.genre = sur.a.genre || sur.b.genre; }
    }
    res.blurb = blurb(res, artPairs);
    return res;
  }
  // One sentence of evidence, never a horoscope.
  function blurb(r, artPairs) {
    var c = r.components, bits = [];
    if (r.level === 'high' && r.pct <= 30) bits.push('A real difference: ' + r.shared + ' shared records and you rarely land in the same place.');
    else if (c.sharedFavourites >= 2) bits.push('You both rate ' + c.sharedFavourites + ' of your shared records well above your own averages.');
    else if (c.rankAgreement >= 0.5) bits.push('You put your shared records in much the same order.');
    else if (c.rankAgreement <= 0) bits.push('You put your shared records in a different order.');
    var close = artPairs.filter(function (p) { return Math.abs(p.a - p.b) < 0.35 && p.na + p.nb >= 3; }).sort(function (x, y) { return (y.na + y.nb) - (x.na + x.nb); })[0];
    if (close) bits.push('Closest on ' + close.name + '.');
    if (r.level === 'low') bits.push('An early read: only ' + r.shared + ' records in common.');
    return bits.join(' ');
  }

  /* ================================================================
     DEPTH — how somebody explores, not how much
     Six dimensions, each a RATIO so rating more of the same never raises
     it, each with a minimum amount of data before it is reported at all.
     Scores are rounded to fives: anything finer would be false precision.
     ================================================================ */
  var MIN_DEPTH = 15;
  function depth(albumsMap, songsMap, opts) {
    opts = opts || {};
    var now = opts.now || Date.now(), DAY = 864e5;
    var A = prep(albumsMap), S = prep(songsMap);
    var dims = {};
    var res = { albums: A.length, songs: S.length, ready: A.length >= MIN_DEPTH, need: Math.max(0, MIN_DEPTH - A.length), dims: dims };

    // Every first rating, in time order, to know when each artist first turned up.
    var ev = A.map(function (x) { return { t: x.t, a: fold(firstArtist(x.artist)), kind: 'album', x: x }; })
      .concat(S.map(function (x) { return { t: x.t, a: fold(firstArtist(x.artist)), kind: 'song', x: x }; }))
      .filter(function (e) { return e.t && e.a; }).sort(function (p, q) { return p.t - q.t; });
    var seen = {};
    ev.forEach(function (e) { e.newArtist = !seen[e.a]; seen[e.a] = 1; });

    // Exploration: of the last year's ratings, the share that met an artist for the first time.
    var yr = ev.filter(function (e) { return e.t >= now - 365 * DAY; });
    if (yr.length >= 10) {
      var nNew = yr.filter(function (e) { return e.newArtist; }).length, sh = nNew / yr.length;
      dims.exploration = { score: r5(clamp(sh / 0.6) * 100), evidence: Math.round(sh * 100) + '% of your ratings this year were a first look at an artist (' + nNew + ' of ' + yr.length + ')' };
    }
    // Diversity: how evenly spread across artists, genres and decades.
    if (A.length >= MIN_DEPTH) {
      var parts = [], ev2 = [];
      var aShare = strip(share(A, function (x) { return fold(firstArtist(x.artist)); })), H = 0, nA = Object.keys(aShare).length;
      Object.keys(aShare).forEach(function (k) { H -= aShare[k] * Math.log(aShare[k]); });
      var eff = Math.exp(H) / A.length; parts.push(eff); ev2.push(nA + ' artists across ' + A.length + ' albums');
      var g = share(A, function (x) { return x.genre; });
      if (g._n >= 10) { var gs = strip(g), Hg = 0, ng = Object.keys(gs).length; Object.keys(gs).forEach(function (k) { Hg -= gs[k] * Math.log(gs[k]); }); if (ng > 1) { parts.push(Hg / Math.log(Math.min(ng, 12))); ev2.push(ng + ' genres'); } }
      var d = share(A, function (x) { return decadeOf(x.year); });
      if (d._n >= 10) { var ds = strip(d), Hd = 0, nd = Object.keys(ds).length; Object.keys(ds).forEach(function (k) { Hd -= ds[k] * Math.log(ds[k]); }); if (nd > 1) { parts.push(Hd / Math.log(Math.min(nd, 7))); ev2.push(nd + ' decades'); } }
      dims.diversity = { score: r5(clamp(mean(parts)) * 100), evidence: ev2.join(', ') };
    }
    // Commitment: depth on artists and records, not volume.
    if (A.length >= MIN_DEPTH) {
      var byArt = {};
      A.forEach(function (x) { var k = fold(firstArtist(x.artist)); byArt[k] = (byArt[k] || 0) + 1; });
      var deepShare = A.filter(function (x) { return byArt[fold(firstArtist(x.artist))] >= 3; }).length / A.length;
      var perAlb = {};
      S.forEach(function (x) { var k = x.albumId || ''; if (k) perAlb[k] = (perAlb[k] || 0) + 1; });
      var takenApart = Object.keys(perAlb).filter(function (k) { return perAlb[k] >= 5; }).length;
      var rerated = A.filter(function (x) { return x.history && x.history.length > 1; }).length;
      var cm = 0.7 * deepShare + 0.15 * clamp(takenApart / Math.max(4, A.length * 0.15)) + 0.15 * clamp((rerated / A.length) / 0.3);
      dims.commitment = { score: r5(clamp(cm) * 100), evidence: Math.round(deepShare * 100) + '% of your albums are by artists you have rated 3 or more records from' + (takenApart ? '; ' + takenApart + ' albums rated track by track' : '') };
    }
    // Curiosity: recent ratings outside what you had established before them.
    if (A.length >= 25) {
      var chron = A.slice().sort(function (p, q) { return p.t - q.t; }), recent = chron.slice(-Math.min(40, Math.floor(A.length / 2))), before = chron.slice(0, chron.length - recent.length);
      var useG = share(before, function (x) { return x.genre; })._n >= 10 && recent.filter(function (x) { return x.genre; }).length >= 8;
      var f = useG ? function (x) { return x.genre; } : function (x) { return decadeOf(x.year); };
      var bs = strip(share(before, f)), top2 = Object.keys(bs).sort(function (p, q) { return bs[q] - bs[p]; }).slice(0, 2);
      var rk = recent.filter(function (x) { return f(x) != null && f(x) !== ''; });
      if (rk.length >= 8 && top2.length) {
        var out = rk.filter(function (x) { return top2.indexOf(String(f(x))) < 0; }).length / rk.length;
        dims.curiosity = { score: r5(clamp(out / 0.6) * 100), evidence: Math.round(out * 100) + '% of your recent albums sit outside your usual ' + (useG ? 'genres (' + top2.join(', ') + ')' : 'decades (' + top2.map(function (x) { return x + 's'; }).join(', ') + ')') };
      }
    }
    // Consistency: weeks with any rating, over the last 26 (or since you started).
    if (ev.length >= 10) {
      var since = Math.max(4, Math.min(26, Math.ceil((now - ev[0].t) / (7 * DAY))));
      var weeks = {};
      ev.forEach(function (e) { if (e.t >= now - since * 7 * DAY) weeks[Math.floor((now - e.t) / (7 * DAY))] = 1; });
      var wk = Object.keys(weeks).length;
      dims.consistency = { score: r5(clamp(wk / since) * 100), evidence: 'Active in ' + wk + ' of the last ' + since + ' weeks' };
    }
    // Obscurity: only when the community is big enough for "few people rated it" to mean anything.
    if (opts.raters && A.length >= MIN_DEPTH) {
      var known = A.map(function (x) { return opts.raters[x.id]; }).filter(function (v) { return v != null; });
      var med = known.slice().sort(function (p, q) { return p - q; })[Math.floor(known.length / 2)] || 0;
      if (known.length >= 15 && (opts.communitySize || 0) >= 50) {
        var rare = known.filter(function (v) { return v <= 2; }).length / known.length;
        dims.obscurity = { score: r5(clamp(rare / 0.6) * 100), evidence: Math.round(rare * 100) + '% of your albums have been rated by two or fewer people on VINALL', median: med };
      }
    }

    // The identity: the rule the data clears by the widest margin, said in its own evidence.
    var RULES = [
      { id: 'digger', name: 'Crate Digger', need: { obscurity: 65, exploration: 55 }, line: 'Most of what you rate, few others have.' },
      { id: 'completist', name: 'Completist', need: { commitment: 65 }, line: 'You go all the way through an artist.' },
      { id: 'wanderer', name: 'Wanderer', need: { diversity: 65, curiosity: 50 }, line: 'You keep leaving familiar ground.' },
      { id: 'scout', name: 'Scout', need: { exploration: 65 }, line: 'You are always meeting someone new.' },
      { id: 'loyalist', name: 'Loyalist', need: { commitment: 55 }, max: { exploration: 35 }, line: 'You know your artists, and stay with them.' },
      { id: 'regular', name: 'Regular', need: { consistency: 70 }, line: 'Week in, week out.', weak: true }
    ];
    var best = null;
    RULES.forEach(function (r) {
      var margin = Infinity, ok = true;
      Object.keys(r.need).forEach(function (k) { if (!dims[k]) { ok = false; return; } margin = Math.min(margin, dims[k].score - r.need[k]); if (dims[k].score < r.need[k]) ok = false; });
      if (r.max) Object.keys(r.max).forEach(function (k) { if (!dims[k] || dims[k].score > r.max[k]) ok = false; });
      // Turning up is a habit, not a taste: Regular only names somebody when
      // nothing about WHAT they rate stands out.
      if (ok && (!best || (best.rule.weak && !r.weak) || (!!best.rule.weak === !!r.weak && margin > best.margin))) best = { rule: r, margin: margin };
    });
    if (!res.ready) res.identity = { id: 'early', name: 'Getting started', line: 'Rate ' + res.need + ' more album' + (res.need === 1 ? '' : 's') + ' and this fills in.' };
    else if (best) {
      var key = Object.keys(best.rule.need)[0];
      res.identity = { id: best.rule.id, name: best.rule.name, line: best.rule.line, because: dims[key].evidence };
    } else {
      var top = Object.keys(dims).sort(function (p, q) { return dims[q].score - dims[p].score; })[0];
      res.identity = { id: 'balanced', name: 'All-rounder', line: 'No single habit stands out.', because: top ? dims[top].evidence : '' };
    }
    return res;
  }

  /* ================================================================
     ABOUT YOU — observations, each with the numbers behind it
     Every insight below has a condition; if the data does not clear it the
     insight is simply absent. Nothing here guesses at personality: they are
     statements about ratings, eras, genres and listening.
     ================================================================ */
  function insights(albumsMap, songsMap, opts) {
    opts = opts || {};
    var now = opts.now || Date.now(), DAY = 864e5;
    var A = prep(albumsMap), S = prep(songsMap), out = [];
    if (A.length < 10) return { ready: false, need: 10 - A.length, list: [] };
    var mu = A.mean;
    function art(x) { return { id: x.id, name: x.name, artist: x.artist, art: x.art, score: x.s }; }

    // 1. Your core: artists with 2+ albums, ranked by relative affinity and depth together.
    var byA = {};
    A.forEach(function (x) { var k = fold(firstArtist(x.artist)); (byA[k] = byA[k] || { name: firstArtist(x.artist), list: [] }).list.push(x); });
    var core = Object.keys(byA).map(function (k) { var L = byA[k].list; return { name: byA[k].name, n: L.length, avg: Math.round(mean(L.map(function (x) { return x.s; }))), aff: mean(L.map(function (x) { return x.z; })) * Math.sqrt(L.length), best: L.slice().sort(function (p, q) { return q.s - p.s; })[0] }; })
      .filter(function (a) { return a.n >= 2; }).sort(function (p, q) { return q.aff - p.aff; }).slice(0, 5);
    if (core.length >= 2) out.push({ id: 'core', kicker: 'Your core', headline: core.slice(0, 3).map(function (a) { return a.name; }).join(', ').replace(/, ([^,]*)$/, ' and $1'),
      detail: 'The artists you rate highest relative to your own average, counting only those with two or more albums rated.',
      items: core.map(function (a) { return { name: a.name, artist: a.n + ' albums · avg ' + a.avg, art: a.best.art, score: a.avg }; }) });

    // 2. Your scale.
    var sc = A.map(function (x) { return x.s; }), hist = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    sc.forEach(function (s) { hist[Math.min(9, Math.floor(s / 10))]++; });
    var hi = sc.filter(function (s) { return s >= 90; }).length, sd = sdOf(sc);
    var scaleLine = mu >= 80 ? 'You score generously: your average album gets ' + Math.round(mu) + '.'
      : mu <= 62 ? 'You are a tough marker: your average album gets ' + Math.round(mu) + '.'
      : sd >= 18 ? 'You use the whole scale: your scores spread ' + Math.round(sd) + ' points either side of ' + Math.round(mu) + '.'
      : 'Your scores sit close together around ' + Math.round(mu) + '.';
    out.push({ id: 'scale', kicker: 'Your scale', headline: scaleLine, detail: hi + ' of ' + A.length + ' albums scored 90 or more.', visual: { type: 'hist', data: hist } });

    // 3. Against everybody else, on the same records.
    if (opts.community) {
      var vs = A.map(function (x) { var c = opts.community[x.id]; return c && c.n >= 3 ? { x: x, crowd: c.mean, n: c.n } : null; }).filter(Boolean);
      if (vs.length >= 15) {
        var d = mean(vs.map(function (v) { return v.x.s - v.crowd; }));
        var takes = vs.slice().sort(function (p, q) { return Math.abs(q.x.s - q.crowd) - Math.abs(p.x.s - p.crowd); }).slice(0, 3);
        if (Math.abs(d) >= 3) out.push({ id: 'crowd', kicker: 'You and VINALL', headline: 'You rate ' + Math.abs(Math.round(d)) + ' points ' + (d < 0 ? 'below' : 'above') + ' everyone else on the same records.',
          detail: 'Across ' + vs.length + ' albums that at least three other people have rated.',
          items: takes.map(function (v) { var o = art(v.x); o.note = 'You ' + v.x.s + ' · VINALL ' + Math.round(v.crowd); return o; }) });
      }
    }

    // 4. The genre you rate most against the genre you rate highest.
    var g = {};
    A.forEach(function (x) { if (x.genre) (g[x.genre] = g[x.genre] || []).push(x.s); });
    var gl = Object.keys(g).filter(function (k) { return g[k].length >= 5; }).map(function (k) { return { g: k, n: g[k].length, avg: mean(g[k]) }; });
    if (gl.length >= 2) {
      var most = gl.slice().sort(function (p, q) { return q.n - p.n; })[0], best = gl.slice().sort(function (p, q) { return q.avg - p.avg; })[0];
      if (most.g !== best.g && best.avg - most.avg >= 5) out.push({ id: 'genre', kicker: 'A contradiction', headline: 'You rate more ' + most.g + ' than anything, but ' + best.g + ' gets your highest marks.',
        detail: best.g + ' averages ' + Math.round(best.avg) + ' across ' + best.n + ' albums; ' + most.g + ' averages ' + Math.round(most.avg) + ' across ' + most.n + '.',
        visual: { type: 'bars', data: gl.sort(function (p, q) { return q.n - p.n; }).slice(0, 6).map(function (x) { return { k: x.g, n: x.n, avg: Math.round(x.avg) }; }) } });
    }

    // 5. Eras: where your crate lives, and where your best marks go.
    var dd = {};
    A.forEach(function (x) { var dec = decadeOf(x.year); if (dec) (dd[dec] = dd[dec] || []).push(x.s); });
    var dl = Object.keys(dd).map(function (k) { return { d: +k, n: dd[k].length, avg: mean(dd[k]) }; }).sort(function (p, q) { return p.d - q.d; });
    var yrs = dl.reduce(function (t, x) { return t + x.n; }, 0);
    if (yrs >= 12 && dl.length >= 2) {
      var dMost = dl.slice().sort(function (p, q) { return q.n - p.n; })[0], dBest = dl.filter(function (x) { return x.n >= 4; }).sort(function (p, q) { return q.avg - p.avg; })[0];
      var line = dBest && dBest.d !== dMost.d && dBest.avg - dMost.avg >= 4
        ? 'Most of your crate is from the ' + dMost.d + 's, but the ' + dBest.d + 's get your best marks.'
        : Math.round(dMost.n / yrs * 100) + '% of your crate is from the ' + dMost.d + 's.';
      out.push({ id: 'eras', kicker: 'Your eras', headline: line, detail: 'From ' + yrs + ' albums with a release year.', visual: { type: 'eras', data: dl.map(function (x) { return { k: x.d + 's', n: x.n, avg: Math.round(x.avg) }; }) } });
    }

    // 6. Concentration.
    var counts = Object.keys(byA).map(function (k) { return byA[k].list.length; }).sort(function (p, q) { return q - p; });
    var top5 = counts.slice(0, 5).reduce(function (t, x) { return t + x; }, 0) / A.length;
    if (A.length >= 20) {
      if (top5 >= 0.3) out.push({ id: 'focus', kicker: 'Focus', headline: 'Five artists make up ' + Math.round(top5 * 100) + '% of your crate.', detail: Object.keys(byA).length + ' artists in all.' });
      else if (counts[0] <= 3) out.push({ id: 'focus', kicker: 'Spread', headline: 'No artist has more than ' + counts[0] + ' records in your crate.', detail: Object.keys(byA).length + ' artists across ' + A.length + ' albums.' });
    }

    // 7. Best recent discovery.
    var firstBy = {};
    A.concat(S).forEach(function (x) { var k = fold(firstArtist(x.artist)); if (x.t && (!firstBy[k] || x.t < firstBy[k])) firstBy[k] = x.t; });
    var fresh = Object.keys(byA).filter(function (k) { return firstBy[k] >= now - 180 * DAY; }).map(function (k) { var L = byA[k].list; return { name: byA[k].name, avg: mean(L.map(function (x) { return x.s; })), best: L.slice().sort(function (p, q) { return q.s - p.s; })[0], n: L.length }; })
      .filter(function (a) { return a.avg >= mu + 5; }).sort(function (p, q) { return q.avg - p.avg; });
    if (fresh.length) out.push({ id: 'find', kicker: 'Best recent find', headline: fresh[0].name, detail: 'First rated in the last six months, averaging ' + Math.round(fresh[0].avg) + ' — ' + Math.round(fresh[0].avg - mu) + ' above your usual.', items: fresh.slice(0, 3).map(function (a) { var o = art(a.best); o.note = 'avg ' + Math.round(a.avg); return o; }) });

    // 8. How your marks have moved, early ratings against recent ones.
    if (A.length >= 30) {
      var ch = A.slice().sort(function (p, q) { return p.t - q.t; }), third = Math.floor(ch.length / 3);
      var early = mean(ch.slice(0, third).map(function (x) { return x.s; })), late = mean(ch.slice(-third).map(function (x) { return x.s; }));
      if (Math.abs(late - early) >= 4) out.push({ id: 'drift', kicker: 'Over time', headline: late < early ? 'You have got tougher: your recent ratings average ' + Math.round(early - late) + ' points lower than your first ones.' : 'You have mellowed: your recent ratings average ' + Math.round(late - early) + ' points higher than your first ones.', detail: 'Your first ' + third + ' albums against your latest ' + third + '.' });
    }

    // 9. Changed minds.
    var moved = A.filter(function (x) { var h = x.history; return h && h.length > 1 && Math.abs(h[h.length - 1].s - h[0].s) >= 15; });
    if (moved.length >= 3) out.push({ id: 'minds', kicker: 'Second thoughts', headline: 'You have changed your mind by 15 points or more on ' + moved.length + ' records.', detail: 'VINALL keeps every score you have given a record.',
      items: moved.slice(0, 3).map(function (x) { var o = art(x); o.note = x.history[0].s + ' → ' + x.s; return o; }) });

    // 10. What you play against what you rate (only with imported listening).
    if (opts.listen && opts.listen.length) {
      var plays = {};
      opts.listen.forEach(function (r) { var k = fold(firstArtist(r.artist)); plays[k] = (plays[k] || 0) + (r.plays || 0); });
      var heavyLow = Object.keys(byA).filter(function (k) { return (plays[k] || 0) >= 100 && mean(byA[k].list.map(function (x) { return x.s; })) <= mu - 8; })
        .sort(function (p, q) { return plays[q] - plays[p]; })[0];
      var highRare = Object.keys(byA).filter(function (k) { return byA[k].list.length >= 2 && mean(byA[k].list.map(function (x) { return x.s; })) >= mu + 8 && (plays[k] || 0) < 10; })
        .sort(function (p, q) { return mean(byA[q].list.map(function (x) { return x.s; })) - mean(byA[p].list.map(function (x) { return x.s; })); })[0];
      if (heavyLow) out.push({ id: 'played-low', kicker: 'Played, not rated', headline: 'You have played ' + byA[heavyLow].name + ' ' + plays[heavyLow].toLocaleString('en-GB') + ' times, but rate their albums ' + Math.round(mean(byA[heavyLow].list.map(function (x) { return x.s; }))) + ' on average.', detail: 'Your overall average is ' + Math.round(mu) + '. From your imported Spotify history.' });
      if (highRare) out.push({ id: 'rated-rare', kicker: 'Rated, not played', headline: 'You rate ' + byA[highRare].name + ' ' + Math.round(mean(byA[highRare].list.map(function (x) { return x.s; }))) + ' on average, but barely play them' + ((plays[highRare] || 0) ? ' (' + plays[highRare] + ' plays)' : '') + '.', detail: 'From your imported Spotify history.' });
    }
    return { ready: true, albums: A.length, songs: S.length, mean: Math.round(mu), list: out };
  }

  /* ================================================================
     YOUR MUSIC — the order imported music is offered for rating
       played a lot      log plays, against the most-played thing you have
       played recently   last play within 90 days
       you asked for it  liked or saved on Spotify
       familiar artist   you already rate them, so it is a quick call
       whole records     an album you have several tracks of
     then INTERLEAVED so no artist appears twice within four cards. Ties
     break on the id, so the order is the same every time.
     ================================================================ */
  function queue(items, opts) {
    opts = opts || {};
    var now = opts.now || Date.now(), DAY = 864e5;
    var maxP = Math.max(1, Math.max.apply(null, items.map(function (x) { return x.plays || 0; }).concat([0])));
    var scored = items.map(function (x) {
      var s = 3 * (Math.log(1 + (x.plays || 0)) / Math.log(1 + maxP))
        + (x.lastPlayed && now - x.lastPlayed < 90 * DAY ? 1 : 0)
        + (x.liked || x.saved ? 0.8 : 0)
        + (x.familiar ? 0.6 : 0)
        + Math.min(1, Math.log(1 + (x.tracks || 0)) / Math.log(12));
      return { x: x, s: s };
    }).sort(function (p, q) { return q.s - p.s || String(p.x.id).localeCompare(String(q.x.id)); });
    var out = [], recent = [], pool = scored.slice();
    while (pool.length) {
      // The gap adapts to what is left: four cards apart while there is the
      // variety for it, narrowing as the pool runs down to a few artists, so a
      // library dominated by one artist still never shows them back to back
      // while anything else remains.
      var left = {}; pool.forEach(function (p) { left[fold(firstArtist(p.x.artist))] = 1; });
      var win = Math.max(1, Math.min(3, Object.keys(left).length - 1));
      var block = recent.slice(-win);
      var i = pool.findIndex(function (p) { return block.indexOf(fold(firstArtist(p.x.artist))) < 0; });
      if (i < 0) i = 0;
      var pick = pool.splice(i, 1)[0];
      out.push(pick.x);
      recent.push(fold(firstArtist(pick.x.artist)));
      if (recent.length > 3) recent.shift();
    }
    return out;
  }

  root.TasteCore = { fold: fold, recKey: recKey, firstArtist: firstArtist, prep: prep, spearman: spearman,
    match: match, depth: depth, insights: insights, queue: queue, MIN_SHARED: MIN_SHARED };
})(typeof window !== 'undefined' ? window : globalThis);
