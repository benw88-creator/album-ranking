/* Copies the web app into app/www, which is what Capacitor bundles.
 *
 * The repo root has no build step and must not grow one: Vercel auto-detects
 * a root package.json and starts trying to build a site that is already
 * finished. So the copy runs from in here, reads the root as a plain source
 * directory and never writes back to it.
 *
 * The list is explicit rather than a glob. A glob would quietly pick up
 * api/, supabase/ and CLAUDE.md and ship all of it inside the binary — and
 * the point of a bundled wrapper is that what is in it was chosen.
 */
import { cp, rm, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const www = resolve(here, '..', 'www');

/* sw.js is deliberately absent. Inside the binary the assets are already
   local, so a cache of them buys nothing, and the one thing a service worker
   could still do here is serve a stale shell — which is the exact failure
   sw.js is written to avoid on the web. index.html skips registration when it
   is running natively; not shipping the file is the second half of that. */
const FILES = [
  'index.html',
  'offline.html',
  'privacy.html',
  'terms.html',
  'manifest.webmanifest'
];

const DIRS = ['assets', 'dither-frames'];

await rm(www, { recursive: true, force: true });
await mkdir(www, { recursive: true });

let bytes = 0;
for (const f of FILES) {
  const src = join(root, f);
  if (!existsSync(src)) throw new Error(`sync-web: ${f} is missing from the repo root`);
  bytes += (await stat(src)).size;
  await cp(src, join(www, f));
}
for (const d of DIRS) {
  const src = join(root, d);
  if (!existsSync(src)) throw new Error(`sync-web: ${d}/ is missing from the repo root`);
  await cp(src, join(www, d), { recursive: true });
}

console.log(`sync-web: ${FILES.length} files + ${DIRS.join(', ')} → app/www (${(bytes / 1024).toFixed(0)}KB of markup)`);
