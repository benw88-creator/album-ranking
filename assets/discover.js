/* ============================================================================
   Discover — "check it out" prompts that introduce a feature at the moment it
   is worth knowing about (2026-10-20).

   The rules are what keep this from being an advert:
   - Nothing before onboarding is finished, and nothing for a signed-out visitor.
   - ONE prompt a session, and none within 18 hours of the last one.
   - Each prompt is shown once, ever. Acting on it or dismissing it retires it.
   - A prompt for a feature somebody already uses is never shown: playing
     Recall retires the Recall prompt, visiting a view retires that view's.
   - It waits for a calm moment: on a page for a few seconds, no sheet open,
     not mid-scroll in For You. It leaves by itself after 12 seconds.

   State is crate_tips_v1 (crate_ prefix, so an account switch wipes it with
   the rest of the account's local state). Not synced: a prompt seen on a phone
   being offered again on a laptop is harmless; the cap keeps it quiet.
   ========================================================================== */
(function () {
  'use strict';
  var KEY = 'crate_tips_v1', GAP = 18 * 3600 * 1000, DWELL = 4500, LIFE = 12000;
  function read() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function write(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function lsJSON(k) { try { return JSON.parse(localStorage.getItem(k)) || null; } catch (e) { return null; } }
  function rated() { try { return Object.keys((window.loadAlbums && loadAlbums()) || {}).length; } catch (e) { return 0; } }
  function plays(g) { var l = lsJSON('crate_gamelog_v1') || {}; return (l.plays && l.plays[g]) || 0; }
  function visited(v) { return !!(read().v || {})[v]; }
  function go(v) { if (window.goToView) goToView(v); }
  function icon(name) { return (window.ICONS && ICONS[name]) || ''; }

  /* In priority order: the first eligible one wins. `where` limits a prompt to
     the views it makes sense on (null = anywhere but For You). */
  var TIPS = [
    /* The notification ask lives here, not on launch: it is offered once,
       native only, after somebody has played Recall — the moment a nudge for
       tomorrow's song means something. Permission asked cold is permission
       denied for good. */
    { id: 'reminders', hue: 'var(--gold)', ico: 'bell', where: ['games', 'home'],
      kicker: 'Reminders', title: 'A nudge when tomorrow’s song drops?', sub: 'Recall at noon and your streak at 8pm. Change it in Settings.',
      cta: 'Turn on', when: function () { return window.Native && Native.on && window.Reminders && !Reminders.isOn() && plays('recall') >= 1; },
      act: function () {
        Reminders.requestPermission().then(function (ok) {
          if (ok) Reminders.setOn(true);
          if (window.toast) toast(ok ? 'Reminders on' : 'Notifications are off for VINALL in Settings');
        });
      } },
    { id: 'recall-daily', hue: 'var(--c-blue)', ico: 'disc', where: ['home', 'crate', 'albums', 'songs'],
      kicker: 'Today’s Recall', title: 'One second of a song. Name it.', sub: 'Same song for everybody, one go a day.',
      cta: 'Play', when: function () { return window.Recall && Recall.dailyDone && !Recall.dailyDone() && plays('recall') < 2; },
      act: function () { go('games'); setTimeout(function () { if (window.openRecall) openRecall(); }, 250); } },
    { id: 'foryou', hue: 'var(--c-pink)', ico: 'sparkle', where: ['home', 'crate', 'albums'],
      kicker: 'For You', title: 'Songs picked from your ratings.', sub: 'Thirty seconds each. Scroll, listen, score.',
      cta: 'Open', when: function () { return rated() >= 3 && !visited('foryou'); }, act: function () { go('foryou'); } },
    { id: 'arcade', hue: 'var(--c-violet)', ico: 'trophy', where: ['home', 'crate', 'albums', 'songs', ],
      kicker: 'Arcade', title: 'Eleven games built on your records.', sub: 'Daily puzzles, quick rounds and head to heads.',
      cta: 'Play', when: function () { var l = lsJSON('crate_gamelog_v1') || {}, t = 0; Object.keys(l.plays || {}).forEach(function (k) { t += l.plays[k]; }); return t < 3 && !visited('games'); },
      act: function () { go('games'); } },
    { id: 'missions', hue: 'var(--gold)', ico: 'check', where: ['home'],
      kicker: 'Daily missions', title: 'Three small goals, every day.', sub: 'Each one pays Discs.',
      cta: 'Show me', when: function () { return !!document.getElementById('dm-toggle') && rated() >= 1; },
      act: function () { var t = document.getElementById('dm-toggle'); if (t) { window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(function () { t.click(); }, 300); } } },
    { id: 'choice', hue: 'var(--c-cyan)', ico: 'mic', where: ['crate', 'albums', 'songs'],
      kicker: 'Community Choice', title: 'The best verse, hook and beat drop.', sub: 'Pick a moment in a song; everybody hears exactly that bit.',
      cta: 'Listen', when: function () { return rated() >= 5 && !visited('choice'); }, act: function () { go('choice'); } },
    { id: 'yourmusic', hue: '#1ed760', ico: 'note', where: ['home', 'profile'],
      kicker: 'Your music', title: 'Rate what you play on Spotify.', sub: 'Your imported songs, thirty seconds at a time.',
      cta: 'Start', when: function () { var s = lsJSON('crate_spotify_v1') || {}; return !!(s.imported && Object.keys(s.imported).length) && !visited('yourmusic'); },
      act: function () { go('yourmusic'); } },
    { id: 'passport', hue: 'var(--c-lime)', ico: 'wave', where: ['home', 'profile', 'albums'],
      kicker: 'Music Passport', title: 'Where in the world your music is from.', sub: 'A stamp for every country your artists come from.',
      cta: 'Open', when: function () { return rated() >= 10 && !visited('passport'); }, act: function () { go('passport'); } },
    { id: 'about', hue: 'var(--c-violet)', ico: 'person', where: ['home', 'profile', 'albums'],
      kicker: 'About you', title: 'What your ratings say about you.', sub: 'Your taste, scored on six dimensions.',
      cta: 'Read it', when: function () { return rated() >= 10 && !visited('about'); }, act: function () { go('about'); } }
  ];

  var shown = false, timer = 0, lifeT = 0, node = null;
  function eligible(mode) {
    if (!window.Cloud || !Cloud.isOn || !Cloud.isOn()) return null;
    var onb = lsJSON('crate_onboard_v1');
    if (onb && !onb.done) return null;
    if (document.getElementById('onb') && document.getElementById('onb').classList.contains('open')) return null;
    var s = read();
    if (s.last && Date.now() - s.last < GAP) return null;
    var done = s.d || {};
    for (var i = 0; i < TIPS.length; i++) {
      var t = TIPS[i];
      if (done[t.id]) continue;
      if (t.where && t.where.indexOf(mode) === -1) continue;
      try { if (!t.when()) continue; } catch (e) { continue; }
      return t;
    }
    return null;
  }
  function retire(id, how) {
    var s = read(); s.d = s.d || {}; s.d[id] = how || 1; write(s);
  }
  function hide() {
    clearTimeout(lifeT);
    if (!node) return;
    var n = node; node = null;
    n.classList.add('out');
    setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 300);
  }
  function show(t) {
    if (shown || node) return;
    if (document.querySelector('.modal.open, .activity.open, .onb.open, .celebrate.show, .celebrate.open')) return;
    shown = true;
    var s = read(); s.last = Date.now(); write(s);
    retire(t.id, 'shown');
    node = document.createElement('div');
    node.className = 'vx-tip';
    node.setAttribute('role', 'status');
    node.style.setProperty('--vx', t.hue);
    node.innerHTML = '<span class="vx-ico" aria-hidden="true">' + icon(t.ico) + '</span>' +
      '<span class="vx-t"><span class="vx-k">' + esc(t.kicker) + '</span><b>' + esc(t.title) + '</b><small>' + esc(t.sub) + '</small></span>' +
      '<button class="vx-go">' + esc(t.cta) + '</button><button class="vx-x" aria-label="Dismiss">×</button>';
    node.querySelector('.vx-go').addEventListener('click', function () { retire(t.id, 'acted'); hide(); if (window.buzz) buzz('tap'); try { t.act(); } catch (e) {} if (window.track) track('tip_acted', { id: t.id }); });
    node.querySelector('.vx-x').addEventListener('click', function () { retire(t.id, 'dismissed'); hide(); if (window.track) track('tip_dismissed', { id: t.id }); });
    document.body.appendChild(node);
    if (window.buzz) buzz('tap');
    if (window.track) track('tip_shown', { id: t.id });
    lifeT = setTimeout(hide, LIFE);
  }
  function onView(mode) {
    if (mode) { var s = read(); s.v = s.v || {}; if (!s.v[mode]) { s.v[mode] = 1; write(s); } }
    // Leaving the page takes the prompt with it: it was about where you were.
    if (node) hide();
    clearTimeout(timer);
    if (shown) return;
    timer = setTimeout(function () {
      if (document.hidden || document.body.dataset.section !== mode) return;
      var t = eligible(mode);
      if (t) show(t);
    }, DWELL);
  }
  new MutationObserver(function () { onView(document.body.dataset.section); })
    .observe(document.body, { attributes: true, attributeFilter: ['data-section'] });
  window.addEventListener('vinall:onboarded', function () { shown = true; });   // not straight after the tutorial
  // The first view of a launch is counted once the session has settled.
  setTimeout(function () { onView(document.body.dataset.section); }, 6000);

  window.Discover = { _tips: TIPS, eligible: eligible, show: function (id) { var t = TIPS.filter(function (x) { return x.id === id; })[0]; if (t) { shown = false; show(t); } }, reset: function () { write({}); shown = false; } };
})();
