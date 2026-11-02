// Tests use the static mode and intercept API calls. --public-api also runs
// the actual read-only music catalogue/preview handlers for manual review.
// It never proxies production routes or enables account mutation handlers.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicApi = process.argv.includes('--public-api');
const publicHandlers = new Map();
if (publicApi) {
  for (const name of ['catalogue', 'preview']) {
    publicHandlers.set('/api/' + name, (await import('../api/' + name + '.js')).default);
  }
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.ico': 'image/x-icon' };
http.createServer(async (req, res) => {
  let pathname;
  let url;
  try { url = new URL(req.url, 'http://localhost'); pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400).end(); return; }
  if (publicHandlers.has(pathname)) {
    res.status = code => { res.statusCode = code; return res; };
    res.json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); return res; };
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); res.status(405).json({ error: 'Manual preview supports read-only catalogue requests.' }); return; }
    req.query = Object.fromEntries(url.searchParams);
    // Spotify matching persists catalogue mappings: it is not a preview read.
    if (req.query.path === 'spotify-match') { res.status(403).json({ error: 'Import matching is disabled in the local preview.' }); return; }
    try { await publicHandlers.get(pathname)(req, res); }
    catch (error) {
      console.error('Local public API failed:', error.message);
      if (!res.headersSent) res.status(502).json({ error: 'Local catalogue request failed.' });
      else if (!res.writableEnded) res.end();
    }
    return;
  }
  if (!/^\/(assets|dither-frames)\//.test(pathname) && !['/', '/index.html', '/privacy.html', '/terms.html', '/reset.html', '/offline.html', '/manifest.webmanifest', '/sw.js'].includes(pathname)) { res.writeHead(404).end(); return; }
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep) || pathname.startsWith('/api/')) { res.writeHead(404).end(); return; }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
}).listen(4173, '127.0.0.1', () => console.log('VINALL local preview: http://127.0.0.1:4173' + (publicApi ? ' (public music APIs enabled; account APIs disabled)' : ' (static test mode)')));
