/* RocketRun in the Arcade: the featured card and the full-screen sheet.
 *
 * The game is its own document (arcade/rocketrun/, the prototype's renderer
 * kept whole) framed same-origin, so its canvas, global styles and listeners
 * never touch this page. It reaches back for the session (Cloud.client), the
 * auth sheet, the leaderboard (Boards), the wallet and the share sheet, and
 * calls RocketRunHost.close() to leave. The frame is created on open and
 * thrown away on close, which stops the render loop and the sound outright.
 *
 * The sheet is a `.modal`, so hardware Back and the iOS edge swipe close it
 * like every other sheet. Nothing is lost by leaving: every answer is saved
 * on the server the moment it lands.
 */
(function () {
  'use strict';
  var SRC = 'arcade/rocketrun/index.html?v=2';
  var KEY = 'crate_rocketrun_v1';     // crate_: wiped with the rest on an account switch
  var sheet, frame, card;

  function day() { return Math.floor((Date.now() - Date.UTC(2020, 0, 1)) / 86400000); }
  function fmt(n) { return Math.round(n || 0).toLocaleString('en-GB'); }
  function read() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }

  function build() {
    sheet = document.createElement('div');
    sheet.id = 'rocketrun-sheet';
    sheet.className = 'modal rrh-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'RocketRun');
    document.body.appendChild(sheet);
    if (window.__watchLayer) window.__watchLayer(sheet);
    new MutationObserver(function () { if (!sheet.classList.contains('open')) teardown(); })
      .observe(sheet, { attributes: true, attributeFilter: ['class'] });
  }
  function teardown() {
    if (!frame) return;
    try { frame.contentWindow.dispatchEvent(new Event('pagehide')); } catch (e) {}
    frame.remove(); frame = null;
    document.documentElement.classList.remove('rrh-on');
    paintCard();
  }
  function open() {
    if (!sheet) build();
    if (frame) { sheet.classList.add('open'); return; }
    frame = document.createElement('iframe');
    frame.title = 'RocketRun';
    frame.src = SRC;
    frame.setAttribute('allow', 'autoplay; clipboard-write');
    sheet.appendChild(frame);
    sheet.classList.add('open');
    document.documentElement.classList.add('rrh-on');
    try { if (window.track) track('game_open', { game: 'rocketrun' }); } catch (e) {}
    setTimeout(function () { try { frame.focus(); } catch (e) {} }, 60);
  }
  function close() { if (sheet) sheet.classList.remove('open'); }

  /* The game says how today went; the card shows it without a round trip. */
  function note(s) {
    try { localStorage.setItem(KEY, JSON.stringify({ day: s.day, total: s.total, done: !!s.finished, streak: s.streak || 0, n: (s.answers || []).length })); } catch (e) {}
  }
  function paintCard() {
    if (!card) return;
    var st = card.querySelector('.gc-best'), go = card.querySelector('.gc-go');
    var s = read(), today = s && s.day === day();
    if (go) go.innerHTML = today && s.done ? 'See today&rsquo;s flight &rarr;' : today && s.n ? 'Carry on today&rsquo;s run &rarr;' : 'Launch today&rsquo;s run &rarr;';
    if (st) st.textContent = today && s.done ? fmt(s.total) + ' m today' + (s.streak > 1 ? ' · streak ' + s.streak : '')
      : s && s.streak && s.day === day() - 1 ? 'Streak ' + s.streak + ' · keep it going' : '';
    card.classList.toggle('rrh-done', !!(today && s.done));
  }

  function wire() {
    card = document.getElementById('rocketrun-card');
    if (!card) return;
    card.setAttribute('role', 'button'); card.tabIndex = 0;
    card.addEventListener('click', open);
    card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    paintCard();
    document.addEventListener('visibilitychange', paintCard);
    if (/[#&?]rocketrun\b/.test(location.hash + location.search)) setTimeout(open, 400);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();

  window.RocketRunHost = { open: open, close: close, note: note, paint: paintCard,
    done: function () { var s = read(); return !!(s && s.day === day() && s.done); } };
})();
