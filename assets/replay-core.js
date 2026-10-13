/* ================================================================
   VINALL REPLAY — the arithmetic.

   Pure functions only: no DOM, no network, no storage. Everything Replay
   says about somebody is computed here, which is what lets
   `node scripts/replay.selfcheck.mjs` hold it to account — period edges,
   British Summer Time, duplicate imports, Music DNA thresholds.

   TWO SOURCES THAT ARE NEVER INTERCHANGEABLE:

     crate     — what you RATED in VINALL: every album and song rating carries
                 a timestamped score history (pushScoreHistory). Gives most
                 RATED, highest rated, discoveries, changes of mind, genres.
     listening — what you PLAYED, from a Spotify data export, folded per day
                 (listening_days). Gives most PLAYED, minutes, busiest day.

   Nothing here estimates one from the other. An artist is "most played" only
   when listening data says so, and minutes are never derived from ratings.

   Periods are LOCAL time: a week is Monday 00:00 to the next Monday 00:00 in
   the browser's zone, built with new Date(y, m, d) so DST is the calendar's
   problem rather than ours. All boundaries are half-open: [start, end).
   ================================================================ */
(function (root) {
  'use strict';

  var DAY = 864e5;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MON3 = MONTHS.map(function (m) { return m.slice(0, 3); });

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(ms) { var d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dayStart(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).getTime(); }
  function fmtDay(ms) { var d = new Date(ms); return d.getDate() + ' ' + MON3[d.getMonth()]; }

  /* ---- periods ----------------------------------------------------------- */
  function make(kind, s, e) {
    var sd = new Date(s), last = e - 1, ed = new Date(last);
    var p = { kind: kind, start: s, end: e, startDay: dayKey(s), endDay: dayKey(last), year: sd.getFullYear() };
    if (kind === 'year') {
      p.key = 'y' + sd.getFullYear(); p.label = String(sd.getFullYear()); p.short = p.label;
    } else if (kind === 'month') {
      p.key = 'm' + sd.getFullYear() + '-' + pad(sd.getMonth() + 1);
      p.label = MONTHS[sd.getMonth()] + ' ' + sd.getFullYear(); p.short = MON3[sd.getMonth()] + ' ' + sd.getFullYear();
      p.month = MONTHS[sd.getMonth()];
    } else {
      p.key = 'w' + p.startDay;
      p.label = fmtDay(s) + ' – ' + fmtDay(last) + (ed.getFullYear() !== new Date().getFullYear() ? ' ' + ed.getFullYear() : '');
      p.short = 'w/c ' + fmtDay(s);
    }
    return p;
  }
  function period(kind, at) {
    var d = new Date(at == null ? Date.now() : at);
    if (kind === 'year') return make('year', new Date(d.getFullYear(), 0, 1).getTime(), new Date(d.getFullYear() + 1, 0, 1).getTime());
    if (kind === 'month') return make('month', new Date(d.getFullYear(), d.getMonth(), 1).getTime(), new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime());
    var back = (d.getDay() + 6) % 7;                         // Monday = 0
    var s = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
    return make('week', s.getTime(), new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7).getTime());
  }
  function prev(p) { return period(p.kind, p.start - 1); }
  function next(p) { return period(p.kind, p.end); }
  function fromKey(key) {
    var m = /^([ywm])(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(String(key || ''));
    if (!m) return null;
    if (m[1] === 'y') return period('year', new Date(+m[2], 0, 1).getTime());
    if (m[1] === 'm') return period('month', new Date(+m[2], +m[3] - 1, 1).getTime());
    return period('week', new Date(+m[2], +m[3] - 1, +m[4]).getTime());
  }
  function complete(p, now) { return (now == null ? Date.now() : now) >= p.end; }
  // Buckets inside a period, for "evolution": months of a year, weeks of a
  // month (clipped to the month), days of a week.
  function buckets(p) {
    var out = [];
    if (p.kind === 'year') {
      for (var m = 0; m < 12; m++) {
        var s = new Date(p.year, m, 1).getTime(), e = new Date(p.year, m + 1, 1).getTime();
        out.push({ start: s, end: e, label: MON3[m], long: MONTHS[m] });
      }
    } else if (p.kind === 'month') {
      var w = period('week', p.start);
      while (w.start < p.end) {
        var s2 = Math.max(w.start, p.start), e2 = Math.min(w.end, p.end);
        out.push({ start: s2, end: e2, label: fmtDay(s2), long: 'w/c ' + fmtDay(s2) });
        w = next(w);
      }
    } else {
      var names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      for (var i = 0; i < 7; i++) {
        var d = new Date(p.start); var ds = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i).getTime();
        var de = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i + 1).getTime();
        out.push({ start: ds, end: de, label: names[i], long: names[i] + ' ' + fmtDay(ds) });
      }
    }
    return out;
  }

  /* ---- listening import: parse, dedupe, fold per day ---------------------
     Spotify timestamps are UTC. The Extended file says so (`ts` ends in Z);
     the basic StreamingHistory file writes "2024-03-31 01:05" with no zone,
     which JavaScript would read as LOCAL time — an hour out for half the
     year. It is parsed as UTC explicitly. */
  function parseUtc(s) {
    if (!s) return NaN;
    var t = String(s).trim();
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(t)) t = t.replace(' ', 'T') + 'Z';
    return Date.parse(t);
  }
  /* People drop the whole zip, which can hold BOTH the basic one-year history
     and the Extended one — the same plays twice. Both stamp the END of the
     play; the basic file to the minute, the Extended to the second. So one
     play is one (track, end-minute). Events with no time cannot be matched
     and are kept. Returns the events in their original order. */
  function dedupe(events, keyOf) {
    var seen = Object.create(null), out = [];
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (!e) continue;
      if (e.at != null && !isNaN(e.at)) {
        var id = keyOf(e.artist, e.track) + '@' + Math.floor(e.at / 60000);
        if (seen[id]) continue;
        seen[id] = 1;
      }
      out.push(e);
    }
    return out;
  }
  // One row per (local day, track). Events without a time cannot be placed
  // in a day and are left out of Replay (they still count in the lifetime
  // listening_plays rows).
  function foldDays(events, keyOf) {
    var by = Object.create(null), rows = [];
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (!e || e.at == null || isNaN(e.at)) continue;
      var k = keyOf(e.artist, e.track), day = dayKey(e.at), id = day + '|' + k;
      var r = by[id];
      if (!r) { r = by[id] = { day: day, k: k, artist: e.artist, track: e.track, album: e.album || null, uri: e.uri || null, plays: 0, ms: 0 }; rows.push(r); }
      r.plays++; r.ms += Math.round(e.ms || 0);
      if (!r.album && e.album) r.album = e.album;
      if (!r.uri && e.uri) r.uri = e.uri;
    }
    return rows;
  }

  /* ---- the crate --------------------------------------------------------- */
  function fold(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function firstArtist(s) { return String(s || '').split(/,\s+|\s+&\s+|\s+feat\.?\s+|\s+x\s+/i)[0].trim(); }
  // Entries oldest first. A rating made before history existed has none, so
  // its score is placed at the moment it entered the crate.
  function hist(it) {
    var h = (it && Array.isArray(it.history) && it.history.length) ? it.history.filter(function (x) { return x && typeof x.s === 'number' && x.t; }) : [];
    if (!h.length && it && typeof it.score === 'number') h = [{ s: it.score, t: it.savedAt || it.ratedAt || 0 }];
    return h;
  }
  function firstT(it) { var h = hist(it); return h.length ? h[0].t : 0; }
  // The score as it stood when the period closed — so a Replay for March
  // says what you thought in March, not what you think today.
  function scoreAt(it, t) {
    var h = hist(it), s = null;
    for (var i = 0; i < h.length; i++) if (h[i].t < t) s = h[i].s;
    return s;
  }
  function inP(t, p) { return t >= p.start && t < p.end; }
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
  function sd(a) { var m = mean(a); return a.length > 1 ? Math.sqrt(mean(a.map(function (x) { return (x - m) * (x - m); }))) : 0; }
  function median(a) { if (!a.length) return null; var b = a.slice().sort(function (x, y) { return x - y; }); var h = b.length >> 1; return b.length % 2 ? b[h] : (b[h - 1] + b[h]) / 2; }
  function round1(x) { return Math.round(x * 10) / 10; }
  function genreName(g) {
    g = String(g || '').trim(); if (!g) return '';
    return g.replace(/\b([a-z])/g, function (m) { return m.toUpperCase(); }).replace(/\bHip Hop\b|Hip-hop|Rap\/hip Hop/i, 'Hip-Hop');
  }

  // What the crate says about one period. `input` is { albums, songs, liked }
  // exactly as localStorage holds them.
  function crateStats(input, p) {
    var albums = values(input && input.albums), songs = values(input && input.songs);
    var liked = values(input && input.liked);
    // First time each ARTIST appears anywhere in the crate, for discoveries.
    var artistFirst = Object.create(null), artistName = Object.create(null);
    function noteArtist(name, t) {
      var k = fold(firstArtist(name)); if (!k || !t) return;
      if (!artistFirst[k] || t < artistFirst[k]) artistFirst[k] = t;
      if (!artistName[k]) artistName[k] = firstArtist(name);
    }
    albums.forEach(function (a) { noteArtist(a.artist, firstT(a)); });
    songs.forEach(function (s) { noteArtist(s.artist, firstT(s)); });

    var newAlbums = [], newSongs = [], rerates = 0, moves = [], dayHits = Object.create(null);
    function scan(it, isAlbum) {
      var h = hist(it); if (!h.length) return;
      for (var i = 0; i < h.length; i++) if (inP(h[i].t, p)) { dayHits[dayKey(h[i].t)] = 1; if (i > 0) rerates++; }
      if (inP(h[0].t, p)) (isAlbum ? newAlbums : newSongs).push(it);
      if (!isAlbum) return;
      // A change of mind is a score that moved DURING the period: from what
      // it was going in (or the first verdict made inside it) to how it left.
      var touched = h.some(function (x, i) { return i > 0 && inP(x.t, p); });
      if (!touched) return;
      var from = scoreAt(it, p.start);
      if (from == null) { for (var j = 0; j < h.length; j++) if (inP(h[j].t, p)) { from = h[j].s; break; } }
      var to = scoreAt(it, p.end);
      if (from != null && to != null && Math.abs(to - from) >= 5) {
        moves.push({ id: it.id, name: it.name, artist: it.artist, art: it.art || '', from: from, to: to, delta: to - from });
      }
    }
    albums.forEach(function (a) { scan(a, true); });
    songs.forEach(function (s) { scan(s, false); });
    moves.sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); });

    var albumRows = newAlbums.map(function (a) {
      return { id: a.id, name: a.name, artist: a.artist, art: a.art || '', year: parseInt(a.year, 10) || null,
               genre: genreName(a.genre), score: scoreAt(a, p.end), t: firstT(a) };
    }).filter(function (a) { return a.score != null; });
    var songRows = newSongs.map(function (s) {
      return { id: s.id, name: s.name, artist: s.artist, art: s.art || '', albumId: s.albumId || '', albumName: s.albumName || '',
               score: scoreAt(s, p.end), t: firstT(s) };
    }).filter(function (s) { return s.score != null; });

    var topAlbums = albumRows.slice().sort(function (a, b) { return b.score - a.score || a.t - b.t; }).slice(0, 10);
    var topSongs = songRows.slice().sort(function (a, b) { return b.score - a.score || a.t - b.t; }).slice(0, 10);

    // Most RATED artists — a count of verdicts, never a play count.
    var art = Object.create(null);
    function bump(name, score100, artUrl) {
      var k = fold(firstArtist(name)); if (!k) return;
      var r = art[k] || (art[k] = { name: firstArtist(name), n: 0, scores: [], art: '' });
      r.n++; if (score100 != null) r.scores.push(score100);
      if (!r.art && artUrl) r.art = artUrl;
    }
    albumRows.forEach(function (a) { bump(a.artist, a.score, a.art); });
    songRows.forEach(function (s) { bump(s.artist, s.score * 10, s.art); });
    var topArtists = Object.keys(art).map(function (k) {
      var r = art[k]; return { name: r.name, n: r.n, avg: r.scores.length ? Math.round(mean(r.scores)) : null, art: r.art, key: k };
    }).sort(function (a, b) { return b.n - a.n || (b.avg || 0) - (a.avg || 0) || a.name.localeCompare(b.name); });

    // Genres of the albums rated, weighted equally.
    var gc = Object.create(null), gN = 0;
    albumRows.forEach(function (a) { if (a.genre) { gc[a.genre] = (gc[a.genre] || 0) + 1; gN++; } });
    var genres = Object.keys(gc).map(function (g) { return { name: g, n: gc[g], share: gc[g] / gN }; })
      .sort(function (a, b) { return b.n - a.n || a.name.localeCompare(b.name); });

    // Discoveries: an artist whose FIRST rating ever is inside the period.
    var disc = Object.keys(artistFirst).filter(function (k) { return inP(artistFirst[k], p); });
    var discSet = Object.create(null); disc.forEach(function (k) { discSet[k] = 1; });
    var discAlbums = albumRows.filter(function (a) { return discSet[fold(firstArtist(a.artist))]; })
      .sort(function (a, b) { return b.score - a.score || a.t - b.t; });
    var discoveries = disc.map(function (k) {
      var best = discAlbums.filter(function (a) { return fold(firstArtist(a.artist)) === k; })[0];
      return { name: artistName[k], first: artistFirst[k], art: best ? best.art : ((art[k] || {}).art || ''), score: best ? best.score : null };
    }).sort(function (a, b) { return (b.score || 0) - (a.score || 0) || a.first - b.first; });

    // Longest run of consecutive local days with any rating in it.
    var days = Object.keys(dayHits).sort(), streak = 0, run = 0, prevD = null;
    days.forEach(function (d) {
      var t = dayStart(d);
      run = (prevD != null && Math.round((t - prevD) / DAY) === 1) ? run + 1 : 1;
      streak = Math.max(streak, run); prevD = t;
    });

    // Milestones: totals crossing round numbers during the period.
    var STEPS = [1, 10, 25, 50, 100, 250, 500, 1000, 2500];
    function crossed(list) {
      var before = list.filter(function (x) { return firstT(x) && firstT(x) < p.start; }).length;
      var after = list.filter(function (x) { return firstT(x) && firstT(x) < p.end; }).length;
      return STEPS.filter(function (s) { return before < s && after >= s; });
    }
    var milestones = [];
    crossed(albums).forEach(function (s) { milestones.push({ kind: 'albums', n: s, text: s === 1 ? 'Your first album rating' : s.toLocaleString('en-GB') + ' albums rated' }); });
    crossed(songs).forEach(function (s) { milestones.push({ kind: 'songs', n: s, text: s === 1 ? 'Your first song rating' : s.toLocaleString('en-GB') + ' songs rated' }); });
    var perfect = albumRows.filter(function (a) { return a.score === 100; });
    if (perfect.length) milestones.push({ kind: 'perfect', n: perfect.length, text: perfect.length === 1 ? 'A perfect 100 — ' + perfect[0].name : perfect.length + ' perfect 100s' });
    if (streak >= 3) milestones.push({ kind: 'streak', n: streak, text: streak + ' days rating in a row' });
    if (moves.length && Math.abs(moves[0].delta) >= 20) milestones.push({ kind: 'move', n: Math.abs(moves[0].delta), text: 'Your biggest change of mind: ' + Math.abs(moves[0].delta) + ' points' });

    var scores = albumRows.map(function (a) { return a.score; });
    var years = albumRows.map(function (a) { return a.year; }).filter(Boolean);

    // Evolution, bucket by bucket.
    var evo = buckets(p).map(function (b) {
      var al = albumRows.filter(function (a) { return a.t >= b.start && a.t < b.end; });
      var so = songRows.filter(function (s) { return s.t >= b.start && s.t < b.end; });
      var g = Object.create(null); al.forEach(function (a) { if (a.genre) g[a.genre] = (g[a.genre] || 0) + 1; });
      var tg = Object.keys(g).sort(function (x, y) { return g[y] - g[x] || x.localeCompare(y); })[0] || '';
      var sc = al.map(function (a) { return a.score; });
      return { label: b.label, long: b.long, start: b.start, end: b.end, albums: al.length, songs: so.length,
               avg: sc.length ? Math.round(mean(sc)) : null, genre: tg };
    });

    return {
      albums: albumRows.length, songs: songRows.length, rerates: rerates,
      liked: liked.filter(function (x) { return inP(x.savedAt || x.likedAt || 0, p); }).length,
      artists: Object.keys(art).length,
      avg: scores.length ? round1(mean(scores)) : null, sd: round1(sd(scores)),
      high: scores.length ? Math.max.apply(null, scores) : null,
      medianYear: years.length >= 3 ? Math.round(median(years)) : null, yearsKnown: years.length,
      freshShare: years.length ? years.filter(function (y) { return y >= p.year; }).length / years.length : 0,
      topAlbums: topAlbums, topSongs: topSongs, topArtists: topArtists.slice(0, 10),
      artistAlbums: topArtists.length ? albumRows.filter(function (a) { return fold(firstArtist(a.artist)) === topArtists[0].key; }).length : 0,
      genres: genres.slice(0, 8), genresKnown: gN,
      discoveries: discoveries.slice(0, 12), discoveryCount: discoveries.length,
      moves: moves.slice(0, 5), streak: streak, activeDays: days.length, milestones: milestones,
      architect: architectCount(songRows), evolution: evo,
      covers: albumRows.slice().sort(function (a, b) { return b.score - a.score; }).map(function (a) { return a.art; }).filter(Boolean).slice(0, 60)
    };
  }
  // Records with five or more songs rated inside the period — somebody taking
  // an album apart track by track.
  function architectCount(songRows) {
    var c = Object.create(null);
    songRows.forEach(function (s) { var k = s.albumId || fold(s.albumName); if (k) c[k] = (c[k] || 0) + 1; });
    return Object.keys(c).filter(function (k) { return c[k] >= 5; }).length;
  }
  function values(o) { return o ? Object.keys(o).map(function (k) { return o[k]; }).filter(Boolean) : []; }

  /* ---- listening, as the server summarised it ---------------------------- */
  // Is there enough listening data INSIDE this period to say anything true?
  var MIN_PLAYS = { week: 15, month: 40, year: 150 };
  function listeningUsable(L, p) {
    if (!L || !L.plays) return false;
    return L.plays >= (MIN_PLAYS[p.kind] || 40);
  }
  // Coverage, said plainly when partial: the export ends on a day, and a
  // period that runs past it is only partly heard.
  function coverage(L, p) {
    if (!L || !L.data_to) return null;
    var to = dayStart(L.data_to), from = dayStart(L.data_from);
    var full = from <= p.start && to >= p.end - DAY;
    return { full: full, from: from, to: to, endsEarly: to < p.end - DAY, note: to < p.end - DAY ? 'Your Spotify file runs to ' + fmtDay(to) + ' ' + new Date(to).getFullYear() : '' };
  }
  // Listening "discoveries" only mean something when the data reaches well
  // back before the period. The first month of any export calls everything new.
  function listeningDiscoveriesValid(L, p) {
    return !!(L && L.data_from && dayStart(L.data_from) <= p.start - 90 * DAY);
  }

  /* ---- Music DNA ----------------------------------------------------------
     Each archetype is a rule with a THRESHOLD and EVIDENCE: it is only
     eligible when the data clears the bar, its strength is 0..1, and it must
     be able to say why in numbers taken from the person's own activity. The
     strongest eligible one leads; the next is a secondary trait. When nothing
     clears a bar there is no flattering invention — the fallback describes
     exactly what is there. */
  var ARCHETYPES = {
    diver:     { name: 'The Deep Diver',      line: 'When you find an artist, you go all the way down.' },
    hopper:    { name: 'The Genre Hopper',    line: 'No home genre. Every door open.' },
    loyal:     { name: 'The Loyal Listener',  line: 'You know what you love, and you keep it on.' },
    architect: { name: 'The Album Architect', line: 'You take records apart, track by track.' },
    nostalgic: { name: 'The Nostalgic',       line: 'The past keeps calling, and you keep answering.' },
    trend:     { name: 'The Trendsetter',     line: 'You hear it the year it lands.' },
    explorer:  { name: 'The Explorer',        line: 'Most of your year was somewhere new.' },
    critic:    { name: 'The Critic',          line: 'A high score from you has to be earned.' },
    curator:   { name: 'The Curator',         line: 'Every rating a deliberate choice.' }
  };
  function clamp(x) { return Math.max(0, Math.min(1, x)); }
  function pct(x) { return Math.round(x * 100) + '%'; }
  function entropyNorm(genres) {
    if (genres.length < 2) return 0;
    var H = 0; genres.forEach(function (g) { if (g.share > 0) H -= g.share * Math.log(g.share); });
    return H / Math.log(genres.length);
  }
  function dna(c, L, p) {
    var out = [];
    var items = (c.albums || 0) + (c.songs || 0);
    var top = c.topArtists && c.topArtists[0];
    var scale = p.kind === 'year' ? 1 : p.kind === 'month' ? 0.45 : 0.25;   // less data in a shorter period

    if (top && c.artistAlbums >= Math.max(2, Math.round(3 * scale + 0.4)) && items >= 6 * scale) {
      out.push({ id: 'diver', score: clamp(c.artistAlbums / 5) * 0.6 + clamp(top.n / Math.max(1, items)) * 0.4,
        evidence: [c.artistAlbums + ' records by ' + top.name + ' rated', top.n + ' of your ' + items + ' ratings were ' + top.name] });
    }
    if (c.genres.length >= 5 && c.genresKnown >= Math.max(5, 8 * scale)) {
      var en = entropyNorm(c.genres);
      if (en >= 0.75) out.push({ id: 'hopper', score: en,
        evidence: [c.genres.length + ' genres across ' + c.genresKnown + ' albums', 'None took more than ' + pct(c.genres[0].share)] });
    }
    if (L && L.plays >= (MIN_PLAYS[p.kind] || 40) && L.top_artists && L.top_artists.length >= 5 && L.ms > 0) {
      var five = L.top_artists.slice(0, 5).reduce(function (s, a) { return s + (a.ms || 0); }, 0) / L.ms;
      if (five >= 0.45) out.push({ id: 'loyal', score: clamp(five),
        evidence: ['Your top five artists were ' + pct(five) + ' of your listening', L.top_artists[0].artist + ' alone: ' + pct((L.top_artists[0].ms || 0) / L.ms)] });
    }
    if (c.architect >= (p.kind === 'year' ? 2 : 1)) {
      out.push({ id: 'architect', score: clamp(c.architect / 6) * 0.7 + clamp(c.songs / Math.max(1, c.albums * 5)) * 0.3,
        evidence: ['Five or more songs rated on ' + c.architect + ' record' + (c.architect === 1 ? '' : 's'), c.songs + ' songs rated in all'] });
    }
    if (c.yearsKnown >= 6 && c.medianYear) {
      var age = p.year - c.medianYear;
      if (age >= 15) out.push({ id: 'nostalgic', score: clamp(age / 30),
        evidence: ['Your typical record came out in ' + c.medianYear, age + ' years before this one'] });
      if (c.freshShare >= 0.4) out.push({ id: 'trend', score: clamp(c.freshShare),
        evidence: [pct(c.freshShare) + ' of what you rated came out in ' + p.year, c.yearsKnown + ' albums with a release year'] });
    }
    if (c.artists >= Math.max(5, 8 * scale) && c.discoveryCount) {
      var ds = c.discoveryCount / c.artists;
      if (ds >= 0.5) out.push({ id: 'explorer', score: clamp(ds * 0.7 + clamp(c.artists / Math.max(1, items)) * 0.3),
        evidence: [c.discoveryCount + ' of ' + c.artists + ' artists were new to your crate', c.discoveries[0] ? 'Best new name: ' + c.discoveries[0].name : ''] });
    }
    if (c.albums >= Math.max(4, 6 * scale) && c.avg != null && (c.avg <= 65 || c.sd >= 18)) {
      out.push({ id: 'critic', score: clamp(Math.max((72 - c.avg) / 25, (c.sd - 12) / 16)),
        evidence: ['Average score ' + c.avg + ' across ' + c.albums + ' albums', 'Spread of ' + c.sd + ' points between verdicts'] });
    }
    out.sort(function (a, b) { return b.score - a.score || a.id.localeCompare(b.id); });
    if (!out.length) {
      if (!items) return null;
      out.push({ id: 'curator', score: 0, fallback: true,
        evidence: [items + ' ratings this ' + (p.kind === 'year' ? 'year' : p.kind), c.avg != null ? 'Average album score ' + c.avg : c.artists + ' artists'] });
    }
    function dress(x) { if (!x) return null; var a = ARCHETYPES[x.id]; return { id: x.id, name: a.name, line: a.line, score: round1(x.score), evidence: x.evidence.filter(Boolean), fallback: !!x.fallback }; }
    return { primary: dress(out[0]), secondary: dress(out[1]), all: out.map(function (x) { return { id: x.id, score: round1(x.score) }; }) };
  }

  /* ---- the comparison with the period before ------------------------------ */
  function compare(c, cPrev, L, LPrev) {
    if (!cPrev) return null;
    var rows = [];
    rows.push({ k: 'Ratings', now: c.albums + c.songs, then: cPrev.albums + cPrev.songs });
    if (c.avg != null && cPrev.avg != null) rows.push({ k: 'Average album score', now: c.avg, then: cPrev.avg });
    rows.push({ k: 'Artists', now: c.artists, then: cPrev.artists });
    if (L && LPrev && L.ms && LPrev.ms) rows.push({ k: 'Minutes listened', now: Math.round(L.ms / 60000), then: Math.round(LPrev.ms / 60000) });
    var g = c.genres[0] && c.genres[0].name, gp = cPrev.genres[0] && cPrev.genres[0].name;
    return { rows: rows, genreNow: g || '', genreThen: gp || '', genreShift: !!(g && gp && g !== gp) };
  }

  // One sentence about how the period moved, only when the numbers support it.
  function evolutionLine(c, p) {
    var b = c.evolution.filter(function (x) { return x.albums + x.songs > 0; });
    if (b.length < 2) return '';
    var busiest = c.evolution.slice().sort(function (x, y) { return (y.albums + y.songs) - (x.albums + x.songs); })[0];
    var line = 'Your busiest ' + (p.kind === 'year' ? 'month was ' + busiest.long : p.kind === 'month' ? 'week began ' + busiest.label : 'day was ' + busiest.long) + '.';
    var withAvg = b.filter(function (x) { return x.avg != null; });
    if (withAvg.length >= 4) {
      var h = withAvg.length >> 1;
      var a1 = mean(withAvg.slice(0, h).map(function (x) { return x.avg; })), a2 = mean(withAvg.slice(h).map(function (x) { return x.avg; }));
      if (a2 - a1 >= 4) line += ' Your scores warmed as it went on.';
      else if (a1 - a2 >= 4) line += ' Your scores got tougher as it went on.';
    }
    return line;
  }

  root.ReplayCore = {
    DAY: DAY, MONTHS: MONTHS, dayKey: dayKey, dayStart: dayStart, fmtDay: fmtDay,
    period: period, prev: prev, next: next, fromKey: fromKey, complete: complete, buckets: buckets,
    parseUtc: parseUtc, dedupe: dedupe, foldDays: foldDays,
    hist: hist, firstT: firstT, scoreAt: scoreAt, crateStats: crateStats,
    listeningUsable: listeningUsable, coverage: coverage, listeningDiscoveriesValid: listeningDiscoveriesValid,
    dna: dna, ARCHETYPES: ARCHETYPES, compare: compare, evolutionLine: evolutionLine,
    foldName: fold, firstArtist: firstArtist, MIN_PLAYS: MIN_PLAYS
  };
})(typeof window !== 'undefined' ? window : globalThis);
