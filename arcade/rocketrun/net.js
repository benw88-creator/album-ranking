// RocketRun's two connections: VINALL (the host page that frames this one,
// same origin on the web and in the app) and MusicBrainz (searched directly
// from the device; CC0 data, CORS open, one request a second).
import { albumFacts, artistFacts, isAlbum, fold } from '../../assets/rocketrun-rules.js?v=2';
import { createMusicBrainzClient } from '../../assets/rocketrun-musicbrainz.js?v=1';

export const host = (() => { try { return window.parent !== window && window.parent.Cloud ? window.parent : null; } catch (e) { return null; } })();
const client = () => { try { return host && host.Cloud.client && host.Cloud.client(); } catch (e) { return null; } };
async function session() {
  const c = client(); if (!c) return null;
  try { const { data } = await c.auth.getSession(); return (data && data.session) || null; } catch (e) { return null; }
}
async function token() { return (await session())?.access_token || null; }
export async function signedIn() { return !!(await token()); }
export function onAuth(fn) { const c = client(); if (c) try { c.auth.onAuthStateChange(() => fn()); } catch (e) {} }

const API = ((host && host.Native && host.Native.api) || '') + '/api/rocketrun';
async function call(method, op, body, authSession) {
  const t = authSession ? authSession.access_token : await token();
  const r = await fetch(API + (method === 'GET' ? '?op=' + op : ''), {
    method, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
    body: method === 'POST' ? JSON.stringify({ op, ...body }) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !j.reason) throw Object.assign(new Error(j.error || 'RocketRun couldn’t reach VINALL. Try again.'), { status: r.status });
  return j;
}
export const getDay = () => call('GET', 'day');
export const getState = () => call('GET', 'state');
const receipts = new Map();
const pendingKey = s => s?.user?.id ? 'vinall_rocketrun_pending:' + s.user.id : null;
function pending(key) {
  if (!key) return null;
  try {
    const p = JSON.parse(sessionStorage.getItem(key));
    if (p && Number.isInteger(p.day) && Number.isInteger(p.q) && typeof p.id === 'string' && typeof p.retry === 'string' && Date.now() - p.savedAt < 90000) return p;
    sessionStorage.removeItem(key);
  } catch (e) {}
  return null;
}
export async function resumeAnswer() {
  const s = await session(), p = pending(pendingKey(s));
  return p ? answer(p.day, p.q, p.id, s?.user?.id) : null;
}
export async function answer(day, q, id, expectedOwner) {
  const s = await session(), storageKey = pendingKey(s);
  const owner = s?.user?.id || s?.access_token || '';
  const changed = () => Object.assign(new Error('The account changed. Reopening RocketRun.'), { accountChanged: true });
  if (expectedOwner && owner !== expectedOwner) throw changed();
  const key = [s?.user?.id || s?.access_token || '', day, q, id].join(':');
  const saved = pending(storageKey);
  if (saved && saved.day === day && saved.q === q && saved.id === id) receipts.set(key, saved.retry);
  let r;
  for (let i = 0; i < 3; i++) {
    const current = await session();
    if ((current?.user?.id || current?.access_token || '') !== owner) throw changed();
    r = await call('POST', 'answer', { day, q, id, retry: receipts.get(key) }, current);
    const after = await session();
    if ((after?.user?.id || after?.access_token || '') !== owner) throw changed();
    if (r.reason !== 'busy' || !r.retry) {
      receipts.delete(key); try { if (storageKey) sessionStorage.removeItem(storageKey); } catch (e) {}
      return r;
    }
    receipts.set(key, r.retry);
    // Receipt only, scoped to the signed-in user. Never persist a JWT here.
    try { if (storageKey) sessionStorage.setItem(storageKey, JSON.stringify({ day, q, id, retry: r.retry, savedAt: saved?.savedAt || Date.now() })); } catch (e) {}
    if (i < 2) await new Promise(resolve => setTimeout(resolve, 1100 * (i + 1)));
  }
  return r;
}
export const pass = (day, q) => call('POST', 'pass', { day, q });
export const open = (day, q) => call('POST', 'open', { day, q });
// Looks the record up on the server while the player decides, so the answer
// itself is judged from cache. Failure is harmless: the answer looks it up again.
export const warm = (day, q, id) => call('POST', 'warm', { day, q, id }).catch(() => null);
export const missing = (day, q, text) => call('POST', 'missing', { day, q, text });

export const login = () => { try { host.Cloud.openAuth(); } catch (e) {} };
export const exit = () => { try { host.RocketRunHost.close(); } catch (e) { location.href = '../../'; } };
export const leaderboard = () => { try { host.Boards.open({ game: 'rocketrun', mode: 'daily' }); return true; } catch (e) { return false; } };
export const walletSync = () => { try { host.Wallet.syncAward('rocketrun'); } catch (e) {} };

/* ---- MusicBrainz search ---------------------------------------------------- */

const memo = new Map();
const fetchMB = createMusicBrainzClient();
let ctl = null, healthyAt = 0;
// Do not reveal/start a fresh timed question while search is known to be down.
export async function searchReady() {
  if (Date.now() - healthyAt < 10000) return;
  const j = await fetchMB('artist/?fmt=json&limit=1&query=artist%3ARadiohead', { validate: j => Array.isArray(j?.artists) });
  if (!j) throw new Error('MusicBrainz search is unavailable.');
  healthyAt = Date.now();
}

// "radiohed ok comp" -> (radiohed OR radiohed~1) AND ok AND (comp OR comp*)
// Prefix on the word still being typed, one typo allowed on longer words.
export function luceneFor(text, kind) {
  // Apostrophes stay inside words: MusicBrainz indexes "fry's", not "fry" + "s".
  const toks = fold(text).replace(/&/g, ' and ').split(/[^\p{L}\p{N}']+/u).map((t) => t.replace(/^'+|'+$/g, '')).filter(Boolean).slice(0, 8);
  if (!toks.length) return '';
  const parts = toks.map((t, i) => {
    const lastTok = i === toks.length - 1;
    if (lastTok && t.length >= 2) return `(${t} OR ${t}*)`;
    if (t.length >= 5) return `(${t} OR ${t}~1)`;
    return t;
  });
  return '(' + parts.join(' AND ') + ')' + (kind === 'album' ? ' AND primarytype:album' : '');
}

// -> facts[] best first. Throws AbortError if a newer search replaced it.
export async function search(text, kind) {
  const q = luceneFor(text, kind);
  if (!q) return [];
  const key = kind + '|' + q;
  if (ctl) ctl.abort();
  ctl = new AbortController();
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < 600000) return hit.value;
  let j;
  try {
    j = await fetchMB((kind === 'album' ? 'release-group' : 'artist') + '/?fmt=json&limit=25&query=' + encodeURIComponent(q), {
      signal: ctl.signal, validate: j => Array.isArray(j?.[kind === 'album' ? 'release-groups' : 'artists'])
    });
  } catch (e) { if (e.name !== 'AbortError') healthyAt = 0; throw e; }
  if (!j) throw new Error('MusicBrainz search is unavailable.');
  healthyAt = Date.now();
  let out;
  if (kind === 'album') {
    // A record with many editions is one people know: MusicBrainz's score
    // says how well the words match, the release count breaks the ties.
    out = (j['release-groups'] || []).map((rg) => ({ f: albumFacts(rg), s: (rg.score || 0) + 9 * Math.log2(1 + (rg.count || 0)) }))
      .filter((x) => isAlbum(x.f)).sort((a, b) => b.s - a.s).map((x) => x.f);
  } else {
    out = (j.artists || []).map(artistFacts);
  }
  if (memo.size >= 100) memo.delete(memo.keys().next().value);
  memo.set(key, { at: Date.now(), value: out });
  return out;
}
