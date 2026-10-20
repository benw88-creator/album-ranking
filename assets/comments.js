/* ================================================================
   SONG COMMENTS — For You's comment layer (window.SongComments).

   One thread per SONG, keyed by the feed's `skey` (artist|title), so a
   legacy id and a Deezer id land on the same conversation. Comments belong
   to the SONG, never to a second of it: the audio is a 30-second preview, so
   "at 0:14" pointed at a moment most people will never hear. Older rows that
   carry at_ms keep it in the table; nothing here reads it. The card shows
   the thread's best comment as one quiet line under the sleeve.

   The server (song_comment_add, ..._20261014140000_song_comments.sql) is the
   safeguard; the checks here only give instant, friendly answers. Every
   string reaches the DOM through esc() or textContent — nothing user-written
   is ever parsed as HTML.
   ================================================================ */
(function () {
  'use strict';
  var MAX = 280;
  var _cache = {};            // skey -> { at, rows, profs, liked }
  var _active = null;         // { card, item }
  var _sheet = null, _sort = 'top', _sending = false;
  var _off = false;           // migration missing → stay quiet

  function $(s, r) { return (r || document).querySelector(s); }
  function e(s) { return window.esc ? esc(s) : String(s || '').replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function sb() { return window.Cloud && Cloud.client ? Cloud.client() : null; }
  function me() { return window.Cloud && Cloud.getUser ? Cloud.getUser() : null; }
  function ago(iso) { return window.timeAgo ? timeAgo(new Date(iso).getTime()) : ''; }
  function reduced() { return window.motionReduced ? motionReduced() : matchMedia('(prefers-reduced-motion: reduce)').matches; }

  /* Strong swearing is softened on display, not refused: this is a music app
     and a lyric quoted back is not abuse. Slurs and targeted abuse never get
     this far — the server refuses them. */
  var SOFT = /\b(f+u+c+k+\w*|c+u+n+t+s?|b+i+t+c+h+\w*|w+h+o+r+e+s?|s+l+u+t+s?)\b/gi;
  function soften(s) { return String(s).replace(SOFT, function (w) { return w[0] + '•'.repeat(Math.max(2, w.length - 1)); }); }

  var REASONS = {
    not_signed_in: 'Log in to comment.', too_short: 'Say a little more.', too_long: 'Keep it under 280 characters.',
    blocked_words: 'That comment breaks the community rules.', no_links: 'Links aren’t allowed in comments.',
    spam: 'That looks like spam.', slow_down: 'Slow down a little — try again in a minute.',
    daily_limit: 'That’s today’s comment limit reached.', duplicate: 'You’ve already posted that.', bad_key: 'Can’t comment on this one.'
  };
  function reasonOf(err) {
    var m = String(err && (err.message || err) || '');
    for (var k in REASONS) if (m.indexOf(k) !== -1) return REASONS[k];
    if (/song_comment|does not exist|schema cache/i.test(m)) return 'Comments aren’t switched on yet.';
    return 'Couldn’t post that. Try again.';
  }
  // Mirror of the obvious server rules, so a normal person never waits on a round trip to hear "no".
  function precheck(body) {
    if (body.length < 2) return REASONS.too_short;
    if (body.length > MAX) return REASONS.too_long;
    if (/(https?:\/\/|www\.|discord\.gg|t\.me\/)/i.test(body)) return REASONS.no_links;
    if (/(.)\1{9,}/.test(body)) return REASONS.spam;
    if (window.hasSlur && hasSlur(body)) return REASONS.blocked_words;
    return '';
  }

  /* ---- data --------------------------------------------------------- */
  async function load(key, force) {
    var c = _cache[key];
    if (c && !force && Date.now() - c.at < 60000) return c;
    var client = sb();
    if (!client || _off) return { at: Date.now(), rows: [], profs: {}, liked: {} };
    var res = await client.from('song_comments').select('id,user_id,body,likes,created_at,hidden')
      .eq('song_key', key).order('created_at', { ascending: false }).limit(200);
    if (res.error) {
      if (/does not exist|schema cache|relation/i.test(res.error.message || '')) _off = true;
      return { at: Date.now(), rows: [], profs: {}, liked: {}, error: true };
    }
    try { if (window.loadBlocks) await loadBlocks(); } catch (x) {}
    var rows = (res.data || []).filter(function (r) { return !(window.isBlocked && isBlocked(r.user_id)); });
    var ids = rows.map(function (r) { return r.user_id; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
    var profs = {}, liked = {};
    if (ids.length) {
      var p = await client.from('profiles').select('id,username,avatar_url').in('id', ids);
      (p.data || []).forEach(function (x) { profs[x.id] = x; });
    }
    var u = me();
    if (u && rows.length) {
      var l = await client.from('song_comment_likes').select('comment_id').eq('user_id', u.id).in('comment_id', rows.map(function (r) { return r.id; }));
      (l.data || []).forEach(function (x) { liked[x.comment_id] = 1; });
    }
    c = _cache[key] = { at: Date.now(), rows: rows, profs: profs, liked: liked };
    return c;
  }

  /* ---- the card: count + the thread's best line ------------------- */
  // Most-liked visible comment, newest breaking ties (rows arrive newest first).
  function best(rows) {
    var top = null;
    rows.forEach(function (r) { if (!r.hidden && (!top || (r.likes || 0) > (top.likes || 0))) top = r; });
    return top;
  }
  function paintCard(card, data) {
    if (!card) return;
    var n = data.rows.length, cnt = card.querySelector('.fy-cmt-n');
    if (cnt) cnt.textContent = n ? (n > 999 ? Math.round(n / 100) / 10 + 'k' : String(n)) : '';
    var peek = card.querySelector('.fy-peek');
    if (!peek) return;
    var r = best(data.rows);
    if (!r) { peek.classList.remove('on'); peek.hidden = true; return; }
    var pr = data.profs[r.user_id], name = pr ? pr.username : 'someone';
    peek.innerHTML = (pr && pr.avatar_url ? '<img src="' + e(pr.avatar_url) + '" alt="" loading="lazy" onerror="this.remove()">' : '') +
      '<b></b><span></span>' + (n > 1 ? '<em>+' + (n - 1) + '</em>' : '');
    peek.querySelector('b').textContent = name;
    peek.querySelector('span').textContent = soften(r.body);
    peek.setAttribute('aria-label', n + (n === 1 ? ' comment' : ' comments') + '. Open comments');
    if (peek.hidden) { peek.hidden = false; requestAnimationFrame(function () { peek.classList.add('on'); }); }
  }

  // Called by For You when a card becomes the one in view.
  function focus(card, item) {
    if (!card || !item || !item.skey) { _active = null; return; }
    _active = { card: card, item: item };
    var mine = _active;
    load(item.skey).then(function (d) { if (_active === mine) paintCard(card, d); }).catch(function () {});
  }

  /* ---- the sheet ----------------------------------------------------- */
  function build() {
    if (_sheet) return _sheet;
    var m = document.createElement('div');
    m.className = 'modal sc-modal'; m.id = 'sc-modal';
    m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'sc-h');
    m.innerHTML =
      '<div class="sc-panel">' +
        '<div class="sc-grab" aria-hidden="true"></div>' +
        '<div class="sc-top">' +
          '<img class="sc-art" alt="">' +
          '<div class="sc-ttl"><h2 id="sc-h">Comments</h2><p class="sc-song"></p></div>' +
          '<button class="modal-close sc-x" type="button" aria-label="Close comments">&times;</button>' +
        '</div>' +
        '<div class="sc-sort" role="tablist">' +
          '<button data-sort="top" role="tab">Top</button><button data-sort="new" role="tab">Newest</button>' +
        '</div>' +
        '<div class="sc-list" aria-live="polite"></div>' +
        '<form class="sc-form" autocomplete="off">' +
          '<div class="sc-field"><textarea rows="1" maxlength="' + MAX + '" placeholder="Add a comment…" aria-label="Write a comment"></textarea><span class="sc-left"></span></div>' +
          '<button type="submit" class="sc-send" aria-label="Post comment"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" fill="currentColor"/></svg></button>' +
        '</form>' +
        '<div class="sc-err" role="status"></div>' +
      '</div>';
    document.body.appendChild(m);
    _sheet = m;
    m.addEventListener('click', function (ev) {
      if (ev.target === m || ev.target.closest('.sc-x')) return close();
      var s = ev.target.closest('[data-sort]'); if (s) { _sort = s.dataset.sort; renderList(); return; }
      var lk = ev.target.closest('[data-clike]'); if (lk) return like(lk);
      var more = ev.target.closest('[data-cmore]'); if (more) return menu(more.dataset.cmore);
      var u = ev.target.closest('[data-cuser]'); if (u && u.dataset.cuser && window.viewUserProfile) { close(); viewUserProfile(u.dataset.cuser); }
    });
    var ta = m.querySelector('textarea');
    ta.addEventListener('input', function () {
      ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px';
      var left = MAX - ta.value.length, l = m.querySelector('.sc-left');
      l.textContent = left <= 40 ? String(left) : ''; l.classList.toggle('low', left < 0);
      m.querySelector('.sc-send').classList.toggle('ready', ta.value.trim().length >= 2);
      m.querySelector('.sc-err').textContent = '';
    });
    ta.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); send(); } });
    ta.addEventListener('focus', function () {
      if (!me() && window.Cloud) { ta.blur(); close(); Cloud.openAuth(); }
    });
    m.querySelector('.sc-form').addEventListener('submit', function (ev) { ev.preventDefault(); send(); });
    // Swipe the grab handle down to dismiss.
    var grab = m.querySelector('.sc-grab'), panel = m.querySelector('.sc-panel'), y0 = null;
    grab.addEventListener('pointerdown', function (ev) { y0 = ev.clientY; grab.setPointerCapture(ev.pointerId); panel.style.transition = 'none'; });
    grab.addEventListener('pointermove', function (ev) { if (y0 != null) panel.style.transform = 'translateY(' + Math.max(0, ev.clientY - y0) + 'px)'; });
    grab.addEventListener('pointerup', function (ev) {
      var dy = y0 == null ? 0 : ev.clientY - y0; y0 = null; panel.style.transition = ''; panel.style.transform = '';
      if (dy > 90) close();
    });
    return m;
  }

  var _openItem = null, _openCard = null;
  async function open(item, card) {
    if (!item) return;
    var m = build();
    _openItem = item; _openCard = card || null;
    var art = m.querySelector('.sc-art'); if (item.art) { art.src = item.art; art.hidden = false; } else art.hidden = true;
    m.querySelector('.sc-song').textContent = (item.title || '') + (item.artist ? ' · ' + item.artist : '');
    m.querySelector('.sc-err').textContent = '';
    var ta = m.querySelector('textarea'); ta.placeholder = me() ? 'Add a comment…' : 'Log in to comment';
    m.querySelector('.sc-list').innerHTML = '<div class="sc-loading"><i></i><i></i><i></i></div>';
    // Escape and the back button close modals by removing `open` alone, so
    // `in` may still be set from last time; clear it or the sheet would not slide.
    m.classList.remove('in');
    m.classList.add('open');
    void m.offsetWidth;
    requestAnimationFrame(function () { m.classList.add('in'); });
    if (window.buzz) buzz('tap');
    try { await load(item.skey, true); } catch (x) {}
    if (_openItem === item) renderList();
  }
  function close() {
    if (!_sheet) return;
    _sheet.classList.remove('in');
    setTimeout(function () { _sheet.classList.remove('open'); }, reduced() ? 0 : 260);
    if (_openCard && _openItem && _cache[_openItem.skey]) paintCard(_openCard, _cache[_openItem.skey]);
  }

  function sorted(d) {
    var r = d.rows.slice();
    if (_sort === 'top') r.sort(function (a, b) { return (b.likes - a.likes) || (a.created_at < b.created_at ? 1 : -1); });
    return r;
  }
  function renderList() {
    if (!_sheet || !_openItem) return;
    _sheet.querySelectorAll('[data-sort]').forEach(function (b) { b.classList.toggle('on', b.dataset.sort === _sort); b.setAttribute('aria-selected', String(b.dataset.sort === _sort)); });
    var d = _cache[_openItem.skey] || { rows: [], profs: {}, liked: {} };
    var h = _sheet.querySelector('#sc-h');
    h.textContent = d.rows.length ? 'Comments · ' + d.rows.length : 'Comments';
    var list = _sheet.querySelector('.sc-list'), u = me();
    if (_off) { list.innerHTML = '<div class="sc-empty"><b>Not switched on yet</b><span>Comments are coming soon.</span></div>'; return; }
    if (!d.rows.length) {
      list.innerHTML = '<div class="sc-empty"><span class="sc-empty-mark" aria-hidden="true"></span><b>No comments yet</b><span>' +
        'No comments yet.</span></div>';
      return;
    }
    list.innerHTML = sorted(d).map(function (r, k) {
      var pr = d.profs[r.user_id], name = pr ? pr.username : 'deleted account', mine = u && u.id === r.user_id;
      var av = pr && pr.avatar_url ? '<img src="' + e(pr.avatar_url) + '" alt="" loading="lazy">' : '<span>' + e((name[0] || '?').toUpperCase()) + '</span>';
      return '<div class="sc-row' + (r.hidden ? ' is-hidden' : '') + '" style="--k:' + Math.min(k, 12) + '">' +
        '<button class="sc-av" data-cuser="' + (pr ? e(r.user_id) : '') + '" aria-label="' + e(name) + '">' + av + '</button>' +
        '<div class="sc-body">' +
          '<div class="sc-meta"><b>' + e(name) + '</b>' +
            '<span>' + e(ago(r.created_at)) + '</span>' + (r.hidden ? '<em>Hidden after reports</em>' : '') + '</div>' +
          '<p>' + e(soften(r.body)) + '</p>' +
        '</div>' +
        '<div class="sc-acts">' +
          '<button class="sc-like' + (d.liked[r.id] ? ' on' : '') + '" data-clike="' + r.id + '"' + (mine ? ' disabled' : '') + ' aria-label="Like comment">' +
            '<svg viewBox="0 0 24 24" width="15" height="15"><path d="M12 20.6s-7.6-4.5-10.2-9C.3 8.6 1 5.4 3.7 4.1c2-.9 4.3-.3 5.7 1.4l2.6 3.1 2.6-3.1c1.4-1.7 3.7-2.3 5.7-1.4 2.7 1.3 3.4 4.5 1.9 7.5-2.6 4.5-10.2 9-10.2 9Z"/></svg>' +
            '<span>' + (r.likes || '') + '</span></button>' +
          '<button class="sc-more" data-cmore="' + r.id + '" aria-label="More">•••</button>' +
        '</div></div>';
    }).join('');
  }

  async function send() {
    if (_sending || !_sheet || !_openItem) return;
    var ta = _sheet.querySelector('textarea'), err = _sheet.querySelector('.sc-err');
    if (!me()) { close(); if (window.Cloud) Cloud.openAuth(); return; }
    var body = ta.value.replace(/\s+/g, ' ').trim();
    var bad = precheck(body); if (bad) { err.textContent = bad; if (window.buzz) buzz('bad'); return; }
    _sending = true;
    var btn = _sheet.querySelector('.sc-send'); btn.disabled = true;
    try {
      var it = _openItem;
      var res = await sb().rpc('song_comment_add', { p_key: it.skey, p_body: body,
        p_at_ms: null, p_title: it.title || null, p_artist: it.artist || null });
      if (res.error) throw res.error;
      var row = Array.isArray(res.data) ? res.data[0] : res.data;
      var d = _cache[it.skey] || (_cache[it.skey] = { at: Date.now(), rows: [], profs: {}, liked: {} });
      d.rows.unshift(row);
      var u = me(); if (u && !d.profs[u.id]) { try { d.profs[u.id] = await Cloud.fetchProfile(u.id); } catch (x) {} }
      ta.value = ''; ta.style.height = 'auto'; ta.dispatchEvent(new Event('input'));
      _sort = 'new'; renderList();
      var first = _sheet.querySelector('.sc-row'); if (first) first.classList.add('fresh');
      if (window.buzz) buzz('good');
      if (window.track) track('song_comment', {});
    } catch (x) {
      err.textContent = reasonOf(x); if (window.buzz) buzz('bad');
    } finally { _sending = false; btn.disabled = false; }
  }

  async function like(btn) {
    if (!me()) { close(); if (window.Cloud) Cloud.openAuth(); return; }
    var id = btn.dataset.clike, d = _cache[_openItem.skey]; if (!d) return;
    var row = d.rows.find(function (r) { return r.id === id; }); if (!row) return;
    var on = !d.liked[id];
    // Optimistic, and put back if the server says no.
    d.liked[id] = on ? 1 : 0; row.likes = Math.max(0, (row.likes || 0) + (on ? 1 : -1));
    btn.classList.toggle('on', on); btn.lastChild.textContent = row.likes || '';
    if (on) { btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop'); if (window.buzz) buzz('tap'); }
    var q = on ? sb().from('song_comment_likes').insert({ comment_id: id, user_id: me().id })
               : sb().from('song_comment_likes').delete().eq('comment_id', id).eq('user_id', me().id);
    var res = await q;
    if (res.error && !/duplicate/i.test(res.error.message || '')) {
      d.liked[id] = on ? 0 : 1; row.likes = Math.max(0, row.likes + (on ? -1 : 1));
      btn.classList.toggle('on', !on); btn.lastChild.textContent = row.likes || '';
    }
  }

  async function menu(id) {
    var d = _cache[_openItem.skey], row = d && d.rows.find(function (r) { return r.id === id; });
    if (!row) return;
    var u = me(), mine = u && u.id === row.user_id, pr = d.profs[row.user_id];
    if (!window.ask) return;
    if (mine) {
      var yes = await ask({ title: 'Delete comment?', body: '“' + e(row.body.slice(0, 80)) + '”', confirm: 'Delete comment', danger: true });
      if (!yes) return;
      var r = await sb().from('song_comments').delete().eq('id', id);
      if (!r.error) { d.rows = d.rows.filter(function (x) { return x.id !== id; }); renderList(); }
      return;
    }
    if (!u) { close(); if (window.Cloud) Cloud.openAuth(); return; }
    var rep = await ask({ title: 'Report this comment?', body: 'We review every report. Three reports hide a comment until we’ve looked.', confirm: 'Report', danger: true });
    if (!rep || !window.openReport) return;
    openReport('comment', 'sc:' + id, row.user_id, pr ? '@' + pr.username + '’s comment' : 'a comment');
  }

  window.SongComments = { focus: focus, open: open, close: close, blur: function () { _active = null; }, _soften: soften, _precheck: precheck };
})();
