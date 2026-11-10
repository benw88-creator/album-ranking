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
    /* Account / Ratings / Records / About You / Shop, in that order. Music
       Passport and Achievements are pages INSIDE About You (and Passport is
       offered from the Shop too), not destinations of their own. */
    profile: [
      { mode: 'profile', label: 'Account' },
      { mode: 'albums', label: 'Ratings', on: ['albums', 'songs', 'liked'] },
      { mode: 'collection', label: 'Records' },
      { mode: 'about', label: 'About You' },
      { mode: 'rewards', label: 'Shop' }
    ],
    ratings: [
      { mode: 'albums', label: 'Albums' },
      { mode: 'songs', label: 'Songs' },
      { mode: 'liked', label: 'Liked' }
    ]
  };
  var BAR_FOR = {
    foryou: ['discover'], crate: ['discover'], choice: ['discover'], people: ['discover'],
    profile: ['profile'], collection: ['profile'], about: ['profile'], rewards: ['profile'],
    albums: ['profile', 'ratings'], songs: ['profile', 'ratings'], liked: ['profile', 'ratings']
  };

  /* Pushed pages: a back bar, no segmented bar. `parent` is where back goes
     when there is no history to go back through (a deep link, a reload). */
  var PUSHED = {
    replay: { title: 'Replay', parent: 'home' },
    achievements: { title: 'Achievements', parent: 'about' },
    passport: { title: 'Music Passport', parent: 'about' },
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
        /* history.back() only when the screen behind this one is in the same
           place (you came here from it). Reopened from the tab bar, or from a
           deep link, the screen behind is somewhere else entirely, and Back
           should go up to the parent rather than across to another tab. */
        var from = Shell._pushedFrom;
        if (from && (NAV_GROUP[from] || from) === (NAV_GROUP[mode] || mode) && window.navBack) navBack(PUSHED[mode].parent);
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

    Menu.ensure(tb);
    var mb = $('pt-more');
    if (mb) mb.hidden = !signedIn();
  }

  /* ---- Profile: the More menu -------------------------------------------
     A dropdown anchored under its own button in the Profile header, so the
     extra pages are one tap away from the top instead of a list you scroll
     past the whole profile to find. role=menu, arrow keys move, Escape and an
     outside tap close it, focus returns to the button. Clamped to the screen:
     it is right-aligned to the button and never wider than the viewport. */
  var MENU_ROWS = [
    ['yourmusic', 'Your music', 'Rate what you brought in'],
    ['replay', 'Replay', 'Your week, month and year'],
    ['achievements', 'Achievements', 'Milestones and discographies'],
    ['passport', 'Music Passport', 'Where your music comes from'],
    ['@activity', 'Recent activity', '']
  ];
  var Menu = {
    ensure: function (tb) {
      if ($('pt-more')) return;
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'icon-btn'; btn.id = 'pt-more';
      btn.setAttribute('aria-label', 'More options'); btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'pt-menu');
      btn.innerHTML = '<svg viewBox="0 0 16 16" width="17" height="17" fill="currentColor" aria-hidden="true"><circle cx="3.6" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.4" cy="8" r="1.3"/></svg>';
      tb.insertBefore(btn, $('pt-settings'));
      var m = document.createElement('div');
      m.className = 'pt-menu'; m.id = 'pt-menu'; m.setAttribute('role', 'menu'); m.hidden = true;
      m.innerHTML = MENU_ROWS.map(function (r) {
        return '<button type="button" role="menuitem" class="pt-mi" data-more="' + r[0] + '"><b>' + r[1] + '</b>' + (r[2] ? '<small>' + r[2] + '</small>' : '') + '</button>';
      }).join('');
      tb.appendChild(m);
      btn.addEventListener('click', function (ev) { ev.stopPropagation(); Menu.toggle(); });
      m.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-more]'); if (!b) return;
        var k = b.dataset.more;
        Menu.close(true);
        if (k === '@activity') { var t = $('activity-toggle'); if (t) t.click(); return; }
        go(k);
      });
      m.addEventListener('keydown', function (ev) {
        var items = Array.prototype.slice.call(m.querySelectorAll('.pt-mi'));
        var i = items.indexOf(document.activeElement);
        if (ev.key === 'ArrowDown') { ev.preventDefault(); items[(i + 1) % items.length].focus(); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
        else if (ev.key === 'Home') { ev.preventDefault(); items[0].focus(); }
        else if (ev.key === 'End') { ev.preventDefault(); items[items.length - 1].focus(); }
        else if (ev.key === 'Tab') Menu.close(false);
      });
      document.addEventListener('pointerdown', function (ev) {
        if (!m.hidden && !m.contains(ev.target) && !btn.contains(ev.target)) Menu.close(false);
      }, true);
      document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !m.hidden) { ev.stopPropagation(); Menu.close(true); } }, true);
    },
    toggle: function () { var m = $('pt-menu'); if (m && m.hidden) Menu.open(); else Menu.close(true); },
    open: function () {
      var m = $('pt-menu'), btn = $('pt-more'); if (!m || !btn) return;
      m.hidden = false; m.classList.remove('in');
      btn.setAttribute('aria-expanded', 'true');
      void m.offsetWidth;
      m.classList.add('in');
      if (window.buzz) buzz('select');
      var first = m.querySelector('.pt-mi');
      if (first) first.focus({ preventScroll: true });
    },
    close: function (refocus) {
      var m = $('pt-menu'), btn = $('pt-more'); if (!m || m.hidden) return;
      m.classList.remove('in');
      m.hidden = true;
      if (btn) { btn.setAttribute('aria-expanded', 'false'); if (refocus) btn.focus({ preventScroll: true }); }
    }
  };

  /* About You holds the pages that used to be tabs of their own. */
  function linkRows(cls, rows) {
    return '<div class="rx-list ' + cls + '">' + rows.map(function (r) {
      return '<button type="button" class="rx-row" data-seg-go="' + r[0] + '"><span class="rx-text"><b>' + r[1] + '</b><small>' + r[2] + '</small></span>' + ICON.chev + '</button>';
    }).join('') + '</div>';
  }
  function aboutChrome() {
    var sec = $('view-about');
    if (!sec || sec.querySelector('.about-links')) return;
    var w = document.createElement('div');
    w.innerHTML = linkRows('about-links', [
      ['passport', 'Music Passport', 'Every country your music comes from'],
      ['achievements', 'Achievements', 'Milestones and finished discographies']
    ]);
    sec.appendChild(w.firstChild);
  }
  function shopChrome() {
    var sec = $('view-rewards');
    if (!sec || sec.querySelector('.shop-links')) return;
    var w = document.createElement('div');
    w.innerHTML = linkRows('shop-links', [['passport', 'Music Passport', 'See where your stamps come from']]);
    sec.appendChild(w.firstChild);
  }

  function peopleChrome() {
    var sec = $('view-people');
    if (!sec || sec.querySelector('.grooves-link')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'rx-row grooves-link';
    b.innerHTML = '<span class="rx-text"><b>Grooves</b><small>Join or create a groove</small></span>' + ICON.chev;
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

  /* ---- Community: tap a tile, the full card opens in a sheet -------------
     The card node itself moves into the sheet (a placeholder holds its grid
     cell) and moves back on close, however the sheet is closed — X, backdrop,
     Escape, or Back via the modal history layer. Nothing is rebuilt, so the
     spread, your answer, Not heard and the comments link work exactly as on
     the old full-size feed. */
  var CfSheet = (function () {
    var modal, panel, card, ph;
    function ensure() {
      if (modal) return;
      modal = document.createElement('div');
      modal.className = 'modal'; modal.id = 'cf-sheet';
      modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', 'Post');
      modal.innerHTML = '<div class="modal-panel cf-sheet-panel"><button type="button" class="rs-x modal-close" aria-label="Close">&times;</button></div>';
      document.body.appendChild(modal);
      panel = modal.firstChild;
      panel.firstChild.addEventListener('click', close);
      modal.addEventListener('click', function (ev) {
        if (ev.target === modal) { close(); return; }
        // Anything on the card that leaves it (the album page, a profile)
        // closes the sheet behind it; the card's own controls do not.
        if (card && card.contains(ev.target) && !ev.target.closest('.cf-foot,[data-action]')) setTimeout(close, 0);
      });
      new MutationObserver(function () { if (!modal.classList.contains('open')) restore(); })
        .observe(modal, { attributes: true, attributeFilter: ['class'] });
      document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && modal.classList.contains('open')) close(); });
      // The history layer watches .modal elements it found at load; tell it about this one.
      if (window.__watchLayer) window.__watchLayer(modal);
    }
    function restore() {
      if (!card) return;
      if (ph && ph.parentNode) ph.parentNode.replaceChild(card, ph);
      card = null; ph = null;
    }
    function open(c) {
      ensure();
      restore();
      card = c;
      ph = document.createElement('div');
      ph.className = 'cf-ph'; ph.setAttribute('aria-hidden', 'true');
      c.parentNode.replaceChild(ph, c);
      panel.appendChild(c);
      modal.classList.add('open');
      var f = c.querySelector('.cf-foot');
      if (f) requestAnimationFrame(function () { c.style.setProperty('--cf-foot', Math.round(f.offsetHeight) + 'px'); });
      if (window.buzz) buzz('select');
    }
    function close() { if (modal) modal.classList.remove('open'); restore(); }
    document.addEventListener('click', function (ev) {
      var c = ev.target.closest && ev.target.closest('#crate-feed .cf-card');
      if (!c) return;
      ev.stopPropagation(); ev.preventDefault();
      open(c);
    }, true);
    return { open: open, close: close };
  })();
  window.CfSheet = CfSheet;

  /* ---- nav badges --------------------------------------------------------------
     Small counts on three tabs, each read from state the app already keeps —
     never a number held here. Zero hides the badge.
       Home     missions finished and not yet claimed (daily_missions_status,
                reported by the Missions module after every render)
       Arcade   today's daily games still to play: Recall, Daily Drop (both
                puzzles), Earworm, Cover Fire's Today's Ten — each only once its
                unlock gate is passed
       Profile  achievements reached and not claimed: album milestones, plus
                discographies whose tracklist is already known locally (no
                request is made to count one) */
  var NavBadges = (function () {
    var counts = {};
    function paint(tab, n) {
      var b = document.querySelector('#modes button[data-mode="' + tab + '"] .nav-badge');
      if (!b) return;
      n = Math.max(0, n | 0);
      var was = counts[tab];
      counts[tab] = n;
      if (!n) { b.hidden = true; b.textContent = ''; return; }
      b.textContent = n > 9 ? '9+' : String(n);
      b.hidden = false;
      var btn = b.parentNode;
      btn.setAttribute('aria-label', (btn.querySelector('.nl') || {}).textContent + ', ' + n + ' waiting');
      if (was !== n) { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
    }
    function rated() {
      try { var al = window.loadAlbums ? loadAlbums() : {}; return Object.keys(al).filter(function (k) { return al[k] && al[k].score != null; }).length; } catch (e) { return 0; }
    }
    function open(gate) {
      var G = window.UnlockGates || {};
      return !G[gate] || rated() >= (G[gate].need || 0);
    }
    function arcade() {
      var n = 0;
      try { if (window.Recall && Recall.dailyDone && !Recall.dailyDone()) n++; } catch (e) {}
      try { if (window.DropDaily && !DropDaily.done()) n++; } catch (e) {}
      try { if (open('ew-card') && window.EarwormDaily && !EarwormDaily.done()) n++; } catch (e) {}
      try { if (open('blitz-card') && window.Blitz && Blitz.dailyDone && !Blitz.dailyDone()) n++; } catch (e) {}
      return n;
    }
    function profile() {
      if (!signedIn() || !window.Wallet || !Wallet.claimedMilestone || !window.__achClaimsLoaded) return 0;
      var n = 0;
      try {
        var all = window.loadAlbums ? loadAlbums() : {}, count = Object.keys(all).length;
        [1, 5, 10, 25, 50, 100, 250, 500].forEach(function (m) { if (count >= m && !Wallet.claimedMilestone('albums:' + m)) n++; });
        var groups = {};
        Object.keys(all).forEach(function (k) {
          var a = all[k]; if (!a || !a.artistId) return;
          var key = (window._artistKey ? _artistKey(a.artist) : '') || a.artistId;
          var g = groups[key] = groups[key] || { id: a.artistId, rated: {} };
          if (/^d+$/.test(String(a.artistId)) && !/^d+$/.test(String(g.id))) g.id = a.artistId;
          if (window.baseAlbumTitle) g.rated[baseAlbumTitle(a.name)] = 1;
        });
        Object.keys(groups).forEach(function (k) {
          var g = groups[k];
          var list = window.studioListFor ? studioListFor(g.id) : null;
          if (!list || !list.length) return;
          var bases = list.map(function (x) { return baseAlbumTitle(x.name); }).filter(Boolean);
          if (bases.length && bases.every(function (b) { return g.rated[b]; }) && !Wallet.claimedMilestone('comp:' + g.id)) n++;
        });
      } catch (e) {}
      return n;
    }
    function refresh() {
      paint('games', arcade());
      paint('profile', profile());
      if (!signedIn()) paint('home', 0);
    }
    var t = 0;
    function soon() { clearTimeout(t); t = setTimeout(refresh, 120); }
    // Claims are read from the server once a session, then kept by Wallet.
    function loadClaims() {
      if (!signedIn() || !window.Wallet || !Wallet.loadClaims) return;
      Wallet.loadClaims().then(function () { window.__achClaimsLoaded = true; refresh(); }).catch(function () {});
    }
    var lastMissions = 0;
    function missions(force) {
      if (!signedIn() || !window.renderMissionsDot) return;
      if (!force && Date.now() - lastMissions < 60000) return;
      lastMissions = Date.now();
      try { renderMissionsDot(); } catch (e) {}
    }
    // The wallet loading is also the first sign that somebody signed in.
    window.addEventListener('vinall:wallet', function () { if (!window.__achClaimsLoaded) loadClaims(); missions(false); soon(); });
    window.addEventListener('vinall:rated', soon);
    window.addEventListener('vinall:badges', soon);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { refresh(); missions(false); } });
    // A game sheet closing is when a daily gets finished.
    document.addEventListener('DOMContentLoaded', function () {
      var mo = new MutationObserver(soon);
      document.querySelectorAll('.modal').forEach(function (m) { mo.observe(m, { attributes: true, attributeFilter: ['class'] }); });
    });
    // The day rolls over at midnight; a minute's lag is fine for a count.
    setInterval(function () { if (!document.hidden) refresh(); }, 60000);
    if (window.Cloud && Cloud.ready) Cloud.ready.then(function () { loadClaims(); missions(true); refresh(); });
    return { set: paint, refresh: refresh, missions: missions, loadClaims: loadClaims, get: function (k) { return counts[k] || 0; } };
  })();
  window.NavBadges = NavBadges;

  /* ---- per-switch hook from setMode ------------------------------------------- */
  /* The last view you were on inside each place, so a tab-bar tap returns to
     it. Somebody else's profile and an album page are never remembered: one
     belongs to another person, the other needs the record it was opened for. */
  var LAST = {};
  var Shell = {
    _pushedFrom: null,
    lastIn: function (place) { return LAST[place] || place; },
    onMode: function (mode) {
      var place = window.navTabFor ? navTabFor(mode) : mode;
      document.body.dataset.place = place;
      if (mode !== 'album-detail' && !(mode === 'profile' && viewingOther())) LAST[place] = mode;
      NavBadges.refresh();
      ensureBars(mode);
      if (PUSHED[mode]) Shell._pushedFrom = Shell._prev; else Shell._pushedFrom = null;
      Shell._prev = mode;
      if (mode === 'profile') profileChrome();
      if (mode === 'people') peopleChrome();
      if (mode === 'about') aboutChrome();
      if (mode === 'rewards') shopChrome();
      if (mode !== 'profile') Menu.close(false);
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
    // The pill springs between tabs from now on; on first paint it just appears.
    requestAnimationFrame(function () { requestAnimationFrame(function () { var n = $('modes'); if (n) n.classList.add('nav-ready'); }); });
    NavBadges.refresh();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  if (window.Cloud && Cloud.ready) Cloud.ready.then(function () { paintGreeting(); if (window.currentMode === 'profile') profileChrome(); });
})();
