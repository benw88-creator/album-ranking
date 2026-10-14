/* ================================================================
   MUSIC PASSPORT — your world in music. The view (`view-passport`), the
   profile and About-you teasers, the stamps and the share card. The
   arithmetic is in passport-core.js.

   Origins: MusicBrainz (CC0), asked from the browser at its published one
   request a second, cached for good in localStorage (`vinall_origins_v1`,
   public facts, so it survives an account switch like the catalogue
   caches do). assets/passport-seed.json carries the artists everybody
   rates, so a first visit lights up at once and the rest land as the queue
   works through them — the world illuminating while you watch is the point,
   not a loading state to hide.

   Which stamps you have already been shown (`crate_passport_v1`) is
   account state, MERGED and never replaced (trap 9), and only written from
   a paint that ran after the crate and listening had loaded.
   ================================================================ */
(function () {
  'use strict';
  var P = window.PassportCore;
  if (!P) return;

  var ORIGINS = 'vinall_origins_v1', SEEN = 'crate_passport_v1';
  var MISS_TTL = 30 * 864e5;
  var INK = { 'Europe': '#7aa2ff', 'North America': '#ff6b6b', 'South America': '#3ddc84', 'Africa': '#ffb547', 'Asia': '#c084fc', 'Oceania': '#2dd4bf' };
  var CT_SHORT = { 'Europe': 'Europe', 'North America': 'N. America', 'South America': 'S. America', 'Africa': 'Africa', 'Asia': 'Asia', 'Oceania': 'Oceania' };
  var CT_TOTAL = { 'Europe': 44, 'North America': 23, 'South America': 12, 'Africa': 54, 'Asia': 48, 'Oceania': 14 };
  var UN_TOTAL = 195;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function th(u, px) { return window.thumb ? window.thumb(u, px) : u; }
  function n(x) { return Number(x || 0).toLocaleString('en-GB'); }
  function calm() { return !!(window.motionReduced && motionReduced()); }
  function lsJSON(k) { try { return JSON.parse(localStorage.getItem(k)) || null; } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  // Windows ships no flag emoji and draws "GB" in two boxed letters, so test
  // once and fall back to a drawn code badge (HTML) or nothing (plain text).
  var FLAGS = (function () {
    try { var c = document.createElement('canvas'); c.width = c.height = 20; var x = c.getContext('2d'); x.font = '16px sans-serif'; x.fillText('🇬🇧', 0, 16);
      var d = x.getImageData(0, 0, 20, 20).data; for (var i = 0; i < d.length; i += 4) if (d[i + 3] && (Math.abs(d[i] - d[i + 1]) > 30 || Math.abs(d[i + 1] - d[i + 2]) > 30)) return true; } catch (e) {}
    return false;
  })();
  function emo(cc) { return String.fromCodePoint.apply(null, cc.split('').map(function (c) { return 127397 + c.charCodeAt(0); })); }
  function flag(cc) { if (!/^[A-Z]{2}$/.test(cc)) return ''; return FLAGS ? emo(cc) : '<span class="pp-cc">' + cc + '</span>'; }
  function flagT(cc) { return FLAGS && /^[A-Z]{2}$/.test(cc) ? emo(cc) + ' ' : ''; }
  function month(t) { return t ? new Date(t).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : ''; }
  function day(t) { return t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase() : ''; }
  function scoreCol(s) { var r = ['#e24b4a', '#e0603c', '#e08a3c', '#efb927', '#c8c344', '#a8c24a', '#6bbf68', '#4fb477']; return r[Math.max(0, Math.min(7, Math.floor((s - 30) / 9)))]; }
  function hash(s) { var x = 2166136261; for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }
  function albums() { return typeof loadAlbums === 'function' ? loadAlbums() : {}; }
  function songs() { return typeof loadSongs === 'function' ? loadSongs() : {}; }

  /* ---- data ------------------------------------------------------------------ */
  var _geo = null, _seed = null, GEO = {}, NAMES = {};
  function loadGeo() {
    return _geo || (_geo = fetch('/assets/passport-world.json').then(function (r) { if (!r.ok) throw new Error('world ' + r.status); return r.json(); }).then(function (w) {
      Object.keys(w.shapes).forEach(function (cc) { GEO[cc] = w.shapes[cc]; });
      Object.keys(w.extra || {}).forEach(function (cc) { GEO[cc] = w.extra[cc]; });
      Object.keys(GEO).forEach(function (cc) { NAMES[P.fold(GEO[cc].n)] = cc; });
      [['United States', 'US'], ['United Kingdom', 'GB'], ['South Korea', 'KR'], ['Russia', 'RU'], ["Côte d'Ivoire", 'CI'], ['Czechia', 'CZ']].forEach(function (p) { NAMES[P.fold(p[0])] = p[1]; });
      return w;
    }).catch(function (e) { _geo = null; throw e; }));
  }
  function loadSeed() {
    return _seed || (_seed = fetch('/assets/passport-seed.json').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
      .then(function (s) { s.origins = s.origins || {}; s.recs = s.recs || {}; return s; }));
  }
  var _cache = null;
  function cache() { return _cache || (_cache = lsJSON(ORIGINS) || {}); }
  function origin(name) {
    var k = P.fold(P.firstArtist(name)), c = cache()[k];
    if (c) { if (c[0] || Date.now() - c[1] < MISS_TTL) return c[0]; }
    if (_seedSync && k in _seedSync.origins) return _seedSync.origins[k];
    return undefined;
  }
  var _seedSync = null;

  /* ---- the MusicBrainz queue ----------------------------------------------------- */
  var Q = [], queued = {}, running = false, dead = false, prog = { done: 0, total: 0 };
  var lastReq = 0;
  function mb(url) {
    var wait = Math.max(0, lastReq + 1100 - Date.now());
    return new Promise(function (res) { setTimeout(res, wait); }).then(function () {
      lastReq = Date.now();
      return fetch(url, { headers: { Accept: 'application/json' } });
    }).then(function (r) {
      if (r.status === 503 || r.status === 429) return new Promise(function (res) { setTimeout(res, 3000); }).then(function () { return mb(url); });
      return r.ok ? r.json() : null;
    });
  }
  function resolve(a) {
    var q = 'artist:"' + a.name.replace(/["\\]/g, '') + '"';
    return mb('https://musicbrainz.org/ws/2/artist?fmt=json&limit=8&query=' + encodeURIComponent(q)).then(function (j) {
      // An exact phrase misses spelling variants MusicBrainz files as aliases
      // ("Mulatu Astatke" is "Mulatu Astatqé" there). pick() still demands an
      // exact name or alias, so the looser search cannot turn into a guess.
      if (j && !(j.artists || []).length) return mb('https://musicbrainz.org/ws/2/artist?fmt=json&limit=8&query=' + encodeURIComponent(a.name.replace(/[^\p{L}\p{N}\s]/gu, ' ')));
      return j;
    }).then(function (j) {
      if (!j) return null;
      var p = P.pick(j.artists || [], a.name, NAMES);
      if (!p) return null;
      if (!p.amb) return p.c || null;
      // Two artists, one name, two countries. A record they made decides it:
      // the release group's credit names exactly one of them.
      if (!a.album) return null;
      var rq = 'releasegroup:"' + a.album.replace(/["\\]/g, '') + '" AND artist:"' + a.name.replace(/["\\]/g, '') + '"';
      return mb('https://musicbrainz.org/ws/2/release-group?fmt=json&limit=5&query=' + encodeURIComponent(rq)).then(function (r) {
        var ids = {}; p.amb.forEach(function (x) { ids[x.id] = x.c; });
        var hit = ((r && r['release-groups']) || []).map(function (g) { return ((g['artist-credit'] || [])[0] || {}).artist; }).filter(function (x) { return x && x.id in ids; })[0];
        return hit ? ids[hit.id] || null : null;
      });
    });
  }
  function enqueue(list) {
    list.forEach(function (r) { if (!queued[r.k]) { queued[r.k] = 1; Q.push({ k: r.k, name: r.name, weight: r.weight, album: r.albums[0] ? r.albums[0].name : (r.tracks[0] && r.tracks[0].album) || '' }); } });
    Q.sort(function (a, b) { return b.weight - a.weight; });
    prog.total = prog.done + Q.length;
    run();
  }
  function run() {
    if (running || dead || !Q.length) return;
    running = true;
    (function next() {
      if (!Q.length) { running = false; onProgress(true); return; }
      var a = Q.shift();
      resolve(a).then(function (c) {
        var all = cache(); all[a.k] = [c || null, Date.now()]; lsSet(ORIGINS, all);
        prog.done++; onProgress(false, c && !(_w && _w.countries[c]) ? c : null);
        next();
      }, function () {
        // Offline or MusicBrainz unreachable: stop for this session rather
        // than hammering it, and say so on the map.
        dead = true; running = false; Q.unshift(a); onProgress(true);
      });
    })();
  }
  var _repaintT = 0;
  function onProgress(final, gotCountry) {
    var p = $('pp-prog');
    if (p) p.innerHTML = progHtml();
    if (!gotCountry && !final) return;
    clearTimeout(_repaintT);
    _repaintT = setTimeout(function () { if (isVisible()) refresh(); fillTeasers(); }, final ? 0 : 1600);
  }
  function progHtml() {
    if (dead) return '<span class="pp-prog-dead">Couldn’t reach MusicBrainz — ' + Q.length + ' artist' + (Q.length === 1 ? '' : 's') + ' still to place. <button data-pp="retry">Try again</button></span>';
    if (!Q.length) return '';
    var pct = prog.total ? Math.round(prog.done / prog.total * 100) : 0;
    return '<span class="pp-prog-run"><i style="--p:' + pct + '%"></i>Charting your artists · ' + n(prog.done) + ' of ' + n(prog.total) + ' <small>the map fills in as they land</small></span>';
  }

  /* ---- assembling the world ---------------------------------------------------------- */
  var _listen = null;
  function getListen() {
    if (_listen) return Promise.resolve(_listen);
    return (window.listeningPlays ? window.listeningPlays().catch(function () { return []; }) : Promise.resolve([])).then(function (l) { _listen = l || []; return _listen; });
  }
  function world(listen) {
    return P.build({ albums: albums(), songs: songs(), listen: listen || _listen || [], origin: origin, geo: GEO });
  }

  /* ---- the map --------------------------------------------------------------------------- */
  function mapSvg(W, w, opts) {
    opts = opts || {};
    var maxA = 1;
    w.list.forEach(function (c) { maxA = Math.max(maxA, c.artists.length); });
    var land = '', glow = '', dots = '';
    Object.keys(W.shapes).forEach(function (cc) {
      var s = W.shapes[cc], c = w.countries[cc];
      if (!c) { land += '<path data-cc="' + cc + '" d="' + s.d + '"/>'; return; }
      var k = (0.45 + 0.55 * Math.log(1 + c.artists.length) / Math.log(1 + maxA)).toFixed(2);
      land += '<path data-cc="' + cc + '" class="on s-' + c.src + '" style="--k:' + k + '" d="' + s.d + '"/>';
      if (!opts.mini) glow += '<path data-g="' + cc + '" class="s-' + c.src + '" d="' + s.d + '"/>';
      if (s.a < 12) dots += '<g class="pp-dot s-' + c.src + '" data-cc="' + cc + '" transform="translate(' + s.c[0] + ' ' + s.c[1] + ')"><circle class="ring" r="7"/><circle r="' + (opts.mini ? 5 : 3.4) + '"/></g>';
    });
    return '<svg class="pp-svg" viewBox="0 0 ' + W.w + ' ' + W.h + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="World map of ' + w.list.length + ' countries in your music">' +
      '<defs><linearGradient id="ppBoth' + (opts.mini ? 'm' : '') + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffc061"/><stop offset="1" stop-color="#4fe0cf"/></linearGradient>' +
      '<radialGradient id="ppSea' + (opts.mini ? 'm' : '') + '" cx="50%" cy="45%" r="65%"><stop offset="0" stop-color="#1a1c33"/><stop offset="1" stop-color="#0a0a12"/></radialGradient>' +
      '<filter id="ppBloom' + (opts.mini ? 'm' : '') + '" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4"/></filter></defs>' +
      '<path class="pp-sphere" d="' + W.o + '" fill="url(#ppSea' + (opts.mini ? 'm' : '') + ')"/>' +
      (opts.mini ? '' : '<path class="pp-grat" d="' + W.g + '"/>') +
      (glow ? '<g class="pp-bloom" filter="url(#ppBloom)">' + glow + '</g>' : '') +
      '<g class="pp-land">' + land + '</g><g class="pp-dots">' + dots + '</g></svg>';
  }

  // Pan, wheel-zoom, pinch-zoom and zoom-to-country, all on the viewBox.
  function wireMap(host, W) {
    var svg = host.querySelector('svg'); if (!svg) return;
    var full = { x: 0, y: 0, w: W.w, h: W.h }, vb = Object.assign({}, full), anim = 0;
    function set(v) { vb = v; svg.setAttribute('viewBox', v.x.toFixed(1) + ' ' + v.y.toFixed(1) + ' ' + v.w.toFixed(1) + ' ' + v.h.toFixed(1)); host.classList.toggle('zoomed', v.w < full.w * 0.98); }
    function clamp(v) {
      var w = Math.max(full.w / 12, Math.min(full.w, v.w)), h = w * full.h / full.w;
      return { x: Math.max(-w * .2, Math.min(full.w - w * .8, v.x)), y: Math.max(-h * .2, Math.min(full.h - h * .8, v.y)), w: w, h: h };
    }
    function animateTo(t, ms) {
      cancelAnimationFrame(anim);
      if (calm()) return set(t);
      var f = Object.assign({}, vb), t0 = performance.now(); ms = ms || 700;
      (function step(now) {
        var k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 4);
        set({ x: f.x + (t.x - f.x) * e, y: f.y + (t.y - f.y) * e, w: f.w + (t.w - f.w) * e, h: f.h + (t.h - f.h) * e });
        if (k < 1) anim = requestAnimationFrame(step);
      })(t0);
    }
    function pt(cx, cy) { var r = svg.getBoundingClientRect(); var s = Math.min(r.width / vb.w, r.height / vb.h); var ox = (r.width - vb.w * s) / 2, oy = (r.height - vb.h * s) / 2; return { x: vb.x + (cx - r.left - ox) / s, y: vb.y + (cy - r.top - oy) / s, s: s }; }
    function zoomAt(cx, cy, f) { var p = pt(cx, cy), w = vb.w / f; var nv = clamp({ x: p.x - (p.x - vb.x) / f, y: p.y - (p.y - vb.y) / f, w: w, h: w * full.h / full.w }); set(nv); }
    svg.addEventListener('wheel', function (e) { if (!e.ctrlKey && !host.classList.contains('zoomed')) return; e.preventDefault(); cancelAnimationFrame(anim); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022))); }, { passive: false });
    var ptrs = {}, start = null, moved = false;
    svg.addEventListener('pointerdown', function (e) {
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      moved = false; start = { vb: Object.assign({}, vb), ptrs: JSON.parse(JSON.stringify(ptrs)) };
      cancelAnimationFrame(anim);
    });
    svg.addEventListener('pointermove', function (e) {
      if (!ptrs[e.pointerId]) return hover(e);
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(ptrs);
      if (ids.length === 1 && start && start.ptrs[ids[0]]) {
        var d = { x: e.clientX - start.ptrs[ids[0]].x, y: e.clientY - start.ptrs[ids[0]].y };
        if (!moved && Math.hypot(d.x, d.y) < 6) return;
        if (!moved) { moved = true; try { svg.setPointerCapture(e.pointerId); } catch (x) {} }
        var s = pt(0, 0).s;
        set(clamp({ x: start.vb.x - d.x / s, y: start.vb.y - d.y / s, w: start.vb.w, h: start.vb.h }));
      } else if (ids.length === 2 && start && start.ptrs[ids[0]] && start.ptrs[ids[1]]) {
        moved = true;
        var a0 = start.ptrs[ids[0]], b0 = start.ptrs[ids[1]], a1 = ptrs[ids[0]], b1 = ptrs[ids[1]];
        var f = Math.hypot(a1.x - b1.x, a1.y - b1.y) / Math.max(1, Math.hypot(a0.x - b0.x, a0.y - b0.y));
        var keep = vb; vb = start.vb; var m = pt((a0.x + b0.x) / 2, (a0.y + b0.y) / 2);
        var w = Math.max(full.w / 12, Math.min(full.w, start.vb.w / f)), nv = { x: 0, y: 0, w: w, h: w * full.h / full.w };
        vb = nv; var q = pt((a1.x + b1.x) / 2, (a1.y + b1.y) / 2); vb = keep;
        nv.x = m.x - q.x; nv.y = m.y - q.y; set(clamp(nv));
      }
    });
    function up(e) { delete ptrs[e.pointerId]; start = Object.keys(ptrs).length ? { vb: Object.assign({}, vb), ptrs: JSON.parse(JSON.stringify(ptrs)) } : null; }
    svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up); svg.addEventListener('pointerleave', function () { tip(null); });
    svg.addEventListener('click', function (e) {
      if (moved) { moved = false; return; }
      var el = e.target.closest('[data-cc]'); if (!el) return;
      select(el.getAttribute('data-cc'), true);
    });
    var tipEl = host.querySelector('.pp-tip');
    function tip(cc, e) {
      if (!tipEl) return;
      if (!cc) { tipEl.hidden = true; return; }
      var c = _w && _w.countries[cc], g = GEO[cc]; if (!g) return;
      tipEl.innerHTML = '<b>' + flag(cc) + ' ' + esc(g.n) + '</b><span>' + (c ? c.artists.length + ' artist' + (c.artists.length === 1 ? '' : 's') : 'Not yet') + '</span>';
      var r = host.getBoundingClientRect();
      tipEl.style.transform = 'translate(' + Math.round(e.clientX - r.left + 14) + 'px,' + Math.round(e.clientY - r.top + 14) + 'px)';
      tipEl.hidden = false;
    }
    function hover(e) { if (e.pointerType !== 'mouse') return; var el = e.target.closest && e.target.closest('[data-cc]'); tip(el ? el.getAttribute('data-cc') : null, e); }
    host._zoomTo = function (cc) {
      var el = svg.querySelector('.pp-land [data-cc="' + cc + '"]') || svg.querySelector('.pp-dots [data-cc="' + cc + '"]');
      if (!el) return;
      var b = el.getBBox(); var pad = Math.max(b.width, b.height * full.w / full.h) * 0.9 + 30;
      var w = Math.min(full.w, Math.max(full.w / 10, b.width + pad)); var h = w * full.h / full.w;
      animateTo(clamp({ x: b.x + b.width / 2 - w / 2, y: b.y + b.height / 2 - h / 2, w: w, h: h }));
    };
    host._reset = function () { animateTo(full); };
    host._zoom = function (f) { var r = svg.getBoundingClientRect(); cancelAnimationFrame(anim); var p = pt(r.left + r.width / 2, r.top + r.height / 2), w = vb.w / f; animateTo(clamp({ x: p.x - w / 2, y: p.y - w * full.h / full.w / 2, w: w, h: w * full.h / full.w }), 320); };
    host._vb = function () { return vb; };
    if (_keepVb) { set(_keepVb); _keepVb = null; }
  }

  /* ---- stamps ------------------------------------------------------------------------------ */
  // One ink per continent, one shape per continent, a rotation that is the
  // country's own (seeded, so it is the same stamp every time), and a ragged
  // edge from one shared turbulence filter.
  function stampSvg(cc, c, size) {
    var g = GEO[cc] || { n: cc, ct: '' }, ct = (c && c.ct) || g.ct, ink = INK[ct] || '#e8e4dc', h = hash(cc);
    var rot = ((h % 17) - 8), id = 'st' + cc + (size || '');
    var name = String(g.n).toUpperCase(), when = c && c.when ? day(c.when) : '';
    var far = c && c.rarity >= 4;
    var shape, text;
    if (ct === 'Europe') {
      shape = '<circle cx="60" cy="60" r="54" class="b2"/><circle cx="60" cy="60" r="47"/><circle cx="60" cy="60" r="33" class="thin"/>';
      text = '<path id="' + id + 'a" d="M18,60 a42,42 0 1,1 84,0" fill="none"/><text class="arc"><textPath href="#' + id + 'a" startOffset="50%" text-anchor="middle">' + esc(name.slice(0, 22)) + '</textPath></text>' +
        '<text x="60" y="68" class="cc">' + cc + '</text><text x="60" y="94" class="dt">' + esc(when) + '</text>';
    } else if (ct === 'North America') {
      shape = '<rect x="8" y="16" width="104" height="88" rx="10" class="b2"/><rect x="15" y="23" width="90" height="74" rx="5"/>';
      text = '<text x="60" y="42" class="nm">' + esc(name.slice(0, 16)) + '</text><text x="60" y="73" class="cc">' + cc + '</text><text x="60" y="90" class="dt">' + esc(when) + '</text>';
    } else if (ct === 'South America') {
      shape = '<polygon points="38,6 82,6 114,38 114,82 82,114 38,114 6,82 6,38" class="b2"/><polygon points="41,14 79,14 106,41 106,79 79,106 41,106 14,79 14,41"/>';
      text = '<text x="60" y="44" class="nm">' + esc(name.slice(0, 14)) + '</text><text x="60" y="74" class="cc">' + cc + '</text><text x="60" y="92" class="dt">' + esc(when) + '</text>';
    } else if (ct === 'Africa') {
      shape = '<ellipse cx="60" cy="60" rx="56" ry="44" class="b2"/><ellipse cx="60" cy="60" rx="49" ry="37"/>';
      text = '<text x="60" y="44" class="nm">' + esc(name.slice(0, 16)) + '</text><text x="60" y="72" class="cc">' + cc + '</text><text x="60" y="88" class="dt">' + esc(when) + '</text>';
    } else if (ct === 'Asia') {
      shape = '<polygon points="60,4 110,32 110,88 60,116 10,88 10,32" class="b2"/><polygon points="60,13 102,37 102,83 60,107 18,83 18,37"/>';
      text = '<text x="60" y="46" class="nm">' + esc(name.slice(0, 14)) + '</text><text x="60" y="74" class="cc">' + cc + '</text><text x="60" y="90" class="dt">' + esc(when) + '</text>';
    } else {
      shape = '<path d="M60 6 L112 26 L104 84 L60 114 L16 84 L8 26 Z" class="b2"/><path d="M60 15 L103 32 L96 80 L60 105 L24 80 L17 32 Z"/>';
      text = '<text x="60" y="46" class="nm">' + esc(name.slice(0, 14)) + '</text><text x="60" y="74" class="cc">' + cc + '</text><text x="60" y="90" class="dt">' + esc(when) + '</text>';
    }
    return '<svg class="pp-stamp-svg' + (far ? ' far' : '') + '" viewBox="0 0 120 120" style="--ink:' + ink + ';--rot:' + rot + 'deg" aria-hidden="true"><g filter="url(#ppInk)">' + shape + text + (far ? '<text x="60" y="26" class="star">★</text>' : '') + '</g></svg>';
  }
  function inkDefs() {
    if ($('pp-ink-defs')) return;
    var d = document.createElement('div'); d.id = 'pp-ink-defs'; d.setAttribute('aria-hidden', 'true');
    d.innerHTML = '<svg width="0" height="0" style="position:absolute"><filter id="ppInk" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" result="d"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.7 1.3" result="speck"/><feComposite in="d" in2="speck" operator="in"/></filter></svg>';
    document.body.appendChild(d);
  }

  /* ---- the view -------------------------------------------------------------------------- */
  var _w = null, _W = null, _sel = null, _tl = null, _keepVb = null;
  function isVisible() { var v = $('view-passport'); return !!(v && v.style.display !== 'none' && v.offsetParent !== null); }

  function render() {
    var host = $('pp-body'); if (!host) return;
    inkDefs();
    if (!host.firstChild) host.innerHTML = '<div class="pp-loading"><span class="pp-globe" aria-hidden="true"></span><p>Unfolding your passport…</p></div>';
    Promise.all([loadGeo(), loadSeed(), getListen()]).then(function (r) {
      _W = r[0]; _seedSync = r[1];
      refresh(true);
    }).catch(function (e) {
      host.innerHTML = '<div class="pp-empty"><h2>The map would not load.</h2><p>' + esc(e && e.message || '') + '</p><button class="btn-primary" data-pp="reload">Try again</button></div>';
    });
  }
  function refresh(entering) {
    var host = $('pp-body'); if (!host || !_W) return;
    _w = world();
    if (_w.pending.length) enqueue(_w.pending);
    var keepSel = _sel && _w.countries[_sel] ? _sel : null;
    var y = window.scrollY, mapEl = $('pp-map');
    if (!entering && mapEl && mapEl._vb) _keepVb = mapEl._vb();
    host.innerHTML = paint(_w);
    wireMap($('pp-map'), _W);
    if (keepSel) select(keepSel, false, true); else _sel = null;
    if (!entering) window.scrollTo(0, y);
    stampsFresh(entering);
  }

  function paint(w) {
    var total = Object.keys(w.artists).length;
    if (!total) {
      return '<div class="pp-empty"><span class="pp-kick">Music Passport</span><h1 class="pp-title">An empty passport.</h1><p>Every artist you rate — or play, once you import your Spotify history — pins a country to your map. Rate a few records and watch the world light up.</p><div class="pp-empty-btns"><button class="btn-primary" data-go="albums">Rate albums</button><button class="btn-secondary" data-pp="import">Import Spotify history</button></div></div>';
    }
    var nC = w.list.length, nCt = Object.keys(w.continents).length;
    var fav = P.favourites(w), genres = P.genreSpread(w).slice(0, 4), rareL = P.rare(w).slice(0, 8), tl = P.timeline(w);
    var recs = P.recommend(w, (_seedSync && _seedSync.recs) || {}, GEO, 6);
    var newest = w.list.slice().sort(function (a, b) { return (b.when || 0) - (a.when || 0); })[0];
    var furthest = w.list.slice().sort(function (a, b) { return b.rarity - a.rarity || (a.artists.length - b.artists.length); })[0];
    var me = window.Wallet && Wallet.get && Wallet.get().username;

    var hero = '<header class="pp-hero"><div class="pp-cover" aria-hidden="true"><span class="pp-crest"><i></i></span><b>PASSPORT</b><small>VINALL · MUSIC</small></div>' +
      '<div class="pp-hero-t"><span class="pp-kick">Music Passport' + (me ? ' · ' + esc(me) : '') + '</span><h1 class="pp-title">Your world<br>in music</h1>' +
      '<p class="pp-sub">' + n(nC) + ' ' + (nC === 1 ? 'country' : 'countries') + ' on ' + nCt + ' of 6 continents, through ' + n(w.placedArtists) + ' artist' + (w.placedArtists === 1 ? '' : 's') + '.' + (newest && newest.when ? ' Latest stamp: ' + flag(newest.cc) + ' ' + esc(newest.n) + ', ' + month(newest.when) + '.' : '') + '</p></div></header>';

    var map = '<section class="pp-mapcard"><div class="pp-map" id="pp-map">' + mapSvg(_W, w) + '<div class="pp-tip" hidden></div>' +
      '<div class="pp-zoom"><button data-pp="zin" aria-label="Zoom in">+</button><button data-pp="zout" aria-label="Zoom out">−</button><button class="pp-reset" data-pp="reset" aria-label="Show the whole world">World</button></div></div>' +
      '<div class="pp-legend"><span class="s-rated">Rated</span><span class="s-listened">Listened</span><span class="s-both">Both</span><span class="pp-legend-n">brighter = more artists</span></div>' +
      (w.list.length > 1 ? '<div class="pp-time"><button class="pp-play" data-pp="journey" aria-label="Replay your journey">▶</button><input type="range" id="pp-scrub" min="1" max="' + w.list.length + '" value="' + w.list.length + '" aria-label="Your world over time"><output id="pp-when">Today · ' + w.list.length + ' countries</output></div>' : '') +
      '<div class="pp-prog" id="pp-prog">' + progHtml() + '</div></section>';

    var stats = '<section class="pp-stats">' +
      statTile('Countries', nC, '<i class="pp-ring" style="--p:' + Math.min(100, nC / UN_TOTAL * 100).toFixed(1) + '%"></i>', 'of ' + UN_TOTAL) +
      statTile('Continents', nCt, '<span class="pp-ct-dots">' + P.CONTINENTS.map(function (ct) { return '<i style="--ink:' + INK[ct] + '" class="' + (w.continents[ct] ? 'on' : '') + '" title="' + ct + '"></i>'; }).join('') + '</span>', 'of 6') +
      statTile('Artists placed', w.placedArtists, '', w.unplaced.length ? w.unplaced.length + ' unplaced' : 'all placed') +
      (furthest ? '<button class="pp-stat pp-stat-far" data-cc="' + furthest.cc + '"><small>Furthest find</small><b>' + flag(furthest.cc) + ' ' + esc(furthest.n) + '</b><span>' + P.TIERS[furthest.rarity] + ' · via ' + esc(furthest.artists[0].name) + '</span></button>' : '') + '</section>';

    var panel = '<section class="pp-country" id="pp-country" hidden></section>';

    var book = '<section class="pp-book"><div class="pp-sec-h"><h2>Stamps</h2><span>' + nC + ' collected · tap one to open it</span></div>' +
      P.CONTINENTS.map(function (ct) {
        var got = w.list.filter(function (c) { return c.ct === ct; });
        var left = Math.max(0, CT_TOTAL[ct] - got.length);
        return '<div class="pp-page" style="--ink:' + INK[ct] + '"><div class="pp-page-h"><b>' + ct + '</b><span>' + got.length + ' / ' + CT_TOTAL[ct] + '</span><i><em style="width:' + Math.min(100, got.length / CT_TOTAL[ct] * 100) + '%"></em></i></div>' +
          '<div class="pp-stamps">' + got.map(function (c) { return '<button class="pp-stamp" data-cc="' + c.cc + '" title="' + esc(c.n) + '">' + stampSvg(c.cc, c) + '<span>' + esc(c.n) + '</span></button>'; }).join('') +
          (left ? '<div class="pp-stamp ghost"><span class="pp-ghost-ring">+' + left + '</span><span>to find</span></div>' : '<div class="pp-stamp ghost done"><span class="pp-ghost-ring">✓</span><span>complete</span></div>') + '</div></div>';
      }).join('') + '</section>';

    var cards = [];
    if (fav.loved.length || fav.played.length) {
      cards.push('<article class="pp-card pp-fav"><span class="pp-kick">Favourite countries</span><h3>' + (fav.loved[0] ? flag(fav.loved[0].cc) + ' ' + esc(fav.loved[0].n) + ' rates highest' : flag(fav.played[0].cc) + ' ' + esc(fav.played[0].n) + ' plays most') + '</h3>' +
        '<div class="pp-fav-cols">' + favCol('Loved', fav.loved, function (c) { return '<em style="color:' + scoreCol(c.avg) + '">' + Math.round(c.avg) + '</em> avg'; }) +
        favCol('Played', fav.played, function (c) { return n(c.plays) + ' plays'; }) + favCol('Deepest', fav.deepest, function (c) { return c.artists.length + ' artists'; }) + '</div>' +
        '<p class="pp-note">Loved is your average there, pulled towards your overall ' + Math.round(w.myMean) + ' until it has a few records behind it.</p></article>');
    }
    if (genres.length) {
      cards.push('<article class="pp-card pp-genres"><span class="pp-kick">Most well-travelled genres</span><h3>' + esc(genres[0].genre) + ' takes you to ' + genres[0].countries + ' countries</h3>' +
        genres.map(function (g) { return '<div class="pp-genre"><b>' + esc(g.genre) + '</b><span class="pp-flags">' + g.ccs.slice(0, 9).map(function (cc) { return '<i title="' + esc(GEO[cc] ? GEO[cc].n : cc) + '">' + flag(cc) + '</i>'; }).join('') + (g.ccs.length > 9 ? '<small>+' + (g.ccs.length - 9) + '</small>' : '') + '</span><em>' + g.n + ' albums</em></div>'; }).join('') + '</article>');
    }
    if (rareL.length) {
      cards.push('<article class="pp-card pp-rare"><span class="pp-kick">Rare finds</span><h3>' + (rareL[0].artists.length === 1 ? 'One artist is your whole ' + esc(rareL[0].n) : esc(rareL[0].n) + ' is a ' + P.TIERS[rareL[0].rarity].toLowerCase() + ' stamp') + '</h3>' +
        '<div class="pp-rare-list">' + rareL.map(function (c) { var a = c.artists[0]; return '<button data-cc="' + c.cc + '"><span class="pp-rare-art' + (a.art ? '' : ' noart') + '" style="--ink:' + (INK[c.ct] || '#fff') + '">' + (a.art ? '<img src="' + esc(th(a.art, 160)) + '" alt="" loading="lazy">' : '') + '<i>' + flag(c.cc) + '</i></span><b>' + esc(c.n) + '</b><small>' + (c.artists.length === 1 ? 'only ' + esc(a.name) : P.TIERS[c.rarity]) + '</small></button>'; }).join('') + '</div>' +
        '<p class="pp-note">Stamp rarity is how often a country turns up in the world’s charts, not a judgement on you.</p></article>');
    }
    if (tl.length >= 2) {
      var maxT = Math.max.apply(null, tl.map(function (r) { return r.total; })) || 1;
      cards.push('<article class="pp-card pp-evo"><span class="pp-kick">How your world grew</span><h3>' + evoLine(tl) + '</h3><div class="pp-evo-rows">' +
        tl.map(function (r) {
          var bar = P.CONTINENTS.map(function (ct) { var v = r.mix[ct] || 0; return v ? '<i style="flex:' + v + ';background:' + INK[ct] + '" title="' + ct + ': ' + v + '"></i>' : ''; }).join('');
          return '<div class="pp-evo-row"><b>' + r.y + '</b><span class="pp-evo-bar" style="width:' + Math.max(8, r.total / maxT * 100) + '%">' + (bar || '<i style="flex:1;background:rgba(255,255,255,.12)"></i>') + '</span><em>' + (r.fresh.length ? '+' + r.fresh.length + ' ' + r.fresh.slice(0, 6).map(flag).join('') : '') + '</em></div>';
        }).join('') + '</div><div class="pp-evo-key">' + P.CONTINENTS.map(function (ct) { return '<span style="--ink:' + INK[ct] + '">' + CT_SHORT[ct] + '</span>'; }).join('') + '</div></article>');
    }
    if (recs.length) {
      cards.push('<article class="pp-card pp-next"><span class="pp-kick">Where next</span><h3>' + recs.length + ' countries waiting for a stamp</h3><div class="pp-next-list">' +
        recs.map(function (r) { return '<div class="pp-next-c" style="--ink:' + (INK[r.ct] || '#fff') + '"><span class="pp-next-flag">' + flag(r.cc) + '</span><b>' + esc(r.n) + '</b><small>' + esc(r.ct) + (r.near ? ' · near your map' : ' · a new continent') + '</small><div>' + r.artists.slice(0, 3).map(function (a) { return '<button data-pp-artist="' + esc(a) + '">' + esc(a) + '</button>'; }).join('') + '</div></div>'; }).join('') +
        '</div><p class="pp-note">Every suggestion is placed in that country by MusicBrainz, not by us.</p></article>');
    }

    var foot = '<footer class="pp-foot"><button class="pp-share" data-pp="share"><span>↗</span> Share your passport</button>' +
      '<p>Where an artist is from comes from <a href="https://musicbrainz.org" target="_blank" rel="noopener">MusicBrainz</a>, the open music encyclopedia.' +
      (w.unplaced.length ? ' ' + w.unplaced.length + ' artist' + (w.unplaced.length === 1 ? ' it can’t' : 's it can’t') + ' place with confidence ' + (w.unplaced.length === 1 ? 'is' : 'are') + ' left off rather than guessed: <span class="pp-unplaced">' + w.unplaced.slice(0, 8).map(function (r) { return esc(r.name); }).join(', ') + (w.unplaced.length > 8 ? '…' : '') + '</span>.' : '') + ' Only you can see this page.</p></footer>';

    return hero + map + stats + panel + book + '<section class="pp-cards">' + cards.join('') + '</section>' + foot;
  }
  function statTile(label, v, vis, sub) { return '<div class="pp-stat"><small>' + label + '</small><b>' + n(v) + '</b>' + vis + '<span>' + sub + '</span></div>'; }
  function favCol(h, list, fn) {
    return '<div><small>' + h + '</small>' + (list.length ? list.map(function (c, i) { return '<button data-cc="' + c.cc + '" class="r' + i + '"><i>' + flag(c.cc) + '</i><b>' + esc(c.n) + '</b><span>' + fn(c) + '</span></button>'; }).join('') : '<p class="pp-note">Needs a few more.</p>') + '</div>';
  }
  function evoLine(tl) {
    var a = tl[0], b = tl[tl.length - 1];
    function lead(r) { var best = null; Object.keys(r.mix).forEach(function (k) { if (!best || r.mix[k] > r.mix[best]) best = k; }); return best && r.total ? { ct: best, p: Math.round(r.mix[best] / r.total * 100) } : null; }
    var la = lead(a), lb = lead(b);
    if (la && lb && la.ct === lb.ct && la.p - lb.p >= 12) return 'In ' + a.y + ' ' + la.p + '% of what you rated was ' + CT_SHORT[la.ct] + 'n. This year, ' + lb.p + '%.';
    if (la && lb && la.ct !== lb.ct) return 'You started in ' + la.ct + '. Lately you live in ' + lb.ct + '.';
    var best = tl.slice().sort(function (x, y) { return y.fresh.length - x.fresh.length; })[0];
    return best.y + ' was your biggest year for new countries: ' + best.fresh.length + '.';
  }

  /* ---- a country, opened ----------------------------------------------------------------- */
  function select(cc, zoom, quiet) {
    var host = $('pp-country'); if (!host || !_w) return;
    var c = _w.countries[cc], g = GEO[cc] || { n: cc, ct: '' };
    _sel = cc;
    document.querySelectorAll('#pp-map .sel').forEach(function (el) { el.classList.remove('sel'); });
    document.querySelectorAll('#pp-map [data-cc="' + cc + '"]').forEach(function (el) { el.classList.add('sel'); });
    if (zoom && $('pp-map')._zoomTo) $('pp-map')._zoomTo(cc);
    if (window.buzz && !quiet) buzz('tap');
    if (!c) {
      var recs = (_seedSync && _seedSync.recs[cc]) || [];
      host.innerHTML = '<div class="pp-c-head" style="--ink:' + (INK[g.ct] || '#fff') + '"><span class="pp-c-flag">' + flag(cc) + '</span><div><span class="pp-kick">' + esc(g.ct || '') + ' · not yet stamped</span><h2>' + esc(g.n) + '</h2></div><button class="pp-c-x" data-pp="close" aria-label="Close">✕</button></div>' +
        (recs.length ? '<p class="pp-note">Start with ' + recs.slice(0, 3).map(function (a) { return '<button class="pp-inline" data-pp-artist="' + esc(a) + '">' + esc(a) + '</button>'; }).join(', ') + '.</p>' : '<p class="pp-note">Nobody you rate or play is from here yet.</p>');
      host.hidden = false; if (!quiet) reveal(host); return;
    }
    var albumsL = [], songsL = [], tracks = [];
    c.artists.forEach(function (r) {
      r.albums.forEach(function (a) { albumsL.push(a); });
      r.songs.forEach(function (s) { songsL.push(Object.assign({ artist: r.name }, s)); });
      r.tracks.forEach(function (t) { tracks.push(Object.assign({ artist: r.name }, t)); });
    });
    albumsL.sort(function (a, b) { return b.score - a.score; }); songsL.sort(function (a, b) { return b.score - a.score; }); tracks.sort(function (a, b) { return b.plays - a.plays; });
    var hours = c.ms ? Math.round(c.ms / 36e5) : 0;
    host.innerHTML =
      '<div class="pp-c-head" style="--ink:' + (INK[c.ct] || '#fff') + '"><span class="pp-c-flag">' + flag(cc) + '</span><div><span class="pp-kick">' + esc(c.ct) + ' · ' + P.TIERS[c.rarity] + ' stamp</span><h2>' + esc(c.n) + '</h2></div>' +
      '<div class="pp-c-stamp">' + stampSvg(cc, c) + '</div><button class="pp-c-x" data-pp="close" aria-label="Close">✕</button></div>' +
      '<div class="pp-c-stats">' +
      cStat('Artists', c.artists.length) + (c.albums ? cStat('Albums rated', c.albums) : '') + (c.songs ? cStat('Songs rated', c.songs) : '') +
      (c.avg != null ? '<div><small>Your average</small><b style="color:' + scoreCol(c.avg) + '">' + Math.round(c.avg) + '</b></div>' : '') +
      (c.plays ? cStat('Plays', c.plays) : '') + (hours ? cStat('Hours', hours) : '') +
      (c.when ? '<div><small>First stamped</small><b class="sm">' + month(c.when) + '</b></div>' : '') + '</div>' +
      '<h4>Artists</h4><div class="pp-c-artists">' + c.artists.map(function (r) {
        return '<div class="pp-c-artist">' + (r.art ? '<img src="' + esc(th(r.art, 320)) + '" alt="" loading="lazy">' : '<span class="pp-noart">' + esc(r.name.charAt(0)) + '</span>') +
          '<b>' + esc(r.name) + '</b><small>' + [r.rated ? r.rated + ' rated' : '', r.avg != null ? 'avg ' + Math.round(r.avg) : '', r.plays ? n(r.plays) + ' plays' : ''].filter(Boolean).join(' · ') + '</small></div>';
      }).join('') + '</div>' +
      (albumsL.length ? '<h4>Albums</h4><div class="pp-c-albums">' + albumsL.slice(0, 12).map(function (a) {
        return '<button class="pp-c-album" data-pp-open="' + esc(a.id) + '">' + (a.art ? '<img src="' + esc(th(a.art, 320)) + '" alt="" loading="lazy">' : '<span class="pp-c-noart"></span>') + '<em style="background:' + scoreCol(a.score) + '">' + a.score + '</em><b>' + esc(a.name) + '</b><small>' + esc(a.artist) + '</small></button>';
      }).join('') + '</div>' : '') +
      (songsL.length ? '<h4>Songs</h4><ol class="pp-c-songs">' + songsL.slice(0, 8).map(function (s) { return '<li>' + (s.art ? '<img src="' + esc(th(s.art, 160)) + '" alt="" loading="lazy">' : '') + '<b>' + esc(s.name) + '</b><small>' + esc(s.artist) + '</small><em style="color:' + scoreCol(s.score * (s.score <= 10 ? 10 : 1)) + '">' + s.score + '</em></li>'; }).join('') + '</ol>' : '') +
      (tracks.length ? '<h4>Most played</h4><ol class="pp-c-songs pp-c-plays">' + tracks.slice(0, 6).map(function (t) { return '<li><b>' + esc(t.name) + '</b><small>' + esc(t.artist) + '</small><em>' + n(t.plays) + '</em></li>'; }).join('') + '</ol>' : '');
    host.hidden = false;
    if (!quiet) reveal(host);
  }
  function cStat(l, v) { return '<div><small>' + l + '</small><b>' + n(v) + '</b></div>'; }
  function reveal(host) {
    if (!calm()) { host.classList.remove('in'); void host.offsetWidth; host.classList.add('in'); }
    var r = host.getBoundingClientRect();
    if (r.top > window.innerHeight * 0.7 || r.top < 0) host.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' });
  }

  /* ---- new stamps, and the journey -------------------------------------------------------- */
  function stampsFresh(entering) {
    if (!_w || !_w.list.length) return;
    var seen = lsJSON(SEEN) || {}, first = !Object.keys(seen).length;
    var fresh = _w.list.filter(function (c) { return !seen[c.cc]; });
    if (!fresh.length) return;
    // merge, never replace
    var next = Object.assign({}, seen); fresh.forEach(function (c) { next[c.cc] = Date.now(); }); lsSet(SEEN, next);
    if (calm()) return;
    if (first && entering && _w.list.length > 1) { setTimeout(journey, 500); return; }
    fresh.slice(0, 6).forEach(function (c, i) {
      var el = document.querySelector('.pp-stamp[data-cc="' + c.cc + '"]'); if (el) { el.style.setProperty('--d', (i * 260) + 'ms'); el.classList.add('fresh'); }
      document.querySelectorAll('#pp-map [data-cc="' + c.cc + '"]').forEach(function (p) { p.classList.add('fresh'); });
    });
    toastStamp(fresh);
  }
  function toastStamp(fresh) {
    var c = fresh[0]; if (!c) return;
    var t = document.createElement('div'); t.className = 'pp-newstamp';
    t.innerHTML = '<div class="pp-ns-stamp">' + stampSvg(c.cc, c) + '</div><div><small>' + (fresh.length > 1 ? fresh.length + ' new stamps' : 'New stamp') + '</small><b>' + flag(c.cc) + ' ' + esc(c.n) + '</b><span>via ' + esc(c.artists[0].name) + '</span></div>';
    document.body.appendChild(t);
    if (window.buzz) buzz('good');
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 500); }, 3600);
  }
  // The world lights up in the order you reached it.
  function journey() {
    var sc = $('pp-scrub'), out = $('pp-when'); if (!sc || !_w) return;
    var N = _w.list.length, i = 0, step = Math.max(60, Math.min(260, 3600 / N));
    clearInterval(_tl); applyScrub(0);
    var map = $('pp-map'); if (map) map.classList.add('playing');
    _tl = setInterval(function () {
      i++; sc.value = i; applyScrub(i, true);
      if (i >= N) { clearInterval(_tl); _tl = null; if (map) map.classList.remove('playing'); out.textContent = 'Today · ' + N + ' countries'; }
    }, step);
  }
  function applyScrub(k, lit) {
    if (!_w) return;
    var on = {}; _w.list.slice(0, k).forEach(function (c) { on[c.cc] = 1; });
    document.querySelectorAll('#pp-map .pp-land .on, #pp-map .pp-dot, #pp-map .pp-bloom path').forEach(function (el) {
      var cc = el.getAttribute('data-cc') || el.getAttribute('data-g'); el.classList.toggle('off', !on[cc]);
    });
    var c = _w.list[k - 1], out = $('pp-when');
    if (out) out.textContent = k >= _w.list.length ? 'Today · ' + _w.list.length + ' countries' : c ? (c.when ? month(c.when) + ' · ' : '') + flagT(c.cc) + c.n + ' · ' + k : 'Before your first stamp';
    if (lit && c) document.querySelectorAll('#pp-map [data-cc="' + c.cc + '"]').forEach(function (p) { p.classList.remove('flash'); p.getBoundingClientRect(); p.classList.add('flash'); });
  }

  /* ---- share card ------------------------------------------------------------------------- */
  function share(btn) {
    if (!_w || !_W) return;
    var cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1350;
    var x = cv.getContext('2d');
    var bg = x.createLinearGradient(0, 0, 0, 1350); bg.addColorStop(0, '#0d1024'); bg.addColorStop(1, '#07070d');
    x.fillStyle = bg; x.fillRect(0, 0, 1080, 1350);
    var glow = x.createRadialGradient(540, 560, 40, 540, 560, 620); glow.addColorStop(0, 'rgba(79,224,207,.14)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = glow; x.fillRect(0, 0, 1080, 1350);
    var font = getComputedStyle(document.body).getPropertyValue('--font-display') || 'sans-serif';
    x.fillStyle = '#e9c46a'; x.font = '600 26px ' + font; x.letterSpacing = '8px'; x.fillText('MUSIC PASSPORT', 72, 110);
    x.letterSpacing = '0px'; x.fillStyle = '#fff'; x.font = '800 78px ' + font;
    var me = window.Wallet && Wallet.get && Wallet.get().username;
    x.fillText(me ? me + '’s world' : 'My world in music', 72, 190);
    // map
    var s = 936 / _W.w, ox = 72, oy = 260;
    x.save(); x.translate(ox, oy); x.scale(s, s);
    Object.keys(_W.shapes).forEach(function (cc) {
      var p = new Path2D(_W.shapes[cc].d), c = _w.countries[cc];
      if (!c) { x.fillStyle = '#1d1f33'; x.fill(p); return; }
      var col = c.src === 'rated' ? '#ffc061' : c.src === 'listened' ? '#4fe0cf' : '#ffe3a3';
      x.shadowColor = col; x.shadowBlur = 18 / s; x.fillStyle = col; x.fill(p); x.shadowBlur = 0;
    });
    _w.list.forEach(function (c) { var sh = _W.shapes[c.cc]; if (sh && sh.a < 12) { x.fillStyle = '#fff'; x.beginPath(); x.arc(sh.c[0], sh.c[1], 4, 0, 7); x.fill(); } });
    x.restore();
    var nC = _w.list.length, nCt = Object.keys(_w.continents).length;
    var y0 = oy + _W.h * s + 80;
    [[nC, nC === 1 ? 'country' : 'countries'], [nCt + '/6', 'continents'], [_w.placedArtists, 'artists']].forEach(function (st, i) {
      x.fillStyle = '#fff'; x.font = '800 92px ' + font; x.fillText(String(st[0]), 72 + i * 330, y0 + 70);
      x.fillStyle = 'rgba(255,255,255,.55)'; x.font = '500 28px ' + font; x.fillText(st[1], 76 + i * 330, y0 + 112);
    });
    var top = _w.list.slice().sort(function (a, b) { return b.artists.length - a.artists.length || b.plays - a.plays; }).slice(0, 5);
    x.font = '600 34px ' + font; x.fillStyle = '#fff';
    top.forEach(function (c, i) { x.fillText(flagT(c.cc) + c.n, 72 + (i % 2) * 470, y0 + 210 + Math.floor(i / 2) * 58); });
    x.fillStyle = 'rgba(255,255,255,.4)'; x.font = '500 26px ' + font; x.fillText('vinall.xyz', 72, 1290);
    x.textAlign = 'right'; x.fillText('Origins: MusicBrainz', 1008, 1290);
    cv.toBlob(function (blob) {
      if (!blob) return;
      var file = new File([blob], 'vinall-passport.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: 'My Music Passport', text: nC + ' countries in my music on VINALL' }).catch(function () {});
        return;
      }
      var url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'vinall-passport.png'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      if (btn) { var t = btn.innerHTML; btn.textContent = 'Saved ✓'; setTimeout(function () { btn.innerHTML = t; }, 1600); }
    }, 'image/png');
  }

  /* ---- teasers: profile and About you -------------------------------------------------- */
  function teaserHtml() { setTimeout(fillTeasers, 0); return '<div class="pp-teaser" data-pp-teaser><button class="pp-teaser-btn" data-go-passport><span class="pp-kick">Music Passport</span><b>Your world in music</b><span class="pp-teaser-map"></span><span class="pp-teaser-go">→</span></button></div>'; }
  function fillTeasers() {
    var els = document.querySelectorAll('[data-pp-teaser]'); if (!els.length) return;
    Promise.all([loadGeo(), loadSeed(), getListen()]).then(function (r) {
      _W = r[0]; _seedSync = r[1];
      var w = world();
      if (w.pending.length) enqueue(w.pending);
      var nC = w.list.length, nCt = Object.keys(w.continents).length;
      els.forEach(function (el) {
        var btn = el.querySelector('.pp-teaser-btn'); if (!btn) return;
        btn.querySelector('b').textContent = nC ? nC + ' ' + (nC === 1 ? 'country' : 'countries') + ', ' + nCt + ' continent' + (nCt === 1 ? '' : 's') : 'Your world in music';
        btn.querySelector('.pp-teaser-map').innerHTML = mapSvg(_W, w, { mini: true });
        var fl = btn.querySelector('.pp-teaser-flags') || btn.appendChild(Object.assign(document.createElement('span'), { className: 'pp-teaser-flags' }));
        fl.innerHTML = w.list.slice(-8).reverse().map(function (c) { return flag(c.cc); }).join(' ');
      });
    }).catch(function () {});
  }
  // About you is rebuilt wholesale on every visit, so the teaser is put back
  // after each paint rather than wired into its renderer.
  function watchAbout() {
    var ab = $('ab-body'); if (!ab) return;
    new MutationObserver(function () {
      if (ab.querySelector('[data-pp-teaser]')) return;
      var after = ab.querySelector('.ab-hero') || ab.querySelector('.ab-empty'); if (!after) return;
      var d = document.createElement('div'); d.innerHTML = teaserHtml(); after.insertAdjacentElement('afterend', d.firstChild);
    }).observe(ab, { childList: true });
  }

  /* ---- events ------------------------------------------------------------------------------ */
  document.addEventListener('click', function (e) {
    var go = e.target.closest('[data-go-passport]'); if (go) { e.preventDefault(); if (window.goToView) goToView('passport'); return; }
    var root = e.target.closest('#view-passport'); if (!root) return;
    var dg = e.target.closest('[data-go]'); if (dg && window.goToView) { goToView(dg.dataset.go); return; }
    var b = e.target.closest('[data-pp], [data-cc], [data-pp-artist], [data-pp-open]'); if (!b || b.closest('svg')) return;
    if (b.dataset.ppOpen) { var a = albums()[b.dataset.ppOpen]; if (a && window.openAlbum) openAlbum({ id: b.dataset.ppOpen, name: a.name, artist: a.artist, art: a.art, artistId: a.artistId }); return; }
    if (b.dataset.ppArtist) return openArtist(b.dataset.ppArtist, b);
    if (b.dataset.cc && !b.dataset.pp) return select(b.dataset.cc, true);
    var k = b.dataset.pp;
    if (k === 'reset') { $('pp-map')._reset(); return; }
    if (k === 'zin' || k === 'zout') { $('pp-map')._zoom(k === 'zin' ? 1.8 : 1 / 1.8); return; }
    if (k === 'close') { var c = $('pp-country'); if (c) c.hidden = true; _sel = null; document.querySelectorAll('#pp-map .sel').forEach(function (el) { el.classList.remove('sel'); }); $('pp-map')._reset(); return; }
    if (k === 'journey') return journey();
    if (k === 'share') return share(b);
    if (k === 'retry') { dead = false; run(); onProgress(false); return; }
    if (k === 'reload') { _geo = null; return render(); }
    if (k === 'import') { if (window.SpotifyBridge && SpotifyBridge.open) SpotifyBridge.open(); else if (window.goToView) goToView('profile'); return; }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id !== 'pp-scrub') return;
    clearInterval(_tl); _tl = null;
    applyScrub(+e.target.value, true);
  });
  // A recommendation opens a real record by that artist, matched by name.
  function openArtist(name, btn) {
    if (typeof spotifyGet !== 'function' || !window.openAlbum) return;
    if (btn) btn.classList.add('busy');
    spotifyGet('/search?q=' + encodeURIComponent(name) + '&type=album&limit=10').then(function (j) {
      var items = (j && j.albums && j.albums.items) || [], want = P.fold(name);
      var hit = items.filter(function (it) { return it.artists && it.artists[0] && P.fold(it.artists[0].name) === want; })[0] || items[0];
      if (btn) btn.classList.remove('busy');
      if (!hit) return;
      openAlbum({ id: hit.id, name: hit.name, artist: (hit.artists && hit.artists[0] && hit.artists[0].name) || name, art: hit.images && hit.images[0] && hit.images[0].url, artistId: hit.artists && hit.artists[0] && hit.artists[0].id });
    }).catch(function () { if (btn) btn.classList.remove('busy'); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchAbout); else watchAbout();

  window.Passport = { render: render, teaserHtml: teaserHtml, fillTeasers: fillTeasers, stampSvg: stampSvg, _world: function () { return _w; } };
})();
