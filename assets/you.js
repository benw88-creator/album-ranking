/* ================================================================
   YOU — Taste Match, Depth, About You and Your Music.
   The arithmetic is assets/taste.js (TasteCore); this file draws it and
   wires it to the app. Every rating made here goes through saveAlbum /
   saveSong, the same functions the album page uses, so it lands in the
   crate, the cloud mirror, the feed, the wallet and every personal feature
   at once — there is no second rating model.
   ================================================================ */
(function () {
  'use strict';
  var T = window.TasteCore;
  if (!T) return;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function th(u, px) { return window.thumb ? window.thumb(u, px) : u; }
  function n(x) { return Number(x || 0).toLocaleString('en-GB'); }
  function on() { return !!(window.Cloud && Cloud.isOn && Cloud.isOn()); }
  function albums() { return typeof loadAlbums === 'function' ? loadAlbums() : {}; }
  function songs() { return typeof loadSongs === 'function' ? loadSongs() : {}; }
  function lsJSON(k) { try { return JSON.parse(localStorage.getItem(k)) || null; } catch (e) { return null; } }
  function col(s100) { var r = ['#e24b4a', '#e0603c', '#e08a3c', '#efb927', '#c8c344', '#a8c24a', '#6bbf68', '#4fb477']; return r[Math.max(0, Math.min(7, Math.floor((s100 - 30) / 9)))]; }
  function cover(u, cls, px) { return '<img class="' + (cls || '') + '"' + (u ? ' src="' + esc(th(u, px || 160)) + '"' : '') + ' alt="" loading="lazy" onerror="this.removeAttribute(\'src\')">'; }

  /* ---- shared community figures, fetched once per session -------------- */
  var _comm = null;
  async function community(ids) {
    if (!on() || !Cloud.fetchAlbumScores) return null;
    _comm = _comm || {};
    var me = Cloud.getUser && Cloud.getUser(), mine = me && me.id;
    var need = ids.filter(function (id) { return !(id in _comm); });
    for (var i = 0; i < need.length && i < 360; i += 120) {
      var chunk = need.slice(i, i + 120), res = await Cloud.fetchAlbumScores(chunk);
      chunk.forEach(function (id) {
        var rows = (res[id] || []).filter(function (r) { return r.u !== mine; });
        _comm[id] = { n: rows.length, mean: rows.length ? rows.reduce(function (t, r) { return t + r.s; }, 0) / rows.length : null };
      });
    }
    return _comm;
  }
  function raters() { var o = {}; Object.keys(_comm || {}).forEach(function (k) { o[k] = _comm[k].n; }); return o; }

  /* ================================================================
     TASTE MATCH (profile)
     ================================================================ */
  function pairRows(list, mode) {
    return list.map(function (r) {
      var right = mode === 'you-them'
        ? '<span class="tm2-nums"><b style="color:' + col(r.you) + '">' + r.you + '</b><i>you</i><b style="color:' + col(r.them) + '">' + r.them + '</b><i>them</i></span>'
        : '<span class="tm2-nums"><b style="color:' + col(r.score || r.them) + '">' + (r.score || r.them) + '</b></span>';
      return '<div class="tm2-row">' + cover(r.art, '', 120) + '<span class="tm2-t"><b>' + esc(r.name) + '</b><small>' + esc(r.artist) + (r.newArtist ? ' · new artist' : '') + (r.raters != null ? ' · ' + r.raters + ' on VINALL' : '') + '</small></span>' + right +
        (mode === 'intro-in' ? '<button class="btn-mini tm-add" data-tmadd="' + esc(r.id) + '">Shortlist</button>' : '') + '</div>';
    }).join('');
  }
  function bar(label, value, note) {
    return '<div class="tm2-bar"><span>' + esc(label) + '</span><i><b style="width:' + Math.max(2, Math.min(100, value)) + '%"></b></i><em>' + esc(note) + '</em></div>';
  }
  function tasteHtml(tm, uname) {
    if (!tm) return '';
    var who = esc(uname || 'they');
    var head = '<div class="prof-section-title">Taste match</div>';
    if (!tm.enough) {
      return head + '<div class="tm2 tm2-thin"><p class="tm2-lede">' + (tm.shared ? 'You have ' + tm.shared + ' record' + (tm.shared === 1 ? '' : 's') + ' in common. Rate ' + tm.need + ' more that ' + who + ' has rated and this becomes a real comparison.' : 'Nothing in common yet. A comparison needs at least five records you have both rated.') + '</p>' +
        (tm.unheard.length ? '<div class="tm2-sub">' + who + ' rates these highly</div>' + pairRows(tm.unheard.slice(0, 4), 'intro-in') : '') + '</div>';
    }
    var c = tm.components, lvl = { high: 'High confidence', medium: 'Medium confidence', low: 'Early read' }[tm.level];
    var html = head + '<div class="tm2" data-tm2>' +
      '<div class="tm2-top"><div class="tm2-pct"><b>' + tm.pct + '</b><span>%</span></div>' +
        '<div class="tm2-meta"><span class="tm2-conf tm2-' + tm.level + '">' + lvl + '</span><span>' + tm.shared + ' records in common</span></div></div>' +
      (tm.blurb ? '<p class="tm2-lede">' + esc(tm.blurb) + '</p>' : '') +
      '<div class="tm2-bars">' +
        bar('Same order', Math.max(0, c.rankAgreement) * 100, c.rankAgreement >= 0.5 ? 'close' : c.rankAgreement > 0.15 ? 'partly' : 'different') +
        bar('Same level', c.closeness, c.closeness + '% of the way from chance to identical') +
        (c.eitherFavourite >= 3 ? bar('Shared favourites', c.sharedFavourites / c.eitherFavourite * 100, c.sharedFavourites + ' of ' + c.eitherFavourite) : '') +
        (c.artistCloseness != null ? bar('Artists', c.artistCloseness, c.artistsCompared + ' compared') : '') +
      '</div>' +
      ((tm.genreSimilarity != null || tm.eraSimilarity != null) ? '<div class="tm2-ctx">' +
        (tm.genreSimilarity != null ? '<span><b>' + tm.genreSimilarity + '%</b> genre overlap</span>' : '') +
        (tm.eraSimilarity != null ? '<span><b>' + tm.eraSimilarity + '%</b> era overlap</span>' : '') +
        '<em>Not part of the score.</em></div>' : '');
    if (tm.overlaps && tm.overlaps.length) html += '<div class="tm2-sub">Where you meet</div>' + pairRows(tm.overlaps, 'you-them');
    if (tm.surprise) html += '<div class="tm2-sub">A surprise</div><p class="tm2-note">You both love a ' + esc(tm.surprise.genre) + ' record, and neither of you usually rates much ' + esc(tm.surprise.genre) + '.</p>' + pairRows([tm.surprise], 'you-them');
    html += '<div data-tm2-gems></div>';
    if (tm.splits && tm.splits.length) html += '<div class="tm2-sub">Furthest apart</div>' + pairRows(tm.splits, 'you-them');
    if (tm.unheard && tm.unheard.length) html += '<div class="tm2-sub">From ' + who + ' to you</div>' + pairRows(tm.unheard.slice(0, 4), 'intro-in');
    if (tm.introduce && tm.introduce.length) html += '<div class="tm2-sub">From you to ' + who + '</div>' + pairRows(tm.introduce.slice(0, 3), 'intro-out');
    html += '</div>';
    return html;
  }
  // Rare shared favourites need everybody's ratings, so they arrive after the block.
  async function enhanceTaste(host, tm) {
    if (!host || !tm || !tm.enough || !tm.overlaps || !tm.overlaps.length) return;
    var slot = host.querySelector('[data-tm2-gems]'); if (!slot) return;
    var comm = await community(tm.overlaps.map(function (r) { return r.id; }));
    if (!comm) return;
    var gems = tm.overlaps.filter(function (r) { return comm[r.id] && comm[r.id].n <= 1; }).map(function (r) { var o = Object.assign({}, r); o.raters = comm[r.id].n + 2; return o; });
    if (gems.length) slot.innerHTML = '<div class="tm2-sub">Hidden gems you share</div>' + pairRows(gems, 'you-them');
  }

  /* ================================================================
     DEPTH
     ================================================================ */
  var DIMS = [
    { k: 'exploration', label: 'Exploration', q: 'How often you meet a new artist' },
    { k: 'diversity', label: 'Diversity', q: 'How widely you spread across artists, genres and decades' },
    { k: 'commitment', label: 'Commitment', q: 'How deep you go on an artist or a record' },
    { k: 'curiosity', label: 'Curiosity', q: 'How often you leave your usual ground' },
    { k: 'consistency', label: 'Consistency', q: 'How regularly you come back' },
    { k: 'obscurity', label: 'Obscurity', q: 'How few others have rated what you rate' }
  ];
  function depthNow() { return T.depth(albums(), songs(), { raters: _comm ? raters() : null, communitySize: _commSize }); }
  var _commSize = 0;
  function radar(d, size) {
    size = size || 220; var R = size / 2 - 26, cx = size / 2, cy = size / 2, pts = [], axes = '', labels = '', rings = '';
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      rings += '<polygon class="rd-ring" points="' + DIMS.map(function (x, i) { var a = -Math.PI / 2 + i * Math.PI / 3; return (cx + Math.cos(a) * R * f).toFixed(1) + ',' + (cy + Math.sin(a) * R * f).toFixed(1); }).join(' ') + '"/>';
    });
    DIMS.forEach(function (x, i) {
      var a = -Math.PI / 2 + i * Math.PI / 3, dim = d.dims[x.k], v = dim ? dim.score / 100 : 0;
      pts.push((cx + Math.cos(a) * R * v).toFixed(1) + ',' + (cy + Math.sin(a) * R * v).toFixed(1));
      axes += '<line class="rd-axis' + (dim ? '' : ' off') + '" x1="' + cx + '" y1="' + cy + '" x2="' + (cx + Math.cos(a) * R).toFixed(1) + '" y2="' + (cy + Math.sin(a) * R).toFixed(1) + '"/>';
      var lx = cx + Math.cos(a) * (R + 14), ly = cy + Math.sin(a) * (R + 14);
      labels += '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="' + (Math.abs(Math.cos(a)) < 0.2 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end') + '" dominant-baseline="middle" class="' + (dim ? '' : 'off') + '">' + x.label + '</text>';
    });
    return '<svg class="rd" viewBox="-30 0 ' + (size + 60) + ' ' + size + '" role="img" aria-label="Depth profile">' + rings + axes +
      '<polygon class="rd-shape" points="' + pts.join(' ') + '"/>' + labels + '</svg>';
  }
  function depthHtml() {
    var d = depthNow();
    var rows = DIMS.map(function (x) {
      var dim = d.dims[x.k];
      return '<div class="dp-dim' + (dim ? '' : ' off') + '"><div class="dp-dim-top"><b>' + x.label + '</b><span>' + (dim ? dim.score : '—') + '</span></div>' +
        '<i><em style="width:' + (dim ? dim.score : 0) + '%"></em></i><small>' + esc(dim ? dim.evidence : (x.k === 'obscurity' ? 'Needs more people on VINALL rating the same records.' : 'Not enough ratings yet.')) + '</small></div>';
    }).join('');
    return '<div class="prof-section-title" style="margin-top:26px;">Depth</div>' +
      '<div class="dp-card"><div class="dp-id"><span class="dp-kicker">How you listen</span><h3>' + esc(d.identity.name) + '</h3><p>' + esc(d.identity.line) + '</p>' +
      (d.identity.because ? '<p class="dp-because">' + esc(d.identity.because) + '.</p>' : '') + '</div>' +
      '<div class="dp-radar">' + radar(d) + '</div><div class="dp-dims">' + rows + '</div>' +
      '</div>';
  }
  function depthTile() {
    var d = depthNow(), top = Object.keys(d.dims).sort(function (a, b) { return d.dims[b].score - d.dims[a].score; })[0];
    return '<div class="stat stat-wallet stat-level" id="stat-depth" title="' + esc(d.identity.because || d.identity.line) + '"><div class="s-label">◈ Depth</div>' +
      '<div class="s-val s-val-word">' + esc(d.identity.name) + '</div>' +
      (top ? '<div class="lvl-bar"><i style="width:' + d.dims[top].score + '%"></i></div><div class="lvl-sub">' + DIMS.filter(function (x) { return x.k === top; })[0].label + ' ' + d.dims[top].score + '</div>' : '<div class="lvl-sub">' + esc(d.identity.line) + '</div>') + '</div>';
  }

  /* ================================================================
     ABOUT YOU
     ================================================================ */
  function aboutTeaser(isOwner) {
    if (!isOwner) return '';
    var A = albums(), k = Object.keys(A).length;
    var covers = Object.keys(A).map(function (id) { return A[id]; }).sort(function (a, b) { return (b.score || 0) - (a.score || 0); }).slice(0, 5).map(function (a) { return a.art; }).filter(Boolean);
    return '<div class="prof-section-title">About you</div><button class="ab-teaser" data-go-about>' +
      '<span class="ab-teaser-covers">' + covers.map(function (u, i) { return '<img src="' + esc(th(u, 160)) + '" alt="" style="--i:' + i + '">'; }).join('') + '</span>' +
      '<span class="ab-teaser-t"><b>' + (k >= 10 ? 'What your ratings say about you' : 'Rate ' + (10 - k) + ' more albums to unlock') + '</b></span><span class="ab-teaser-go">→</span></button>';
  }
  function visual(v) {
    if (!v) return '';
    if (v.type === 'hist') {
      var mx = Math.max.apply(null, v.data.concat([1]));
      return '<div class="ab-hist">' + v.data.map(function (c, i) { return '<span><i style="height:' + Math.max(2, c / mx * 100) + '%;background:' + col(i * 10 + 5) + '"></i><em>' + (i * 10) + '</em></span>'; }).join('') + '</div>';
    }
    if (v.type === 'bars') {
      var mn = Math.max.apply(null, v.data.map(function (d) { return d.n; }));
      return '<div class="ab-bars">' + v.data.map(function (d) { return '<div><span>' + esc(d.k) + '</span><i><b style="width:' + (d.n / mn * 100) + '%"></b></i><em style="color:' + col(d.avg) + '">' + d.avg + '</em></div>'; }).join('') + '<small class="ab-legend">bar: how many · number: average score</small></div>';
    }
    if (v.type === 'eras') {
      var me2 = Math.max.apply(null, v.data.map(function (d) { return d.n; }));
      return '<div class="ab-eras">' + v.data.map(function (d) { return '<span><em style="color:' + col(d.avg) + '">' + d.avg + '</em><i style="height:' + Math.max(4, d.n / me2 * 100) + '%"></i><b>' + esc(d.k) + '</b></span>'; }).join('') + '</div>';
    }
    return '';
  }
  async function renderAbout() {
    var host = $('ab-body'); if (!host) return;
    var A = albums(), S = songs();
    var base = T.insights(A, S, {});
    if (!base.ready) {
      host.innerHTML = '<div class="ab-empty"><span class="ab-kicker">About you</span><h1 class="ab-title">Not yet.</h1><p>About you reads patterns out of your ratings, and patterns need a few. Rate ' + base.need + ' more album' + (base.need === 1 ? '' : 's') + '.</p><button class="btn-primary" data-go="albums">Rate albums</button></div>';
      return;
    }
    host.innerHTML = paint(base);
    // The parts that need the network arrive after the page: everybody else's
    // scores on your records, and your imported listening.
    var ids = Object.keys(A);
    var comm = await community(ids).catch(function () { return null; });
    if (comm) _commSize = Math.max(_commSize, Object.keys(comm).reduce(function (t, k) { return t + (comm[k].n ? 1 : 0); }, 0) >= 30 ? 50 : 0);
    var listen = window.listeningPlays ? await window.listeningPlays().catch(function () { return []; }) : [];
    var full = T.insights(A, S, { community: comm || null, listen: listen || [] });
    if ($('ab-body') === host) host.innerHTML = paint(full);
  }
  function paint(r) {
    var A = albums(), d = depthNow();
    var top = Object.keys(A).map(function (id) { return A[id]; }).sort(function (a, b) { return (b.score || 0) - (a.score || 0); }).slice(0, 12).map(function (a) { return a.art; }).filter(Boolean);
    var cards = r.list.map(function (x, i) {
      return '<article class="ab-card' + (i === 0 ? ' lead' : '') + '"><span class="ab-kicker">' + esc(x.kicker) + '</span><h2>' + esc(x.headline) + '</h2>' +
        (x.detail ? '<p>' + esc(x.detail) + '</p>' : '') + visual(x.visual) +
        (x.items && x.items.length ? '<div class="ab-items">' + x.items.map(function (it) { return '<span>' + cover(it.art, '', 160) + '<b>' + esc(it.name) + '</b><small>' + esc(it.note || it.artist || '') + '</small></span>'; }).join('') + '</div>' : '') + '</article>';
    }).join('');
    return '<div class="ab-hero"><div class="ab-wall" aria-hidden="true">' + top.map(function (u) { return '<img src="' + esc(th(u, 160)) + '" alt="">'; }).join('') + '</div>' +
      '<span class="ab-kicker">About you</span><h1 class="ab-title">' + esc(d.identity.name) + '</h1><p class="ab-sub">' + esc(d.identity.line) + ' Read from ' + n(r.albums) + ' albums' + (r.songs ? ' and ' + n(r.songs) + ' songs' : '') + '.</p></div>' +
      '<section class="ab-depth"><div class="dp-radar">' + radar(d, 240) + '</div><div class="dp-dims">' + DIMS.map(function (x) {
        var dim = d.dims[x.k];
        return '<div class="dp-dim' + (dim ? '' : ' off') + '"><div class="dp-dim-top"><b>' + x.label + '</b><span>' + (dim ? dim.score : '—') + '</span></div><i><em style="width:' + (dim ? dim.score : 0) + '%"></em></i><small>' + esc(dim ? dim.evidence : x.q) + '</small></div>';
      }).join('') + '</div></section>' +
      '<div class="ab-grid">' + cards + '</div>' +
      '<p class="ab-foot">Only you can see this.</p>';
  }

  /* ================================================================
     YOUR MUSIC — rate what you brought in from Spotify, fast
     ================================================================ */
  var YM_KEY = 'crate_yourmusic_v1', SKIP_DAYS = 7;
  var ym = { tab: 'songs', queue: [], i: 0, session: [], undo: [], goal: 20, listen: null, typed: '', typedAt: 0 };
  function skips() { return lsJSON(YM_KEY) || {}; }
  function setSkip(key) { var s = skips(); s[key] = Date.now(); try { localStorage.setItem(YM_KEY, JSON.stringify(s)); } catch (e) {} if (window.Cloud) Cloud.push(YM_KEY); }
  function ratedAlbumKeys() { var o = {}; var A = albums(); Object.keys(A).forEach(function (id) { o[id] = 1; o[T.recKey(A[id].name, A[id].artist)] = 1; }); return o; }
  function ratedSongKeys() { var o = {}; var S = songs(); Object.keys(S).forEach(function (id) { o[id] = 1; o[T.recKey(S[id].name, S[id].artist)] = 1; }); return o; }

  // Everything the Spotify import left behind, as two candidate lists.
  function gather() {
    var st = lsJSON('crate_spotify_v1') || lsJSON('vinall_spotify_v1') || {}, imp = st.imported || {};
    var liked = lsJSON('crate_liked_songs_v1') || {}, sl = lsJSON('crate_shortlist_v1') || {};
    var plays = {}, last = {}, albPlays = {};
    (ym.listen || []).forEach(function (r) {
      var k = T.recKey(r.track, r.artist); plays[k] = (plays[k] || 0) + (r.plays || 0);
      var lp = r.last_played ? Date.parse(r.last_played) : 0; if (lp > (last[k] || 0)) last[k] = lp;
      if (r.album) { var ak = T.recKey(r.album, r.artist); albPlays[ak] = (albPlays[ak] || 0) + (r.plays || 0); if (lp > (last['a:' + ak] || 0)) last['a:' + ak] = lp; }
    });
    var familiar = {}; var A = albums(), S = songs();
    Object.keys(A).forEach(function (id) { familiar[T.fold(T.firstArtist(A[id].artist))] = 1; });
    Object.keys(S).forEach(function (id) { familiar[T.fold(T.firstArtist(S[id].artist))] = 1; });
    var songsOut = {}, albumsOut = {};
    function addSong(m, from) {
      if (!m || !m.id || !m.name) return;
      var k = T.recKey(m.name, m.artist), cur = songsOut[k];
      if (cur) { if (from === 'liked') cur.liked = true; if (!cur.albumId && m.albumId) { cur.albumId = m.albumId; cur.album = m.album; } return; }
      songsOut[k] = { kind: 'song', id: String(m.id), key: k, name: m.name, artist: m.artist || '', art: m.art || '', album: m.album || '', albumId: m.albumId ? String(m.albumId) : '',
        liked: from === 'liked', plays: plays[k] || 0, lastPlayed: last[k] || 0, familiar: !!familiar[T.fold(T.firstArtist(m.artist))] };
      if (m.albumId) {   // the album this track belongs to is a candidate too
        var ak = T.recKey(m.album, m.artist);
        var a = albumsOut[ak] || (albumsOut[ak] = { kind: 'album', id: String(m.albumId), key: ak, name: m.album, artist: m.artist, art: m.art, tracks: 0, plays: albPlays[ak] || 0, lastPlayed: last['a:' + ak] || 0, familiar: !!familiar[T.fold(T.firstArtist(m.artist))] });
        a.tracks++;
      }
    }
    function addAlbum(m, saved) {
      if (!m || !m.id || !m.name) return;
      var ak = T.recKey(m.name, m.artist), a = albumsOut[ak];
      if (a) { a.saved = a.saved || saved; a.id = a.id || String(m.id); return; }
      albumsOut[ak] = { kind: 'album', id: String(m.id), key: ak, name: m.name, artist: m.artist || '', art: m.art || '', tracks: 0, saved: saved, plays: albPlays[ak] || 0, lastPlayed: last['a:' + ak] || 0, familiar: !!familiar[T.fold(T.firstArtist(m.artist))] };
    }
    Object.keys(imp).forEach(function (u) { var m = imp[u]; if (/^spotify:album:/.test(u)) addAlbum(m, true); else addSong(m, 'import'); });
    Object.keys(liked).forEach(function (id) { var x = liked[id]; if (x && x.from === 'spotify') addSong(x, 'liked'); });
    Object.keys(sl).forEach(function (id) { var x = sl[id]; if (x && /Spotify/.test(x.why || '')) addAlbum(x, true); });
    var rA = ratedAlbumKeys(), rS = ratedSongKeys(), sk = skips(), cut = Date.now() - SKIP_DAYS * 864e5;
    function keep(x, rated, pre) { return !rated[x.id] && !rated[x.key] && !((sk[pre + x.key] || 0) > cut); }
    return {
      albums: Object.keys(albumsOut).map(function (k) { return albumsOut[k]; }).filter(function (x) { return keep(x, rA, 'a:'); }),
      songs: Object.keys(songsOut).map(function (k) { return songsOut[k]; }).filter(function (x) { return keep(x, rS, 's:'); }),
      any: Object.keys(imp).length + Object.keys(liked).length > 0
    };
  }

  async function renderYourMusic() {
    var host = $('ym-body'); if (!host) return;
    if (ym.listen == null) ym.listen = window.listeningPlays ? await window.listeningPlays().catch(function () { return []; }) : [];
    var g = gather();
    ym.counts = { albums: g.albums.length, songs: g.songs.length };
    if (!g.any) {
      host.innerHTML = '<div class="ym-empty"><span class="ym-kicker">Your music</span><h1 class="ym-title">Bring your library in.</h1>' +
        '<p>Your music turns what you saved and played on Spotify into ratings, one record at a time. Start by importing your Spotify data.</p>' +
        '<button class="btn-primary" data-ym-act="import">Import from Spotify</button></div>';
      return;
    }
    ym.queue = T.queue(ym.tab === 'albums' ? g.albums : g.songs, {});
    ym.i = 0;
    paintYm();
  }
  function cur() { return ym.queue[ym.i]; }
  function paintYm() {
    var host = $('ym-body'); if (!host) return;
    var x = cur(), done = ym.session.length, pct = Math.min(100, done / ym.goal * 100);
    var head = '<div class="ym-head"><div><span class="ym-kicker">Your music</span><h1 class="ym-title">Rate what you play.</h1></div>' +
      '<div class="ym-ring" style="--p:' + pct + '"><b>' + done + '</b><small>of ' + ym.goal + '</small></div></div>' +
      '<div class="ym-tabs" role="tablist">' + ['albums', 'songs'].map(function (t) { return '<button role="tab" data-ym-tab="' + t + '" aria-selected="' + (ym.tab === t) + '">' + (t === 'albums' ? 'Albums' : 'Songs') + '<em>' + n(ym.counts[t]) + '</em></button>'; }).join('') + '</div>';
    if (x && ym.tab === 'songs') { paintFeed(host, head); return; }
    feedStop();
    if (!x) {
      var rated = ym.session.filter(function (s) { return s.kind === (ym.tab === 'albums' ? 'album' : 'song'); });
      host.innerHTML = head + '<div class="ym-done"><h2>' + (rated.length ? 'That is everything here.' : 'Nothing left to rate here.') + '</h2>' +
        (rated.length ? '<p>' + rated.length + ' rated this session.</p><div class="ym-done-covers">' + rated.slice(-8).map(function (s) { return cover(s.art, '', 160); }).join('') + '</div>' : '<p>Everything imported in this tab is already rated or skipped for now.</p>') +
        '<button class="btn-primary" data-go="' + (ym.tab === 'albums' ? 'albums' : 'songs') + '">See your ' + (ym.tab === 'albums' ? 'albums' : 'songs') + '</button></div>';
      return;
    }
    var isAlb = x.kind === 'album', chips = [];
    if (x.plays) chips.push('Played ' + n(x.plays) + ' time' + (x.plays === 1 ? '' : 's'));
    if (x.liked) chips.push('Liked on Spotify');
    if (x.saved) chips.push('Saved on Spotify');
    if (isAlb && x.tracks > 1) chips.push(x.tracks + ' of its songs imported');
    if (!isAlb && x.album) chips.push(x.album);
    var ctl = isAlb
      ? '<div class="ym-rate ym-rate-alb"><output id="ym-val" style="color:' + col(ym.val) + '">' + ym.val + '</output><input type="range" id="ym-slider" min="1" max="100" value="' + ym.val + '" aria-label="Score out of 100">' +
        '<div class="ym-quick">' + [50, 60, 70, 80, 90, 100].map(function (v) { return '<button data-ym-q="' + v + '">' + v + '</button>'; }).join('') + '</div>' +
        '<button class="btn-primary ym-save" data-ym-act="rate">Rate ' + ym.val + '</button></div>'
      : '<div class="ym-rate ym-rate-song">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (v) { return '<button data-ym-s="' + v + '" style="--c:' + col(v * 10) + '">' + v + '</button>'; }).join('') + '</div>';
    host.innerHTML = head +
      '<div class="ym-stage"><div class="ym-bed" aria-hidden="true">' + (x.art ? '<img src="' + esc(th(x.art, 500)) + '" alt="">' : '') + '</div>' +
      '<div class="ym-card" id="ym-card">' + (x.art ? '<img class="ym-art" src="' + esc(th(x.art, 500)) + '" alt="">' : '<div class="ym-art ym-noart"></div>') +
      '<h2>' + esc(x.name) + '</h2><p class="ym-artist">' + esc(x.artist) + '</p>' + (chips.length ? '<p class="ym-chips">' + chips.map(esc).join(' · ') + '</p>' : '') + ctl + '</div></div>' +
      '<div class="ym-actions"><button class="btn-ghost" data-ym-act="undo"' + (ym.undo.length ? '' : ' disabled') + '>Undo</button><button class="btn-ghost" data-ym-act="skip">Skip</button></div>' +
      '<p class="ym-keys">' + (isAlb ? 'Type a score · ← → to adjust · Enter to rate' : '1–9, 0 for 10') + ' · S to skip · U to undo</p>';
    var sl = $('ym-slider');
    if (sl && window.GlowSlider) GlowSlider.enhance(sl, { className: 'gs-ym' });
    prefetch();
  }
  // The next few records' details, so rating one never waits on the network.
  function prefetch() {
    ym.queue.slice(ym.i, ym.i + 3).forEach(function (x) {
      if (x._meta || x._metaP) return;
      if (x.kind === 'album' && typeof spotifyGet === 'function') {
        x._metaP = spotifyGet('/albums/' + encodeURIComponent(x.id) + '?name=' + encodeURIComponent(x.name) + '&artist=' + encodeURIComponent(x.artist)).then(function (d) {
          x._meta = { year: d && d.release_date ? String(d.release_date).slice(0, 4) : '', genre: d && d.genres && d.genres[0] ? d.genres[0] : '', artistId: d && d.artists && d.artists[0] ? d.artists[0].id : '' };
        }, function () { x._meta = {}; });
      } else if (x.kind === 'song' && !x.albumId) {
        x._metaP = fetch(((window.Native && Native.api) || '') + '/api/catalogue?path=track&id=' + encodeURIComponent(x.id)).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
          var al = d && (d.album || (d.track && d.track.album));
          if (al) { x.albumId = String(al.id || ''); x.album = al.name || al.title || x.album; }
          x._meta = {};
        }, function () { x._meta = {}; });
      } else x._meta = {};
    });
  }
  ym.val = 75;
  async function rateCur(score) {
    var x = cur(); if (!x || ym.busy) return;
    ym.busy = true;
    try {
      if (x._metaP) await Promise.race([x._metaP, new Promise(function (r) { setTimeout(r, 1500); })]);
      var m = x._meta || {};
      if (x.kind === 'album') {
        saveAlbum({ id: x.id, name: x.name, artist: x.artist, artistId: m.artistId || '', art: x.art, year: m.year || '', genre: m.genre || '' }, score);
      } else {
        saveSong({ id: x.id, name: x.name, artists: [{ name: x.artist, id: '' }] }, score, { id: x.albumId || '', name: x.album || '', art: x.art });
      }
      ym.undo.push(x); ym.session.push({ kind: x.kind, art: x.art, score: score });
      if (window.buzz) buzz('tap');
      if (x.kind === 'song' && feedOn()) { ym.busy = false; feedRated(x, score); return; }
      var c = $('ym-card'); if (c) c.classList.add('out');
      if (ym.session.length % 10 === 0 && window.toast) toast(ym.session.length + ' rated');
      setTimeout(function () { ym.i++; ym.busy = false; paintYm(); }, window.motionReduced && motionReduced() ? 0 : 200);
    } catch (e) { ym.busy = false; if (window.reportIssue) reportIssue('Your music: rating failed', { e: String(e) }); }
  }
  function undo() {
    var x = ym.undo.pop(); if (!x) return;
    if (x.kind === 'album') { if (typeof removeAlbum === 'function') removeAlbum(x.id); }
    else saveSong({ id: x.id, name: x.name, artists: [{ name: x.artist, id: '' }] }, 0, { id: x.albumId || '', name: x.album || '', art: x.art });
    ym.session.pop();
    // Back to that card, wherever the queue has got to.
    var at = ym.queue.indexOf(x); if (at >= 0) { ym.queue.splice(at, 1); if (at < ym.i) ym.i--; }
    ym.queue.splice(ym.i, 0, x);
    paintYm();
  }
  function skip() {
    var x = cur(); if (!x) return;
    setSkip((x.kind === 'album' ? 'a:' : 's:') + x.key);
    if (x.kind === 'song' && feedOn()) { feedGo(ym.i + 1); return; }
    ym.i++; paintYm();
  }

  /* ================================================================
     THE SONG FEED — your imported library, thirty seconds at a time
     ================================================================
     For You's shape (a snap-scrolled column, one song a screen, the clip
     starting as the card settles) with a different job: everything here is
     already YOURS, saved or played on Spotify, so the card leads with how you
     know it and the rating is one tap on 1–10 rather than a slider. Rating a
     song moves the feed on by itself; Skip hides it for a week as before.

     The clip is VinalAudio's, resolved fresh by name every time — never a
     stored url (Deezer signs them for ~10 minutes). One observer, one playing
     card; leaving the view or the tab stops it, because display:none does not
     stop an <audio> element. The first card waits for a tap on iOS, where a
     clip can only start inside a gesture; after that the feed autoplays. */
  var FEED_BATCH = 8, _io = null, _feedPlaying = -1, _playTok = 0, _unlocked = false;
  function feedOn() { return !!$('ymf'); }
  function feedCard(x, q) {
    var chips = [];
    if (x.plays) chips.push('Played ' + n(x.plays) + '×');
    if (x.liked) chips.push('Liked');
    if (x.album) chips.push(x.album);
    return '<article class="ymf-card" data-q="' + q + '">' +
      '<div class="ymf-bed" aria-hidden="true">' + (x.art ? '<img src="' + esc(th(x.art, 120)) + '" alt="" decoding="async">' : '') + '</div>' +
      '<button class="ymf-art" data-ymf-play aria-label="Play or pause the preview">' +
        (x.art ? '<img src="' + esc(th(x.art, 500)) + '" alt="" decoding="async"' + (q > ym.i + 1 ? ' loading="lazy"' : '') + '>' : '<span class="ymf-noart"></span>') +
        '<span class="ymf-cue" aria-hidden="true">▶</span><i class="ymf-line" aria-hidden="true"></i></button>' +
      '<div class="ymf-meta"><span class="ymf-src">From your Spotify</span><h2>' + esc(x.name) + '</h2><p>' + esc(x.artist) + '</p>' +
        (chips.length ? '<p class="ymf-chips">' + chips.map(esc).join(' · ') + '</p>' : '') + '</div>' +
      '<div class="ymf-rate" role="group" aria-label="Rate out of 10">' +
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (v) { return '<button data-ymf-r="' + v + '" style="--c:' + col(v * 10) + '">' + v + '</button>'; }).join('') + '</div>' +
      '<div class="ymf-foot"><button class="ymf-skip" data-ymf-skip>Skip for now</button><span class="ymf-stamp" aria-live="polite"></span></div>' +
    '</article>';
  }
  function feedAppend(upto) {
    var f = $('ymf'); if (!f) return;
    var have = +f.dataset.to || 0, to = Math.min(ym.queue.length, upto);
    if (to <= have) return;
    var html = '';
    for (var q = have; q < to; q++) html += feedCard(ym.queue[q], q);
    f.insertAdjacentHTML('beforeend', html);
    f.dataset.to = to;
    f.querySelectorAll('.ymf-card:not([data-io])').forEach(function (c) { c.dataset.io = 1; if (_io) _io.observe(c); });
  }
  function paintFeed(host, head) {
    feedStop();
    host.innerHTML = head + '<div class="ymf" id="ymf" data-from="' + ym.i + '" data-to="' + ym.i + '" tabindex="-1"></div>' +
      '<p class="ym-keys">1–9, 0 for 10 · S to skip · U to undo · ↑ ↓ to move</p>';
    fitFeed();
    _io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting || e.intersectionRatio < 0.6) return;
        var q = +e.target.dataset.q;
        ym.i = q;
        feedAppend(q + FEED_BATCH);
        feedPlay(q);
      });
    }, { root: $('ymf'), threshold: [0.6] });
    feedAppend(ym.i + FEED_BATCH);
    setTimeout(function () {
      var f = $('ymf'); if (!f || window.currentMode !== 'yourmusic') return;
      // setMode's scroll restore retries for a second; this takes over from it.
      if (typeof window._scrollTok === 'number') window._scrollTok++;
      if (scrollY > 40) return;
      window.scrollTo({ top: Math.max(0, f.getBoundingClientRect().top + scrollY - safeTop() - 6), behavior: window.motionReduced && motionReduced() ? 'auto' : 'smooth' });
    }, 350);
  }
  /* The feed is a screen, not a box under the page header: it is as tall as
     the space between the status bar and the nav, and entering it brings it
     up to the top — the tabs and the ring are one swipe above it. */
  var _sat = null;
  function safeTop() {
    if (_sat == null) { var p = document.createElement('div'); p.style.cssText = 'position:fixed;top:0;padding-top:env(safe-area-inset-top,0px);visibility:hidden'; document.body.appendChild(p); _sat = p.offsetHeight; p.remove(); }
    return _sat;
  }
  function fitFeed() {
    var f = $('ymf'); if (!f) return;
    var nav = document.getElementById('modes');
    var navTop = nav && innerWidth < 700 ? nav.getBoundingClientRect().top : innerHeight;
    f.style.height = Math.max(420, Math.round(navTop - safeTop() - 14)) + 'px';
  }
  function cardEl(q) { var f = $('ymf'); return f && f.querySelector('.ymf-card[data-q="' + q + '"]'); }
  async function feedPlay(q, gesture) {
    var x = ym.queue[q], c = cardEl(q);
    if (!x || !c || document.hidden || window.currentMode !== 'yourmusic' || !window.VinalAudio) return;
    if (_feedPlaying === q && !gesture) return;
    var mine = ++_playTok;
    try { VinalAudio.stop(); } catch (e) {}
    document.querySelectorAll('.ymf-card.is-playing, .ymf-card.is-blocked').forEach(function (n) { n.classList.remove('is-playing', 'is-blocked', 'is-loading'); });
    _feedPlaying = q;
    if (gesture) { try { VinalAudio.prime(); } catch (e) {} _unlocked = true; }
    c.classList.add('is-loading');
    var ok = false;
    try { ok = await VinalAudio.play({ artist: x.artist, title: x.name, album: x.album || '' }, 30); } catch (e) { ok = false; }
    if (mine !== _playTok) return;
    c.classList.remove('is-loading');
    if (ok === true) { c.classList.add('is-playing'); _unlocked = true; }
    else if (ok === 'blocked' || !_unlocked) c.classList.add('is-blocked');
    else c.classList.add('no-clip');
  }
  function feedStop() {
    _playTok++; _feedPlaying = -1;
    if (_io) { _io.disconnect(); _io = null; }
    try { if (window.VinalAudio) VinalAudio.stop(); } catch (e) {}
  }
  function feedGo(q) {
    var c = cardEl(q);
    if (!c) { feedAppend(q + FEED_BATCH); c = cardEl(q); }
    if (!c) { ym.i = q; feedStop(); paintYm(); return; }
    var f = $('ymf');
    f.scrollTo({ top: c.offsetTop, behavior: window.motionReduced && motionReduced() ? 'auto' : 'smooth' });
  }
  function feedRated(x, score) {
    var q = ym.queue.indexOf(x), c = cardEl(q);
    if (c) {
      c.classList.add('rated');
      c.style.setProperty('--rc', col(score * 10));
      c.querySelectorAll('[data-ymf-r]').forEach(function (b) { b.classList.toggle('on', +b.dataset.ymfR === score); });
      var st = c.querySelector('.ymf-stamp'); if (st) st.textContent = 'Rated ' + score;
      if (window.burst && score >= 8) { var b = c.querySelector('[data-ymf-r="' + score + '"]'); if (b) try { burst(b, { count: 14, spread: 70 }); } catch (e) {} }
    }
    paintRing();
    if (ym.session.length % 10 === 0 && window.toast) toast(ym.session.length + ' rated');
    setTimeout(function () { if (feedOn() && ym.queue[ym.i] === x) feedGo(q + 1); }, 520);
  }
  function paintRing() {
    var r = document.querySelector('#ym-body .ym-ring'); if (!r) return;
    var done = ym.session.length;
    r.style.setProperty('--p', Math.min(100, done / ym.goal * 100));
    var b = r.querySelector('b'); if (b) b.textContent = done;
  }
  function wireFeed() {
    var host = $('view-yourmusic'); if (!host || host._feedWired) return; host._feedWired = true;
    host.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || !b.closest('.ymf-card')) return;
      var q = +b.closest('.ymf-card').dataset.q;
      if (b.hasAttribute('data-ymf-play')) {
        e.stopPropagation();
        if (_feedPlaying === q && b.closest('.ymf-card').classList.contains('is-playing')) { feedStop(); b.closest('.ymf-card').classList.remove('is-playing'); return; }
        if (!_io && feedOn()) { paintFeedObserverOnly(); }
        feedPlay(q, true); return;
      }
      if (b.dataset.ymfR) { e.stopPropagation(); ym.i = q; _unlocked = true; rateCur(+b.dataset.ymfR); return; }
      if (b.hasAttribute('data-ymf-skip')) { e.stopPropagation(); ym.i = q; skip(); }
    }, true);
    window.addEventListener('resize', function () { if (feedOn()) fitFeed(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden && feedOn()) { _playTok++; _feedPlaying = -1; try { VinalAudio.stop(); } catch (e) {} } });
    // Leaving the view stops the clip; setMode only changes display.
    new MutationObserver(function () {
      if (document.body.dataset.section !== 'yourmusic' && _feedPlaying !== -1) { _playTok++; _feedPlaying = -1; try { VinalAudio.stop(); } catch (e) {} }
    }).observe(document.body, { attributes: true, attributeFilter: ['data-section'] });
    document.addEventListener('keydown', function (e) {
      if (window.currentMode !== 'yourmusic' || !feedOn() || document.querySelector('.modal.open')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); feedGo(ym.i + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); feedGo(Math.max(0, ym.i - 1)); }
    });
  }
  // A tap after the observer was dropped (tab change and back) re-attaches it.
  function paintFeedObserverOnly() {
    _io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting && e.intersectionRatio >= 0.6) { ym.i = +e.target.dataset.q; feedAppend(ym.i + FEED_BATCH); feedPlay(ym.i); } });
    }, { root: $('ymf'), threshold: [0.6] });
    document.querySelectorAll('#ymf .ymf-card').forEach(function (c) { _io.observe(c); });
  }
  function setVal(v) {
    ym.val = Math.max(1, Math.min(100, Math.round(v)));
    var o = $('ym-val'), s = $('ym-slider'), b = document.querySelector('.ym-save');
    if (o) { o.textContent = ym.val; o.style.color = col(ym.val); }
    if (s && +s.value !== ym.val) s.value = ym.val;
    if (s && s._gs) s._gs.sync();
    if (b) b.textContent = 'Rate ' + ym.val;
  }
  function wireYm() {
    var host = $('view-yourmusic'); if (!host || host._wired) return; host._wired = true;
    host.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.ymTab) { ym.tab = b.dataset.ymTab; renderYourMusic(); return; }
      if (b.dataset.ymQ) { setVal(+b.dataset.ymQ); return; }
      if (b.dataset.ymS) { rateCur(+b.dataset.ymS); return; }
      var a = b.dataset.ymAct;
      if (a === 'rate') rateCur(ym.val);
      else if (a === 'skip') skip();
      else if (a === 'undo') undo();
      else if (a === 'import' && window.SpotifyBridge) SpotifyBridge.open('intro');
    });
    host.addEventListener('input', function (e) { if (e.target.id === 'ym-slider') setVal(+e.target.value); });
    document.addEventListener('keydown', function (e) {
      if (window.currentMode !== 'yourmusic' || document.querySelector('.modal.open')) return;
      if (e.target && e.target.closest && e.target.closest('input[type=text], textarea')) return;
      var x = cur(); if (!x) return;
      var k = e.key;
      if (k === 's' || k === 'S') { e.preventDefault(); skip(); return; }
      if (k === 'u' || k === 'U' || k === 'Backspace' || ((e.metaKey || e.ctrlKey) && k === 'z')) { e.preventDefault(); undo(); return; }
      if (x.kind === 'song' && /^[0-9]$/.test(k)) { e.preventDefault(); rateCur(k === '0' ? 10 : +k); return; }
      if (x.kind === 'album') {
        if (/^[0-9]$/.test(k)) {
          e.preventDefault();
          // One digit is tens (8 → 80, 0 → 100); a second within a moment makes it exact (8, 5 → 85).
          var now = Date.now();
          if (ym.typed && now - ym.typedAt < 900) { setVal(+(ym.typed + k) || 100); ym.typed = ''; }
          else { ym.typed = k; ym.typedAt = now; setVal(k === '0' ? 100 : +k * 10); }
          return;
        }
        if (k === 'ArrowRight' || k === 'ArrowUp') { e.preventDefault(); setVal(ym.val + 1); return; }
        if (k === 'ArrowLeft' || k === 'ArrowDown') { e.preventDefault(); setVal(ym.val - 1); return; }
        if (k === 'Enter') { e.preventDefault(); rateCur(ym.val); }
      }
    });
  }

  /* ---- wiring ------------------------------------------------------------ */
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-go-about]');
    if (t && window.goToView) goToView('about');
  });
  wireYm();
  wireFeed();
  window.YouUI = { tasteHtml: tasteHtml, enhanceTaste: enhanceTaste, depthHtml: depthHtml, depthTile: depthTile, aboutTeaser: aboutTeaser,
                   renderAbout: renderAbout, renderYourMusic: renderYourMusic, depth: depthNow };
})();
