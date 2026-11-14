/* RIGHTS — where the catalogue, artwork and previews come from.

   App Review rejected 1.0 under 5.2.3: VINALL could show no permission for
   the Deezer catalogue it was built on. Apple publishes terms that DO cover a
   rating and discovery app (iTunes Search API, "Legal"; DPLA §3.3.6(F)):
   metadata, artwork and 30-second previews may be used to promote the record,
   next to a badge linking to it, with previews attributed and streamed only,
   and never for "independent entertainment value". So in the iOS app the
   catalogue is Apple's, and the games that would use sleeves or clips as game
   content are held back. See APPLE_REVIEW_FIXES/ for the evidence pack.

   ONE SWITCH. `Rights.ON` is true in the native app and false on the web,
   which is untouched until the owner decides otherwise. `?rights=apple` /
   `?rights=deezer` overrides it on this device (kept in localStorage), so the
   Apple build can be tested in a browser. Same arrangement as Cert.ON.

   ONE SEAM. Rather than teach forty call sites a second provider, this answers
   the app's own /api/catalogue and /api/preview requests on the device, in the
   exact shapes those routes return. Nothing above it knows which service
   replied — the same trick _toCatalogue played when Spotify became Deezer.

   ON THE DEVICE, NOT ON VERCEL, because Apple limits the Search API to
   "approximately 20 calls per minute" per IP; a shared server IP would hit it
   for everybody at once. Metadata is cached a day (Apple's own doc asks large
   users to cache search and lookup); preview AUDIO is never cached — the url
   string is kept, the file is streamed by the <audio> element like any page.

   IDS. Apple collection/track/artist ids are numeric, and so are Deezer's, so
   an Apple id is written `am<digits>` — a Deezer id in somebody's crate must
   never be looked up as an Apple one (trap 4: two keys for one record). Any id
   that is not `am…` is resolved by name + artist, the legacy path every caller
   already feeds. Nothing stored is re-keyed. */
