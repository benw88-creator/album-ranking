// node scripts/traps.mjs — run before pushing.
// Each check is a bug this repo has shipped more than once; see "The traps that
// keep recurring" in CLAUDE.md. All of them fail silently in the app, so this
// script is the only place they make a noise. Exit code 1 if any fire.
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const lineOf = i => html.slice(0, i).split('\n').length;
const inComment = i => html.lastIndexOf('/*', i) > html.lastIndexOf('*/', i)
  || html.lastIndexOf('<!--', i) > html.lastIndexOf('-->', i)
  || /^\s*\/\//.test(html.slice(html.lastIndexOf('\n', i) + 1, i));
const fails = [];
const fail = (trap, msg) => fails.push(`[${trap}] ${msg}`);

// 11. Vercel Hobby: a 13th function rejects the WHOLE deploy.
const routes = fs.readdirSync(path.join(root, 'api')).filter(f => f.endsWith('.js') && !f.startsWith('_'));
if (routes.length > 12) fail('api-count', `${routes.length} routes in api/ (max 12): ${routes.join(', ')}`);

// No theme may change the typeface: --font-display is defined once, on :root.
const fd = css.match(/--font-display\s*:/g) || [];
if (fd.length !== 1) fail('font-display', `--font-display defined ${fd.length} times (must be exactly 1)`);

// 6. Scrolling gradients in percentages. Ping-pong 0..100% is fine; anything
// past 100% or negative is the snapping-loop bug — unless it is a single
// highlight band with transparent ends (it is off-screen at both ends, so
// there is nothing to snap) or a loader whose first and last stops match.
// Those were checked by eye; add a name here only after doing the same.
const SWEEPS_OK = new Set(['warShimmer', 'coverGlint', 'ltbSweep', 'shimmer']);
for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?\}\s*)\}/g)) {
  if (SWEEPS_OK.has(m[1])) continue;
  for (const v of m[2].matchAll(/background-position\s*:\s*([^;}]+)/g)) {
    if ((v[1].match(/-?\d+(\.\d+)?%/g) || []).some(p => parseFloat(p) > 100 || parseFloat(p) < 0))
      fail('gradient-%', `@keyframes ${m[1]} moves background-position by ${v[1].trim()} — use a pixel tile`);
  }
}

// 7. .gc-best without [data-best] wiped four games' status lines.
for (const m of html.matchAll(/querySelectorAll\(\s*['"]\.gc-best['"]\s*\)/g))
  fail('gc-best', `line ${lineOf(m.index)}: select .gc-best[data-best], not every .gc-best`);

// 7. notePlay('x') for a key GAME_LABELS does not have is a silent no-op.
const gl = html.match(/GAME_LABELS\s*=\s*\{([\s\S]*?)\}/);
const labels = new Set(gl ? [...gl[1].matchAll(/(\w+)\s*:/g)].map(m => m[1]) : []);
for (const m of html.matchAll(/notePlay\(\s*['"](\w+)['"]/g))
  if (!labels.has(m[1])) fail('notePlay', `line ${lineOf(m.index)}: '${m[1]}' is not in GAME_LABELS`);

// The views map in setMode is explicit: every destination reached must be in it.
const vm = html.match(/const views\s*=\s*\{([\s\S]*?)\n\};?/);
const views = new Set(vm ? [...vm[1].matchAll(/^\s*'?([\w-]+)'?\s*:/gm)].map(m => m[1]) : []);
const modes = new Set([
  ...[...html.matchAll(/data-mode="([\w-]+)"/g)].map(m => m[1]),
  ...[...html.matchAll(/setMode\(\s*'([\w-]+)'/g)].map(m => m[1]),
]);
for (const k of modes) if (!views.has(k)) fail('views', `mode '${k}' is used but missing from the views map in setMode`);
for (const k of views) if (!html.includes(`id="view-${k}"`)) fail('views', `views.${k} points at #view-${k}, which does not exist`);

// 4. Two keys for one record: never fabricate a Spotify URI from an id.
for (const m of html.matchAll(/['"`]spotify:(track|album):['"`]\s*\+/g))
  if (!inComment(m.index)) fail('fake-uri', `line ${lineOf(m.index)}: builds a spotify:${m[1]}: URI from an id — ids may be Deezer's`);
// The catalogue is Deezer's: no Spotify CDN artwork in source.
if (html.includes('i.scdn.co')) fail('scdn', `i.scdn.co appears ${html.split('i.scdn.co').length - 1} times — artwork must not come from Spotify`);

// Native dialogs are titled with the origin; everything goes through ask().
// A fallback for when ask() is missing (`window.ask ? ask(..) : confirm(..)`) is allowed.
for (const m of html.matchAll(/(^|[^.\w])(alert|confirm|prompt)\(/gm)) {
  if (inComment(m.index) || /\bask\b[^;]*\?[^;]*$/.test(html.slice(m.index - 300, m.index))) continue;
  fail('native-dialog', `line ${lineOf(m.index)}: ${m[2]}() — use ask()`);
}

// writeText refuses by REJECTING; an unhandled one says "Copied" over nothing.
// ponytail: only checks a .then/.catch follows; a one-arg .then() would slip through.
for (const m of html.matchAll(/clipboard\.writeText\(/g)) {
  const tail = html.slice(m.index, m.index + 300);
  if (!/\)\s*\.(catch|then)\(/.test(tail)) fail('clipboard', `line ${lineOf(m.index)}: writeText without a rejection handler`);
}

// Client copies of server numbers: change one, change the other.
const mig = path.join(root, 'supabase', 'migrations');
const migs = fs.readdirSync(mig).sort().map(f => fs.readFileSync(path.join(mig, f), 'utf8'));
const lastMatch = (re, mustHave = '') => { let r = null; for (const s of migs) if (s.includes(mustHave)) for (const m of s.matchAll(re)) r = m; return r; };
const arr = s => s.replace(/\s/g, '');
const cl = html.match(/var LADDER = \[([^\]]+)\]/), sl = lastMatch(/v_ladder\s+integer\[\]\s*:=\s*array\[([^\]]+)\]/g);
if (cl && sl && arr(cl[1]) !== arr(sl[1])) fail('ladder', `LADDER [${cl[1]}] != v_ladder [${sl[1]}]`);
const cm = html.match(/var MAX_SCORE = (\d+)/), sm = lastMatch(/least\(coalesce\(p_score,\s*0\),\s*(\d+)\)/g, 'function public.blitz_submit');
if (cm && sm && cm[1] !== sm[1]) fail('blitz-max', `Blitz MAX_SCORE ${cm[1]} != blitz_submit clamp ${sm[1]}`);

if (fails.length) { console.log(fails.join('\n')); console.log(`\n${fails.length} trap(s) sprung`); process.exit(1); }
console.log(`ok — ${routes.length}/12 routes, ${views.size} views, ${labels.size} game labels, all traps clear`);
