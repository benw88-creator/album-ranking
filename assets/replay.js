/* ================================================================
   VINALL REPLAY — the experience.

   Data in (crate + listening, via ReplayCore), a story out. Three rules:

   1. ONLY WHAT IS TRUE. A scene appears when the data behind it clears a
      bar; "most played" appears only over listening data; a partial Spotify
      file says where it ends. The demo is fabricated and says so on every
      scene and every export.
   2. COMPLETED PERIODS ARE FROZEN. The first time a finished week, month or
      year is built its statistics are snapshotted (crate_replay_v1, synced
      like ratings), so re-rating a record in December does not rewrite the
      March you already shared. Listening is re-asked only when a newer import
      has landed since the snapshot.
   3. NOTHING PER FRAME. All numbers are computed once when a story opens.
      Animation is CSS transforms and opacity; the only script that runs per
      frame is a 1.2s count-up, once per number.
   ================================================================ */
(function () {
  'use strict';
  var R = window.ReplayCore;
  if (!R) return;

  var SNAP_KEY = 'crate_replay_v1', SNAP_V = 1, LDAYS_AT = 'crate_listening_days_at';
  var DUR = { open: 6500, minutes: 8500, record: 7000, sound: 8500, artists: 9500, tracks: 10000, albums: 8500,
              discover: 8500, mind: 8500, evolution: 10000, compare: 8500, dna: 11000, miles: 8000, final: 0 };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function lsJSON(k) { try { return JSON.parse(localStorage.getItem(k)) || null; } catch (e) { return null; } }
  function on() { return !!(window.Cloud && Cloud.isOn && Cloud.isOn()); }
  function sb() { return window.Cloud && Cloud.client ? Cloud.client() : null; }
  function reduced() { return !!(window.motionReduced && window.motionReduced()); }
  function n(x) { return Number(x || 0).toLocaleString('en-GB'); }
  function pl(x, w) { return n(x) + ' ' + w + (x === 1 ? '' : 's'); }
  function report(m, x) { try { if (window.reportIssue) reportIssue(m, x); } catch (e) {} }
  function thumbOf(u, px) { return window.thumb ? window.thumb(u, px) : u; }
  function hm(ms) { var m = Math.round(ms / 60000), h = Math.floor(m / 60); return h ? h + 'h ' + (m % 60) + 'm' : m + 'm'; }
  function scoreColor(s100) {
    var r = ['#e24b4a', '#e0603c', '#e08a3c', '#efb927', '#c8c344', '#a8c24a', '#6bbf68', '#4fb477'];
    return r[Math.max(0, Math.min(r.length - 1, Math.floor((s100 - 30) / 9)))];
  }

  /* ---- sources ------------------------------------------------------------ */
  function crateInput() {
    return {
      albums: (typeof window.loadAlbums === 'function' ? window.loadAlbums() : lsJSON('crate_albums_v1')) || {},
      songs: (typeof window.loadSongs === 'function' ? window.loadSongs() : lsJSON('crate_songs_v1')) || {},
      liked: lsJSON('crate_liked_songs_v1') || {}
    };
  }
  function lat() { return +(localStorage.getItem(LDAYS_AT) || 0); }

  // Listening, one period, from the server. Missing migration, logged out, or
  // a network failure all return null — Replay is complete without it.
  var _L = {}, _missing = false, _idx = null, _idxAt = 0;
  function rpcMissing(err) { return /function|does not exist|schema cache|404/i.test((err && (err.message || err.code)) || ''); }
  function listening(p) {
    if (!on() || _missing) return Promise.resolve(null);
    var k = p.key + '@' + lat();
    if (_L[k]) return _L[k];
    _L[k] = Promise.resolve(sb().rpc('replay_listening', { p_from: p.startDay, p_to: p.endDay })).then(function (r) {
      if (r.error) { if (rpcMissing(r.error)) _missing = true; else report('replay_listening failed', { e: r.error.message }); delete _L[k]; return null; }
      return r.data || null;
    }, function () { delete _L[k]; return null; });
    return _L[k];
  }
  function listeningIndex() {
    if (!on() || _missing) return Promise.resolve(null);
    if (_idx && Date.now() - _idxAt < 600000) return _idx;
    _idxAt = Date.now();
    _idx = Promise.resolve(sb().rpc('replay_listening_index')).then(function (r) {
      if (r.error) { if (rpcMissing(r.error)) _missing = true; return null; }
      return r.data || null;
    }, function () { return null; });
    return _idx;
  }
  // Has this account imported listening before per-day dates existed? Then
  // the honest prompt is "import it again", not "import it".
  var _lifetime = null;
  function hasLifetimeListening() {
    if (_lifetime) return _lifetime;
    if (!on()) return Promise.resolve(false);
    _lifetime = Promise.resolve(sb().from('listening_plays').select('k', { count: 'exact', head: true })
      .eq('user_id', Cloud.getUser().id)).then(function (r) { return !r.error && (r.count || 0) > 0; }, function () { return false; });
    return _lifetime;
  }

  /* ---- snapshots ---------------------------------------------------------- */
  function snaps() { return lsJSON(SNAP_KEY) || {}; }
  function prune(all) {
    var keep = { w: 26, m: 36, y: 99 };
    ['w', 'm', 'y'].forEach(function (c) {
      Object.keys(all).filter(function (k) { return k[0] === c; }).sort().reverse()
        .slice(keep[c]).forEach(function (k) { delete all[k]; });
    });
    return all;
  }
  function saveSnap(key, v) {
    var all = snaps(); all[key] = v;
    try { localStorage.setItem(SNAP_KEY, JSON.stringify(prune(all))); } catch (e) { return; }
    if (window.Cloud && Cloud.push) Cloud.push(SNAP_KEY);
  }
  function slimL(L) {
    if (!L) return null;
    return { data_from: L.data_from, data_to: L.data_to, plays: L.plays, ms: L.ms, days: L.days, tracks: L.tracks, artists: L.artists,
             top_artists: L.top_artists, top_tracks: L.top_tracks, by_day: L.by_day, new_artists: L.new_artists, new_artist_count: L.new_artist_count };
  }

  /* ---- the model ---------------------------------------------------------- */
  async function model(p, opts) {
    opts = opts || {};
    var done = R.complete(p) && !opts.demo;
    var snap = done ? snaps()[p.key] : null;
    if (snap && snap.v !== SNAP_V) snap = null;
    var input = opts.input || crateInput();
    var pp = R.prev(p);
    var crate = snap ? snap.crate : R.crateStats(input, p);
    var cratePrev = snap ? snap.cratePrev : R.crateStats(input, pp);
    var L, Lp;
    if (opts.demo) { L = opts.L || null; Lp = null; }
    else if (snap && snap.L && (snap.lat || 0) >= lat()) { L = snap.L; Lp = snap.Lp; }
    else { L = await listening(p); Lp = L ? await listening(pp) : null; }
    if (done && (!snap || (L && !snap.L))) {
      saveSnap(p.key, { v: SNAP_V, at: snap ? snap.at : Date.now(), lat: lat(), crate: crate, cratePrev: cratePrev, L: slimL(L), Lp: slimL(Lp) });
    }
    var Lok = L && R.listeningUsable(L, p) ? L : null;
    var LpOk = Lp && R.listeningUsable(Lp, pp) ? Lp : null;
    var m = {
      p: p, pp: pp, crate: crate, cratePrev: cratePrev, L: Lok, Lp: LpOk, rawL: L,
      cov: Lok ? R.coverage(L, p) : null, discValid: !!(Lok && R.listeningDiscoveriesValid(L, p)),
      dna: p.kind === 'week' ? null : R.dna(crate, Lok, p),
      cmp: R.compare(crate, cratePrev, Lok, LpOk), evo: R.evolutionLine(crate, p),
      demo: !!opts.demo, live: !R.complete(p), snapAt: snap ? snap.at : null
    };
    m.hasAny = crate.albums + crate.songs + crate.rerates > 0 || !!Lok;
    m.covers = crate.covers.slice();
    return m;
  }

  /* ---- artwork and colour ------------------------------------------------- */
  var _imgs = {};
  function loadImg(url, cors) {
    if (!url) return Promise.resolve(null);
    var k = (cors ? 'c:' : '') + url;
    if (_imgs[k]) return _imgs[k];
    _imgs[k] = new Promise(function (res) {
      var im = new Image(); if (cors) im.crossOrigin = 'anonymous';
      im.decoding = 'async';
      var t = setTimeout(function () { res(null); }, 5000);
      im.onload = function () { clearTimeout(t); res(im); };
      im.onerror = function () { clearTimeout(t); delete _imgs[k]; res(null); };
      im.src = url;
    });
    return _imgs[k];
  }
  // Three colours out of a sleeve: the overall cast and the two most vivid
  // regions. A sleeve that will not give up its pixels (no CORS) yields the
  // default Replay palette rather than an error.
  var DEFAULT_PAL = ['#3a1d4a', '#b8432f', '#f5c842'];
  var _pal = {};
  function palette(url) {
    if (!url) return Promise.resolve(DEFAULT_PAL);
    if (_pal[url]) return _pal[url];
    _pal[url] = loadImg(thumbOf(url, 160), true).then(function (im) {
      if (!im) return DEFAULT_PAL;
      try {
        var c = document.createElement('canvas'); c.width = c.height = 24;
        var x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, 24, 24);
        var d = x.getImageData(0, 0, 24, 24).data, px = [];
        for (var i = 0; i < d.length; i += 4) {
          var r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          px.push({ r: r, g: g, b: b, s: mx ? (mx - mn) / mx : 0, v: mx / 255 });
        }
        var avg = px.reduce(function (a, p) { a.r += p.r; a.g += p.g; a.b += p.b; return a; }, { r: 0, g: 0, b: 0 });
        avg = { r: avg.r / px.length, g: avg.g / px.length, b: avg.b / px.length };
        var vivid = px.filter(function (p) { return p.v > 0.25; }).sort(function (a, b) { return (b.s * b.v) - (a.s * a.v); });
        var a1 = vivid[0] || avg, a2 = vivid.filter(function (p) { return Math.abs(p.r - a1.r) + Math.abs(p.g - a1.g) + Math.abs(p.b - a1.b) > 120; })[0] || vivid[Math.floor(vivid.length / 3)] || a1;
        // Through HSL so every sleeve lands in a usable range: a grey or washed
        // out cover (Rumours, Blonde) would otherwise light the room grey. The
        // cast goes deep enough for white text; the accents keep their HUE
        // but are pushed to a saturation and lightness that read as colour.
        function hsl(p, sMin, lMin, lMax, fallback) {
          var r = p.r / 255, g = p.g / 255, b = p.b / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0;
          if (mx !== mn) {
            var d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
            h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60;
          }
          if (s < 0.12 && fallback) return fallback;             // no hue to keep: use the house colour
          return 'hsl(' + Math.round(h) + ',' + Math.round(Math.max(s, sMin) * 100) + '%,' + Math.round(Math.min(lMax, Math.max(lMin, l)) * 100) + '%)';
        }
        return [hsl(avg, 0.3, 0.1, 0.2, null), hsl(a1, 0.6, 0.45, 0.6, DEFAULT_PAL[1]), hsl(a2, 0.55, 0.5, 0.68, DEFAULT_PAL[2])];
      } catch (e) { return DEFAULT_PAL; }
    });
    return _pal[url];
  }
  function applyPal(el, pal) { if (!el || !pal) return; el.style.setProperty('--p1', pal[0]); el.style.setProperty('--p2', pal[1]); el.style.setProperty('--p3', pal[2]); }

  // Artist pictures for listening artists who are not in the crate: one
  // catalogue search per name, remembered for a month.
  function artistImage(name) {
    var key = 'rpai:' + R.foldName(name);
    var c = lsJSON(key);
    if (c && Date.now() - c.at < 30 * 864e5) return Promise.resolve(c.url || '');
    var base = (window.Native && Native.api) || '';
    return fetch(base + '/api/catalogue?path=search&type=artist&limit=1&q=' + encodeURIComponent(name)).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var a = j && j.artists && j.artists.items && j.artists.items[0];
        var url = a && a.images && a.images[0] ? a.images[0].url : '';
        try { localStorage.setItem(key, JSON.stringify({ url: url, at: Date.now() })); } catch (e) {}
        return url;
      }, function () { return ''; });
  }

  /* ---- what each scene shows ---------------------------------------------- */
  function crateArtFor(m, artist, album) {
    var k = R.foldName(R.firstArtist(artist)), input = m._input || (m._input = m.demo ? m._demoInput : crateInput());
    // The named album if it is in the crate, otherwise their best-rated one.
    var exact = null, best = null, want = album ? R.foldName(album) : '';
    Object.keys(input.albums || {}).forEach(function (id) {
      var a = input.albums[id];
      if (!a || !a.art || R.foldName(R.firstArtist(a.artist)) !== k) return;
      if (want && R.foldName(a.name) === want) exact = a;
      if (!best || (a.score || 0) > (best.score || 0)) best = a;
    });
    return (exact || best || {}).art || '';
  }
  function artistsOf(m) {
    if (m.L && m.L.top_artists && m.L.top_artists.length) {
      return { label: 'Most played artists', src: 'listening', rows: m.L.top_artists.slice(0, 5).map(function (a) {
        return { name: a.artist, value: hm(a.ms), sub: n(a.plays) + ' plays · ' + n(a.tracks) + ' songs', art: crateArtFor(m, a.artist), needArt: true };
      }) };
    }
    return { label: 'Most rated artists', src: 'crate', rows: m.crate.topArtists.slice(0, 5).map(function (a) {
      return { name: a.name, value: a.n + (a.n === 1 ? ' rating' : ' ratings'), sub: a.avg != null ? 'averaging ' + a.avg : '', art: a.art };
    }) };
  }
  function tracksOf(m) {
    if (m.L && m.L.top_tracks && m.L.top_tracks.length >= 3) {
      return { label: 'Most played songs', src: 'listening', rows: m.L.top_tracks.slice(0, 5).map(function (t) {
        return { title: t.track, artist: t.artist, value: n(t.plays) + ' plays', art: crateArtFor(m, t.artist, t.album) };
      }) };
    }
    return { label: 'Your highest-rated songs', src: 'crate', rows: m.crate.topSongs.slice(0, 5).map(function (s) {
      return { title: s.name, artist: s.artist, value: s.score + '/10', art: s.art };
    }) };
  }
  function evoBuckets(m) { return m.crate.evolution.filter(function (b) { return b.albums + b.songs > 0; }); }
  function scenesFor(m) {
    /* Each scene has a floor, scaled to the length of the period. A month of
       three albums does not have "a sound", and a personality read off ten
       ratings is a horoscope — those scenes wait for enough to be true. */
    var c = m.crate, k = m.p.kind, S = ['open'], items = c.albums + c.songs;
    var F = { week: { genre: 99, disc: 1, evo: 99, dna: 99 }, month: { genre: 5, disc: 2, evo: 3, dna: 12 }, year: { genre: 8, disc: 3, evo: 3, dna: 20 } }[k];
    if (m.L) S.push('minutes');
    if (items) S.push('record');
    if (c.genresKnown >= F.genre && c.genres.length >= 2) S.push('sound');
    if (artistsOf(m).rows.length >= (k === 'week' ? 1 : 3)) S.push('artists');
    if (tracksOf(m).rows.length >= 3) S.push('tracks');
    if (c.topAlbums.length >= 3) S.push('albums');
    if (c.discoveryCount >= F.disc || (m.discValid && m.L.new_artist_count >= 3)) S.push('discover');
    if (c.moves.length) S.push('mind');
    if (evoBuckets(m).length >= F.evo) S.push('evolution');
    if (k !== 'year' && m.cmp && (m.cratePrev.albums + m.cratePrev.songs) > 0) S.push('compare');
    if (m.dna && m.dna.primary && (items >= F.dna || m.L) && !(m.dna.primary.fallback && k !== 'year')) S.push('dna');
    if (c.milestones.length) S.push('miles');
    S.push('final');
    return S;
  }

  /* ---- scene markup -------------------------------------------------------
     Every scene is a function of the model, returning markup. Lines that
     rise are `.rp-line > span` with --d (ms) for the stagger. */
  function line(txt, d, cls) { return '<span class="rp-line ' + (cls || '') + '"><span style="--d:' + (d || 0) + '">' + txt + '</span></span>'; }
  function fade(html, d, tag, cls) { tag = tag || 'div'; return '<' + tag + ' class="rp-fade ' + (cls || '') + '" style="--d:' + (d || 0) + '">' + html + '</' + tag + '>'; }
  function count(v, fmt) { return '<span class="rp-num" data-count="' + v + '" data-fmt="' + (fmt || 'int') + '">' + (reduced() ? n(v) : '0') + '</span>'; }
  // Always an <img>, even with no picture yet: an artist's photo can arrive
  // after the scene is drawn and is patched straight into it. With no src it
  // shows its palette-gradient background, never a broken-image icon.
  function img(url, cls, px) { return '<img class="ph ' + (cls || '') + '"' + (url ? ' src="' + esc(thumbOf(url, px || 500)) + '"' : '') + ' alt="" decoding="async" onerror="this.removeAttribute(\'src\')">'; }
  function periodWord(p) { return p.kind === 'year' ? 'year' : p.kind === 'month' ? 'month' : 'week'; }
  var PLAY_SVG = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11l9-5.5z"/></svg>';
  var STOP_SVG = '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="3.5" y="3.5" width="9" height="9" rx="1.5"/></svg>';

  var SCENES = {
    open: function (m) {
      var p = m.p, covers = m.covers.slice(0, p.kind === 'year' ? 8 : 6);
      var orbit = covers.map(function (u, i) {
        var a = (i / covers.length) * Math.PI * 2 + 0.5, rx = 38, ry = 32;
        return '<img src="' + esc(thumbOf(u, 320)) + '" alt="" style="--x:' + (Math.cos(a) * rx).toFixed(1) + 'vw;--y:' + (Math.sin(a) * ry).toFixed(1) + 'vh;--r:' + ((i % 2 ? 1 : -1) * (6 + i * 2)) + 'deg;--d:' + (300 + i * 110) + '">';
      }).join('');
      var big = p.kind === 'year' ? '<div class="rp-year rp-mega">' + p.label.split('').map(function (ch, i) { return line(ch, 250 + i * 120); }).join('') + '</div>'
        : p.kind === 'month' ? '<h1 class="rp-mega" style="font-size:clamp(64px,16vw,190px)">' + line(esc(p.month), 250) + '</h1>'
        : '<h1 class="rp-h">' + line('Your week,', 200) + line('replayed.', 380) + '</h1>';
      var lead = p.kind === 'year' ? 'Your year had a soundtrack.' : p.kind === 'month' ? esc(p.month) + ' had a sound. Here it is.' : esc(p.label);
      return '<div class="rp-orbit" aria-hidden="true">' + orbit + '</div>' +
        fade('<span class="rp-kicker">VINALL Replay' + (m.live ? ' · so far' : '') + '</span>', 0) + big +
        fade('<p class="rp-sub" style="margin-inline:auto">' + lead + '</p>', 900);
    },
    minutes: function (m) {
      var L = m.L, mins = Math.round(L.ms / 60000), days = L.ms / 864e5;
      var series = (L.by_day || []).map(function (d) { return { t: R.dayStart(d.d), ms: +d.ms }; });
      var bars = [], per = m.p.kind === 'year' ? 'week' : 'day';
      if (per === 'week') { var wk = {}; series.forEach(function (d) { var k = R.period('week', d.t).key; wk[k] = (wk[k] || 0) + d.ms; }); bars = Object.keys(wk).sort().map(function (k) { return wk[k]; }); }
      else bars = series.map(function (d) { return d.ms; });
      var mx = Math.max.apply(null, bars.concat([1])), peakI = bars.indexOf(mx);
      var wave = bars.map(function (v, i) { return '<i class="' + (i === peakI ? 'peak' : '') + '" style="--h:' + Math.max(2, Math.round(v / mx * 100)) + '%;--d:' + (300 + i * Math.min(14, 900 / bars.length)) + '"></i>'; }).join('');
      var peak = series.slice().sort(function (a, b) { return b.ms - a.ms; })[0];
      var said = days >= 1 ? 'That is ' + (Math.round(days * 10) / 10) + ' days of music, end to end.' : 'That is ' + hm(L.ms) + ' of music.';
      return '<div class="rp-wave" aria-hidden="true">' + wave + '</div>' +
        fade('<span class="rp-kicker">Your listening</span>', 0) +
        '<h1 class="rp-mega" style="font-size:clamp(70px,18vw,220px)">' + line(count(mins), 150) + '</h1>' +
        '<h2 class="rp-h2">' + line('minutes of music', 450) + '</h2>' +
        fade('<p class="rp-sub">' + said + (peak && m.p.kind !== 'week' ? ' Your loudest day was ' + R.fmtDay(peak.t) + ': ' + hm(peak.ms) + '.' : '') + '</p>', 900) +
        fade('<div class="rp-stats"><div class="rp-stat"><b>' + count(L.plays) + '</b><span>plays</span></div><div class="rp-stat"><b>' + count(L.artists) + '</b><span>artists</span></div><div class="rp-stat"><b>' + count(L.tracks) + '</b><span>different songs</span></div></div>', 1200) +
        fade('<div class="rp-foot">From your Spotify data' + (m.cov && m.cov.note ? ' · ' + esc(m.cov.note) : '') + '</div>', 1500);
    },
    record: function (m) {
      var c = m.crate;
      var wall = m.covers.slice(0, 48).map(function (u, i) { return '<img src="' + esc(thumbOf(u, 160)) + '" alt="" style="--d:' + (i * 35) + '">'; }).join('');
      var bits = [];
      if (c.rerates) bits.push(c.rerates + ' second thought' + (c.rerates === 1 ? '' : 's'));
      if (c.streak >= 2) bits.push('a ' + c.streak + '-day streak');
      if (c.artists) bits.push(c.artists + ' artist' + (c.artists === 1 ? '' : 's'));
      return '<div class="rp-wall" aria-hidden="true">' + wall + '</div>' +
        fade('<span class="rp-kicker">Your crate this ' + periodWord(m.p) + '</span>', 0) +
        '<h1 class="rp-mega" style="font-size:clamp(72px,17vw,200px)">' + line(count(c.albums) + '<small style="font-size:.28em;letter-spacing:-.02em;margin-left:.2em">albums rated</small>', 150) + '</h1>' +
        (c.songs ? '<h1 class="rp-mega" style="font-size:clamp(56px,12vw,150px);opacity:.82">' + line(count(c.songs) + '<small style="font-size:.3em;letter-spacing:-.02em;margin-left:.2em">songs</small>', 380) + '</h1>' : '') +
        (bits.length ? fade('<p class="rp-sub">' + esc(bits.join(' · ')) + (c.avg != null ? '. Average album score: <b class="rp-num">' + c.avg + '</b>.' : '.') + '</p>', 900) : '');
    },
    sound: function (m) {
      var g = m.crate.genres.slice(0, 6);
      var hues = [m.pal[2], m.pal[1], '#7cf2ff', '#c46bff', '#ff6fae', '#b8f24a'];
      var lines = g.map(function (x, i) {
        return '<div class="rp-genre rp-slide" style="--d:' + (450 + i * 140) + ';--s:' + Math.min(2.3, 0.75 + x.share * 2.2).toFixed(2) + ';--gc:' + hues[i % hues.length] + '"><b>' + esc(x.name) + '</b><em>' + Math.round(x.share * 100) + '%</em></div>';
      }).join('');
      var bar = g.map(function (x, i) { return '<i style="--w:' + (x.share * 100).toFixed(1) + '%;--gc:' + hues[i % hues.length] + ';--d:' + (900 + i * 120) + '"></i>'; }).join('');
      return fade('<span class="rp-kicker">Your sound</span>', 0) +
        '<h1 class="rp-h">' + line('You lived in', 120) + line('<span class="rp-grad">' + esc(g[0].name) + '.</span>', 300) + '</h1>' +
        '<div class="rp-genres">' + lines + '</div>' +
        '<div class="rp-mixbar" aria-hidden="true">' + bar + '</div>' +
        fade('<div class="rp-foot">From the genres of ' + m.crate.genresKnown + ' album' + (m.crate.genresKnown === 1 ? '' : 's') + ' you rated</div>', 1400);
    },
    artists: function (m) {
      var A = artistsOf(m), top = A.rows[0];
      var rest = A.rows.slice(1).map(function (a, i) {
        return '<div class="rp-row rp-slide" style="--d:' + (1100 + i * 130) + '"><span class="n">' + (i + 2) + '</span>' + img(a.art, 'rpa-' + (i + 1), 120) + '<div class="t"><b>' + esc(a.name) + '</b>' + (a.sub ? '<small>' + esc(a.sub) + '</small>' : '') + '</div><span class="v">' + esc(a.value) + '</span></div>';
      }).join('');
      return '<div class="rp-backdrop" aria-hidden="true">' + (top.art ? '<img class="rpa-bg" src="' + esc(thumbOf(top.art, 500)) + '" alt="">' : '<img class="rpa-bg" alt="" style="display:none">') + '</div>' +
        fade('<span class="rp-kicker">' + esc(A.label) + '</span>', 0) +
        '<div class="rp-pop" style="--d:200">' + (top.art ? '<img class="rp-hero-art rpa-0' + (A.src === 'listening' ? ' round' : '') + '" src="' + esc(thumbOf(top.art, 500)) + '" alt="">' : '<img class="rp-hero-art rpa-0 round" alt="" style="visibility:hidden">') + '</div>' +
        fade('<span class="rp-rank-no">No. 1</span>', 450) +
        '<h1 class="rp-h" style="font-size:clamp(40px,8.6vw,104px)">' + line(esc(top.name), 520) + '</h1>' +
        fade('<p class="rp-sub" style="margin-top:8px"><b class="rp-num">' + esc(top.value) + '</b>' + (top.sub ? ' · ' + esc(top.sub) : '') + '</p>', 800) +
        (rest ? '<div class="rp-list">' + rest + '</div>' : '') +
        (A.src === 'crate' ? fade('<div class="rp-foot">Counted by ratings, not plays' + (m.rawL ? '' : ' · add your Spotify data to see what you played') + '</div>', 1700) : '');
    },
    tracks: function (m) {
      var T = tracksOf(m);
      var rows = T.rows.map(function (t, i) {
        return '<div class="rp-track rp-slide" style="--d:' + (300 + i * 140) + '"><span class="big">' + (i + 1) + '</span>' + img(t.art, 'rpt-' + i, 160) +
          '<div class="t"><b>' + esc(t.title) + '</b><small>' + esc(t.artist) + ' · <span class="rp-num">' + esc(t.value) + '</span></small></div>' +
          '<button class="rp-pv" data-rp-pv="' + i + '" aria-label="Play a preview of ' + esc(t.title) + '">' + PLAY_SVG + '</button></div>';
      }).join('');
      return fade('<span class="rp-kicker">' + esc(T.label) + '</span>', 0) +
        '<h1 class="rp-h">' + line('The songs that', 100) + line('defined it.', 260) + '</h1>' +
        '<div class="rp-tracks">' + rows + '</div>' +
        fade('<span class="rp-attr"><img src="/assets/deezer-mark.png" alt="">30-second previews from Deezer, only when you press play</span>', 1300);
    },
    albums: function (m) {
      var A = m.crate.topAlbums.slice(0, 5);
      var order = [3, 1, 0, 2, 4], pos = { 0: [0, 0, 0, 1], 1: [-58, -120, 28, .8], 2: [58, -120, -28, .8], 3: [-104, -260, 42, .45], 4: [104, -260, -42, .45] };
      var shelf = order.filter(function (i) { return A[i]; }).map(function (i) {
        var a = A[i], q = pos[i];
        return '<figure style="--x:' + q[0] + '%;--z:' + q[1] + 'px;--ry:' + q[2] + 'deg;--o:' + q[3] + ';--d:' + (200 + i * 150) + ';--sc:' + scoreColor(a.score) + ';z-index:' + (10 - i) + '">' +
          '<img src="' + esc(thumbOf(a.art, 500)) + '" alt=""><figcaption>' + a.score + '</figcaption></figure>';
      }).join('');
      var top = A[0];
      return fade('<span class="rp-kicker">Your highest verdicts</span>', 0) +
        '<div class="rp-shelf" aria-hidden="true">' + shelf + '</div>' +
        '<h1 class="rp-h" style="font-size:clamp(30px,6vw,70px)">' + line(esc(top.name), 900) + '</h1>' +
        fade('<p class="rp-sub">' + esc(top.artist) + ' · <b class="rp-num" style="color:' + scoreColor(top.score) + '">' + top.score + '</b> — the best thing you heard this ' + periodWord(m.p) + '.</p>', 1150);
    },
    discover: function (m) {
      var c = m.crate, useL = m.discValid && m.L.new_artist_count >= 3 && (c.discoveryCount < 3 || m.p.kind === 'year');
      var countN = useL ? m.L.new_artist_count : c.discoveryCount;
      var names = (useL ? m.L.new_artists.map(function (a) { return a.artist; }) : c.discoveries.map(function (d) { return d.name; })).slice(0, 10);
      var best = c.discoveries.filter(function (d) { return d.score != null && d.art; })[0];
      return fade('<span class="rp-kicker">New to you</span>', 0) +
        '<h1 class="rp-mega" style="font-size:clamp(80px,20vw,230px)">' + line(count(countN), 150) + '</h1>' +
        '<h2 class="rp-h2">' + line(useL ? 'artists you played for the first time' : 'artists you rated for the first time', 380) + '</h2>' +
        (best ? fade('<div class="rp-disc-hero"><img src="' + esc(thumbOf(best.art, 400)) + '" alt=""><div><span class="rp-kicker">Your best-rated find</span><p class="rp-h2" style="margin-top:8px">' + esc(best.name) + '</p><p class="rp-sub" style="margin-top:6px">First rated ' + R.fmtDay(best.first) + ' · scored <b class="rp-num" style="color:' + scoreColor(best.score) + '">' + best.score + '</b></p></div></div>', 800) : '') +
        fade('<div class="rp-names">' + names.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>', 1100) +
        (useL ? fade('<div class="rp-foot">From your Spotify data, which starts ' + R.fmtDay(R.dayStart(m.L.data_from)) + ' ' + String(m.L.data_from).slice(0, 4) + '</div>', 1400) : '');
    },
    mind: function (m) {
      var rows = m.crate.moves.slice(0, 3).map(function (x, i) {
        var up = x.delta > 0;
        return '<div class="rp-move rp-slide" style="--d:' + (400 + i * 180) + '">' + img(x.art, '', 160) + '<div><b>' + esc(x.name) + '</b><small>' + esc(x.artist) + '</small></div>' +
          '<div class="ft"><s>' + x.from + '</s> → <span style="color:' + scoreColor(x.to) + '">' + x.to + '</span><em>' + (up ? '+' : '') + x.delta + '</em></div></div>';
      }).join('');
      return fade('<span class="rp-kicker">Second thoughts</span>', 0) +
        '<h1 class="rp-h">' + line('You changed', 100) + line('your mind.', 260) + '</h1>' +
        '<div class="rp-moves">' + rows + '</div>' +
        fade('<div class="rp-foot">Scores as they stood going in, and how they left</div>', 1300);
    },
    evolution: function (m) {
      var B = m.crate.evolution, W = 1000, H = 300, pad = 26, bw = (W - pad * 2) / B.length;
      var mxR = Math.max.apply(null, B.map(function (b) { return b.albums + b.songs; }).concat([1]));
      var lms = null;
      if (m.L && m.L.by_day) {
        lms = B.map(function (b) { return m.L.by_day.reduce(function (s, d) { var t = R.dayStart(d.d); return s + (t >= b.start && t < b.end ? +d.ms : 0); }, 0); });
      }
      var mxL = lms ? Math.max.apply(null, lms.concat([1])) : 1;
      var hot = B.map(function (b, i) { return { i: i, v: b.albums + b.songs }; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 3).map(function (x) { return x.i; });
      var bars = B.map(function (b, i) {
        var v = b.albums + b.songs, h = Math.max(v ? 4 : 0, v / mxR * (H - 70)), x = pad + i * bw + bw * 0.18, w = bw * 0.64;
        var g = hot.indexOf(i) !== -1 && b.genre && v ? '<text class="g" x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 36 - h).toFixed(1) + '" text-anchor="middle">' + esc(b.genre) + '</text>' : '';
        return '<rect class="bar' + (hot[0] === i ? ' hot' : '') + '" style="--d:' + (300 + i * 60) + '" x="' + x.toFixed(1) + '" y="' + (H - 30 - h).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="5"/>' + g +
          '<text x="' + (pad + i * bw + bw / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(b.label) + '</text>';
      }).join('');
      // Listening as a soft area behind the bars: a different source, so a
      // different shape, never a second set of bars to confuse with ratings.
      var area = '';
      if (lms) {
        var ap = lms.map(function (v, i) { return (pad + i * bw + bw / 2).toFixed(1) + ' ' + (H - 30 - v / mxL * (H - 80)).toFixed(1); });
        area = '<path class="lst" d="M' + (pad + bw / 2).toFixed(1) + ' ' + (H - 30) + ' L' + ap.join(' L') + ' L' + (pad + (B.length - 1) * bw + bw / 2).toFixed(1) + ' ' + (H - 30) + 'Z"/>';
      }
      var pts = B.map(function (b, i) { return b.avg == null ? null : [pad + i * bw + bw / 2, H - 30 - ((b.avg - 40) / 60) * (H - 70)]; }).filter(Boolean);
      var path = pts.length >= 2 ? '<path class="avg" pathLength="1" d="M' + pts.map(function (p) { return p[0].toFixed(1) + ' ' + Math.max(10, p[1]).toFixed(1); }).join(' L') + '"/>' : '';
      return fade('<span class="rp-kicker">Your ' + periodWord(m.p) + ' in motion</span>', 0) +
        '<h1 class="rp-h" style="font-size:clamp(28px,5.4vw,62px)">' + line(esc(m.evo || 'How it moved.'), 120) + '</h1>' +
        '<svg class="rp-chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Ratings by ' + (m.p.kind === 'year' ? 'month' : 'week') + '">' + area + bars + path + '</svg>' +
        fade('<div class="rp-legend"><span><i style="background:#fff"></i>Ratings</span>' + (path ? '<span><i style="background:var(--p3);height:3px;border-radius:2px"></i>Average album score</span>' : '') + (lms ? '<span><i style="background:color-mix(in srgb,var(--p2) 60%,transparent)"></i>Listening</span>' : '') + '</div>', 1200);
    },
    compare: function (m) {
      var C = m.cmp;
      var rows = C.rows.map(function (r, i) {
        var d = r.now - r.then, cls = d > 0 ? 'up' : d < 0 ? 'down' : '';
        return '<div class="rp-vs-row rp-slide" style="--d:' + (400 + i * 150) + '"><span>' + esc(r.k) + '</span><b>' + n(r.now) + '</b><em class="' + cls + '">' + (d > 0 ? '+' : '') + (d ? n(Math.round(d * 10) / 10) : '±0') + '</em></div>';
      }).join('');
      return fade('<span class="rp-kicker">Versus ' + esc(m.pp.short) + '</span>', 0) +
        '<h1 class="rp-h">' + line((m.crate.albums + m.crate.songs) >= (m.cratePrev.albums + m.cratePrev.songs) ? 'Turned up.' : 'A quieter ' + periodWord(m.p) + '.', 120) + '</h1>' +
        '<div class="rp-vs">' + rows + '</div>' +
        (C.genreShift ? fade('<p class="rp-sub">You moved from <b>' + esc(C.genreThen) + '</b> to <b>' + esc(C.genreNow) + '</b>.</p>', 1200) : '');
    },
    dna: function (m) {
      var d = m.dna.primary, s = m.dna.secondary;
      return '<div class="rp-emblem" aria-hidden="true">' + emblem(d.id, m.pal) + '</div>' +
        fade('<span class="rp-kicker">Your music DNA</span>', 300) +
        '<h1 class="rp-dna-name">' + line('<span class="rp-grad">' + esc(d.name) + '</span>', 500) + '</h1>' +
        fade('<p class="rp-sub" style="margin-inline:auto">' + esc(d.line) + '</p>', 900) +
        fade('<div class="rp-evidence">' + d.evidence.map(function (e) { return '<span>' + esc(e) + '</span>'; }).join('') + '</div>', 1200) +
        (s ? fade('<span class="rp-trait">With a little of ' + esc(s.name) + '</span>', 1600) : '');
    },
    miles: function (m) {
      var rows = m.crate.milestones.slice(0, 5).map(function (x, i) {
        var badge = x.kind === 'albums' || x.kind === 'songs' ? (x.n >= 1000 ? Math.round(x.n / 100) / 10 + 'k' : x.n) : x.kind === 'perfect' ? '100' : x.kind === 'streak' ? x.n + 'd' : '±' + x.n;
        return '<div class="rp-mile rp-slide" style="--d:' + (300 + i * 150) + '"><i>' + esc(String(badge)) + '</i><span>' + esc(x.text) + '</span></div>';
      }).join('');
      return fade('<span class="rp-kicker">Milestones</span>', 0) + '<h1 class="rp-h">' + line('Worth marking.', 100) + '</h1><div class="rp-miles">' + rows + '</div>';
    },
    final: function (m) {
      return '<h1 class="rp-h2" style="margin:0 0 16px">' + line(m.p.kind === 'year' ? 'That was your ' + esc(m.p.label) + (m.live ? ', so far.' : '.') : 'That was your ' + periodWord(m.p) + '.', 100) + '</h1>' +
        fade('<div class="rp-summary" id="rp-summary"><div class="ld">Pressing your card…</div></div>', 300) +
        fade('<div class="rp-actions">' +
          '<div class="rp-seg" role="group" aria-label="Card shape"><button data-rp-fmt="story" aria-pressed="true">Story</button><button data-rp-fmt="square" aria-pressed="false">Square</button></div>' +
          '<button class="rp-play" data-rp-act="share"><i>↗</i>' + ((navigator.share || (window.Native && Native.on)) ? 'Share' : 'Save image') + '</button>' +
          (navigator.share ? '<button class="rp-ghost" data-rp-act="save">Save image</button>' : '') +
          '<button class="rp-ghost" data-rp-act="restart">Play again</button></div>', 500) +
        fade('<p class="rp-share-note">' + (m.demo ? 'Demo card — made-up data, watermarked.' : 'Shows your top artists, music DNA and numbers. Never your notes, diary or answers.') + '</p>', 700);
    }
  };

  // A different mark for each personality: same family, different geometry.
  function emblem(id, pal) {
    var pts = { diver: 0, hopper: 6, loyal: 0, architect: 4, nostalgic: 0, trend: 3, explorer: 8, critic: 4, curator: 5 }[id] || 5;
    var core;
    if (!pts) core = '<circle class="core" cx="0" cy="0" r="' + (id === 'loyal' ? 46 : 34) + '"/>' + (id === 'diver' || id === 'nostalgic' ? [24, 14, 5].map(function (r) { return '<circle cx="0" cy="0" r="' + r + '" fill="none" stroke="#0b0810" stroke-opacity=".5" stroke-width="1.5"/>'; }).join('') : '');
    else {
      var d = '', star = id === 'explorer' || id === 'hopper';
      for (var i = 0; i < pts * (star ? 2 : 1); i++) {
        var a = -Math.PI / 2 + i * Math.PI * 2 / (pts * (star ? 2 : 1)) + (id === 'critic' ? Math.PI / 4 : 0), r = star && i % 2 ? 20 : 46;
        d += (i ? 'L' : 'M') + (Math.cos(a) * r).toFixed(1) + ' ' + (Math.sin(a) * r).toFixed(1);
      }
      core = '<path class="core" d="' + d + 'Z"/>';
    }
    var rings = [62, 76, 90].map(function (r, i) { return '<circle class="ring" cx="0" cy="0" r="' + r + '" stroke-dasharray="' + (i === 1 ? '2 6' : 'none') + '"/>'; }).join('');
    return '<svg viewBox="-100 -100 200 200"><defs><linearGradient id="rpDnaGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="' + pal[2] + '"/><stop offset="1" stop-color="' + pal[1] + '"/></linearGradient></defs>' + rings + core + '</svg>';
  }

  /* ---- the story player --------------------------------------------------- */
  var S = null;   // the open story
  function host() { return $('rp-story'); }

  async function open(kind, key, opts) {
    opts = opts || {};
    // Locked: the demo is still a taste; your own Replay waits for the gate.
    if (!opts.demo && !gate().open) { if (window.goToView) goToView('replay'); return; }
    var p = key ? R.fromKey(key) : R.period(kind || 'year');
    if (!p) return;
    var m = opts.demo ? await demoModel(p) : await model(p);
    if (!m.hasAny) { if (window.toast) toast('Nothing to replay for ' + p.label + ' yet.'); return; }
    m.pal = await palette(m.covers[0] || (artistsOf(m).rows[0] || {}).art);
    var list = scenesFor(m);
    var h = host(); if (!h) return;
    if (window.VinalAudio) try { VinalAudio.stop(); } catch (e) {}
    S = { m: m, list: list, i: -1, paused: {}, timer: 0, left: 0, at: 0, cur: null, dir: 1, card: { story: null, square: null }, fmt: 'story' };
    applyPal(h, m.pal);
    h.innerHTML =
      '<div class="rp-room"><div class="rp-bg" aria-hidden="true"><i></i><i></i><i></i></div><div class="rp-shade"></div><div class="rp-grain"></div><div id="rp-stage" aria-live="polite"></div></div>' +
      '<div class="rp-chrome"><div class="rp-bar">' + list.map(function () { return '<span><i></i></span>'; }).join('') + '</div>' +
        '<div class="rp-top"><span class="rp-brand">Replay · ' + esc(p.label) + (m.live ? ' · so far' : '') + '</span>' +
        '<button class="rp-ctl" id="rp-pause" data-rp-ctl aria-label="Pause"><svg viewBox="0 0 16 16" fill="currentColor"><rect x="3.5" y="3" width="3" height="10" rx="1"/><rect x="9.5" y="3" width="3" height="10" rx="1"/></svg></button>' +
        '<button class="rp-ctl modal-close" id="rp-close" data-rp-ctl aria-label="Close Replay"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg></button></div></div>' +
      '<button class="rp-ctl rp-nav prev" data-rp-ctl data-rp-go="-1" aria-label="Previous">‹</button><button class="rp-ctl rp-nav next" data-rp-ctl data-rp-go="1" aria-label="Next">›</button>' +
      (m.demo ? '<div class="rp-demo-ribbon"><span class="rp-demo-tag">Demo · not your data</span></div>' : '<div class="rp-hint">' + (matchMedia('(hover: none)').matches ? 'Tap to continue · hold to pause' : '← → to move · space to pause') + '</div>') +
      // The opening moment: a record in the period's colours spins up out of
      // the centre and breaks into the room. Thrown away once it has played.
      (reduced() ? '' : '<div class="rp-unwrap" aria-hidden="true"><i class="rp-unwrap-disc"></i><i class="rp-unwrap-ring"></i></div>');
    if (!m.demo) markOpened(p.key);
    setTimeout(function () { var u = h.querySelector('.rp-unwrap'); if (u) u.remove(); }, 1600);
    // Artwork first: the opening's covers and the next two scenes' art.
    await Promise.race([Promise.all(m.covers.slice(0, 8).map(function (u) { return loadImg(thumbOf(u, 320)); })), new Promise(function (r) { setTimeout(r, 900); })]);
    m.covers.slice(0, 48).forEach(function (u) { loadImg(thumbOf(u, 160)); });
    h.classList.add('open');
    wire(h);
    go(0, 1);
    if (window.track) try { track('replay_opened', { kind: p.kind, live: m.live, demo: m.demo, scenes: list.length, listening: !!m.L }); } catch (e) {}
    fillArt(m);
  }

  // Listening artists who are not in the crate get their picture after the
  // story has started, patched into whatever is on screen.
  function fillArt(m) {
    var A = artistsOf(m);
    if (A.src !== 'listening') return;
    A.rows.forEach(function (a, i) {
      if (a.art) return;
      artistImage(a.name).then(function (u) {
        if (!u || !S || S.m !== m) return;
        a.art = u; m._artistArt = m._artistArt || {}; m._artistArt[i] = u;
        document.querySelectorAll('#rp-stage .rpa-' + i).forEach(function (el) { if (el.tagName === 'IMG') { el.src = thumbOf(u, 500); el.style.visibility = ''; } });
        if (i === 0) {
          var bg = document.querySelector('#rp-stage .rpa-bg'); if (bg) { bg.src = thumbOf(u, 500); bg.style.display = ''; }
          palette(u).then(function (pal) { if (S && S.list[S.i] === 'artists') applyPal(host(), pal); });
        }
      });
    });
  }

  function go(i, dir) {
    if (!S || i < 0 || i >= S.list.length) return;
    stopPreview();
    clearTimeout(S.timer);
    S.dir = dir; S.i = i;
    var h = host(), stage = $('rp-stage');
    h.classList.toggle('rp-story-back', dir < 0);
    h.classList.toggle('rp-at-end', i === S.list.length - 1);
    // A breath of the palette's light between scenes (opacity only).
    h.classList.remove('rp-pulse'); void h.offsetWidth; h.classList.add('rp-pulse');
    if (S.cur) { var old = S.cur; old.classList.add('is-out'); setTimeout(function () { if (old.parentNode) old.parentNode.removeChild(old); }, reduced() ? 0 : 400); }
    var id = S.list[i], el = document.createElement('section');
    el.className = 'rp-scene sc-' + id + (id === 'albums' ? ' rp-center' : '');
    el.setAttribute('role', 'group'); el.setAttribute('aria-roledescription', 'slide');
    el.setAttribute('aria-label', (i + 1) + ' of ' + S.list.length);
    el.innerHTML = SCENES[id](S.m);
    stage.appendChild(el); S.cur = el;
    // Restore patched artist art if this scene is rebuilt after it arrived.
    if (S.m._artistArt) Object.keys(S.m._artistArt).forEach(function (k) { el.querySelectorAll('.rpa-' + k).forEach(function (x) { x.src = thumbOf(S.m._artistArt[k], 500); x.style.visibility = ''; }); var bg = +k === 0 && el.querySelector('.rpa-bg'); if (bg) { bg.src = thumbOf(S.m._artistArt[0], 500); bg.style.display = ''; } });
    // Scenes about one record or artist take that record's colours.
    var art = id === 'artists' ? artistsOf(S.m).rows[0].art : id === 'albums' ? (S.m.crate.topAlbums[0] || {}).art : id === 'discover' ? ((S.m.crate.discoveries.filter(function (d) { return d.art; })[0]) || {}).art : null;
    if (art) palette(art).then(function (pal) { if (S && S.list[S.i] === id) applyPal(h, pal); });
    else applyPal(h, S.m.pal);
    void el.offsetWidth;
    requestAnimationFrame(function () { el.classList.add('is-in'); countUps(el); });
    // Progress.
    var segs = h.querySelectorAll('.rp-bar span');
    segs.forEach(function (s, k) {
      s.className = k < i ? 'done' : k === i ? 'now' : '';
      if (k === i) { var fresh = document.createElement('i'); s.replaceChild(fresh, s.firstChild); s.style.setProperty('--dur', (DUR[id] || 0) + 'ms'); if (!DUR[id]) s.className = 'done'; }
    });
    if (id === 'final') paintSummary();
    // A played song that is not in the crate has no sleeve; the preview
    // lookup (the same edge-cached route the player uses) carries one.
    if (id === 'tracks' && window.VinalAudio) tracksOf(S.m).rows.forEach(function (t, k) {
      if (t.art) return;
      VinalAudio.resolve({ artist: t.artist, title: t.title }).then(function (r) {
        if (!r || !r.cover) return;
        t.art = r.cover;
        var im = el.querySelector('.rpt-' + k); if (im) im.src = thumbOf(r.cover, 160);
      }, function () {});
    });
    S.left = DUR[id] || 0; schedule();
  }
  function schedule() {
    clearTimeout(S.timer);
    if (!S.left || isPaused()) return;
    S.at = performance.now();
    S.timer = setTimeout(function () { next(); }, S.left);
  }
  function isPaused() { return Object.keys(S.paused).some(function (k) { return S.paused[k]; }); }
  function pause(why) {
    if (!S || S.paused[why]) return;
    var was = isPaused(); S.paused[why] = true;
    if (!was) { clearTimeout(S.timer); if (S.at) S.left = Math.max(400, S.left - (performance.now() - S.at)); S.at = 0; host().classList.add('rp-story-paused'); paintPauseBtn(); }
  }
  function resume(why) {
    if (!S || !S.paused[why]) return;
    S.paused[why] = false;
    if (!isPaused()) { host().classList.remove('rp-story-paused'); paintPauseBtn(); schedule(); }
  }
  function paintPauseBtn() {
    var b = $('rp-pause'); if (!b || !S) return;
    var p = isPaused();
    b.setAttribute('aria-label', p ? 'Play' : 'Pause');
    b.innerHTML = p ? '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11l9-5.5z"/></svg>' : '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="3.5" y="3" width="3" height="10" rx="1"/><rect x="9.5" y="3" width="3" height="10" rx="1"/></svg>';
  }
  function next() { if (S && S.i < S.list.length - 1) go(S.i + 1, 1); }
  function prev() { if (S && S.i > 0) go(S.i - 1, -1); else if (S) go(0, -1); }

  function countUps(el) {
    var nodes = el.querySelectorAll('[data-count]');
    if (!nodes.length) return;
    if (reduced()) { nodes.forEach(function (x) { x.textContent = n(+x.dataset.count); }); return; }
    var t0 = performance.now() + 250, D = 1300;
    function tick(t) {
      var k = Math.min(1, Math.max(0, (t - t0) / D)), e = 1 - Math.pow(1 - k, 4);
      nodes.forEach(function (x) { x.textContent = n(Math.round(+x.dataset.count * e)); });
      if (k < 1 && el.isConnected) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* ---- input --------------------------------------------------------------
     Taps: left third back, the rest forward. A hold pauses. A horizontal
     swipe moves; a long downward pull closes. Anything that is a control —
     buttons, the share card — is never a navigation, so pressing Share
     cannot skip a scene. */
  var _wired = false, _press = null;
  function isCtl(t) { return !!(t && t.closest && t.closest('button, a, input, [data-rp-ctl], .rp-summary')); }
  function wire(h) {
    if (_wired) return; _wired = true;
    h.addEventListener('pointerdown', function (e) {
      if (!S || isCtl(e.target) || e.button > 0) return;
      _press = { x: e.clientX, y: e.clientY, t: performance.now(), hold: false };
      _press.timer = setTimeout(function () { if (_press) { _press.hold = true; pause('hold'); } }, 220);
    });
    h.addEventListener('pointerup', function (e) {
      if (!S || !_press) return;
      var p = _press; _press = null; clearTimeout(p.timer);
      var dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (p.hold) { resume('hold'); return; }
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { if (dx < 0) next(); else prev(); return; }
      if (dy > 110 && dy > Math.abs(dx) * 1.5) { close(); return; }
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) { if (e.clientX < window.innerWidth * 0.3) prev(); else next(); }
    });
    h.addEventListener('pointercancel', function () { if (_press) { clearTimeout(_press.timer); if (_press.hold) resume('hold'); _press = null; } });
    h.addEventListener('click', function (e) {
      if (!S) return;
      var b = e.target.closest('button'); if (!b) return;
      if (b.id === 'rp-pause') { if (S.paused.user) resume('user'); else pause('user'); return; }
      if (b.dataset.rpGo) { if (+b.dataset.rpGo > 0) next(); else prev(); return; }
      if (b.dataset.rpPv) { preview(+b.dataset.rpPv, b); return; }
      if (b.dataset.rpFmt) { S.fmt = b.dataset.rpFmt; b.parentNode.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); paintSummary(); return; }
      if (b.dataset.rpAct === 'share') { shareCard(false, b); return; }
      if (b.dataset.rpAct === 'save') { shareCard(true, b); return; }
      if (b.dataset.rpAct === 'restart') { go(0, -1); return; }
    });
    document.addEventListener('keydown', function (e) {
      if (!S || !host().classList.contains('open')) return;
      if (e.target && e.target.closest && e.target.closest('input, textarea')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
      else if ((e.key === ' ' || e.key === 'k') && !(e.target && e.target.closest && e.target.closest('button'))) { e.preventDefault(); if (S.paused.user) resume('user'); else pause('user'); }
      else if (e.key === 'Home') { e.preventDefault(); go(0, -1); }
    });
    window.addEventListener('blur', function () { if (S) pause('focus'); });
    window.addEventListener('focus', function () { if (S) resume('focus'); });
    document.addEventListener('visibilitychange', function () { if (!S) return; if (document.hidden) pause('focus'); else resume('focus'); });
    // Closing can happen from Escape, the back button or the close control;
    // they all end with `open` coming off, so that is what is watched.
    new MutationObserver(function () { if (S && !h.classList.contains('open')) teardown(); }).observe(h, { attributes: true, attributeFilter: ['class'] });
  }
  function close() { var h = host(); if (h) h.classList.remove('open'); }
  function teardown() {
    stopPreview(); clearTimeout(S && S.timer);
    ['story', 'square'].forEach(function (f) { if (S && S.card[f] && S.card[f].url) URL.revokeObjectURL(S.card[f].url); });
    S = null;
    setTimeout(function () { var h = host(); if (h && !h.classList.contains('open')) h.innerHTML = ''; }, 260);
  }
  document.addEventListener('click', function (e) {
    var c = e.target.closest && e.target.closest('#rp-close');
    if (c) close();
  });

  /* ---- audio: a preview, only when pressed ------------------------------- */
  var _pv = null;
  function preview(i, btn) {
    if (!window.VinalAudio || !S) return;
    if (_pv && _pv.i === i) { stopPreview(); return; }
    stopPreview();
    var t = tracksOf(S.m).rows[i]; if (!t) return;
    _pv = { i: i, btn: btn };
    btn.classList.add('on'); btn.innerHTML = STOP_SVG; btn.setAttribute('aria-label', 'Stop preview');
    pause('audio');
    Promise.resolve(VinalAudio.play({ artist: t.artist, title: t.title }, 30)).catch(function () {}).then(function () {
      if (_pv && _pv.i === i) _pv.end = setTimeout(stopPreview, 30500);
    });
  }
  function stopPreview() {
    if (!_pv) return;
    try { VinalAudio.stop(); } catch (e) {}
    clearTimeout(_pv.end);
    if (_pv.btn) { _pv.btn.classList.remove('on'); _pv.btn.innerHTML = PLAY_SVG; _pv.btn.setAttribute('aria-label', 'Play a preview'); }
    _pv = null;
    if (S) resume('audio');
  }

  /* ---- the card ----------------------------------------------------------
     Drawn on a canvas, not screenshotted: exact pixels (1080×1920 story,
     1080×1080 square) on every device, real fonts, real sleeves. A sleeve
     that will not lend its pixels (CORS) is left out rather than tainting
     the canvas and killing the export. What is on it: the period, top
     artists, the top record, the DNA and a few numbers. Never notes, diary
     entries or Lore answers. */
  var FD = '"Instrument Sans", sans-serif', FM = '"IBM Plex Mono", monospace', FB = '"IBM Plex Sans", sans-serif';
  async function fonts() {
    if (!document.fonts || !document.fonts.load) return;
    await Promise.race([Promise.all([document.fonts.load('800 120px "Instrument Sans"'), document.fonts.load('600 40px "IBM Plex Mono"'), document.fonts.load('500 32px "IBM Plex Sans"')]), new Promise(function (r) { setTimeout(r, 1500); })]);
  }
  function fit(x, text, maxW, size, weight, fam, min) {
    var s = size; x.font = weight + ' ' + s + 'px ' + fam;
    while (x.measureText(text).width > maxW && s > (min || 18)) { s -= 2; x.font = weight + ' ' + s + 'px ' + fam; }
    if (x.measureText(text).width > maxW) { while (text.length > 2 && x.measureText(text + '…').width > maxW) text = text.slice(0, -1); text += '…'; }
    return { text: text, size: s };
  }
  function spaced(x, text, X, Y, sp) { if ('letterSpacing' in x) { x.letterSpacing = sp + 'px'; x.fillText(text, X, Y); x.letterSpacing = '0px'; return; } var cx = X; text.split('').forEach(function (ch) { x.fillText(ch, cx, Y); cx += x.measureText(ch).width + sp; }); }
  var _noise = null;
  function noise() {
    if (_noise) return _noise;
    var c = document.createElement('canvas'); c.width = c.height = 128; var x = c.getContext('2d'), d = x.createImageData(128, 128);
    for (var i = 0; i < d.data.length; i += 4) { var v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    x.putImageData(d, 0, 0); return (_noise = c);
  }
  function rr(x, X, Y, W, H, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r); x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath(); }
  async function drawCard(m, fmt, noImages) {
    await fonts();
    var W = 1080, H = fmt === 'square' ? 1080 : 1920, sq = fmt === 'square';
    var c = document.createElement('canvas'); c.width = W; c.height = H; var x = c.getContext('2d');
    var P = m.pal || DEFAULT_PAL;
    x.fillStyle = '#0b0810'; x.fillRect(0, 0, W, H);
    [[0.15, 0.12, 0.75, P[0], 0.95], [0.9, 0.3, 0.6, P[1], 0.55], [0.4, 0.95, 0.7, P[2], 0.32]].forEach(function (b) {
      var g = x.createRadialGradient(W * b[0], H * b[1], 0, W * b[0], H * b[1], Math.max(W, H) * b[2]);
      g.addColorStop(0, b[3]); g.addColorStop(1, 'rgba(11,8,16,0)'); x.globalAlpha = b[4]; x.fillStyle = g; x.fillRect(0, 0, W, H);
    });
    x.globalAlpha = 1;
    var v = x.createLinearGradient(0, 0, 0, H); v.addColorStop(0, 'rgba(7,6,10,0.15)'); v.addColorStop(0.55, 'rgba(7,6,10,0.35)'); v.addColorStop(1, 'rgba(7,6,10,0.88)');
    x.fillStyle = v; x.fillRect(0, 0, W, H);
    x.globalAlpha = 0.07; x.globalCompositeOperation = 'overlay'; x.fillStyle = x.createPattern(noise(), 'repeat'); x.fillRect(0, 0, W, H);
    x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';

    /* Fixed zones, so nothing can collide however long the names are: a
       head (brand, period), the sleeves, a middle that FLOWS but stops
       before the reserved foot, and a foot (genre mix, numbers, sign-off)
       pinned to the bottom. Anything that would cross into the foot is left
       off rather than squeezed in. */
    var A = artistsOf(m), T = tracksOf(m), M = 80, y = sq ? 96 : 130;
    var FOOT = sq ? H - 236 : H - 360;
    x.fillStyle = 'rgba(255,255,255,0.85)'; x.font = '600 26px ' + FM; x.textBaseline = 'alphabetic';
    spaced(x, 'VINALL REPLAY' + (m.live ? ' · SO FAR' : ''), M, y, 7);
    var title = m.p.kind === 'year' ? m.p.label : m.p.kind === 'month' ? m.p.month : 'Week of ' + R.fmtDay(m.p.start);
    var tf = fit(x, title, W - M * 2, sq ? 150 : (m.p.kind === 'year' ? 300 : 190), 800, FD, 80);
    var tg = x.createLinearGradient(M, 0, W - M, 0); tg.addColorStop(0, '#ffffff'); tg.addColorStop(0.55, P[2]); tg.addColorStop(1, '#ffffff');
    x.fillStyle = tg; x.font = '800 ' + tf.size + 'px ' + FD; if ('letterSpacing' in x) x.letterSpacing = (-tf.size * 0.05) + 'px';
    y += tf.size * 0.86 + 12; x.fillText(tf.text, M - tf.size * 0.03, y); if ('letterSpacing' in x) x.letterSpacing = '0px';
    if (m.p.kind === 'month') { x.fillStyle = 'rgba(255,255,255,0.7)'; x.font = '600 32px ' + FM; x.fillText(String(m.p.year), M, y + 48); y += 48; }

    // Sleeves: a tilted fan on the story card, a straight row on the square.
    var arts = m.crate.topAlbums.map(function (a) { return a.art; }).concat(A.rows.map(function (a) { return a.art; })).filter(Boolean);
    arts = arts.filter(function (u, i) { return arts.indexOf(u) === i; }).slice(0, 3);
    var ims = noImages ? [] : (await Promise.all(arts.map(function (u) { return loadImg(thumbOf(u, 500), true); }))).filter(Boolean);
    function sleeve(im, cx, cy, s, rot) {
      x.save(); x.translate(cx, cy); x.rotate(rot);
      x.shadowColor = 'rgba(0,0,0,0.6)'; x.shadowBlur = 50; x.shadowOffsetY = 24;
      rr(x, -s / 2, -s / 2, s, s, s * 0.07); x.fillStyle = '#000'; x.fill(); x.shadowColor = 'transparent';
      x.clip(); x.drawImage(im, -s / 2, -s / 2, s, s); x.restore();
    }
    if (ims.length) {
      if (!sq) {
        var s = 330, cy = y + 70 + s / 2;
        ims.forEach(function (im, i, all) { var k = all.length === 1 ? 0 : i - (all.length - 1) / 2; sleeve(im, W / 2 + k * 230, cy + Math.abs(k) * 26, s, k * 0.12); });
        y = cy + s / 2 + 90;
      } else {
        var s2 = 160;
        ims.forEach(function (im, i) { sleeve(im, M + s2 / 2 + i * (s2 + 24), y + 40 + s2 / 2, s2, 0); });
        y += 40 + s2 + 56;
      }
    } else y += 80;

    function kicker(t, Y) { x.fillStyle = P[2]; x.font = '600 24px ' + FM; spaced(x, t.toUpperCase(), M, Y, 5); }
    function room(h) { return y + h <= FOOT; }
    if (m.dna && m.dna.primary && room(sq ? 110 : 150)) {
      kicker('Music DNA', y);
      var df = fit(x, m.dna.primary.name, W - M * 2, sq ? 76 : 88, 800, FD, 44);
      x.fillStyle = '#fff'; x.font = '800 ' + df.size + 'px ' + FD; x.fillText(df.text, M, y + df.size + 6);
      y += df.size + 18;
      if (!sq && m.dna.primary.evidence[0]) { var ef = fit(x, m.dna.primary.evidence[0], W - M * 2, 28, 500, FM, 18); x.fillStyle = 'rgba(255,255,255,0.72)'; x.font = '500 ' + ef.size + 'px ' + FM; x.fillText(ef.text, M, y + 34); y += 52; }
      y += sq ? 30 : 56;
    }
    var step = sq ? 52 : 66, rows = A.rows.slice(0, sq ? 3 : 5);
    while (rows.length && !room(64 + rows.length * step)) rows.pop();
    if (rows.length) {
      kicker(A.label, y);
      rows.forEach(function (a, i) {
        var Y = y + 62 + i * step;
        x.fillStyle = 'rgba(255,255,255,0.45)'; x.font = '600 32px ' + FM; x.fillText(String(i + 1), M, Y);
        x.fillStyle = 'rgba(255,255,255,0.6)'; x.font = '500 26px ' + FM; x.textAlign = 'right'; x.fillText(a.value, W - M, Y); var vw = x.measureText(a.value).width; x.textAlign = 'left';
        var nf = fit(x, a.name, W - M * 2 - 64 - vw - 30, i === 0 ? 50 : 42, i === 0 ? 800 : 700, FD, 24);
        x.fillStyle = '#fff'; x.font = (i === 0 ? 800 : 700) + ' ' + nf.size + 'px ' + FD; x.fillText(nf.text, M + 64, Y);
      });
      y += 62 + rows.length * step + 40;
    }
    if (!sq && T.rows[0] && room(110)) {
      kicker(T.src === 'listening' ? 'On repeat' : 'Top song', y);
      var sf = fit(x, T.rows[0].title + ' — ' + T.rows[0].artist, W - M * 2, 40, 700, FD, 24);
      x.fillStyle = '#fff'; x.font = '700 ' + sf.size + 'px ' + FD; x.fillText(sf.text, M, y + 56);
    }

    // The foot: genre mix (story card only), a rule, the numbers.
    var fy = FOOT + 20;
    if (!sq && m.crate.genres.length >= 2) {
      var gx = M, gw = W - M * 2, hues = [P[2], P[1], '#7cf2ff', '#c46bff', '#ff6fae', '#b8f24a'];
      m.crate.genres.slice(0, 6).forEach(function (g, i) { var w = g.share * gw; x.fillStyle = hues[i]; rr(x, gx, fy, Math.max(4, w - 4), 12, 6); x.fill(); gx += w; });
      x.fillStyle = 'rgba(255,255,255,0.62)'; x.font = '500 22px ' + FM;
      x.fillText(m.crate.genres.slice(0, 3).map(function (g) { return g.name + ' ' + Math.round(g.share * 100) + '%'; }).join('   '), M, fy + 46);
      fy += 90;
    }
    var stats = [];
    if (m.L) stats.push([n(Math.round(m.L.ms / 60000)), 'minutes played']);
    if (m.crate.albums) stats.push([n(m.crate.albums), 'albums rated']);
    if (m.crate.discoveryCount) stats.push([n(m.crate.discoveryCount), 'new artists']);
    else if (m.crate.songs) stats.push([n(m.crate.songs), 'songs rated']);
    stats = stats.slice(0, 3);
    if (stats.length) {
      var cw = (W - M * 2) / stats.length;
      x.strokeStyle = 'rgba(255,255,255,0.18)'; x.lineWidth = 2; x.beginPath(); x.moveTo(M, fy); x.lineTo(W - M, fy); x.stroke();
      stats.forEach(function (st, i) {
        x.fillStyle = '#fff'; x.font = '600 ' + (sq ? 48 : 58) + 'px ' + FM; x.fillText(st[0], M + i * cw, fy + (sq ? 62 : 72));
        x.fillStyle = 'rgba(255,255,255,0.6)'; x.font = '500 22px ' + FB; x.fillText(st[1], M + i * cw, fy + (sq ? 96 : 108));
      });
    }
    // Sign-off.
    x.fillStyle = 'rgba(255,255,255,0.8)'; x.font = '700 28px ' + FD; x.fillText('vinall.xyz', M, H - 64);
    x.fillStyle = 'rgba(255,255,255,0.45)'; x.font = '500 20px ' + FM; x.textAlign = 'right';
    x.fillText(m.L ? 'Ratings: VINALL · Listening: your Spotify data' : 'From your VINALL ratings', W - M, H - 66); x.textAlign = 'left';
    if (m.demo) {
      x.save(); x.translate(W / 2, H / 2); x.rotate(-0.5); x.fillStyle = 'rgba(245,200,66,0.32)'; x.font = '800 120px ' + FD; x.textAlign = 'center';
      for (var k = -3; k <= 3; k++) x.fillText('DEMO · NOT REAL DATA', 0, k * 260); x.restore();
    }
    return c;
  }
  function toBlob(c) { return new Promise(function (res, rej) { try { c.toBlob(function (b) { b ? res(b) : rej(new Error('empty')); }, 'image/png'); } catch (e) { rej(e); } }); }
  async function card(fmt) {
    if (!S) return null;
    if (S.card[fmt]) return S.card[fmt];
    var m = S.m, blob;
    try { blob = await toBlob(await drawCard(m, fmt)); }
    catch (e) { blob = await toBlob(await drawCard(m, fmt, true)); }     // a tainted sleeve: draw without sleeves
    var name = 'vinall-replay-' + (m.demo ? 'demo-' : '') + m.p.key.slice(1) + (fmt === 'square' ? '-square' : '') + '.png';
    S.card[fmt] = { blob: blob, url: URL.createObjectURL(blob), name: name };
    return S.card[fmt];
  }
  async function paintSummary() {
    var box = $('rp-summary'); if (!box || !S) return;
    var fmt = S.fmt; box.classList.toggle('square', fmt === 'square');
    box.innerHTML = '<div class="ld">Pressing your card…</div>';
    try {
      var c = await card(fmt);
      if (!S || S.fmt !== fmt || !box.isConnected) return;
      box.innerHTML = '<img class="pv" src="' + c.url + '" alt="Your Replay card: ' + esc(S.m.p.label) + '" style="-webkit-touch-callout:default;user-select:auto">';
    } catch (e) { box.innerHTML = '<div class="ld">Could not draw the card</div>'; report('replay card failed', { e: String(e) }); }
  }
  async function shareCard(saveOnly, btn) {
    if (!S) return;
    var c = await card(S.fmt); if (!c) return;
    var file = new File([c.blob], c.name, { type: 'image/png' });
    if (!saveOnly && navigator.canShare && navigator.canShare({ files: [file] })) {
      pause('share');
      try { await navigator.share({ files: [file], title: 'My VINALL Replay', text: S.m.demo ? '' : 'My ' + S.m.p.label + ' on VINALL' }); if (window.buzz) buzz('good'); }
      catch (e) { /* backed out of the sheet: not an error, not a share */ }
      resume('share'); return;
    }
    // Saving: a download where downloads exist; inside the app's webview the
    // preview image itself can be long-pressed and saved.
    var a = document.createElement('a'); a.href = c.url; a.download = c.name; document.body.appendChild(a); a.click(); a.remove();
    if (btn) { var t = btn.textContent; btn.lastChild.textContent = window.Native && Native.on ? 'Press and hold the card to save' : 'Saved'; setTimeout(function () { if (btn.isConnected) btn.lastChild.textContent = t.replace('↗', ''); }, 2400); }
  }

  /* ---- the demo -----------------------------------------------------------
     Built from the static game pool (real records, invented ratings and
     invented listening), run through exactly the same arithmetic, and marked
     DEMO on every scene and across the exported card. */
  async function demoModel(p) {
    var pool = (window.VinalPool && VinalPool.albums) || [], songsPool = (window.VinalPool && VinalPool.songs) || [];
    var seed = 7; function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    var albums = {}, songs = {}, span = Math.min(p.end, Date.now()) - p.start;
    pool.slice(0, 46).forEach(function (r, i) {
      var t = p.start + Math.floor(rnd() * span * 0.98), s = Math.round(55 + rnd() * 44);
      var h = [{ s: s, t: t }];
      if (i % 9 === 0) h.push({ s: Math.min(100, s + 12), t: Math.min(Date.now(), t + 40 * 864e5) });
      albums['demo' + i] = { id: 'demo' + i, name: r[0], artist: r[1], year: String(r[2]), genre: r[3], art: r[6], score: h[h.length - 1].s, history: h };
    });
    songsPool.slice(0, 70).forEach(function (r, i) {
      var t = p.start + Math.floor(rnd() * span * 0.98);
      songs['ds' + i] = { id: 'ds' + i, name: r[0], artist: r[1], albumName: r[6], albumId: 'da' + (i % 9), art: r[7], score: 5 + Math.round(rnd() * 5), history: [{ s: 5 + Math.round(rnd() * 5), t: t }] };
    });
    var input = { albums: albums, songs: songs, liked: {} };
    var byDay = [], d = p.start; while (d < Math.min(p.end, Date.now())) { byDay.push({ d: R.dayKey(d), ms: Math.round((0.5 + rnd()) * 5.4e6), plays: 20 }); d += 864e5; }
    var ms = byDay.reduce(function (s, x) { return s + x.ms; }, 0);
    var L = { demo: true, data_from: R.dayKey(p.start - 400 * 864e5), data_to: R.dayKey(Math.min(p.end, Date.now()) - 864e5), plays: Math.round(ms / 200000), ms: ms, days: byDay.length, tracks: 1180, artists: 342,
      top_artists: songsPool.slice(0, 5).map(function (r, i) { return { artist: r[1], ms: Math.round(ms * (0.09 - i * 0.012)), plays: 400 - i * 50, tracks: 30 - i * 3 }; }),
      top_tracks: songsPool.slice(5, 10).map(function (r, i) { return { track: r[0], artist: r[1], album: r[6], plays: 140 - i * 17, ms: 0 }; }),
      by_day: byDay, new_artists: songsPool.slice(12, 20).map(function (r) { return { artist: r[1] }; }), new_artist_count: 61 };
    var m = await model(p, { demo: true, input: input, L: L });
    m._demoInput = input;
    return m;
  }

  /* ---- home ---------------------------------------------------------------- */
  var _kind = 'month';
  try { _kind = localStorage.getItem('vinal_replay_kind') || 'month'; } catch (e) {}
  function activitySpan(input) {
    var first = Infinity;
    [input.albums, input.songs].forEach(function (o) { Object.keys(o || {}).forEach(function (k) { var t = R.firstT(o[k]); if (t && t < first) first = t; }); });
    return first === Infinity ? null : first;
  }
  function periodsBack(kind, from, limit) {
    var out = [], p = R.period(kind);
    while (out.length < limit && p.end > from) { out.push(p); p = R.prev(p); }
    return out;
  }
  /* ---- the gate ------------------------------------------------------------
     Replay opens on a five-day login streak. The rule is the server's and
     arrives as window.ReplayGate; until that module exists Replay is simply
     OPEN, so nothing breaks before the backend lands. A gate that throws also
     reads as open: a broken lock must not lock somebody out of their own year.
     The meter shows only when the gate can say how far along you are. */
  function gate() {
    var G = window.ReplayGate, ok = true, pr = null;
    if (!G || typeof G.unlocked !== 'function') return { open: true, progress: null };
    try { ok = !!G.unlocked(); } catch (e) { ok = true; }
    if (!ok && typeof G.progress === 'function') { try { pr = G.progress() || null; } catch (e) { pr = null; } }
    return { open: ok, progress: pr };
  }
  // Which periods this device has opened, so a finished one nobody has
  // looked at yet can say "New". A convenience, not a record: losing it only
  // costs a chip.
  var OPENED = 'vinal_replay_opened';
  function opened() { return lsJSON(OPENED) || {}; }
  function markOpened(k) { try { var o = opened(); if (o[k]) return; o[k] = Date.now(); localStorage.setItem(OPENED, JSON.stringify(o)); } catch (e) {} }
  function topCovers(k) {
    var A = crateInput().albums;
    return Object.keys(A).map(function (id) { return A[id]; }).filter(function (a) { return a && a.art; })
      .sort(function (a, b) { return (b.score || 0) - (a.score || 0); }).slice(0, k).map(function (a) { return a.art; });
  }
  function collage(covers, px) {
    if (!covers.length) return '';
    return '<div class="rp-collage n' + Math.min(covers.length, 6) + '" aria-hidden="true">' + covers.slice(0, 6).map(function (u, i) {
      return '<img src="' + esc(thumbOf(u, px || 320)) + '" alt="" decoding="async" style="--i:' + i + '" onerror="this.style.visibility=\'hidden\'">';
    }).join('') + '</div>';
  }
  function heroStat(v, label) { return '<div class="rp-hstat"><b>' + count(v) + '</b><span>' + esc(label) + '</span></div>'; }

  /* The teaser. Not a button: there is nowhere for it to go yet, and a
     control that names one action and performs none is the worst shape a
     control can have. It sits under every Replay entry. */
  function teaserHtml() {
    return '<div class="rp-teaser" role="note" aria-label="New arcade games coming soon">' +
      '<span class="rp-teaser-sheen" aria-hidden="true"></span>' +
      '<span class="rp-teaser-tiles" aria-hidden="true">' +
        '<i style="--t:var(--c-cyan)"><svg viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 6.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z"/></svg></i>' +
        '<i style="--t:var(--c-violet)"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6" opacity=".45"/></svg></i>' +
        '<i style="--t:var(--c-pink)"><svg viewBox="0 0 24 24"><text x="12" y="18.5" text-anchor="middle" font-size="17" font-weight="800" font-family="sans-serif">?</text></svg></i>' +
      '</span>' +
      '<span class="rp-teaser-t"><b>New arcade games</b><small>Coming soon to the arcade</small></span>' +
      '<em class="rp-soon">Soon</em></div>';
  }

  /* Locked. Says the rule exactly, shows how far along you are, and points at
     the one thing worth doing while you wait: bringing your listening in,
     because Replay is built from it. The demo stays open as a taste. */
  function lockedHtml(g, compact) {
    var pr = g.progress, need = pr ? Math.max(1, Math.round(+pr.need || 5)) : 5;
    var st = pr ? Math.max(0, Math.min(need, Math.floor(+pr.streak || 0))) : 0, covers = topCovers(6), pips = '';
    for (var i = 0; i < need; i++) pips += '<i class="' + (i < st ? 'on' : '') + '" style="--i:' + i + '"><em></em></i>';
    var left = need - st;
    var meter = pr ? '<div class="rp-lock-meter"><div class="rp-lock-pips" role="progressbar" aria-label="Login streak" aria-valuemin="0" aria-valuemax="' + need + '" aria-valuenow="' + st + '">' + pips + '</div>' +
      '<span class="rp-lock-count"><b>' + st + '</b> of ' + need + ' days' + (left > 0 ? ' · ' + (left === 1 ? 'one more day' : left + ' to go') : '') + '</span></div>' : '';
    return '<div class="rp-hero rp-locked' + (compact ? ' compact' : '') + '"' + (covers[0] ? ' data-rp-pal="' + esc(covers[0]) + '"' : '') + '>' +
      '<div class="rp-hero-record" aria-hidden="true"></div>' + collage(covers, 160) +
      '<span class="rp-lock-badge" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="5" y="10.5" width="14" height="10" rx="2.6" fill="currentColor"/></svg></span>' +
      '<span class="rp-kicker">VINALL Replay · locked</span>' +
      '<h2 class="rp-lock-title">Unlock on 5 day login streak</h2>' + meter +
      (compact ? '' : '<p class="rp-hero-sub">Your weeks, months and year in music, told as a story. Open VINALL five days running and it is yours.</p>') +
      '<ul class="rp-lock-needs">' +
        '<li><span class="rp-need-ico sp" aria-hidden="true">♫</span><span class="rp-need-t"><b>Built from your Spotify data</b><small>Import your Spotify listening so it is ready when Replay opens.</small></span><button class="rp-need-btn" data-rp-act="import">Import</button></li>' +
        '<li><span class="rp-need-ico" aria-hidden="true">+</span><span class="rp-need-t"><b>Other music services</b><small>Coming soon.</small></span><em class="rp-soon">Soon</em></li>' +
      '</ul>' +
      '<div class="rp-hero-row"><button class="rp-ghost rp-demo-btn" data-rp-act="demo"><i aria-hidden="true">▶</i>Preview a demo Replay</button></div></div>';
  }
  function paintPals(h) {
    h.querySelectorAll('[data-rp-pal]').forEach(function (el) { palette(el.dataset.rpPal).then(function (pal) { el.style.setProperty('--c1', pal[0]); el.style.setProperty('--c2', pal[1]); applyPal(el, pal); }); });
  }
  function act(a) {
    if (a === 'import' && window.SpotifyBridge) SpotifyBridge.open('intro');
    if (a === 'demo') open('year', null, { demo: true });
    if (a === 'rate') { if (window.goToView) goToView('albums'); var s = document.querySelector('#search, input[type="search"]'); if (s) s.focus(); }
  }

  async function renderHome() {
    var h = $('rp-home'); if (!h) return;
    var g = gate();
    if (!g.open) { h.innerHTML = lockedHtml(g, false) + teaserHtml(); wireHome(h); paintPals(h); return; }
    var input = crateInput(), first = activitySpan(input);
    var idx = await listeningIndex();
    var lFrom = idx && idx.data_from ? R.dayStart(idx.data_from) : null;
    var from = Math.min(first || Infinity, lFrom || Infinity);
    if (from === Infinity) { h.innerHTML = emptyHome(); wireHome(h); return; }
    var byW = {}, byM = {};
    if (idx) { (idx.weeks || []).forEach(function (w) { byW['w' + w.w] = w; }); (idx.months || []).forEach(function (mm) { byM['m' + mm.m] = mm; }); }
    function playsFor(p) { var r = p.kind === 'week' ? byW[p.key] : p.kind === 'month' ? byM[p.key] : null;
      if (p.kind === 'year' && idx) { var t = { plays: 0, ms: 0 }; (idx.months || []).forEach(function (mm) { if (mm.m.slice(0, 4) === String(p.year)) { t.plays += +mm.plays; t.ms += +mm.ms; } }); return t; }
      return r ? { plays: +r.plays, ms: +r.ms } : { plays: 0, ms: 0 }; }
    var limits = { week: 16, month: 24, year: 12 };
    var list = periodsBack(_kind, from, limits[_kind]).map(function (p) {
      var c = R.crateStats(input, p), lp = playsFor(p);
      return { p: p, c: c, plays: lp.plays, ms: lp.ms, any: c.albums + c.songs + c.rerates > 0 || lp.plays >= (R.MIN_PLAYS[p.kind] || 40) };
    }).filter(function (x) { return x.any; });
    // The featured Replay: this year so far once there is something in it.
    var yr = R.period('year'), yc = R.crateStats(input, yr), ylp = playsFor(yr);
    var feat = (yc.albums + yc.songs > 0 || ylp.plays > 0) ? { p: yr, c: yc, ms: ylp.ms } : null;
    if (!feat) { var py = R.prev(yr), pc = R.crateStats(input, py); if (pc.albums + pc.songs > 0) feat = { p: py, c: pc, ms: playsFor(py).ms }; }
    var lifetime = await hasLifetimeListening();
    var noDays = !idx || !idx.data_from;
    var seen = opened();
    h.innerHTML =
      (feat ? heroHtml(feat) : '') + teaserHtml() +
      '<div class="rp-seg" role="group" aria-label="Replay length">' + ['week', 'month', 'year'].map(function (k) { return '<button data-rp-kind="' + k + '" aria-pressed="' + (k === _kind) + '">' + { week: 'Weekly', month: 'Monthly', year: 'Yearly' }[k] + '</button>'; }).join('') + '</div>' +
      (list.length ? '<div class="rp-timeline">' + list.map(function (x, i) { return cardHtml(x, i, seen); }).join('') + '</div>'
        : '<div class="rp-empty"><h3>No ' + { week: 'weeks', month: 'months', year: 'years' }[_kind] + ' to replay yet</h3><p>A Replay needs ratings or listening inside the period. Rate a few records this ' + _kind + ' and it appears here.</p></div>') +
      (noDays ? '<p class="rp-note">' + (lifetime ? 'Your Spotify history was imported before Replay could date it. <a href="#" data-rp-act="import">Import the same file again</a> to see what you played, week by week.' : on() ? 'Replay shows what you rated. <a href="#" data-rp-act="import">Add your Spotify data</a> to see what you played too.' : 'Log in and add your Spotify data to see what you played too.') + '</p>' : '');
    wireHome(h);
    paintPals(h);
    countUps(h);
  }
  function heroHtml(f) {
    var covers = f.c.covers.slice(0, 6), done = R.complete(f.p);
    return '<div class="rp-hero rp-feature" data-rp-open="' + f.p.key + '"' + (covers[0] ? ' data-rp-pal="' + esc(covers[0]) + '"' : '') + '>' +
      '<div class="rp-hero-record" aria-hidden="true"></div>' + collage(covers, 320) +
      '<span class="rp-kicker">VINALL Replay' + (done ? '' : ' · so far') + '</span>' +
      '<h2 class="rp-hero-word">' + esc(f.p.label) + '</h2>' +
      '<div class="rp-hero-stats">' + heroStat(f.c.albums, f.c.albums === 1 ? 'album' : 'albums') + heroStat(f.c.songs, f.c.songs === 1 ? 'song' : 'songs') +
        (f.c.discoveryCount ? heroStat(f.c.discoveryCount, f.c.discoveryCount === 1 ? 'new artist' : 'new artists') : '') +
        (f.ms ? heroStat(Math.round(f.ms / 60000), 'minutes played') : '') + '</div>' +
      '<div class="rp-hero-row"><button class="rp-play" data-rp-open="' + f.p.key + '"><i>▶</i>Play your ' + (f.p.kind === 'year' ? 'year' : f.p.kind) + '</button></div></div>';
  }
  function cardHtml(x, i, seen) {
    var live = !R.complete(x.p), covers = x.c.covers.slice(0, 4), fresh = !live && !seen[x.p.key];
    var bits = []; if (x.c.albums) bits.push(pl(x.c.albums, 'album')); if (x.c.songs) bits.push(pl(x.c.songs, 'song')); if (x.ms) bits.push(hm(x.ms) + ' played');
    return '<button class="rp-card' + (i === 0 ? ' lead' : '') + (fresh ? ' fresh' : '') + '" data-rp-open="' + x.p.key + '"' + (covers[0] ? ' data-rp-pal="' + esc(covers[0]) + '"' : '') + '>' +
      '<span class="rp-chip' + (live ? ' live' : fresh ? ' new' : '') + '">' + (live ? 'So far' : fresh ? 'New' : 'Replayed') + '</span>' +
      (covers.length ? '<span class="rp-card-covers n' + covers.length + '" aria-hidden="true">' + covers.map(function (u, k) { return '<img src="' + esc(thumbOf(u, i === 0 ? 320 : 160)) + '" alt="" loading="lazy" style="--i:' + k + '" onerror="this.style.visibility=\'hidden\'">'; }).join('') + '</span>' : '') +
      '<span class="rp-card-kind">' + periodWord(x.p) + '</span>' +
      '<b>' + esc(x.p.label) + '</b><small>' + esc(bits.join(' · ') || 'Re-ratings only') + '</small>' +
      '<span class="rp-card-go" aria-hidden="true">▶</span></button>';
  }
  function emptyHome() {
    return '<div class="rp-hero" style="min-height:300px"><div class="rp-hero-record" aria-hidden="true"></div><span class="rp-kicker">VINALL Replay</span><h2 class="rp-hero-word">Replay</h2>' +
      '<p class="rp-hero-sub">Your weeks, months and year in music — built from what you rate here and, if you add it, what you played on Spotify.</p></div>' + teaserHtml() +
      '<div class="rp-empty"><h3>Nothing to replay yet</h3><p>Replay needs at least a few ratings, or your Spotify listening history. Nothing here is ever made up — so it waits until there is something real to show.</p>' +
      '<div class="rp-hero-row"><button class="btn-primary" data-rp-act="rate">Rate a record</button>' + (on() ? '<button class="btn-ghost" data-rp-act="import">Add Spotify data</button>' : '') +
      '<button class="btn-ghost" data-rp-act="demo">See a demo</button></div></div>';
  }
  function wireHome(h) {
    if (h._wired) return; h._wired = true;
    h.addEventListener('click', function (e) {
      var k = e.target.closest('[data-rp-kind]');
      if (k) { _kind = k.dataset.rpKind; try { localStorage.setItem('vinal_replay_kind', _kind); } catch (x) {} renderHome(); return; }
      var a = e.target.closest('[data-rp-act]');
      if (a) { e.preventDefault(); act(a.dataset.rpAct); return; }
      var o = e.target.closest('[data-rp-open]');
      if (o) open(null, o.dataset.rpOpen);
    });
  }

  // The invitation on Home. Unlocked, only when this year has something in
  // it — for a brand new account it would be a door to an empty room. Locked,
  // always: that card is the reason to come back tomorrow.
  var _gateWas = null, _fresh = false;
  function renderHomeCard() {
    var h = $('rp-home-card'); if (!h) return;
    var g = gate();
    if (!h._wired) {
      h._wired = true;
      h.addEventListener('click', function (e) {
        var a = e.target.closest('[data-rp-act]'); if (a) { e.preventDefault(); act(a.dataset.rpAct); return; }
        var o = e.target.closest('[data-rp-open]'); if (o) open(null, o.dataset.rpOpen);
      });
      h.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-rp-open]')) { e.preventDefault(); open(null, e.target.dataset.rpOpen); } });
    }
    if (!g.open) {
      var lsig = 'L' + JSON.stringify(g.progress) + topCovers(1)[0];
      if (h._sig === lsig) return; h._sig = lsig;
      h.innerHTML = '<div class="rp-home-card rp-home">' + lockedHtml(g, true) + teaserHtml() + '</div>';
      paintPals(h); return;
    }
    var input = crateInput(), yr = R.period('year'), c = R.crateStats(input, yr);
    if (c.albums + c.songs < 3) { h.innerHTML = ''; h._sig = ''; return; }
    var covers = c.covers.slice(0, 6), fresh = _fresh;
    var sig = yr.key + c.albums + '/' + c.songs + (covers[0] || '') + (fresh ? '!' : '');
    if (h._sig === sig) return; h._sig = sig;
    _fresh = false;
    h.innerHTML = '<div class="rp-home-card rp-home"><div class="rp-hero rp-hc' + (fresh ? ' rp-unlocked' : '') + '" role="button" tabindex="0" aria-label="Play your ' + yr.label + ' Replay" data-rp-open="' + yr.key + '"' + (covers[0] ? ' data-rp-pal="' + esc(covers[0]) + '"' : '') + '>' +
      '<div class="rp-hero-record" aria-hidden="true"></div>' + collage(covers, 160) +
      '<span class="rp-kicker">' + (fresh ? 'Unlocked · ' : '') + 'VINALL Replay · so far</span><h2 class="rp-hero-word">' + yr.label + '</h2>' +
      '<div class="rp-hero-stats">' + heroStat(c.albums, c.albums === 1 ? 'album' : 'albums') + heroStat(c.songs, c.songs === 1 ? 'song' : 'songs') +
        (c.discoveryCount ? heroStat(c.discoveryCount, c.discoveryCount === 1 ? 'new artist' : 'new artists') : '') + '</div>' +
      '<span class="rp-play rp-play-sm" aria-hidden="true"><i>▶</i>Play your year</span></div>' + teaserHtml() + '</div>';
    paintPals(h);
    countUps(h);
    if (fresh && window.burst) { var hero = h.querySelector('.rp-hero'); setTimeout(function () { if (hero.isConnected) burst(hero, { count: 34, spread: 200 }); }, 300); }
  }
  // The gate changed (a login extended the streak, or the backend arrived):
  // repaint both entries. Crossing from locked to open is the unlock moment.
  window.addEventListener('vinall:replay-gate', function () {
    var now = gate().open;
    if (_gateWas === false && now) _fresh = true;
    _gateWas = now;
    var hc = $('rp-home-card'); if (hc) hc._sig = null;
    renderHomeCard();
    if (window.currentMode === 'replay') renderHome();
  });
  _gateWas = gate().open;

  function invalidate() { _L = {}; _idx = null; _lifetime = null; }

  window.Replay = { open: open, renderHome: renderHome, renderHomeCard: renderHomeCard, invalidate: invalidate,
    demo: function () { return open('year', null, { demo: true }); }, _model: model, _scenes: scenesFor, _drawCard: drawCard };

  // vinall.xyz/#replay opens the section; ?replay=demo opens the demo.
  // The splash sits over everything at z-index 1000; a story opened under it
  // would play to nobody. Deep links wait for GO.
  function afterSplash(fn) {
    if (!$('splash-gate')) return fn();
    var mo = new MutationObserver(function () { if (!$('splash-gate')) { mo.disconnect(); fn(); } });
    mo.observe(document.body, { childList: true });
  }
  function boot() {
    try {
      var q = (window.__bootUrl && window.__bootUrl.search) || location.search;
      if (/[?&]replay=demo\b/.test(q)) afterSplash(function () { open('year', null, { demo: true }); });
      else if (location.hash === '#replay' && window.goToView) afterSplash(function () { goToView('replay'); });
    } catch (e) {}
    if (window.currentMode === 'home') renderHomeCard();
  }
  if (window.Cloud && Cloud.ready) Cloud.ready.then(boot); else boot();
})();
