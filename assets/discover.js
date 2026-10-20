/* ============================================================================
   Discover — the prompts that show somebody what VINALL can do, at the moment
   it is worth knowing (2026-10-20, reworked 2026-10-21).

   TWO KINDS OF PROMPT.
   - CONTEXTUAL: about something true right now — a reward waiting to be
     claimed, a game that just unlocked, a milestone two albums away, today's
     Recall. Each is keyed by its instance ("milestone:25"), so the same
     milestone is never mentioned twice but the next one can be.
   - INTRODUCTIONS: a feature somebody has not found yet (Passport, About you,
     Community Choice). Shown once, ever, and never for a feature already used.

   HOW OFTEN. A new account (under 15 albums, or under a week since the
   tutorial) is still learning, so it gets up to three a session, at least 70s
   apart, and a fresh batch two hours later. After that: one a session, 18
   hours apart. Rating something can surface a contextual one straight away
   (that is when "2 albums from 25" is true), still inside those caps.

   WHERE. Docked to the right edge, above the nav and the player bar, never
   over For You's rating tray or an open sheet. It arrives, stays nine
   seconds, then tucks into a small glowing tab on the edge that stays for as
   long as you are on that page — tap it to bring the card back. The × retires
   it for good. Leaving the page takes it away.

   State is crate_tips_v1 (crate_ prefix, so an account switch wipes it).
   ========================================================================== */
