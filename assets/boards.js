/* ================================================================
   BOARDS — server-timed runs, the live clock, the results card and the
   leaderboard sheet, shared by every minigame.

   A game calls Boards.start() when play begins and Boards.finish() with
   what happened. The SERVER stamps the start, measures the elapsed time
   and computes the score (game_start / game_finish, see
   supabase/migrations/20261014100000_game_leaderboards.sql); the browser
   only ever says what it answered. The clock on screen is the server's
   clock mapped onto this one, so a resumed daily shows the time that is
   actually being counted.

   Everything degrades: signed out, or a database without the migration,
   and the game plays exactly as before with a local clock and no board.
   ================================================================ */
(function () {
  'use strict';

  var GAMES = [
    { g: 'cover',       name: 'Guess the Cover',  short: 'Cover',     hue: 'var(--gold)', artist: true, modes: [['artist', '']] },
    { g: 'coverx',      name: 'Cover EXTREME',    short: 'EXTREME',   hue: 'var(--hue-3)', artist: true, modes: [['artist', '']] },
    { g: 'tracklist',   name: 'Guess from Tracklist', short: 'Tracklist', hue: 'var(--hue-1)', artist: true, modes: [['artist', '']] },
    { g: 'year',        name: 'Guess the Year',   short: 'Year',      hue: 'var(--hue-4)', artist: true, modes: [['artist', '']] },
    { g: 'blitz',       name: 'Cover Fire',       short: 'Cover Fire', hue: 'var(--hue-6)', modes: [['daily', 'Today’s Ten', 1], ['solo', 'Solo']] },
    { g: 'recall',      name: 'Recall',           short: 'Recall',    hue: 'var(--hue-recall, var(--hue-3))', modes: [['daily', 'Daily', 1], ['endless', 'Endless']] },
    { g: 'drop',        name: 'Daily Drop',       short: 'Daily Drop', hue: 'var(--hue-5)', modes: [['album', 'Album', 1], ['song', 'Song', 1]] },
    { g: 'earworm',     name: 'Earworm',          short: 'Earworm',   hue: 'var(--hue-2)', modes: [['daily', 'Daily', 1]] },
    { g: 'higherlower', name: 'Higher or Lower',  short: 'Higher/Lower', hue: 'var(--hue-7)', modes: [['streams', 'Streams']] }
  ];
  function gameOf(g) { for (var i = 0; i < GAMES.length; i++) if (GAMES[i].g === g) return GAMES[i]; return null; }
  function isDaily(g, m) { var x = gameOf(g); if (!x) return false; for (var i = 0; i < x.modes.length; i++) if (x.modes[i][0] === m) return !!x.modes[i][2]; return false; }

  function E(s) { return window.esc ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function sb() { try { return window.Cloud && Cloud.client && Cloud.client(); } catch (e) { return null; } }
  function signedIn() { try { return !!(window.Cloud && Cloud.isOn && Cloud.isOn()); } catch (e) { return false; } }
  function me() { try { var u = Cloud.getUser && Cloud.getUser(); return u && u.id; } catch (e) { return null; } }
  function reduced() { return !!(window.motionReduced && motionReduced()); }
  function n(v) { return Math.round(v || 0).toLocaleString('en-GB'); }
  // Local calendar days since 2020-01-01, the clock every daily here counts in.
  function day() { var d = new Date(); return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2020, 0, 1)) / 86400000); }
  function fmtMs(ms, tenths) {
    ms = Math.max(0, ms || 0);
    var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = s % 60;
    var out = (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(ss).padStart(2, '0');
    return tenths && !h ? out + '.' + Math.floor(ms % 1000 / 100) : out;
  }
  var reported = {};
  function report(what, err) {
    if (reported[what]) return; reported[what] = 1;
    try { if (window.reportIssue) reportIssue('boards: ' + what, err && (err.message || err)); } catch (e) {}
  }

  /* ---- runs ------------------------------------------------------------- */
  var runs = {};      // game -> the live run
  var results = {};   // game|mode|day -> last finished result, for re-renders

  function start(game, mode, o) {
    o = o || {};
    var run = { game: game, mode: mode, day: o.day, artistKey: o.artistKey || null, artistLabel: o.artistLabel || '',
                t0: Date.now(), id: null, err: null, done: false };
    runs[game] = run;
    // A mode with no board (your-crate modes, head-to-heads) keeps a clock only.
    if (o.local) { run.local = true; return run; }
    if (!signedIn() || !sb()) { run.err = 'signed_out'; return run; }
    run.pending = Promise.resolve(sb().rpc('game_start', {
      p_game: game, p_mode: mode, p_artist_key: run.artistKey, p_artist_label: run.artistLabel || null,
      p_day: o.day == null ? null : o.day
    })).then(function (r) {
      if (r.error) { run.err = 'off'; report('game_start', r.error); return; }
      var d = r.data || {};
      if (d.error) { run.err = d.error; run.prior = d; return; }
      run.id = d.id;
      // The server's start, on this device's clock: the offset between its
      // `now` and its `started_at` is what has already elapsed.
      var srvNow = Date.parse(d.now), st = Date.parse(d.started_at);
      if (isFinite(srvNow) && isFinite(st) && !run.done) run.t0 = Date.now() - Math.max(0, srvNow - st);
    }).catch(function (e) { run.err = 'off'; report('game_start', e); });
    return run;
  }
  function live(game) { var r = runs[game]; return r && !r.done ? r : null; }

  function finish(game, result) {
    var run = runs[game];
    if (!run || run.done) return Promise.resolve(null);
    run.done = true; run.tEnd = Date.now();
    if (run.local) return Promise.resolve(null);
    var base = { game: game, mode: run.mode, day: run.day, artist_label: run.artistLabel, artist_key: run.artistKey,
                 local_ms: run.tEnd - run.t0 };
    return Promise.resolve(run.pending).then(function () {
      if (!run.id) return Object.assign(base, { error: run.err || 'off', prior: run.prior });
      return Promise.resolve(sb().rpc('game_finish', { p_run: run.id, p_result: result || {} })).then(function (r) {
        if (r.error) { report('game_finish', r.error); return Object.assign(base, { error: 'off' }); }
        return Object.assign(base, r.data || {});
      });
    }).catch(function (e) { report('game_finish', e); return Object.assign(base, { error: 'off' }); })
      .then(function (res) {
        results[game + '|' + run.mode + '|' + (run.day == null ? -1 : run.day)] = res;
        return res;
      });
  }

  /* ---- the live clock ------------------------------------------------------
     One ticker for every mounted clock, text-only writes, skipped while the
     tab is hidden. A clock whose element has left the page drops itself. */
  var clocks = [], ticking = 0;
  function clock(host, game, opts) {
    if (!host) return null;
    opts = opts || {};
    var elc = host.querySelector(':scope > .gb-clock');
    if (!elc) {
      elc = document.createElement('span');
      elc.className = 'gb-clock';
      elc.setAttribute('aria-label', 'Time and score');
      elc.innerHTML = '<i aria-hidden="true"></i><b>0:00</b><em></em>';
      host.appendChild(elc);
    }
    var c = { el: elc, game: game, score: opts.score };
    clocks = clocks.filter(function (x) { return x.el !== elc; });
    clocks.push(c);
    paintClock(c);
    if (!ticking) ticking = setInterval(tick, 250);
    return elc;
  }
  function paintClock(c) {
    var r = runs[c.game];
    var ms = r ? ((r.done ? r.tEnd : Date.now()) - r.t0) : 0;
    c.el.classList.toggle('gb-stopped', !r || r.done);
    var b = c.el.children[1], em = c.el.children[2];
    var t = fmtMs(ms, r && r.done);
    if (b.textContent !== t) b.textContent = t;
    var s = c.score ? c.score(ms) : '';
    if (em.textContent !== s) em.textContent = s;
    em.hidden = !s;
  }
  function tick() {
    if (document.hidden) return;
    clocks = clocks.filter(function (c) { return c.el.isConnected; });
    if (!clocks.length) { clearInterval(ticking); ticking = 0; return; }
    clocks.forEach(paintClock);
  }

  // What the next solve would be worth, mirroring game_score() — display only.
  function speedPart(ms, max) { return Math.round(max * Math.max(0, Math.min(1, (600000 - ms) / 570000))); }
  var preview = {
    drop: function (used, ms) { return used >= 6 ? '' : 'up to ' + n((6 - used) * 1000 + speedPart(ms, 500)); },
    earworm: function (used, ms, letters, hinted) {
      return used >= 6 ? '' : 'up to ' + n((6 - used) * 1000 + Math.min(letters || 0, 15) * 20 - (hinted ? 400 : 0) + speedPart(ms, 400));
    }
  };

  /* ---- the results card ---------------------------------------------------- */
  var REASONS = {
    signed_out: 'Sign in to put runs on the leaderboard.',
    off: 'Leaderboards are not reachable just now — the run still counts here.',
    already_played: 'Today’s board already has your first go on it.',
    already_finished: 'This run is already on the board.',
    rate_limited: 'That is a lot of runs in an hour — this one is not ranked.',
    expired: 'That run went on too long to rank.',
    rejected: 'That run could not be verified, so it is not ranked.',
    bad_day: 'Your device’s date is out — this one is not ranked.'
  };
  function result(host, res, opts) {
    if (!host || !res) return;
    opts = opts || {};
    var gm = gameOf(res.game) || {};
    if (res.error) {
      host.innerHTML = '<div class="gb-res gb-res-off" style="--gb-c:' + (gm.hue || 'var(--gold)') + '">' +
        '<div class="gb-res-why">' + E(REASONS[res.error] || REASONS.off) + '</div>' +
        '<div class="gb-res-meta"><span>' + fmtMs(res.prior && res.prior.elapsed_ms || res.local_ms, true) + '</span></div>' +
        '<button type="button" class="gb-res-open">Leaderboard</button></div>';
    } else {
      var place = '';
      if (res.rank) {
        place = '<b>#' + n(res.rank) + '</b> of ' + n(res.total) +
          (res.artist_key && res.artist_key !== '*' ? ' on ' + E(res.artist_label || 'this artist') : res.day >= 0 ? ' today' : '');
        if (res.overall_rank) place += ' <span>· #' + n(res.overall_rank) + ' ' + (res.day >= 0 ? 'best day' : 'overall') + '</span>';
      } else if (!res.score) {
        place = 'No score this time — nothing to rank.';
      }
      host.innerHTML = '<div class="gb-res' + (res.pb && res.score ? ' gb-pb' : '') + '" style="--gb-c:' + (gm.hue || 'var(--gold)') + '">' +
        (res.pb && res.score ? '<div class="gb-pb-tag">New personal best</div>' : '') +
        '<div class="gb-res-score"><span class="gb-res-num">0</span><small>points</small></div>' +
        '<div class="gb-res-meta">' +
          '<span><i class="gb-ico-t" aria-hidden="true"></i>' + fmtMs(res.elapsed_ms, true) + '</span>' +
          (res.best_score != null && !(res.pb && res.score) ? '<span>Best ' + n(res.best_score) + '</span>' : '') +
        '</div>' +
        (place ? '<div class="gb-res-rank">' + place + '</div>' : '') +
        '<button type="button" class="gb-res-open">Leaderboard</button></div>';
      var num = host.querySelector('.gb-res-num');
      if (window.Play && Play.count) Play.count(num, 0, res.score || 0, 900); else num.textContent = n(res.score);
    }
    var b = host.querySelector('.gb-res-open');
    if (b) b.addEventListener('click', function () {
      open({ game: res.game, mode: res.mode, artist: res.artist_key && res.artist_key !== '*' ? res.artist_key : '*',
             artistLabel: res.artist_label, period: res.day >= 0 ? 'today' : 'all' });
    });
  }
  // A game that rebuilds its end screen re-paints the last result into it.
  function paint(host, game, mode, d) {
    var r = results[game + '|' + mode + '|' + (d == null ? -1 : d)];
    if (r) result(host, r); else if (host) host.innerHTML = '';
  }
  // A slot after an element, created once.
  function slot(after, id) {
    if (!after) return null;
    var s = document.getElementById(id);
    if (!s) { s = document.createElement('div'); s.id = id; s.className = 'gb-slot'; after.parentNode.insertBefore(s, after.nextSibling); }
    return s;
  }

  /* ---- the leaderboard sheet ---------------------------------------------- */
  var st = { game: 'cover', mode: 'artist', period: 'all', artist: '*', artistLabel: '', friends: false };
  var modal, elGames, elModes, elPeriod, elScope, elList, elMe, elSub;
  var cache = {}, loadTok = 0, lastKey = '', lastPos = null;

  function boardKey() { return [st.game, st.mode, st.artist, periodDay(), st.friends ? 'f' : 'a'].join('|'); }
  function periodDay() { return isDaily(st.game, st.mode) && st.period === 'today' ? day() : -1; }

  function open(o) {
    if (!modal) return;
    o = o || {};
    if (o.game && gameOf(o.game)) {
      st.game = o.game;
      var gm = gameOf(o.game);
      st.mode = o.mode && gm.modes.some(function (m) { return m[0] === o.mode; }) ? o.mode : gm.modes[0][0];
      st.artist = o.artist || '*'; st.artistLabel = o.artistLabel || '';
      st.period = o.period || (isDaily(st.game, st.mode) ? 'today' : 'all');
    }
    modal.classList.add('open');
    paintControls();
    load();
    var chip = elGames.querySelector('.on');
    if (chip && chip.scrollIntoView) chip.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
  function close() { if (modal) modal.classList.remove('open'); }

  function paintControls() {
    var gm = gameOf(st.game);
    modal.style.setProperty('--gb-c', gm.hue);
    elGames.innerHTML = GAMES.map(function (x) {
      return '<button type="button" role="tab" data-g="' + x.g + '" class="' + (x.g === st.game ? 'on' : '') + '" aria-selected="' + (x.g === st.game) + '" style="--gb-c:' + x.hue + '">' + E(x.short) + '</button>';
    }).join('');
    elModes.innerHTML = gm.modes.length > 1 ? gm.modes.map(function (m) {
      return '<button type="button" data-m="' + m[0] + '" class="' + (m[0] === st.mode ? 'on' : '') + '">' + E(m[1]) + '</button>';
    }).join('') : '';
    elModes.hidden = gm.modes.length < 2;
    var daily = isDaily(st.game, st.mode);
    elPeriod.hidden = !daily;
    elPeriod.innerHTML = daily ? '<button type="button" data-p="today" class="' + (st.period === 'today' ? 'on' : '') + '">Today</button>' +
      '<button type="button" data-p="all" class="' + (st.period === 'all' ? 'on' : '') + '">Best day</button>' : '';
    elScope.innerHTML =
      (gm.artist ? (st.artist !== '*'
        ? '<span class="gb-artist-chip"><b>' + E(st.artistLabel || 'Artist') + '</b><button type="button" data-clear aria-label="All artists">×</button></span>'
        : '<label class="gb-search"><input type="search" id="gb-q" placeholder="All artists — search one" autocomplete="off" aria-label="Filter by artist"><div class="gb-sugg" id="gb-sugg" hidden></div></label>') : '<span class="gb-scope-all">Everyone</span>') +
      '<button type="button" class="gb-friends' + (st.friends ? ' on' : '') + '" data-friends aria-pressed="' + st.friends + '">Friends</button>';
    elSub.textContent = gm.name + (gm.artist ? (st.artist === '*' ? ' · all artists, scored for pool size' : '') : '') +
      (daily ? (st.period === 'today' ? ' · today' : ' · best single day') : '');
  }

  async function load() {
    var key = boardKey(), tok = ++loadTok;
    var hit = cache[key];
    if (hit && Date.now() - hit.at < 30000) { draw(hit.data, key); return; }
    if (!hit) elList.innerHTML = '<div class="gb-loading" aria-label="Loading">' + new Array(6).join('<i></i>') + '</div>';
    var c = sb();
    if (!c) { elList.innerHTML = '<div class="gb-empty">Leaderboards need a connection.</div>'; elMe.innerHTML = ''; return; }
    if (st.friends && !signedIn()) { elList.innerHTML = '<div class="gb-empty">Sign in to see how you rank against people you follow.</div>'; elMe.innerHTML = ''; return; }
    try {
      var r = await c.rpc('game_board', { p_game: st.game, p_mode: st.mode, p_artist: st.artist, p_day: periodDay(), p_friends: st.friends, p_limit: 50 });
      if (tok !== loadTok) return;
      if (r.error) {
        report('game_board', r.error);
        elList.innerHTML = '<div class="gb-empty">Leaderboards are not switched on yet.</div>'; elMe.innerHTML = '';
        return;
      }
      await (window.loadBlocks ? loadBlocks() : Promise.resolve());
      if (tok !== loadTok) return;
      cache[key] = { at: Date.now(), data: r.data || {} };
      draw(cache[key].data, key);
    } catch (e) {
      if (tok === loadTok) { elList.innerHTML = '<div class="gb-empty">Could not load this board.</div>'; elMe.innerHTML = ''; }
    }
  }

  function avatar(r, cls) {
    var nm = r.username || 'user';
    return '<span class="gb-av ' + (cls || '') + '">' + (r.avatar_url
      ? '<img src="' + E(r.avatar_url) + '" alt="" loading="lazy" decoding="async" onerror="this.remove()">'
      : '') + '<span>' + E(nm.charAt(0).toUpperCase()) + '</span></span>';
  }
  function subLine(r) {
    var gm = gameOf(st.game);
    if (gm.artist && st.artist === '*' && r.artist_label) return E(r.artist_label);
    if (!r.achieved_at) return '';
    var d = new Date(r.achieved_at);
    return isDaily(st.game, st.mode) && st.period === 'today'
      ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  function draw(data, key) {
    var uid = me();
    var rows = (data.rows || []).filter(function (r) { return r.user_id === uid || !(window.isBlocked && isBlocked(r.user_id)); });
    rows.forEach(function (r, i) { r.rk = i + 1; });
    var sameBoard = key === lastKey;
    // FLIP: remember where each player was, so a refreshed board slides
    // rows to their new places instead of snapping.
    var before = {};
    if (sameBoard && !reduced()) elList.querySelectorAll('[data-uid]').forEach(function (n2) { before[n2.dataset.uid] = n2.getBoundingClientRect().top; });
    lastKey = key;

    if (!rows.length) {
      elList.innerHTML = '<div class="gb-empty"><b>Nobody here yet.</b>' + (st.friends ? 'Nobody you follow has a run on this board.' : 'Play a run and the top spot is yours.') + '</div>';
    } else {
      var top = rows.slice(0, 3), rest = rows.slice(3);
      var order = top.length === 3 ? [top[1], top[0], top[2]] : top;
      var html = '<div class="gb-podium' + (sameBoard ? '' : ' gb-in') + '">' + order.map(function (r) {
        return '<div class="gb-pod gb-p' + r.rk + (r.user_id === uid ? ' gb-mine' : '') + '" data-uid="' + E(r.user_id) + '">' +
          avatar(r, 'gb-av-lg') + '<div class="gb-pod-rank">' + r.rk + '</div>' +
          '<div class="gb-pod-name">' + E(r.username || 'user') + '</div>' +
          '<div class="gb-pod-score" data-score="' + r.score + '">' + n(r.score) + '</div>' +
          '<div class="gb-pod-sub">' + fmtMs(r.elapsed_ms, true) + (subLine(r) ? ' · ' + subLine(r) : '') + '</div></div>';
      }).join('') + '</div>';
      html += '<ol class="gb-rows' + (sameBoard ? '' : ' gb-in') + '">' + rest.map(function (r, i) {
        return '<li class="gb-row' + (r.user_id === uid ? ' gb-mine' : '') + '" data-uid="' + E(r.user_id) + '" style="--i:' + Math.min(i, 12) + '">' +
          '<span class="gb-rk">' + r.rk + '</span>' + avatar(r) +
          '<span class="gb-who"><b>' + E(r.username || 'user') + '</b><small>' + subLine(r) + '</small></span>' +
          '<span class="gb-sc"><b>' + n(r.score) + '</b><small>' + fmtMs(r.elapsed_ms, true) + '</small></span></li>';
      }).join('') + '</ol>';
      elList.innerHTML = html;
      if (!sameBoard && window.Play && Play.count) {
        elList.querySelectorAll('.gb-pod-score').forEach(function (s) { Play.count(s, 0, +s.dataset.score, 800); });
      }
      if (sameBoard && !reduced()) {
        elList.querySelectorAll('[data-uid]').forEach(function (n2) {
          var was = before[n2.dataset.uid]; if (was == null) return;
          var dy = was - n2.getBoundingClientRect().top;
          if (Math.abs(dy) > 1 && n2.animate) n2.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
        });
      }
    }
    // You, always: highlighted in the list, or pinned under it with your rank.
    var mine = data.me, shown = rows.some(function (r) { return r.user_id === uid; });
    elMe.innerHTML = !uid ? '<div class="gb-me-row gb-me-out">Sign in to get on the board.</div>'
      : mine ? '<div class="gb-me-row' + (shown ? ' gb-me-quiet' : '') + '"><span class="gb-rk">#' + n(mine.rank) + '</span>' +
               '<span class="gb-who"><b>You</b><small>of ' + n(data.total) + (mine.artist_label && st.artist === '*' && gameOf(st.game).artist ? ' · ' + E(mine.artist_label) : '') + '</small></span>' +
               '<span class="gb-sc"><b>' + n(mine.score) + '</b><small>' + fmtMs(mine.elapsed_ms, true) + '</small></span></div>'
      : '<div class="gb-me-row gb-me-out">You are not on this board yet.</div>';
  }

  var sugTok = 0, sugT = 0;
  function suggest(q) {
    var box = document.getElementById('gb-sugg'), c = sb();
    if (!box || !c) return;
    clearTimeout(sugT);
    sugT = setTimeout(async function () {
      var tok = ++sugTok;
      try {
        var r = await c.rpc('game_board_artists', { p_game: st.game, p_mode: st.mode, p_q: q || '' });
        if (tok !== sugTok) return;
        var list = (r.data || []);
        box.hidden = false;
        box.innerHTML = list.length ? list.map(function (a) {
          return '<button type="button" data-ak="' + E(a.key) + '" data-al="' + E(a.label || '') + '"><b>' + E(a.label || a.key) + '</b><small>' + n(a.players) + ' player' + (a.players === 1 ? '' : 's') + '</small></button>';
        }).join('') : '<div class="gb-sugg-none">No board for “' + E(q) + '” yet.</div>';
      } catch (e) {}
    }, q ? 180 : 0);
  }

  function wire() {
    modal = document.getElementById('leaderboard-modal');
    if (!modal) return;
    elGames = document.getElementById('gb-games'); elModes = document.getElementById('gb-modes');
    elPeriod = document.getElementById('gb-period'); elScope = document.getElementById('gb-scope');
    elList = document.getElementById('gb-list'); elMe = document.getElementById('gb-me'); elSub = document.getElementById('gb-sub');
    var cl = document.getElementById('leaderboard-close');
    if (cl) cl.addEventListener('click', close);
    modal.addEventListener('click', function (e) {
      if (e.target === modal) { close(); return; }
      var t = e.target.closest('button');
      if (!t || !modal.contains(t)) return;
      if (t.dataset.g) {
        var gm = gameOf(t.dataset.g);
        st.game = gm.g; st.mode = gm.modes[0][0]; st.artist = '*'; st.artistLabel = '';
        st.period = isDaily(st.game, st.mode) ? 'today' : 'all';
      } else if (t.dataset.m) { st.mode = t.dataset.m; st.period = isDaily(st.game, st.mode) ? 'today' : 'all'; }
      else if (t.dataset.p) st.period = t.dataset.p;
      else if (t.hasAttribute('data-friends')) st.friends = !st.friends;
      else if (t.hasAttribute('data-clear')) { st.artist = '*'; st.artistLabel = ''; }
      else if (t.dataset.ak) { st.artist = t.dataset.ak; st.artistLabel = t.dataset.al; }
      else return;
      if (window.buzz) buzz('tap');
      paintControls(); load();
    });
    modal.addEventListener('input', function (e) { if (e.target.id === 'gb-q') suggest(e.target.value.trim()); });
    modal.addEventListener('focusin', function (e) { if (e.target.id === 'gb-q') suggest(e.target.value.trim()); });
    var card = document.getElementById('leaderboard-card');
    if (card) card.addEventListener('click', function () { open(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();

  window.Boards = { start: start, finish: finish, live: live, clock: clock, result: result, paint: paint, slot: slot,
                    open: open, day: day, fmt: fmtMs, preview: preview, GAMES: GAMES };
})();
