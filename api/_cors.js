// Cross-origin access for the native app, and for nothing else.
//
// On the web the page and these routes share an origin, so none of this was
// ever needed — and that is exactly why none of it was here. Capacitor
// bundles index.html into the binary and serves it from its own origin
// (capacitor://localhost on iOS, https://localhost on Android), so every
// /api/* call the app makes is cross-origin, and several of them send an
// Authorization header, which forces a preflight this file answers.
//
// Aliasing the origin instead was checked and cannot work. WKWebView will not
// let a URL scheme handler claim https, so iosScheme can never be
// vinall.xyz and the iOS origin is a custom scheme whatever the hostname
// says; and on Android setting hostname to vinall.xyz makes Capacitor's
// WebViewLocalServer own that entire host, so /api/* would be looked for
// inside the app bundle and 404 rather than reaching Vercel at all.
//
// The list is exact origins, never '*', because these routes carry a Supabase
// bearer token. A wildcard would let any page on the internet call them with
// whatever token a browser would attach.
const ALLOWED = new Set([
  'capacitor://localhost',   // iOS
  'https://localhost',       // Android
  'http://localhost'         // Android with cleartext, and local dev
]);

// Returns true when it has already answered the request and the handler must
// stop. Call it as the FIRST thing in every route: three of them 405 anything
// that is not a POST, and a preflight is an OPTIONS.
export function cors(req, res) {
  const origin = req.headers && req.headers.origin;

  // Unconditional, including when the origin is not on the list. /api/preview
  // and /api/catalogue are edge-cached for a week, and without Vary the CDN
  // would serve one visitor's copy of the response — headers and all — to
  // everybody. A copy cached for a browser has no Access-Control-Allow-Origin
  // on it, so the app's fetch of it would be blocked; a copy cached for the
  // app carries one, which a browser simply ignores. Only the first of those
  // breaks anything, and it breaks it a week at a time.
  res.setHeader('Vary', 'Origin');

  if (origin && ALLOWED.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}