(function () {
  var q = new URLSearchParams(location.search);
  var force = q.get('rights');
  try { if (force === 'apple' || force === 'deezer') localStorage.setItem('vinall_rights', force); } catch (e) {}
  var stored = null; try { stored = localStorage.getItem('vinall_rights'); } catch (e) {}
  /* The native app is ALWAYS the Apple build. The override exists only so the
     website can preview it: a `?rights=deezer` once visited inside the app
     (a test link, a shared URL) must never put Recall back in the App Store
     build, so it is ignored there. */
  var ON = (window.Native && Native.on) ? true : stored ? stored === 'apple' : false;

  var BADGE = '/assets/apple-music-badge.svg';
  var COURTESY = 'Preview provided courtesy of iTunes';   // the Search API terms' own words, (iii)

  /* The badge is Apple's own file from tools.applemediaservices.com, unaltered.
     Apple's guidelines allow one per layout; callers place it on the screen
     that promotes the record, linking to that record. */
  function badge(href, size) {
    var h = size === 's' ? 30 : 40;
    return '<a class="am-badge" href="' + String(href || 'https://music.apple.com/gb/').replace(/"/g, '&quot;') +
      '" target="_blank" rel="noopener" aria-label="Listen on Apple Music"><img src="' + BADGE +
      '" alt="Listen on Apple Music" height="' + h + '" style="height:' + h + 'px;width:auto;display:block"></a>';
  }
  function isApple(u) { return /^https:\/\/(is\d-ssl\.mzstatic\.com|[a-z0-9-]+\.mzstatic\.com)\//.test(String(u || '')); }
  function isDeezerArt(u) { return /dzcdn\.net|cdn-images\.deezer|api\.deezer\.com/.test(String(u || '')); }

  window.Rights = {
    ON: ON, badge: badge, courtesy: COURTESY, isAppleArt: isApple, isDeezerArt: isDeezerArt,
    /* Game modes that use a third-party sleeve or clip AS the game. Held back
       in the Apple build until a licence names games (see the evidence pack). */
    /* Guess the Year and Guess from Tracklist quiz on Apple-supplied facts
       (release years, track titles). Held back too (owner's call, 2026-11-14)
       until Apple confirms that is within the Search API terms. Code kept. */
    gameOff: function (key) { return ON && /^(recall|cover|coverx|year|tracklist)$/.test(key); }
  };
  if (!ON) return;
  document.documentElement.classList.add('rights-apple');

  /* No Deezer marks in this build: Deezer supplies nothing here, and a mark
     with nothing behind it is the "Powered by Deezer" that drew the 5.2.3
     question. The credits say where the catalogue now comes from. */
  var css = document.createElement('style');
  css.textContent =
    'img[src*="deezer-mark"],img[src*="deezer-logo"]{display:none!important}' +
    /* Held back in this build: Recall plays clips, the two cover games show
       sleeves, as the game itself. No licence names games yet. */
    '#recall-card,#cover-card,#coverx-card,#year-card,#tracklist-card{display:none!important}' +
    '.am-badge{display:inline-flex;align-items:center;text-decoration:none;flex-shrink:0}' +
    '.am-credit{font-size:11px;opacity:.75}' +
    '.fy-am{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:10.5px;line-height:1.25;color:rgba(255,255,255,.78)}' +
    '.am-pill{position:fixed;left:50%;bottom:calc(var(--nav-h,64px) + env(safe-area-inset-bottom,0px) + 18px);transform:translate(-50%,12px);z-index:170;display:flex;align-items:center;gap:8px;padding:6px 12px 6px 6px;border-radius:999px;background:rgba(10,9,12,.92);color:#fff;font-size:11px;text-decoration:none;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;white-space:nowrap}' +
    '.am-pill.on{opacity:1;transform:translate(-50%,0);pointer-events:auto}' +
    '.am-pill img{height:26px;width:auto;display:block}';
  document.head.appendChild(css);
  function credits() {
    document.querySelectorAll('a.dz-credit[href="https://www.deezer.com"]').forEach(function (a) {
      var s = document.createElement('span');
      s.className = (a.className.replace('dz-credit', '') + ' am-credit').trim();
      s.textContent = 'Catalogue, artwork and previews provided courtesy of iTunes';
      a.replaceWith(s);
    });
    // Cover Fire's answers are names in this build, not sleeves.
    document.querySelectorAll('#blitz-card p, #blitz-modal p').forEach(function (p) {
      p.textContent = p.textContent.replace(/^Ten sleeves/, 'Ten records');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', credits); else credits();

  var _fetch = window.fetch.bind(window);
  var COUNTRY = 'gb';

  /* ---- Apple, rate-held ------------------------------------------------ */
  // ponytail: one rolling window per device; if Apple tightens the limit or
  // For You needs more, move lookups to Apple's batch `lookup?id=a,b,c`.
  var WINDOW = 60000, MAX = 20, stamps = [], pauseUntil = 0;
  function slot() {
    var now = Date.now();
    while (stamps.length && now - stamps[0] > WINDOW) stamps.shift();
    var wait = Math.max(pauseUntil - now, stamps.length >= MAX ? WINDOW - (now - stamps[0]) + 50 : 0);
    if (wait > 0) return new Promise(function (r) { setTimeout(r, wait); }).then(slot);
    stamps.push(now);
    return Promise.resolve();
  }
  var mem = {}, inflight = {}, TTL = 86400000, CK = 'am1:';
  function cacheGet(k) {
    var h = mem[k]; if (h && h.x > Date.now()) return h.d;
    try { var o = JSON.parse(localStorage.getItem(CK + k)); if (o && o.x > Date.now()) { mem[k] = o; return o.d; } } catch (e) {}
    return null;
  }
  function cacheSet(k, d) {
    var o = { d: d, x: Date.now() + TTL }; mem[k] = o;
    try { localStorage.setItem(CK + k, JSON.stringify(o)); } catch (e) {
      try { Object.keys(localStorage).forEach(function (x) { if (x.indexOf(CK) === 0) localStorage.removeItem(x); }); } catch (e2) {}
    }
  }
  function itunes(kind, params) {
    params.country = COUNTRY;
    var url = 'https://itunes.apple.com/' + kind + '?' + new URLSearchParams(params).toString();
    var hit = cacheGet(url); if (hit) return Promise.resolve(hit);
    if (inflight[url]) return inflight[url];
    var p = (function attempt(n) {
      return slot().then(function () {
        var ctrl = new AbortController(), to = setTimeout(function () { ctrl.abort(); }, 12000);
        return _fetch(url, { signal: ctrl.signal }).finally(function () { clearTimeout(to); });
      }).then(function (r) {
        // Apple answers an exceeded limit with 403 (sometimes 429).
        if ((r.status === 403 || r.status === 429) && n < 2) { pauseUntil = Date.now() + 30000; return attempt(n + 1); }
        if (r.status >= 500 && n < 2) return new Promise(function (ok) { setTimeout(ok, 800 * (n + 1)); }).then(function () { return attempt(n + 1); });
        if (!r.ok) { var e = new Error('apple ' + r.status); e.status = r.status; throw e; }
        return r.json();
      }, function (err) {
        if (n < 2) return new Promise(function (ok) { setTimeout(ok, 600 * (n + 1)); }).then(function () { return attempt(n + 1); });
        throw err;
      });
    })(0).then(function (j) { delete inflight[url]; if (j && j.resultCount) cacheSet(url, j); return j; },
               function (e) { delete inflight[url]; throw e; });
    inflight[url] = p;
    return p;
  }

  /* ---- matching (same discipline as api/catalogue.js pickAlbum) -------- */
  function loose(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/ - (single|ep)$/i, '')
      .replace(/[^a-z0-9]+/g, '');
  }
  var BAD = /\b(karaoke|tribute|made popular|originally performed|in the style of|backing track|parody|8-bit|lullaby renditions?)\b/i;
  function amId(id) { var m = /^am(\d+)$/.exec(String(id || '')); return m ? m[1] : null; }

  /* Apple names singles and EPs in the title ("Moon River - Single"). That
     suffix is the evidence; the track count settles the rest on the Official
     Charts Company's lines (single <=3, EP 4-6, album 7+), as _artists.js does. */
  function kindOf(c) {
    var n = c.collectionName || '';
    if (/ - Single$/i.test(n)) return 'single';
    if (/ - EP$/i.test(n)) return 'ep';
    var t = c.trackCount || 0;
    return t && t <= 3 ? 'single' : t && t <= 6 ? 'ep' : 'album';
  }
  function cleanName(n) { return String(n || '').replace(/ - (Single|EP)$/i, ''); }
  function art(u, px) { return u ? String(u).replace(/\/\d+x\d+bb\.(jpg|png)$/, '/' + px + 'x' + px + 'bb.jpg') : null; }
  function images(u) {
    if (!u) return [];
    return [{ url: art(u, 1000), width: 1000, height: 1000 }, { url: art(u, 600), width: 600, height: 600 }, { url: art(u, 300), width: 300, height: 300 }];
  }
  function albumLite(c) {
    var k = kindOf(c);
    return {
      id: 'am' + c.collectionId, name: cleanName(c.collectionName),
      album_type: k === 'single' ? 'single' : (c.collectionType === 'Compilation' ? 'compilation' : 'album'),
      kind: k, kind_confident: true, total_tracks: c.trackCount || 0, fans: 0,
      release_date: String(c.releaseDate || '').slice(0, 10), images: images(c.artworkUrl100),
      artists: [{ id: 'am' + c.artistId, name: c.artistName }],
      external_urls: { spotify: c.collectionViewUrl || '' }, link: c.collectionViewUrl || '',
      uri: 'apple:album:' + c.collectionId, source: 'apple',
      genres: c.primaryGenreName ? [c.primaryGenreName] : [], label: String(c.copyright || '').replace(/^[℗©]\s*\d*\s*/, '')
    };
  }
  function trackItem(t, i) {
    note(t.previewUrl, t.trackViewUrl);
    return {
      id: 'am' + t.trackId, name: t.trackName, duration_ms: t.trackTimeMillis || 0,
      track_number: t.trackNumber || (i + 1), disc_number: t.discNumber || 1,
      preview_url: t.previewUrl || null,
      artists: [{ id: 'am' + t.artistId, name: t.artistName }],
      uri: 'apple:track:' + t.trackId, link: t.trackViewUrl || '', source: 'apple'
    };
  }

  /* APPLE'S ALBUM INDEX IS WEAK ON MIXED TEXT. Measured: "frank ocean blonde"
     as an album search returns seven singles and no Blonde, while the same
     words as a SONG search return Blonde's tracks first. So albums are
     gathered from both: the collections the matching songs belong to (in the
     order they first appear), then whatever the album index adds. */
  function albumSearch(term) {
    return Promise.all([
      itunes('search', { media: 'music', entity: 'song', limit: '50', term: term }).catch(function () { return null; }),
      itunes('search', { media: 'music', entity: 'album', limit: '25', term: term }).catch(function () { return null; })
    ]).then(function (both) {
      if (!both[0] && !both[1]) throw new Error('apple search failed');
      var seen = {}, out = [];
      ((both[0] && both[0].results) || []).forEach(function (t) {
        if (!t.collectionId || seen[t.collectionId]) return;
        seen[t.collectionId] = 1;
        out.push({ wrapperType: 'collection', collectionId: t.collectionId, collectionName: t.collectionName,
          artistId: t.artistId, artistName: t.collectionArtistName || t.artistName, artworkUrl100: t.artworkUrl100,
          trackCount: t.trackCount, releaseDate: t.releaseDate, collectionViewUrl: String(t.collectionViewUrl || '').replace(/[?&]i=\d+/, ''),
          primaryGenreName: t.primaryGenreName, collectionType: t.collectionArtistName === 'Various Artists' ? 'Compilation' : 'Album' });
      });
      ((both[1] && both[1].results) || []).forEach(function (c) { if (!seen[c.collectionId]) { seen[c.collectionId] = 1; out.push(c); } });
      return out;
    });
  }
  function pickAlbum(name, artist) {
    var key = 'pick:' + loose(artist) + '|' + loose(name);
    var known = cacheGet(key); if (known) return Promise.resolve(known.c || null);
    return albumSearch(((artist ? artist + ' ' : '') + name).trim()).then(function (rs) {
      var wa = loose(name), war = loose(artist), best = null, bs = 0;
      rs.forEach(function (r) {
        if (BAD.test(r.collectionName || '') || BAD.test(r.artistName || '')) return;
        var t = loose(r.collectionName), a = loose(r.artistName), s = 0;
        if (t === wa) s += 5; else if (t.indexOf(wa) === 0 || wa.indexOf(t) === 0) s += 3; else return;
        if (!war) s += 1; else if (a === war) s += 3; else if (a.indexOf(war) >= 0 || war.indexOf(a) >= 0) s += 2; else return;
        if (kindOf(r) === 'album') s += 1;                     // the album over its title-track single
        if (!/deluxe|edition|remaster|anniversary|expanded/i.test(r.collectionName || '')) s += 0.5;
        if (s > bs) { bs = s; best = r; }
      });
      cacheSet(key, { c: best });
      return best;
    });
  }
  function albumWithTracks(collectionId) {
    return itunes('lookup', { id: collectionId, entity: 'song', limit: '200' }).then(function (j) {
      var rs = (j && j.results) || [];
      var c = rs.filter(function (r) { return r.wrapperType === 'collection'; })[0];
      if (!c) return null;
      var tracks = rs.filter(function (r) { return r.wrapperType === 'track' && r.kind === 'song'; })
        .sort(function (a, b) { return (a.discNumber - b.discNumber) || (a.trackNumber - b.trackNumber); });
      return { c: c, tracks: tracks };
    });
  }
  /* An artist's own full albums in Apple's order, which is best-known first:
     not singles, not EPs, not records they only feature on. */
  function ownAlbums(rs, aid) {
    return rs.filter(function (r) {
      return r.wrapperType === 'collection' && String(r.artistId) === String(aid) && kindOf(r) === 'album' &&
        r.collectionType !== 'Compilation' && !NOT_STUDIO.test(r.collectionName || '');
    });
  }
  /* Apple has no artist photographs. Where an artist needs a picture (search
     results, the pickers, Replay), it gets the sleeve of its best-known album:
     one batch lookup for a whole list. */
  function leadAlbums(ids) {
    if (!ids.length) return Promise.resolve({});
    return itunes('lookup', { id: ids.join(','), entity: 'album', limit: '25' }).then(function (j) {
      var rs = (j && j.results) || [], out = {};
      ids.forEach(function (id) { var a = ownAlbums(rs, id)[0]; if (a) out[id] = a.artworkUrl100; });
      return out;
    }, function () { return {}; });
  }
  function resolveArtist(id, name) {
    var n = amId(id); if (n) return Promise.resolve(n);
    if (!name) return Promise.resolve(null);
    return itunes('search', { media: 'music', entity: 'musicArtist', attribute: 'artistTerm', limit: '10', term: name }).then(function (j) {
      var want = loose(name), rs = (j && j.results) || [];
      var hit = rs.filter(function (r) { return loose(r.artistName) === want; })[0] || null;
      return hit ? String(hit.artistId) : null;
    });
  }

  /* ---- the routes, answered here --------------------------------------- */
  var NOT_STUDIO = /\b(live|unplugged|in concert|at the|karaoke|tribute|instrumental|remix(es|ed)?|commentary|b-?sides|rarities|greatest hits|best of|the collection|anthology|box ?set)\b|\((demos?|sessions?)\)|\b(demos?|sessions?)\s*$/i;
  var EDITION = /\s*[([]?[^()[\]]*\b(deluxe|edition|remaster(ed)?|anniversary|expanded|bonus|version)\b[^()[\]]*[)\]]?\s*$/i;

  function catalogue(p) {
    var path = p.get('path');
    if (path === 'album') {
      var id = p.get('id') || '', n = amId(id);
      var find = n ? Promise.resolve(n) : (p.get('name') ? pickAlbum(p.get('name'), p.get('artist') || '').then(function (c) { return c ? String(c.collectionId) : null; }) : Promise.resolve(null));
      return find.then(function (cid) {
        if (!cid) return [404, { error: { status: 404, message: 'not found' } }];
        return albumWithTracks(cid).then(function (x) {
          if (!x) return [404, { error: { status: 404, message: 'not found' } }];
          var out = albumLite(x.c);
          out.tracks = { items: x.tracks.map(trackItem), total: x.c.trackCount || x.tracks.length };
          out.legacy_id = n ? null : id;
          return [200, out];
        });
      });
    }
    if (path === 'search') {
      var term = (p.get('q') || '').slice(0, 200), type = p.get('type') || 'album', limit = Math.min(parseInt(p.get('limit'), 10) || 10, 25);
      if (!term) return Promise.resolve([400, { error: { status: 400, message: 'q required' } }]);
      var out = {}, jobs = [];
      if (/album/.test(type)) jobs.push(albumSearch(term).then(function (rs) {
        var items = rs.filter(function (c) { return !BAD.test(c.collectionName || ''); }).map(albumLite).slice(0, Math.max(limit, 15));
        out.albums = { items: items, total: items.length };
      }));
      if (/track/.test(type)) jobs.push(itunes('search', { media: 'music', entity: 'song', limit: String(Math.max(limit, 25)), term: term }).then(function (j) {
        var seen = {}, items = [];
        ((j && j.results) || []).forEach(function (t) {
          if (!t.trackId || BAD.test(t.trackName || '') || BAD.test(t.collectionName || '')) return;
          var k = loose(t.artistName) + '|' + loose(t.trackName); if (seen[k]) return; seen[k] = 1;
          var it = trackItem(t, 0);
          it.album = { id: 'am' + t.collectionId, name: cleanName(t.collectionName), images: images(t.artworkUrl100) };
          it.external_urls = { spotify: t.trackViewUrl || '' };
          items.push(it);
        });
        out.tracks = { items: items.slice(0, limit), total: items.length };
      }));
      if (/artist/.test(type)) jobs.push(itunes('search', { media: 'music', entity: 'musicArtist', limit: String(Math.max(limit, 10)), term: term }).then(function (j) {
        var want = loose(term);
        var rs = ((j && j.results) || []).map(function (a, i) {
          var l = loose(a.artistName);
          return { a: a, r: (l === want ? 0 : l.indexOf(want) === 0 ? 1 : l.indexOf(want) >= 0 ? 2 : 3) * 100 + i };
        }).sort(function (x, y) { return x.r - y.r; });
        rs = rs.slice(0, limit);
        return leadAlbums(rs.map(function (x) { return String(x.a.artistId); })).then(function (lead) {
          out.artists = { items: rs.map(function (x) {
            return { id: 'am' + x.a.artistId, name: x.a.artistName, source: 'apple', fans: 0,
              images: lead[x.a.artistId] ? images(lead[x.a.artistId]) : [], image_kind: 'album', external_urls: { spotify: x.a.artistLinkUrl || '' } };
          }), total: rs.length };
        });
      }));
      return Promise.all(jobs).then(function () { return [200, out]; });
    }
    if (path === 'track') {
      var tn = amId(p.get('id'));
      if (!tn) return Promise.resolve([404, { error: { status: 404, message: 'not an Apple id' } }]);
      return itunes('lookup', { id: tn }).then(function (j) {
        var t = ((j && j.results) || [])[0];
        if (!t) return [404, { error: { status: 404, message: 'not found' } }];
        var it = trackItem(t, 0);
        it.title = t.trackName;
        it.artists = [{ id: 'am' + t.artistId, name: t.artistName, role: 'Main' }];
        it.album = { id: 'am' + t.collectionId, name: cleanName(t.collectionName), images: images(t.artworkUrl100) };
        return [200, it];
      });
    }
    if (path === 'artist') {
      return resolveArtist(p.get('id'), p.get('name')).then(function (aid) {
        if (!aid) return [200, { id: p.get('id'), name: p.get('name') || '', source: 'apple', images: [], external_urls: { spotify: '' } }];
        return itunes('lookup', { id: aid, entity: 'album', limit: '25' }).then(function (j) {
          var rs = (j && j.results) || [];
          var a = rs.filter(function (r) { return r.wrapperType === 'artist'; })[0] || {};
          var lead = ownAlbums(rs, aid)[0];
          return [200, { id: 'am' + aid, name: a.artistName || p.get('name') || '', source: 'apple',
            images: lead ? images(lead.artworkUrl100) : [], image_kind: 'album', external_urls: { spotify: a.artistLinkUrl || '' } }];
        });
      });
    }
    if (path === 'artist-albums') {
      return resolveArtist(p.get('id'), p.get('name')).then(function (aid) {
        if (!aid) return [200, { items: [], total: 0 }];
        return itunes('lookup', { id: aid, entity: 'album', limit: '200' }).then(function (j) {
          var items = ((j && j.results) || []).filter(function (r) { return r.wrapperType === 'collection' && String(r.artistId) === aid; }).map(albumLite);
          // Apple lists an artist's records best-known first (Blonde before
          // channel ORANGE). That order is carried as `fans`, a rank, so the
          // hero's "most popular records" ordering works on Apple too.
          items.forEach(function (a, i) { a.fans = 1000 - i; a._ord = i; });
          if ((p.get('include_groups') || 'album') === 'album') {
            items = items.filter(function (a) { return (a.kind === 'album' || a.kind === 'ep') && a.album_type !== 'compilation' && !NOT_STUDIO.test(a.name); });
            // Editions fold into the plain record, earliest release kept.
            var by = {};
            items.sort(function (a, b) { return a.release_date < b.release_date ? -1 : 1; }).forEach(function (a) {
              var k = loose(a.name.replace(EDITION, '')); if (!by[k]) by[k] = a;
            });
            items = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return a._ord - b._ord; });
          }
          return [200, { items: items, total: items.length }];
        });
      });
    }
    return null;   // anything else (chart-artists, spotify-match) goes to the server
  }

  // /api/preview — the clip list for one album, or one track.
  function preview(p) {
    var artist = p.get('artist') || '', album = p.get('album') || '', track = p.get('track') || '';
    if (!artist || (!album && !track)) return Promise.resolve([400, { error: 'artist plus album or track is required' }]);
    if (track) {
      return itunes('search', { media: 'music', entity: 'song', limit: '25', term: artist + ' ' + track }).then(function (j) {
        var wt = loose(track), wa = loose(artist), best = null, bs = -1;
        ((j && j.results) || []).forEach(function (t) {
          if (!t.previewUrl || loose(t.trackName) !== wt) return;
          var ta = loose(t.artistName);
          if (ta !== wa && ta.indexOf(wa) < 0 && wa.indexOf(ta) < 0) return;
          if (BAD.test(t.trackName) || BAD.test(t.collectionName || '') || BAD.test(t.artistName)) return;
          var s = (ta === wa ? 4 : 0) + (/[([]/.test(t.trackName) ? 0 : 3) + (/\b(live|remix|sped up|slowed|acoustic|demo)\b/i.test(t.trackName + ' ' + t.collectionName) ? 0 : 3);
          if (s > bs) { bs = s; best = t; }
        });
        if (best) note(best.previewUrl, best.trackViewUrl);
        return [200, best ? { source: 'apple', mode: 'track', album: cleanName(best.collectionName), artist: best.artistName,
          cover: art(best.artworkUrl100, 1000), link: best.trackViewUrl,
          tracks: [{ title: best.trackName, preview: best.previewUrl, ms: best.trackTimeMillis || 0, link: best.trackViewUrl }] }
          : { source: 'apple', mode: 'track', album: null, tracks: [] }];
      });
    }
    return pickAlbum(album, artist).then(function (c) {
      if (!c) return [200, { source: 'apple', album: null, tracks: [] }];
      return albumWithTracks(c.collectionId).then(function (x) {
        if (!x) return [200, { source: 'apple', album: null, tracks: [] }];
        return [200, { source: 'apple', album: cleanName(x.c.collectionName), artist: x.c.artistName, link: x.c.collectionViewUrl,
          cover: art(x.c.artworkUrl100, 1000),
          tracks: x.tracks.filter(function (t) { return t.previewUrl; }).map(function (t) { note(t.previewUrl, t.trackViewUrl); return { title: t.trackName, preview: t.previewUrl, ms: t.trackTimeMillis || 0, link: t.trackViewUrl }; }) }];
      });
    });
  }

  /* ---- the credit beside every preview -------------------------------- */
  /* Apple's terms: a preview is attributed "provided courtesy of" and sits by
     a link to the record. The album page's player bar and every For You card
     carry their own; anything else that plays a clip (a song row, a Today
     card, Your music) gets this pill for as long as the clip plays. It listens
     to the media elements themselves, so no caller has to remember it. */
  var linkOf = {};
  function note(preview, link) { if (preview && link) linkOf[preview] = link; }
  var pill = null, hideT = 0;
  function showPill(src) {
    if (document.body.dataset.section === 'foryou' || document.querySelector('#player-bar.up')) return;
    if (!pill) {
      pill = document.createElement('a');
      pill.className = 'am-pill'; pill.target = '_blank'; pill.rel = 'noopener';
      pill.innerHTML = '<img src="' + BADGE + '" alt="Listen on Apple Music" height="26"><span>' + COURTESY + '</span>';
      document.body.appendChild(pill);
    }
    pill.href = linkOf[src] || 'https://music.apple.com/gb/';
    clearTimeout(hideT);
    pill.classList.add('on');
  }
  function hidePill() { clearTimeout(hideT); hideT = setTimeout(function () { if (pill) pill.classList.remove('on'); }, 1200); }
  document.addEventListener('play', function (ev) {
    var s = ev.target && ev.target.currentSrc || '';
    if (/itunes\.apple\.com|apple\.com\/itunes-assets/.test(s)) showPill(s);
  }, true);
  document.addEventListener('pause', hidePill, true);
  document.addEventListener('ended', hidePill, true);

  function respond(pair) {
    return new Response(JSON.stringify(pair[1]), { status: pair[0], headers: { 'Content-Type': 'application/json' } });
  }
  function fail(e) { return respond([502, { error: { status: 502, message: String((e && e.message) || e) } }]); }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var u; try { u = new URL(url, location.href); } catch (e) { return _fetch(input, init); }
    var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (method === 'GET' && /\/api\/catalogue$/.test(u.pathname)) {
      if (u.searchParams.get('path') === 'chart-artists') {
        u.searchParams.set('source', 'apple');
        return _fetch(u.toString(), init);
      }
      var r = catalogue(u.searchParams);
      if (r) return r.then(respond, fail);
    }
    if (method === 'GET' && /\/api\/preview$/.test(u.pathname)) return preview(u.searchParams).then(respond, fail);
    if (/\/api\/catalogue$/.test(u.pathname) && u.searchParams.get('path') === 'spotify-match') {
      var body = {}; try { body = JSON.parse((init && init.body) || '{}'); } catch (e) {}
      return spotifyMatch(body).then(respond, fail);
    }
    return _fetch(input, init);
  };

  /* ---- a Spotify export, matched against Apple ------------------------ */
  /* The server matches against Deezer, which this build does not use, so the
     same rules (assets/match.js, which api/_match.js re-exports: one copy) run
     here against Apple's search, through the same limiter. Apple's results are
     put in the candidate shape those rules read. Slower than the server for a
     big library (the limit is ~20 searches a minute); the import job already
     survives closing the sheet. */
  var matchLib = null;
  function lib() { return matchLib || (matchLib = import('/assets/match.js')); }
  function asTrack(t) {
    return { id: 'am' + t.trackId, title: t.trackName, artist: { name: t.artistName },
      album: { id: 'am' + t.collectionId, title: cleanName(t.collectionName), cover_medium: art(t.artworkUrl100, 300) } };
  }
  function asAlbum(c) {
    return { id: 'am' + c.collectionId, title: cleanName(c.collectionName), artist: { name: c.artistName }, cover_medium: art(c.artworkUrl100, 300) };
  }
  /* A song: the ALBUM's own tracklist first when the export names one.
     Apple's song search can miss the obvious ("Frank Ocean Nikes" returns
     eight other Frank Ocean songs and a piano tribute), while its album lookup
     is reliable — and is cached, so every track on one record costs one
     lookup between them. Song search is the fallback. */
  function matchTrack(M, want) {
    var best = { status: 'none', best: null, alts: [] };
    function take(cands) {
      var d = M.decide(cands.map(function (c) { return { c: c, s: M.scoreTrack(want, c) }; }));
      if (d.status === 'ok' || (best.status === 'none' && d.status === 'check')) best = d;
      return best.status === 'ok';
    }
    var viaAlbum = want.b ? pickAlbum(M.base(want.b), want.a).then(function (c) {
      return c ? albumWithTracks(c.collectionId).then(function (x) { return x ? take(x.tracks.map(asTrack)) : false; }) : false;
    }) : Promise.resolve(false);
    return viaAlbum.then(function (done) {
      if (done) return;
      return itunes('search', { media: 'music', entity: 'song', limit: '50', term: (want.a + ' ' + M.base(want.t)).trim() })
        .then(function (j) { take(((j && j.results) || []).filter(function (t) { return t.trackId; }).map(asTrack)); });
    }).then(function () {
      return { status: best.status, m: M.trackOut(best.best), alts: best.status === 'check' ? best.alts.map(M.trackOut) : [] };
    });
  }
  function spotifyMatch(body) {
    var kind = body.kind === 'album' ? 'album' : 'track';
    var items = (Array.isArray(body.items) ? body.items : []).slice(0, 10);
    return lib().then(function (M) {
      return Promise.all(items.map(function (it) {
        var want = { a: String(it.a || ''), t: String(it.t || ''), b: String(it.b || '') };
        var job = kind === 'album'
          ? albumSearch((want.a + ' ' + M.base(want.b)).trim()).then(function (rs) {
              var d = M.decide(rs.map(asAlbum).map(function (c) { return { c: c, s: M.scoreAlbum(want, c) }; }));
              return { status: d.status, m: M.albumOut(d.best), alts: d.status === 'check' ? d.alts.map(M.albumOut) : [] };
            })
          : matchTrack(M, want);
        return job.then(function (r) { r.u = it.u; return r; },
                        function () { return { u: it.u, status: 'retry', m: null, alts: [] }; });
      }));
    }).then(function (results) { return [200, { results: results }]; });
  }

  /* ---- artwork that is not Apple's ------------------------------------ */
  /* Ratings, feed posts and game pools made before this carry Deezer sleeve
     urls. In this build no Deezer image is requested: a Deezer src is swapped
     for VINALL's own blank sleeve before the browser fetches it (a
     MutationObserver runs before an <img> starts loading), and where the
     record is named on the element the Apple sleeve is looked up. */
  var BLANK = '/assets/sleeve-blank.svg';
  /* Inside a game, NO third-party sleeve is shown, Apple's included: Apple's
     terms are promotional and exclude "independent entertainment value", and
     a sleeve in a game sheet is game content. The record's name still shows. */
  var GAMES = '#game,#drop-modal,#blitz-modal,#hl-modal,#ew-modal,#war-modal,#recall-modal,#tournament-modal,#tourney-modal,#games-grid';
  var MUSIC_ART = /dzcdn\.net|cdn-images\.deezer|mzstatic\.com|i\.scdn\.co/;

  /* BEFORE THE DOM, NOT AFTER IT. The observer below cannot promise the swap
     happens before the fetch: an <img> whose src is set before it is attached
     starts loading at once, and parser timing varies by engine (the rights test
     caught a real request). So a Deezer image url is rewritten on its way in:
     every innerHTML / outerHTML / insertAdjacentHTML string, every img.src and
     every setAttribute('src'). The blank keeps the original in its fragment
     (#dz=…), which costs no request and lets fixImg still find the record. */
  var DZ_IMG = /https?:\/\/(?:[a-z0-9-]+\.)?dzcdn\.net\/[^"'\s)<>]*|https?:\/\/cdn-images\.deezer\.com\/[^"'\s)<>]*/g;
  function scrub(v) {
    if (typeof v !== 'string' || (v.indexOf('dzcdn') < 0 && v.indexOf('cdn-images.deezer') < 0)) return v;
    return v.replace(DZ_IMG, function (u) { return BLANK + '#dz=' + encodeURIComponent(u); });
  }
  (function patch() {
    function wrapSetter(proto, prop) {
      var d = Object.getOwnPropertyDescriptor(proto, prop);
      if (!d || !d.set) return;
      Object.defineProperty(proto, prop, { configurable: true, enumerable: d.enumerable, get: d.get,
        set: function (v) { d.set.call(this, scrub(v)); } });
    }
    wrapSetter(Element.prototype, 'innerHTML');
    wrapSetter(Element.prototype, 'outerHTML');
    wrapSetter(HTMLImageElement.prototype, 'src');
    var iah = Element.prototype.insertAdjacentHTML;
    Element.prototype.insertAdjacentHTML = function (pos, html) { return iah.call(this, pos, scrub(html)); };
    var sa = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      return sa.call(this, name, (name === 'src' || name === 'style' || name === 'srcset') ? scrub(String(value)) : value);
    };
  })();

  function fixImg(img) {
    var s = img.getAttribute('src') || '';
    if (s.indexOf(BLANK + '#dz=') === 0) {
      // Already blank (scrubbed on the way in): keep the original for the lookup.
      try { img.setAttribute('data-dz', decodeURIComponent(s.slice(BLANK.length + 4))); } catch (e) {}
      img.setAttribute('src', BLANK);
      return;
    }
    if (MUSIC_ART.test(s) && img.closest && img.closest(GAMES)) { img.setAttribute('src', BLANK); return; }
    if (!isDeezerArt(s)) return;
    img.setAttribute('data-dz', s);
    img.setAttribute('src', BLANK);
    if (img.srcset) img.removeAttribute('srcset');
  }
  function sweep(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.tagName === 'IMG') fixImg(root);
    var list = root.querySelectorAll ? root.querySelectorAll('img[src*="dzcdn"],img[src*="deezer"]') : [];
    for (var i = 0; i < list.length; i++) fixImg(list[i]);
    if (root.style && isDeezerArt(root.style.backgroundImage)) root.style.backgroundImage = 'url("' + BLANK + '")';
  }
  new MutationObserver(function (muts) {
    muts.forEach(function (m) {
      if (m.type !== 'attributes') { for (var i = 0; i < m.addedNodes.length; i++) sweep(m.addedNodes[i]); return; }
      // An attribute change is checked on that element only: style changes on
      // every animated frame, and a subtree query per frame would cost.
      var t = m.target;
      if (t.tagName === 'IMG') fixImg(t);
      else if (t.style && t.style.backgroundImage && (isDeezerArt(t.style.backgroundImage) ||
               (MUSIC_ART.test(t.style.backgroundImage) && t.closest && t.closest(GAMES)))) t.style.backgroundImage = 'url("' + BLANK + '")';
    });
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'style'] });
})();
