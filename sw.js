/* VINALL service worker.
 *
 * Its only jobs are (a) to stop a phone with no signal showing a blank white
 * page — which Apple rejects specifically — and (b) to stop the static media
 * being refetched on every visit.
 *
 * It was network-first for navigations, so that a deploy was always
 * authoritative and nobody could be left on a stale build without knowing.
 * The cost of that turned out to be the whole of the app's start-up: index.html
 * is 375KB brotli, the server sends max-age=0/must-revalidate, and a cold fetch
 * measured 2.4 SECONDS — paid on every single load, before anything appeared.
 *
 * It is stale-while-revalidate now, which keeps the property that mattered and
 * drops the one that cost. See the long note on the navigate branch: you are
 * never more than one load behind, and when you are, the app says so out loud.
 */

const VERSION = 'vinall-v2';
const SHELL = VERSION + '-shell';
const MEDIA = VERSION + '-media';

/* Small, and safe to have slightly stale. There is no splash media in here
   any more because there is none to cache: the record on the splash is drawn
   in CSS, which removed a 451KB clip and its 76KB poster from the app. */
const PRECACHE = [
  '/offline.html',
  '/manifest.webmanifest',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      // addAll rejects the whole batch if any single item 404s, which would
      // leave no offline page at all. Individually, a missing file is just a
      // missing file.
      .then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL && k !== MEDIA).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* An escape hatch: if a future version ever misbehaves, posting this from the
   console unregisters the worker and clears everything it holds. */
self.addEventListener('message', (event) => {
  if (event.data === 'vinall-sw-purge') {
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister());
  }
});

function isMedia(url) {
  return /\/(assets|dither-frames)\//.test(url.pathname) ||
         /\.(png|jpg|jpeg|svg|webp|mp4|woff2?)$/i.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Same-origin only. Spotify, Supabase, Apple and the fonts are somebody
  // else's cache-control problem, and an opaque cross-origin response cached
  // here would be indistinguishable from a failure.
  if (url.origin !== self.location.origin) return;

  // Never the API. /api/app-token mints a short-lived credential; a cached one
  // is a broken one.
  if (url.pathname.startsWith('/api/')) return;

  /* Navigations: serve the cached copy immediately, then fetch in the
     background and keep the new one for next time.
     ---------------------------------------------------------------------
     This used to be network-first, on the reasoning that index.html changes
     on every push and a cache-first shell would serve last week's build with
     nothing to indicate it. That reasoning was right about cache-FIRST and
     wrong about this, and the cost of it was measured: index.html is 375KB
     brotli, the server sends `max-age=0, must-revalidate`, and a cold fetch
     of it took 2.4 SECONDS. Every single load paid that before anything
     appeared.

     Stale-while-revalidate is a different bargain. You are never more than
     ONE load behind, not a week — and when you are, the app says so: the
     background copy is compared with what was served and a message goes to
     every open page, which puts a "new version, tap to refresh" line on
     screen. A stale build nobody can detect was the actual objection, and
     this answers it rather than accepting it.

     First visit still goes to the network, because there is nothing to
     serve. Offline still falls back the same way. */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const hit = await cache.match(req);

      const fresh = fetch(req).then(async (res) => {
        if (!res || !res.ok) return res;
        // Only keep a good response. The first version cached whatever came
        // back, so a 404 got stored and would then be served as the offline
        // fallback for that path — a cached 'not found' instead of the app.
        const copy = res.clone();
        // Compare before storing, so "changed" means changed against what the
        // person is actually looking at rather than against nothing.
        let changed = false;
        if (hit) {
          try {
            const [a, b] = await Promise.all([hit.clone().text(), copy.clone().text()]);
            changed = a.length !== b.length || a !== b;
          } catch (e) { /* a body that cannot be read is not a reason to fail */ }
        }
        await cache.put(req, copy).catch(() => {});
        if (changed) {
          const clients = await self.clients.matchAll({ type: 'window' });
          clients.forEach((c) => c.postMessage('vinall-sw-updated'));
        }
        return res;
      }).catch(() => null);

      if (hit) return hit;                 // instant, and the fetch runs on
      const net = await fresh;             // first visit there is nothing yet
      if (net) return net;
      return (await caches.match('/offline.html')) || new Response(
        '<h1>Offline</h1><p>VINALL needs a connection to load.</p>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
      );
    })());
    return;
  }

  // Static media: serve from cache, and refresh it in the background so a
  // replaced asset is picked up on the visit after next.
  if (isMedia(url)) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(MEDIA).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    );
    return;
  }

  // Everything else falls through to the network untouched.
});
