/* ============================================================================
   Liked songs — VINALL's own hearts, as a place in the Crate (2026-10-24).

   THE STORE IS NOT HERE. crate_liked_songs_v1 and toggleLikedSong() live in
   index.html beside the shortlist: local, in SYNC_KEYS, merged per item, with
   an unlike written as a tombstone so it syncs (see the note there). This file
   is the view (view-liked, a Crate sub-tab), the one heart every list uses,
   and the occasional reminder.

   Nothing here touches Spotify or Deezer. A like is a fact about you in
   VINALL; the Spotify import can ADD likes, but nothing is ever sent back.

   - The heart is delegated on the document, so a list that rebuilds its rows
     (the Crate's songs on every rating, sort and merge) never strands one.
   - Unliking from this list leaves the row in place, dimmed, until you leave:
     a row that vanished under your thumb is a like you cannot take back with
     the same tap. The next render drops it.
   - The reminder is a Discover prompt (assets/discover.js), so it inherits
     that module's caps — one prompt a session, 18 hours apart — and adds its
     own: three or more likes, the list not opened for a fortnight, at most
     once every three weeks, and never again after two dismissals.
   ========================================================================== */
(function () {
  'use strict';
  var SEEN_KEY = 'crate_liked_seen_v1';   // crate_: an account switch wipes it
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function live() { return window.loadLikedSongs ? loadLikedSongs() : {}; }
  function sorted() {
    var L = live();
    return Object.keys(L).map(function (k) { return L[k]; })
      .sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
  }
  function thumbOf(u, px) { return window.thumb ? thumb(u, px) : u; }

  var HEART = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M12 20.6s-7.6-4.5-10.2-9C.3 8.6 1 5.4 3.7 4.1c2-.9 4.3-.3 5.7 1.4l2.6 3.1 2.6-3.1c1.4-1.7 3.7-2.3 5.7-1.4 2.7 1.3 3.4 4.5 1.9 7.5-2.6 4.5-10.2 9-10.2 9Z"/></svg>';

  /* One heart for every list. The song's own fields ride on the button, so a
     tap needs no lookup into whichever list drew it. */
  function heart(s) {
    if (!s || !s.id) return '';
    var on = window.likedSongHas && likedSongHas(s.id, s.name, s.artist);
    return '<button type="button" class="song-like lk-heart' + (on ? ' liked' : '') + '" data-lk="' + esc(s.id) + '"' +
      ' data-lk-name="' + esc(s.name || '') + '" data-lk-artist="' + esc(s.artist || '') + '" data-lk-art="' + esc(s.art || '') + '"' +
      ' aria-pressed="' + (on ? 'true' : 'false') + '" aria-label="' + (on ? 'Unlike ' : 'Like ') + esc(s.name || 'this song') + '">' + HEART + '</button>';
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-lk]');
    if (!b || !window.toggleLikedSong) return;
    e.preventDefault(); e.stopPropagation();
    var on = toggleLikedSong({ id: b.dataset.lk, name: b.dataset.lkName, artist: b.dataset.lkArtist, art: b.dataset.lkArt });
    paintHeart(b, on);
    var row = b.closest('.lk-row');
    if (row) row.classList.toggle('lk-off', !on);
    if (on) { b.classList.remove('just-liked'); void b.offsetWidth; b.classList.add('just-liked'); if (window.buzz) buzz('good'); }
    else if (window.buzz) buzz('tap');
    if (document.body.dataset.section === 'liked') paintTitle();
  });
  function paintHeart(b, on) {
    b.classList.toggle('liked', !!on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.setAttribute('aria-label', (on ? 'Unlike ' : 'Like ') + (b.dataset.lkName || 'this song'));
  }
  /* A like made on another screen (For You, an album page) shows on any heart
     for the same song that is already drawn — there is never a stale one. */
  window.addEventListener('vinall:liked', function () {
    document.querySelectorAll('[data-lk]').forEach(function (b) {
      if (b.closest('.lk-row')) return;     // the list keeps its own state until re-rendered
      paintHeart(b, window.likedSongHas && likedSongHas(b.dataset.lk, b.dataset.lkName, b.dataset.lkArtist));
    });
  });

  function paintTitle() {
    var t = document.getElementById('liked-title');
    var n = Object.keys(live()).length;
    if (t) t.textContent = n ? 'Liked songs · ' + n : 'Liked songs';
  }

  function render() {
    var host = document.getElementById('liked-list'), empty = document.getElementById('liked-empty');
    if (!host) return;
    try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch (e) {}
    var list = sorted();
    paintTitle();
    if (!list.length) { host.innerHTML = ''; if (empty) empty.style.display = 'block'; return; }
    if (empty) empty.style.display = 'none';
    host.innerHTML = list.map(function (s) {
      return '<div class="song-row lk-row">' +
        (s.art ? '<img src="' + esc(thumbOf(s.art, 160)) + '" alt="" decoding="async" loading="lazy" onerror="this.style.visibility=\'hidden\'">'
               : '<span class="lk-noart" aria-hidden="true"></span>') +
        '<div class="song-meta"><div class="song-name">' + esc(s.name) + '</div>' +
        '<div class="song-sub">' + esc(s.artist) + '</div></div>' +
        '<div class="song-rate">' +
          '<button class="sr-play" data-crateplay="' + esc(s.id) + '" aria-label="Play a preview of ' + esc(s.name) + '"></button>' +
          heart(s) +
        '</div></div>';
    }).join('');
  }

  // Merged in from another device while the list is on screen.
  window.addEventListener('storage', function (e) {
    if (e.key === 'crate_liked_songs_v1' && document.body.dataset.section === 'liked') render();
  });

  /* ---- the reminder --------------------------------------------------------
     Keyed by a three-week bucket, so each instance is shown once and the next
     can come along weeks later. Shown where somebody is browsing, never inside
     a game or on For You (discover.js already keeps it off For You). */
  var BUCKET = 21 * 864e5, QUIET = 14 * 864e5;
  function tips() { try { return JSON.parse(localStorage.getItem('crate_tips_v1')) || {}; } catch (e) { return {}; } }
  function reminder() {
    var n = Object.keys(live()).length;
    if (n < 3) return [];
    var seen = +(localStorage.getItem(SEEN_KEY) || 0);
    if (seen && Date.now() - seen < QUIET) return [];
    var d = tips().d || {}, no = 0;
    Object.keys(d).forEach(function (k) { if (k.indexOf('liked:') === 0 && d[k] === 'dismissed') no++; });
    if (no >= 2) return [];
    return [{ id: 'liked:' + Math.floor(Date.now() / BUCKET), ctx: 1, hue: 'var(--c-pink)', ico: 'heart',
      where: ['home', 'crate', 'albums', 'songs', 'profile', 'collection'],
      kicker: 'Found something good?', title: 'Your liked songs are waiting in Crate.',
      cta: 'Open', act: function () { if (window.goToView) goToView('liked'); } }];
  }
  function hook() {
    if (window.Discover && Discover.sources && Discover.sources.indexOf(reminder) === -1) {
      // After the contextual ones (rewards, unlocks, today's Recall), before
      // the one-off introductions.
      var at = Math.max(0, Discover.sources.length - 1);
      Discover.sources.splice(at, 0, reminder);
    }
  }
  if (window.Discover) hook(); else document.addEventListener('DOMContentLoaded', hook);

  window.LikedSongs = { render: render, heart: heart, count: function () { return Object.keys(live()).length; }, reminder: reminder };
})();