(function () {
  'use strict';
  var KEY = 'crate_tips_v1', DWELL = 3500, OPEN_MS = 9000;
  function read() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function write(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function lsJSON(k) { try { return JSON.parse(localStorage.getItem(k)) || null; } catch (e) { return null; } }
  function rated() { try { return Object.keys((window.loadAlbums && loadAlbums()) || {}).length; } catch (e) { return 0; } }
  function plays(g) { var l = lsJSON('crate_gamelog_v1') || {}; return (l.plays && l.plays[g]) || 0; }
  function totalPlays() { var l = lsJSON('crate_gamelog_v1') || {}, t = 0; Object.keys(l.plays || {}).forEach(function (k) { t += l.plays[k]; }); return t; }
  function visited(v) { return !!(read().v || {})[v]; }
  function go(v) { if (window.goToView) goToView(v); }
  function icon(name) { return (window.ICONS && ICONS[name]) || ''; }
  function n(x) { return Number(x || 0).toLocaleString('en-GB'); }
  function milestones() { try { return typeof MILESTONES !== 'undefined' ? MILESTONES : []; } catch (e) { return []; } }
  function pay(m) { try { return typeof MILESTONE_PAY !== 'undefined' ? MILESTONE_PAY[m] : 0; } catch (e) { return 0; } }
  function rateSomething() {
    var i = document.getElementById('search-input');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (i) setTimeout(function () { try { i.focus(); } catch (e) {} }, 320);
  }
  function newbie() {
    var o = lsJSON('crate_onboard_v1') || {};
    return rated() < 15 || (o.at && Date.now() - o.at < 7 * 864e5);
  }

  /* Each source returns zero or more prompts; the first eligible one wins, so
     the order is the priority. `id` is the instance; `where` limits views. */
  var SOURCES = [
    // A reward is sitting there. Claims only load once Wallet has them.
    function claim() {
      var W = window.Wallet;
      if (!W || !W.claimedMilestone || !W._claimsLoaded) return [];
      var c = rated(), out = [];
      milestones().forEach(function (m) {
        if (c >= m && !W.claimedMilestone('albums:' + m)) out.push({
          id: 'claim:' + m, ctx: 1, hue: 'var(--gold)', ico: 'medal',
          kicker: 'Reward waiting', title: (m === 1 ? 'First album' : m + ' albums') + ' · ' + n(pay(m)) + ' Discs',
          cta: 'Claim', act: function () { go('achievements'); } });
      });
      return out.slice(-1);
    },
    // A game opened because of what you rated.
    function unlocked() {
      var G = window.UnlockGates || {}, c = rated(), out = [];
      Object.keys(G).forEach(function (k) {
        var g = G[k];
        if (g.need > 0 && c >= g.need && c - g.need <= 6) out.push({
          id: 'unlock:' + k, ctx: 1, hue: 'var(--c-violet)', ico: 'trophy',
          kicker: 'Unlocked', title: g.label + ' is open',
          cta: 'Play', act: function () { go('games'); } });
      });
      return out;
    },
    // Close enough to taste.
    function near() {
      var c = rated(), m = milestones().filter(function (x) { return x > c; })[0];
      if (!m || m - c > 3 || m > 100) return [];
      var left = m - c;
      return [{ id: 'near:' + m, ctx: 1, hue: 'var(--c-cyan)', ico: 'disc', where: ['home', 'crate', 'albums', 'songs', 'profile'],
        kicker: left + (left === 1 ? ' album to go' : ' albums to go'), title: m + ' albums pays ' + n(pay(m)) + ' Discs',
        cta: 'Rate one', act: rateSomething }];
    },
    function recall() {
      if (!window.Recall || !Recall.dailyDone || Recall.dailyDone()) return [];
      return [{ id: 'recall:' + (Recall.dayNo ? Recall.dayNo() : 0), ctx: 1, hue: 'var(--c-blue)', ico: 'wave',
        where: ['home', 'crate', 'albums', 'songs', 'profile', 'rewards', 'collection'],
        kicker: 'Today’s Recall', title: 'One second. Name the song.', cta: 'Play',
        act: function () { go('games'); setTimeout(function () { if (window.openRecall) openRecall(); }, 250); } }];
    },
    function intros() {
      var c = rated(), out = [];
      if (window.Native && Native.on && window.Reminders && !Reminders.isOn() && plays('recall') >= 1) out.push({
        id: 'reminders', hue: 'var(--gold)', ico: 'bell', where: ['games', 'home'],
        kicker: 'Reminders', title: 'A nudge when the new song drops?', cta: 'Turn on',
        act: function () {
          Reminders.requestPermission().then(function (ok) {
            if (ok) Reminders.setOn(true);
            if (window.toast) toast(ok ? 'Reminders on' : 'Notifications are off for VINALL in Settings');
          });
        } });
      if (c >= 3 && !visited('foryou')) out.push({ id: 'foryou', hue: 'var(--c-pink)', ico: 'sparkle',
        kicker: 'For You', title: 'Songs picked from your ratings', cta: 'Listen', act: function () { go('foryou'); } });
      if (totalPlays() < 2 && !visited('games')) out.push({ id: 'arcade', hue: 'var(--c-violet)', ico: 'trophy',
        kicker: 'Arcade', title: 'Eleven music games', cta: 'Play', act: function () { go('games'); } });
      if (c >= 25 && !plays('bidwar')) out.push({ id: 'bidwar', hue: 'var(--c-pink)', ico: 'trophy',
        kicker: 'Bid Wars', title: 'Challenge a friend', cta: 'Start one', act: function () { go('wars'); } });
      if (c >= 1 && document.getElementById('dm-toggle')) out.push({ id: 'missions', hue: 'var(--gold)', ico: 'check', where: ['home'],
        kicker: 'Daily missions', title: 'Three goals, every day', cta: 'Show me',
        act: function () { var t = document.getElementById('dm-toggle'); if (t) { window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(function () { t.click(); }, 300); } } });
      if (c >= 8 && !visited('passport')) out.push({ id: 'passport', hue: 'var(--c-lime)', ico: 'wave',
        kicker: 'Music Passport', title: 'See where your music is from', cta: 'Open', act: function () { go('passport'); } });
      if (c >= 10 && !visited('about')) out.push({ id: 'about', hue: 'var(--c-violet)', ico: 'person',
        kicker: 'About you', title: 'What your ratings say', cta: 'Read it', act: function () { go('about'); } });
      if (c >= 5 && !visited('choice')) out.push({ id: 'choice', hue: 'var(--c-cyan)', ico: 'mic',
        kicker: 'Community Choice', title: 'The best moments in songs', cta: 'Listen', act: function () { go('choice'); } });
      var sp = lsJSON('crate_spotify_v1') || {};
      if (sp.imported && Object.keys(sp.imported).length && !visited('yourmusic')) out.push({ id: 'yourmusic', hue: '#1ed760', ico: 'note',
        kicker: 'Your music', title: 'Rate what you play on Spotify', cta: 'Start', act: function () { go('yourmusic'); } });
      return out;
    }
  ];
  var NEVER = { foryou: 1, 'album-detail': 1 };   // a rating tray or a record is the page

  var count = 0, lastAt = 0, timer = 0, openT = 0, node = null, cur = null;
  function caps() { return newbie() ? { per: 3, gap: 2 * 3600e3, between: 70e3 } : { per: 1, gap: 18 * 3600e3, between: 0 }; }
  function pick(mode, ctxOnly) {
    if (!window.Cloud || !Cloud.isOn || !Cloud.isOn()) return null;
    var onb = lsJSON('crate_onboard_v1');
    if (onb && !onb.done) return null;
    if (NEVER[mode]) return null;
    var c = caps(), s = read();
    if (count >= c.per) return null;
    if (!count && s.last && Date.now() - s.last < c.gap) return null;
    if (count && Date.now() - lastAt < c.between) return null;
    var done = s.d || {};
    for (var i = 0; i < SOURCES.length; i++) {
      var list = [];
      try { list = SOURCES[i]() || []; } catch (e) {}
      for (var j = 0; j < list.length; j++) {
        var t = list[j];
        if (done[t.id] || (ctxOnly && !t.ctx)) continue;
        if (t.where && t.where.indexOf(mode) === -1) continue;
        return t;
      }
    }
    return null;
  }
  function retire(id, how) { var s = read(); s.d = s.d || {}; s.d[id] = how || 1; write(s); }
  function busy() { return !!document.querySelector('.modal.open, .activity.open, .onb.open, .celebrate.show, .lvl-pop'); }

  function remove() {
    clearTimeout(openT);
    if (!node) return;
    var nd = node; node = null; cur = null;
    nd.classList.add('out');
    setTimeout(function () { if (nd.parentNode) nd.parentNode.removeChild(nd); }, 320);
  }
  function tuck() { if (node) node.classList.add('tucked'); }
  function expand() {
    if (!node) return;
    node.classList.remove('tucked');
    clearTimeout(openT); openT = setTimeout(tuck, OPEN_MS);
  }
  function show(t) {
    if (node || busy()) return;
    count++; lastAt = Date.now();
    var s = read(); s.last = lastAt; write(s);
    retire(t.id, 'shown');
    cur = t;
    node = document.createElement('aside');
    node.className = 'vx-tip';
    node.setAttribute('role', 'status');
    node.style.setProperty('--vx', t.hue);
    node.innerHTML =
      '<button class="vx-tab" aria-label="' + esc(t.kicker) + '"><span class="vx-ico" aria-hidden="true">' + icon(t.ico) + '</span></button>' +
      '<div class="vx-card"><span class="vx-ico" aria-hidden="true">' + icon(t.ico) + '</span>' +
        '<span class="vx-t"><span class="vx-k">' + esc(t.kicker) + '</span><b>' + esc(t.title) + '</b></span>' +
        '<button class="vx-go">' + esc(t.cta) + '</button><button class="vx-x" aria-label="Dismiss">×</button></div>';
    node.querySelector('.vx-tab').addEventListener('click', function () { expand(); if (window.buzz) buzz('tap'); });
    node.querySelector('.vx-go').addEventListener('click', function () {
      retire(t.id, 'acted'); remove(); if (window.buzz) buzz('tap');
      try { t.act(); } catch (e) {}
      if (window.track) track('tip_acted', { id: t.id });
    });
    node.querySelector('.vx-x').addEventListener('click', function () {
      retire(t.id, 'dismissed'); remove();
      if (window.track) track('tip_dismissed', { id: t.id });
    });
    document.body.appendChild(node);
    if (window.Sfx) Sfx.play('discover');
    if (window.buzz) buzz('tap', true);
    if (window.track) track('tip_shown', { id: t.id });
    openT = setTimeout(tuck, OPEN_MS);
  }
  function consider(mode, ctxOnly, delay) {
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (document.hidden || document.body.dataset.section !== mode || node) return;
      var t = pick(mode, ctxOnly);
      if (t) show(t);
    }, delay);
  }
  function onView(mode) {
    if (mode) { var s = read(); s.v = s.v || {}; if (!s.v[mode]) { s.v[mode] = 1; write(s); } }
    // Leaving the page takes the prompt with it: it was about where you were.
    if (node) remove();
    consider(mode, false, DWELL);
  }
  new MutationObserver(function () { onView(document.body.dataset.section); })
    .observe(document.body, { attributes: true, attributeFilter: ['data-section'] });
  // Rating is the moment "2 albums from 25" and "Earworm is open" become true.
  window.addEventListener('vinall:rated', function () { if (!node) consider(document.body.dataset.section, true, 2600); });
  // Not straight on top of the tutorial's own ending.
  window.addEventListener('vinall:onboarded', function () { lastAt = Date.now(); count = Math.max(count, 0); });
  // Claims are a server read; load them once so "reward waiting" is honest.
  function loadClaims() {
    if (window.Wallet && Wallet.loadClaims && window.Cloud && Cloud.isOn && Cloud.isOn())
      Wallet.loadClaims().then(function () { Wallet._claimsLoaded = true; }).catch(function () {});
  }
  if (window.Cloud && Cloud.ready) Cloud.ready.then(loadClaims); else setTimeout(loadClaims, 4000);
  setTimeout(function () { onView(document.body.dataset.section); }, 5000);

  window.Discover = {
    sources: SOURCES, pick: pick,
    show: function (id) {
      var all = []; SOURCES.forEach(function (f) { try { all = all.concat(f() || []); } catch (e) {} });
      var t = all.filter(function (x) { return x.id === id || x.id.split(':')[0] === id; })[0];
      if (t) { remove(); count = 0; show(t); }
    },
    reset: function () { write({}); count = 0; lastAt = 0; }
  };
})();
