/* VINALL service worker.
 *
 * Its only jobs are (a) to stop a phone with no signal showing a blank white
 * page — which Apple rejects specifically — and (b) to stop the static media
 * being refetched on every visit.
 *
 * The deliberate design decision here is that the app itself is NEVER served
 * from cache in preference to the network. index.html is one 650KB file that
 * changes on every push, and a cache-first shell would happily serve a build
 * from last week with no way for anyone to tell. So navigations are
 * network-first: the cache is a fallback for being offline, not a fast path.
 * Getting this backwards is the classic way a service worker turns into a
 * bug nobody can reproduce.
 */

const VERSION = 'vinall-v1';
const SHELL = VERSION + '-shell';
const MEDIA = VERSION + '-media';

/* Small, and safe to have slightly stale. The 451KB splash clip is
   deliberately absent: precaching half a megabyte of video on first visit
   costs more than it saves. */
const PRECACHE = [
  '/offline.html',
  '/manifest.webmanifest',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/apple-touch-icon.png',
  '/assets/splash-poster.jpg'
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

  // Navigations: network first, cache as a fallback, offline page as a last
  // resort. This is what keeps a deploy authoritative.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only keep a good response. The first version cached whatever came
          // back, so a 404 got stored and would then be served as the offline
          // fallback for that path — a cached 'not found' instead of the app.
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req)
          .then((hit) => hit || caches.match('/offline.html'))
          .then((hit) => hit || new Response(
            '<h1>Offline</h1><p>VINALL needs a connection to load.</p>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
          ))
        )
    );
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
