// Live RocketRun check against the LAB project: real MusicBrainz search in the
// browser, the real /api/rocketrun handler, the lab database. Plays today's
// run as a throwaway account by typing answers, saves screenshots, deletes it.
//   (lab keys in env) node scripts/rocketrun-live.mjs [shots-dir]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import handler from '../api/rocketrun.js';
import { findAnswers } from './rocketrun-mb.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.argv[2] || path.join(root, 'artifacts-rr');
fs.mkdirSync(SHOTS, { recursive: true });
const URL_ = 'https://obqwjntjlyuawmybkddm.supabase.co', SVC = process.env.SUPABASE_SERVICE_ROLE_KEY, ANON = process.env.SUPABASE_ANON_KEY;
if (!SVC || JSON.parse(Buffer.from(SVC.split('.')[1], 'base64url')).ref !== 'obqwjntjlyuawmybkddm') throw new Error('lab keys only');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/rocketrun') {
    let raw = ''; for await (const c of req) raw += c;
    const shim = { status(s) { res.statusCode = s; return shim; }, setHeader: (k, v) => res.setHeader(k, v), json(j) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(j)); return shim; }, end() { res.end(); return shim; } };
    return handler({ method: req.method, headers: req.headers, query: Object.fromEntries(u.searchParams), body: raw ? JSON.parse(raw) : {} }, shim);
  }
  if (u.pathname.startsWith('/api/')) { res.statusCode = 404; return res.end('{}'); }
  const file = path.join(root, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(4398);

const H = { apikey: SVC, Authorization: 'Bearer ' + SVC, 'Content-Type': 'application/json' };
const admin = async (p, init) => { const r = await fetch(URL_ + p, { headers: H, ...init }); const t = await r.text(); if (!r.ok) throw new Error(p + ' ' + r.status + t); return t ? JSON.parse(t) : null; };
const email = `rr-live-${Date.now()}@example.test`, password = 'rr-' + Math.random().toString(36).slice(2) + 'A1!';
const user = await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { age_band: 'adult' } }) });
await admin('/rest/v1/profiles', { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: user.id, username: 'rrlive' + Date.now().toString(36) }) });

const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
try {
  const day = await (await fetch('http://127.0.0.1:4398/api/rocketrun?op=day')).json();
  const plan = [];
  for (const q of day.questions) { const { answers } = await findAnswers(q, 6); plan.push(answers); }

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', reducedMotion: process.env.FULL ? 'no-preference' : 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('crate_onboard_v1', JSON.stringify({ done: true, at: Date.now() })); } catch (e) {} });
  await page.goto('http://127.0.0.1:4398/');
  await page.waitForFunction(() => window.Cloud && Cloud.client && Cloud.client());
  await page.evaluate(([e, p]) => Cloud.client().auth.signInWithPassword({ email: e, password: p }), [email, password]);
  const go = page.locator('#splash-cta'); if (await go.isVisible().catch(() => false)) await go.click();
  await page.waitForTimeout(2500);
  await page.evaluate(() => { document.querySelectorAll('.onb, #onb, .modal.open').forEach((m) => m.classList.remove('open')); goToView('games'); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, 'live-arcade.png') });
  await page.evaluate(() => RocketRunHost.open());
  const g = page.frameLocator('#rocketrun-sheet iframe');
  await g.locator('#start').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, 'live-menu.png') });
  await g.locator('#start').click();

  for (let q = 0; q < 5; q++) {
    await g.locator('.question-card').waitFor({ timeout: 60000 });
    const question = day.questions[q];
    let done = false;
    for (const f of plan[q]) {
      const typed = (f.kind === 'album' ? `${f.artists[0] ? f.artists[0].name + ' ' : ''}${f.title}` : f.name).slice(0, 60);
      await g.locator('#answer').fill('');
      await g.locator('#answer').pressSequentially(typed, { delay: 25 });
      const label = f.kind === 'album' ? f.title : f.name;
      const item = g.locator('.suggestion', { hasText: label }).first();
      try { await item.waitFor({ timeout: 12000 }); } catch (e) { console.log('  not in suggestions:', typed); continue; }
      if (q === 0) await page.screenshot({ path: path.join(SHOTS, 'live-search.png') });
      await item.click();
      await g.locator('#launch-answer').click();
      const outcome = await Promise.race([
        g.locator('#rarity-reveal.show').waitFor({ timeout: 25000 }).then(() => 'flew'),
        g.locator('#answer-error:not(:empty)').waitFor({ timeout: 25000 }).then(() => 'refused')
      ]);
      if (outcome === 'flew') {
        console.log(`Q${q + 1} ${question.text}  ->  typed "${typed}"  ->`, await g.locator('#rarity-reveal strong').innerText(), '·', await g.locator('#rarity-reveal p').innerText());
        if (q === 0 || q === 4) { await page.waitForTimeout(1200); await page.screenshot({ path: path.join(SHOTS, `live-flight-${q + 1}.png`) }); }
        done = true; break;
      }
      console.log('  refused:', await g.locator('#answer-error').innerText());
    }
    if (!done) throw new Error('could not answer ' + question.text);
  }
  await g.locator('.results-card').waitFor({ timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOTS, 'live-results.png') });
  console.log('results:', (await g.locator('.results-altitude').innerText()).replace(/\s+/g, ' '), '·', await g.locator('.results-card p').first().innerText());
  await g.locator('#board-results').click();
  await page.locator('#gb-modal.open, .modal.open .gb-list, [id^="gb"].open').first().waitFor({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(SHOTS, 'live-board.png') });
  console.log('page errors:', errors.length ? errors : 'none');
} finally {
  await browser.close(); server.close();
  await admin(`/rest/v1/game_bests?game=eq.rocketrun&user_id=eq.${user.id}`, { method: 'DELETE' }).catch(() => {});
  await admin('/auth/v1/admin/users/' + user.id, { method: 'DELETE' }).catch((e) => console.error(e.message));
}
