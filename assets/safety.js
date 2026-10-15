/* Safety: the age check, report buttons on public content, and the admin
   moderation queue. Loaded after index.html's own modules (Cloud, ask, toast,
   openReport, esc); every entry point degrades to nothing if one is missing. */
(function () {
  function sb() { return window.Cloud && Cloud.client ? Cloud.client() : null; }
  function escH(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }

  /* ---- Age check ---------------------------------------------------------
     VINALL is 13+. Asked once per ACCOUNT (auth user_metadata.age_band), after
     sign-in, so email sign-up, Apple/Google sign-in and accounts made before
     this existed all pass through the same question. It is self-declared, and
     only a band is kept, never a date of birth. 13-17 starts on high-privacy
     defaults (ICO Children's Code standard 7): ratings visible to mutual
     follows only, which also keeps them out of the public feed. Not a .modal
     on purpose: the Back-button observer closes the top .modal, and this
     question must be answered, not dismissed. */
  var BANDS = { under13: 1, '13-17': 1, adult: 1 };
  function overlay() {
    var el = document.createElement('div');
    el.id = 'age-gate';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'age-gate-h');
    el.style.cssText = 'position:fixed;inset:0;z-index:230;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(5,4,3,.92);backdrop-filter:blur(12px)';
    el.innerHTML = '<div class="modal-panel" style="max-width:380px;text-align:center">' +
      '<h2 id="age-gate-h" style="margin:0 0 8px">How old are you?</h2>' +
      '<p style="color:var(--text-dim);margin:0 0 18px;font-size:14px">VINALL is for people aged 13 and over. We only keep which group you are in, not your birthday.</p>' +
      '<button class="btn-primary g-btn-full" data-band="adult" style="margin-bottom:10px">18 or over</button>' +
      '<button class="btn-primary g-btn-full" data-band="13-17" style="margin-bottom:10px">13 to 17</button>' +
      '<button class="btn-primary g-btn-full" data-band="under13" style="background:var(--surface-2);color:var(--text)">Under 13</button>' +
      '<p style="color:var(--text-faint);margin:14px 0 0;font-size:12px">By continuing you agree to the <a href="/terms.html">Terms</a> and <a href="/privacy.html">Privacy Policy</a>.</p></div>';
    document.body.appendChild(el);
    return el;
  }
  async function refuse(c) {
    try { if (window.Cloud && Cloud.logout) await Cloud.logout(); else await c.auth.signOut(); } catch (e) {}
    if (window.say) say('VINALL is for 13 and over', 'Sorry, you need to be 13 or older to use VINALL. If you made this account by mistake, email vinall.support@gmail.com and we will delete it.');
  }
  var busy = null;
  async function ensure(u) {
    var c = sb(); if (!c || !u) return true;
    if (busy) return busy;
    busy = (async function () {
      var band = u.user_metadata && u.user_metadata.age_band;
      if (band === 'under13') { await refuse(c); return false; }
      if (BANDS[band]) return true;
      var el = document.getElementById('age-gate') || overlay();
      band = await new Promise(function (resolve) {
        el.addEventListener('click', function (e) {
          var b = e.target.closest && e.target.closest('[data-band]');
          if (b) resolve(b.getAttribute('data-band'));
        });
      });
      el.remove();
      try { await c.auth.updateUser({ data: { age_band: band } }); } catch (e) {}
      if (band === 'under13') { await refuse(c); return false; }
      if (band === '13-17' && window.Cloud && Cloud.setRatingsVisibility) {
        try {
          var p = Cloud.fetchProfile ? await Cloud.fetchProfile(u.id) : null;
          if (!p || !p.ratings_visibility || p.ratings_visibility === 'public') await Cloud.setRatingsVisibility('friends');
        } catch (e) {}
        if (window.say) say('Your ratings start friends-only', 'Only people you follow who follow you back can see your ratings and notes. You can change this in Edit profile.');
      }
      return true;
    })();
    try { return await busy; } finally { busy = null; }
  }
  window.AgeCheck = { ensure: ensure };

  /* ---- Report and delete controls ----------------------------------------
     One delegated handler for every [data-report] button (reviews, feed posts,
     album comments, Community Choice picks), in the capture phase so a card's
     own click handler (play, open) never runs underneath it. */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-report],[data-comment-del]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (b.hasAttribute('data-report')) {
      if (window.openReport) openReport(b.getAttribute('data-report'), b.getAttribute('data-rid'), b.getAttribute('data-ruid') || null, b.getAttribute('data-rlabel') || '');
      return;
    }
    var id = b.getAttribute('data-comment-del'), c = sb();
    if (!c || !window.ask) return;
    ask({ title: 'Delete this comment?', confirm: 'Delete comment', danger: true }).then(function (yes) {
      if (!yes) return;
      c.from('feed_comments').delete().eq('id', id).then(function (r) {
        if (r && r.error) { if (window.toast) toast('Could not delete that'); return; }
        var row = b.closest('.ap-comment-row'); if (row) row.remove();
      });
    });
  }, true);

  /* ---- Moderation queue (admins only) -----------------------------------
     admin_reports() groups open reports by target and inlines the content;
     admin_resolve() removes / suspends / dismisses, closes every report on that
     target and notifies reporters and the author. The server checks is_admin,
     so this panel is convenience, not the boundary. */
  var KIND = { feed: 'Review / post', comment: 'Comment', moment: 'Choice pick', list: 'List', groove: 'Groove', lore: 'Lore note', user: 'Profile' };
  // Child-safety, danger and illegal-content reports go first and are due in
  // 24 hours; everything else is due in the 48 the terms promise.
  var URGENT = /child safety|meet up|personal details|threats|self-harm|illegal|sexual/i;
  function urgent(x) { return (x.items || []).some(function (it) { return URGENT.test(it.reason || ''); }); }
  function ageH(x) { return (Date.now() - new Date(x.first_at).getTime()) / 36e5; }
  function ageText(h) { return h < 1 ? 'just now' : h < 48 ? Math.floor(h) + 'h ago' : Math.floor(h / 24) + 'd ago'; }
  var view = 'open';
  async function purgeAvatar(c, userId) {
    // admin_resolve clears avatar_url; the file itself stays public until storage
    // deletes it, which needs the service role (delete-account route, admin mode).
    var s = await c.auth.getSession(), t = s && s.data && s.data.session && s.data.session.access_token;
    var r = await fetch((window.Native ? Native.api : '') + '/api/delete-account', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
      body: JSON.stringify({ moderate: 'avatar', user: userId }) });
    if (!r.ok) throw new Error('The photo was hidden, but its file could not be deleted. Try Remove again.');
  }
  async function mount(anchor) {
    var c = sb(); if (!c || !anchor) return;
    var host = document.getElementById('admin-mod');
    if (!host) { host = document.createElement('div'); host.id = 'admin-mod'; anchor.parentNode.insertBefore(host, anchor); }
    var tabs = '<span class="safety-row" style="margin-left:8px">' + ['open', 'actioned', 'dismissed'].map(function (v) {
      return '<button class="btn-mini" data-view="' + v + '"' + (view === v ? ' disabled' : '') + '>' + v.charAt(0).toUpperCase() + v.slice(1) + '</button>';
    }).join('') + '</span>';
    host.innerHTML = '<h3 class="prof-section-title">Reports</h3><p class="reco-note">Loading…</p>';
    var r = await c.rpc('admin_reports', { p_status: view, p_limit: 100 });
    if (r.error) {
      host.innerHTML = '<h3 class="prof-section-title">Reports</h3><p class="reco-note">' +
        (/admin_reports/.test(r.error.message || '') ? 'Moderation is not switched on yet (apply 20261015200000).' : escH(r.error.message)) + '</p>';
      return;
    }
    var open = view === 'open', rows = (r.data || []).slice();
    if (open) rows.sort(function (p, q) { return (urgent(q) - urgent(p)) || (ageH(q) - ageH(p)); });
    else rows.reverse();
    // Profile reports are often about the photo, so show it.
    var users = rows.filter(function (x) { return x.kind === 'user' && x.target_user; }).map(function (x) { return x.target_user; });
    var avatars = {};
    if (users.length) {
      var pr = await c.from('profiles').select('id,avatar_url').in('id', users);
      (pr.data || []).forEach(function (p) { avatars[p.id] = p.avatar_url; });
    }
    host.innerHTML = '<h3 class="prof-section-title">Reports <span class="reco-note">' + rows.length + ' ' + view + '</span>' + tabs + '</h3>' +
      (open ? '<p class="reco-note">Safety reports are listed first: review them within 24 hours, everything else within 48.</p>' : '') +
      (rows.length ? rows.map(function (x, i) {
        var h = ageH(x), u = urgent(x), late = open && h > (u ? 24 : 48), av = avatars[x.target_user];
        return '<div class="mod-row" data-i="' + i + '" style="border:1px solid ' + (u && open ? 'var(--red)' : 'var(--border)') + ';border-radius:12px;padding:12px;margin:0 0 10px">' +
          '<div style="font-size:12px;color:var(--text-faint)">' + (u ? '<b style="color:var(--red)">Safety</b> · ' : '') + escH(KIND[x.kind] || x.kind) + ' · ' + x.reports + ' report' + (x.reports === 1 ? '' : 's') +
            ' · by ' + escH(x.target_username || 'unknown') + ' · ' + ageText(h) + (late ? ' · <b style="color:var(--red)">overdue</b>' : '') +
            (x.suspended ? ' · <b style="color:var(--red)">suspended</b>' : '') + '</div>' +
          (x.kind === 'user' && av ? '<img src="' + escH(av) + '" alt="Reported profile photo" style="width:96px;height:96px;object-fit:cover;border-radius:10px;margin-top:8px">' : '') +
          '<div style="margin:6px 0;white-space:pre-wrap;word-break:break-word">' + (x.content == null ? '<i>(already gone)</i>' : escH(String(x.content).slice(0, 600))) + '</div>' +
          '<div style="font-size:12px;color:var(--text-dim)">' + (x.items || []).map(function (it) {
            return escH(it.reason) + (it.note ? ' — “' + escH(it.note) + '”' : '') + ' (' + escH(it.reporter || '?') + ')';
          }).join('<br>') + '</div>' +
          '<div class="safety-row" style="margin-top:8px">' +
            (open ? '<button class="btn-mini" data-mod="dismiss">Dismiss</button>' +
              (x.kind === 'user' ? '<button class="btn-mini" data-mod="remove">Clear bio &amp; photo</button>' : '<button class="btn-mini" data-mod="remove">Remove</button>') +
              '<button class="btn-mini" data-mod="remove_suspend" style="color:var(--red)">Remove + suspend</button>' : '') +
            (x.suspended && x.target_user ? '<button class="btn-mini" data-mod="unsuspend">Unsuspend</button>' : '') +
          '</div></div>';
      }).join('') : '<p class="reco-note">' + (open ? 'Nothing waiting.' : 'None yet.') + '</p>');
    host.onclick = async function (e) {
      var v = e.target.closest('[data-view]');
      if (v) { view = v.getAttribute('data-view'); return mount(anchor); }
      var b = e.target.closest('[data-mod]'); if (!b) return;
      var x = rows[+b.closest('.mod-row').getAttribute('data-i')], act = b.getAttribute('data-mod');
      if (act === 'unsuspend') { await c.rpc('admin_unsuspend', { p_user: x.target_user }); return mount(anchor); }
      var note = null;
      if (act !== 'dismiss') {
        note = window.ask ? await ask({ title: act === 'remove_suspend' ? 'Remove and suspend?' : 'Remove this?', body: 'Reason shown to the author:',
          input: true, maxlength: 140, confirm: act === 'remove_suspend' ? 'Remove + suspend' : 'Remove', danger: true }) : '';
        if (note === null && window.ask) return;   // cancelled
      }
      b.disabled = true;
      var res = await c.rpc('admin_resolve', { p_kind: x.kind, p_target: x.target, p_action: act, p_note: note || null });
      if (res.error) { b.disabled = false; if (window.say) say('Could not do that', escH(res.error.message)); return; }
      if (act !== 'dismiss' && x.kind === 'user' && x.target_user) {
        try { await purgeAvatar(c, x.target_user); } catch (err) { if (window.say) say('Photo file not deleted', escH(err.message)); }
      }
      mount(anchor);
    };
  }
  window.ModQueue = { mount: mount };
})();
