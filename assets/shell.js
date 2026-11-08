/* ================================================================
   SHELL — the redesign's structure layer.

   Five places (Home, Discover, Rate, Arcade, Profile). Every existing view
   still exists, keeps its id, its render function and its data; this file
   only decides which of the five places it belongs to, draws the segmented
   bar or the back bar on top of it, and owns the two new pieces: the Rate
   tab and the rating sheet.

   setMode() calls Shell.onMode(mode) after every switch and asks
   navTabFor(mode) which nav button to light. Nothing here renders a view's
   content; that stays where it was.
   ================================================================ */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function e(s) { return window.esc ? window.esc(s) : String(s == null ? '' : s); }
  function th(u, px) { return window.thumb ? window.thumb(u, px) : u; }
  function signedIn() { return !!(window.Cloud && Cloud.isOn && Cloud.isOn()); }
  function viewingOther() {
    try {
      var u = new URLSearchParams(location.search).get('u');
      var me = window.Cloud && Cloud.getUser && Cloud.getUser();
      return !!u && (!me || u !== me.id);
    } catch (x) { return false; }
  }

  /* ---- which place every view belongs to --------------------------------
     A view not listed is its own place (only the five nav modes are). The
     album page has no place of its own: it keeps lit whatever you came from. */
  var NAV_GROUP = {
    home: 'home', replay: 'home',
    foryou: 'foryou', crate: 'foryou', choice: 'foryou', people: 'foryou', grooves: 'foryou',
    rate: 'rate',
    games: 'games', wars: 'games',
    profile: 'profile', albums: 'profile', songs: 'profile', liked: 'profile',
    collection: 'profile', rewards: 'profile', achievements: 'profile',
    passport: 'profile', about: 'profile', yourmusic: 'profile'
  };
  var lastTab = 'home';
  window.navTabFor = function (mode) {
    if (mode === 'album-detail') return lastTab;
    var t = NAV_GROUP[mode] || mode;
    lastTab = t;
    return t;
  };

  /* ---- segmented bars ----------------------------------------------------
     `on` lists the views a segment stays lit for. */
  var BARS = {
    discover: [
      { mode: 'foryou', label: 'For You' },
      { mode: 'crate', label: 'Community' },
      { mode: 'choice', label: 'Moments' },
      { mode: 'people', label: 'People' }
    ],
    profile: [
      { mode: 'profile', label: 'Overview' },
      { mode: 'albums', label: 'Ratings', on: ['albums', 'songs', 'liked'] },
      { mode: 'collection', label: 'Records' },
      { mode: 'passport', label: 'Passport' }
    ],
    ratings: [
      { mode: 'albums', label: 'Albums' },
      { mode: 'songs', label: 'Songs' },
      { mode: 'liked', label: 'Liked' }
    ]
  };
  var BAR_FOR = {
    foryou: ['discover'], crate: ['discover'], choice: ['discover'], people: ['discover'],
    profile: ['profile'], collection: ['profile'], passport: ['profile'],
    albums: ['profile', 'ratings'], songs: ['profile', 'ratings'], liked: ['profile', 'ratings']
  };

  /* Pushed pages: a back bar, no segmented bar. `parent` is where back goes
     when there is no history to go back through (a deep link, a reload). */
  var PUSHED = {
    replay: { title: 'Replay', parent: 'home' },
    rewards: { title: 'Shop', parent: 'profile' },
    achievements: { title: 'Achievements', parent: 'passport' },
    about: { title: 'About you', parent: 'profile' },
    yourmusic: { title: 'Your music', parent: 'profile' },
    wars: { title: 'Bid Wars', parent: 'games' },
    grooves: { title: 'Grooves', parent: 'people' }
  };

  function go(mode) {
    // Your own profile from a segment: drop any ?u= so it is yours, not theirs.
    if (mode === 'profile' && location.search.indexOf('u=') !== -1) {
      try { history.replaceState(history.state, '', location.pathname + location.hash); } catch (x) {}
    }
    if (window.goToView) goToView(mode);
  }

  function segHTML(key, cls) {
    return '<nav class="seg ' + cls + '" data-seg="' + key + '" aria-label="' + key + '">' +
      BARS[key].map(function (t) {
        return '<button type="button" data-seg-go="' + t.mode + '">' + t.label + '</button>';
      }).join('') + '</nav>';
  }

  function ensureBars(mode) {
    var sec = $('view-' + mode);
    if (!sec) return;
    (BAR_FOR[mode] || []).forEach(function (key, i) {
      var bar = sec.querySelector(':scope > .seg[data-seg="' + key + '"]');
      if (!bar) {
        var w = document.createElement('div');
        w.innerHTML = segHTML(key, i ? 'seg-sub' : 'seg-main');
        bar = w.firstChild;
        var anchor = sec.querySelector(':scope > .seg-main');
        if (i && anchor) anchor.after(bar); else sec.insertBefore(bar, sec.firstChild);
      }
      bar.hidden = (mode === 'profile' && viewingOther());
      bar.querySelectorAll('button').forEach(function (b) {
        var t = BARS[key].filter(function (x) { return x.mode === b.dataset.segGo; })[0];
        // Boolean, always: toggle(cls, undefined) FLIPS instead of forcing.
        var lit = t.mode === mode || !!(t.on && t.on.indexOf(mode) !== -1);
        b.classList.toggle('on', lit);
        if (lit) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      });
    });
    if (PUSHED[mode] && !sec.querySelector(':scope > .back-bar')) {
      var bb = document.createElement('div');
      bb.className = 'back-bar';
      bb.innerHTML = '<button type="button" class="back-btn" aria-label="Back"><svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg></button>' +
        '<span class="back-title">' + PUSHED[mode].title + '</span>';
      sec.insertBefore(bb, sec.firstChild);
      bb.querySelector('.back-btn').addEventListener('click', function () {
        var st = history.state;
        if (st && st.vinall && history.length > 1 && Shell._pushedFrom) history.back();
        else go(PUSHED[mode].parent);
      });
    }
  }

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-seg-go]');
    if (!b) return;
    if (window.buzz) buzz('tap');
    go(b.dataset.segGo);
  });

  /* ---- header: one bar on Home only ------------------------------------- */
  function moveSearch() {
    var sb = document.querySelector('.search-block'), slot = $('rate-search-slot');
    if (sb && slot && sb.parentNode !== slot) {
      slot.appendChild(sb);
      var inp = $('search-input');
      if (inp) inp.placeholder = 'Search albums or artists';
    }
  }

  /* ---- profile: what the old avatar menu and Shop tab used to hold ------ */
  var ICON = {
    gear: '<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="2.1"/><path d="M8 1.9v1.6M8 12.5v1.6M3.7 3.7l1.1 1.1M11.2 11.2l1.1 1.1M1.9 8h1.6M12.5 8h1.6M3.7 12.3l1.1-1.1M11.2 4.8l1.1-1.1"/></svg>',
    disc: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="8" cy="8" r="5.9"/><circle cx="8" cy="8" r="1.7"/></svg>',
    chev: '<svg class="rx-chev" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 3 5 5-5 5"/></svg>'
  };
  function profileChrome() {
    var sec = $('view-profile');
    if (!sec) return;
    var tb = sec.querySelector(':scope > .prof-tools');
    if (!tb) {
      tb = document.createElement('div');
      tb.className = 'prof-tools';
      tb.innerHTML = '<h2 class="pg-title">Profile</h2>' +
        '<button type="button" class="chip-btn" id="pt-discs" aria-label="Shop">' + ICON.disc + '<span id="pt-discs-n">Shop</span></button>' +
        '<button type="button" class="icon-btn" id="pt-settings" aria-label="Settings">' + ICON.gear + '</button>';
      sec.insertBefore(tb, sec.firstChild);
      $('pt-discs').addEventListener('click', function () { go('rewards'); });
      $('pt-settings').addEventListener('click', function () { if (window.openSettings) openSettings(); });
    }
    var other = viewingOther();
    tb.hidden = other;
    // Logged out, the page is one invitation; the lore heading under it was
    // a second empty state saying the same thing.
    sec.classList.toggle('is-guest', !signedIn() && !other);
    var n = $('shop-open-discs'), d = $('pt-discs');
    if (d) d.style.display = signedIn() ? '' : 'none';
    if (n && $('pt-discs-n')) $('pt-discs-n').textContent = /\d|∞/.test(n.textContent) ? n.textContent : 'Shop';

    var more = sec.querySelector(':scope > .prof-more');
    if (!more) {
      more = document.createElement('div');
      more.className = 'prof-more';
      var rows = [
        ['about', 'About you', 'Your taste, in numbers'],
        ['yourmusic', 'Your music', 'Everything you have rated and played'],
        ['replay', 'Replay', 'Your week, month and year'],
        ['achievements', 'Achievements', 'Milestones and finished discographies'],
        ['rewards', 'Shop', 'Themes, tags, the daily spin'],
        ['@activity', 'Recent activity', '']
      ];
      more.innerHTML = '<h3 class="grp-title">More</h3><div class="rx-list">' + rows.map(function (r) {
        return '<button type="button" class="rx-row" data-more="' + r[0] + '"><span class="rx-text"><b>' + r[1] + '</b>' +
          (r[2] ? '<small>' + r[2] + '</small>' : '') + '</span>' + ICON.chev + '</button>';
      }).join('') + '</div>';
      // After the profile body, before the lore list, so the identity leads.
      var lore = sec.querySelector('.section-head');
      sec.insertBefore(more, lore || null);
      more.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-more]'); if (!b) return;
        var k = b.dataset.more;
        if (k === '@activity') { var t = $('activity-toggle'); if (t) t.click(); return; }
        go(k);
      });
    }
    more.hidden = other || !signedIn();
  }

  function peopleChrome() {
    var sec = $('view-people');
    if (!sec || sec.querySelector('.grooves-link')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'rx-row grooves-link';
    b.innerHTML = '<span class="rx-text"><b>Grooves</b><small>Small groups that rate together</small></span>' + ICON.chev;
    b.addEventListener('click', function () { go('grooves'); });
    var head = sec.querySelector('.section-head');
    if (head) head.after(b); else sec.appendChild(b);
  }

  function homeChrome() {
    var sec = $('view-home');
    if (!sec || sec.querySelector(':scope > .home-greet')) return;
    var g = document.createElement('div');
    g.className = 'home-greet';
    sec.insertBefore(g, sec.firstChild);
  }
  function paintGreeting() {
    var g = document.querySelector('#view-home > .home-greet');
    if (!g) return;
    var h = new Date().getHours();
    var part = h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    var name = '';
    try {
      var u = window.Cloud && Cloud.getUser && Cloud.getUser();
      var un = window.Wallet && Wallet.get && Wallet.get() && Wallet.get().username;
      name = un || (u && u.user_metadata && u.user_metadata.username) || '';
    } catch (x) {}
    g.innerHTML = '<p class="hg-date">' + new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + '</p>' +
      '<h2 class="pg-title">' + part + (name ? ', ' + e(name) : '') + '</h2>';
  }

  /* ---- the rating sheet --------------------------------------------------- */
  function hue(s) { return 'hsl(' + Math.round(Math.max(0, Math.min(100, s)) * 1.25) + ' 70% 58%)'; }
  function existing(meta) {
    try {
      var all = window.loadAlbums ? loadAlbums() : {};
      var r = window.findAlbumRec ? findAlbumRec(all, meta) : all[meta.id];
      return r && typeof r.score === 'number' ? r : null;
    } catch (x) { return null; }
  }
  var Sheet = {
    meta: null,
    open: function (meta) {
      if (!meta || !meta.id) return;
      Sheet.meta = meta;
      var prev = existing(meta);
      var start = prev ? prev.score : 70;
      var panel = $('rs-panel');
      var listed = window.shortlistHas && shortlistHas(meta.id);
      panel.innerHTML =
        '<button type="button" class="rs-x" aria-label="Close">&times;</button>' +
        '<div class="rs-top"><img class="rs-art" src="' + e(th(meta.art, 500)) + '" alt="" onerror="this.style.visibility=\'hidden\'">' +
        '<div class="rs-meta"><h3 id="rs-title">' + e(meta.name) + '</h3><p>' + e(meta.artist) + (meta.year ? ' &middot; ' + e(meta.year) : '') + '</p>' +
        (prev ? '<p class="rs-was">You gave it ' + prev.score + '</p>' : '') + '</div></div>' +
        '<div class="rs-score"><span id="rs-n">' + start + '</span><small>/100</small></div>' +
        '<input type="range" min="0" max="100" step="1" value="' + start + '" id="rs-range" class="rs-range" aria-label="Score out of 100">' +
        '<div class="rs-ticks" aria-hidden="true"><span>0</span><span>50</span><span>100</span></div>' +
        '<button type="button" class="btn-primary rs-save" id="rs-save"></button>' +
        '<div class="rs-alt">' +
          '<button type="button" class="btn-ghost" id="rs-open">Open album</button>' +
          (!prev && !listed ? '<button type="button" class="btn-ghost" id="rs-later">Save for later</button>' : '') +
        '</div>';
      var range = $('rs-range');
      function paint() {
        var v = +range.value;
        $('rs-n').textContent = v;
        panel.style.setProperty('--rs-c', hue(v));
        range.style.setProperty('--fill', v + '%');
        $('rs-save').textContent = !prev ? 'Rate ' + v : (v === prev.score ? 'Still ' + v : 'Change to ' + v);
      }
      range.addEventListener('input', paint);
      paint();
      panel.querySelector('.rs-x').addEventListener('click', Sheet.close);
      $('rs-save').addEventListener('click', function () {
        var v = +range.value;
        try { window.saveAlbum(Sheet.meta, v); } catch (x) { if (window.reportIssue) reportIssue('rs-save', x); return; }
        if (window.buzz) buzz('good');
        if (window.toast) toast(prev ? 'Updated to ' + v : 'Rated ' + v + ' — ' + Sheet.meta.name);
        Sheet.close();
        if (window.RateTab) RateTab.render();
      });
      $('rs-open').addEventListener('click', function () { var m = Sheet.meta; Sheet.close(); if (window.openAlbum) openAlbum(m); });
      var later = $('rs-later');
      if (later) later.addEventListener('click', function () {
        if (window.shortlistAdd) shortlistAdd(Sheet.meta, 'Saved from search');
        if (window.toast) toast('Saved for later');
        Sheet.close();
        if (window.RateTab) RateTab.render();
      });
      $('rs-modal').classList.add('open');
    },
    close: function () { $('rs-modal').classList.remove('open'); }
  };
  window.RateSheet = Sheet;
  document.addEventListener('DOMContentLoaded', function () {
    var m = $('rs-modal');
    if (m) m.addEventListener('click', function (ev) { if (ev.target === m) Sheet.close(); });
  });

  /* Search results open the sheet, not the album page. Capture phase, so the
     row's own listener (openAlbum) never runs. Keyboard Enter still opens the
     album page, which is what a desktop keyboard user expects. */
  document.addEventListener('click', function (ev) {
    var row = ev.target.closest && ev.target.closest('#suggestions .suggestion');
    if (!row) return;
    var list;
    try { list = suggestions; } catch (x) { return; } // the search module's own array
    var meta = list && list[+row.dataset.i];
    if (!meta) return;
    ev.stopPropagation(); ev.preventDefault();
    Sheet.open(meta);
  }, true);

  /* ---- the Rate tab ---------------------------------------------------------- */
  function rowHTML(m, sub, right) {
    return '<button type="button" class="rx-row rx-album" data-rate=\'' + e(JSON.stringify(m)) + '\'>' +
      '<img src="' + e(th(m.art, 160)) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' +
      '<span class="rx-text"><b>' + e(m.name) + '</b><small>' + e(sub) + '</small></span>' + (right || ICON.chev) + '</button>';
  }
  function scorePill(s) { return '<span class="score-pill" style="--sc:' + hue(s) + '">' + s + '</span>'; }
  var RateTab = {
    render: function () {
      moveSearch();
      var body = $('rate-body');
      if (!body) return;
      var albums = window.loadAlbums ? loadAlbums() : {};
      var html = '';

      var sl = window.loadShortlist ? loadShortlist() : {};
      var queue = Object.keys(sl).map(function (k) { return sl[k]; })
        .sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
      if (queue.length) {
        html += '<h3 class="grp-title">Up next <span>' + queue.length + '</span></h3><div class="rx-list">' +
          queue.slice(0, 12).map(function (r) {
            return rowHTML({ id: r.id, name: r.name, artist: r.artist, art: r.art }, r.artist + (r.why ? ' · ' + r.why : ''));
          }).join('') + '</div>';
      }

      // Records you own and have never had an opinion about.
      var owned = (window.CollectionWorth && CollectionWorth.mine) ? CollectionWorth.mine() : [];
      var unrated = owned.filter(function (r) {
        var m = { id: r.album_id, name: r.album_name || r.name, artist: r.album_artist || r.artist };
        return m.id && !existing(m);
      });
      if (unrated.length) {
        html += '<h3 class="grp-title">On your shelf, unrated</h3><div class="rx-list">' +
          unrated.slice(0, 8).map(function (r) {
            return rowHTML({ id: r.album_id, name: r.album_name || r.name, artist: r.album_artist || r.artist, art: r.album_art || r.art }, (r.album_artist || r.artist) + ' · you own it');
          }).join('') + '</div>';
      }

      var recent = Object.keys(albums).map(function (k) { return albums[k]; })
        .filter(function (a) { return typeof a.score === 'number'; })
        .sort(function (a, b) { return (b.ratedAt || b.savedAt || 0) - (a.ratedAt || a.savedAt || 0); });
      if (recent.length) {
        html += '<h3 class="grp-title">Recently rated</h3><div class="rx-list">' +
          recent.slice(0, 6).map(function (a) {
            return rowHTML({ id: a.id, name: a.name, artist: a.artist, artistId: a.artistId, art: a.art, year: a.year }, a.artist, scorePill(a.score));
          }).join('') + '</div>' +
          (recent.length > 6 ? '<button type="button" class="link-btn" data-seg-go="albums">All ' + recent.length + ' ratings</button>' : '');
      }

      if (!html) {
        html = '<div class="empty-quiet"><p><b>Start with a record you know by heart.</b></p>' +
          '<p>Search for it above. Your first three ratings unlock the first games in the Arcade.</p></div>';
      }
      body.innerHTML = html;
    }
  };
  window.RateTab = RateTab;
  document.addEventListener('click', function (ev) {
    var r = ev.target.closest && ev.target.closest('#rate-body [data-rate]');
    if (!r) return;
    try { Sheet.open(JSON.parse(r.dataset.rate)); } catch (x) {}
  });
  window.addEventListener('vinall:rated', function () { if (window.currentMode === 'rate') RateTab.render(); });

  /* ---- per-switch hook from setMode ------------------------------------------- */
  var Shell = {
    _pushedFrom: null,
    onMode: function (mode) {
      document.body.dataset.place = window.navTabFor ? navTabFor(mode) : mode;
      ensureBars(mode);
      if (PUSHED[mode]) Shell._pushedFrom = Shell._prev; else Shell._pushedFrom = null;
      Shell._prev = mode;
      if (mode === 'profile') profileChrome();
      if (mode === 'people') peopleChrome();
      if (mode === 'home') paintGreeting();
      if (mode === 'rate') setTimeout(function () {
        // Focus only when nothing is queued: a keyboard popping over the queue
        // on every visit hides the thing the page is offering.
        var body = $('rate-body');
        if (body && !body.querySelector('.rx-row') && window.matchMedia('(hover: hover)').matches) { var i = $('search-input'); if (i && !i.disabled) i.focus(); }
      }, 60);
    }
  };
  window.Shell = Shell;

  function boot() {
    moveSearch();
    homeChrome();
    paintGreeting();
    var m = window.currentMode || 'home';
    document.body.dataset.place = window.navTabFor ? navTabFor(m) : m;
    ensureBars(m);
    if (window.positionNavIndicator) positionNavIndicator();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  if (window.Cloud && Cloud.ready) Cloud.ready.then(function () { paintGreeting(); if (window.currentMode === 'profile') profileChrome(); });
})();
