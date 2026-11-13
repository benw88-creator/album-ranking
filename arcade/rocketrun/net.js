// RocketRun's two connections: VINALL (the host page that frames this one,
// same origin on the web and in the app) and MusicBrainz (searched directly
// from the device; CC0 data, CORS open, one request a second).
import { albumFacts, artistFacts, isAlbum, fold } from '../../assets/rocketrun-rules.js';

export const host = (() => { try { return window.parent !== window && window.parent.Cloud ? window.parent : null; } catch (e) { return null; } })();
const client = () => { try { return host && host.Cloud.client && host.Cloud.client(); } catch (e) { return null; } };
async function token() {
  const c = client(); if (!c) return null;
  try { const { data } = await c.auth.getSession(); return (data && data.session && data.session.access_token) || null; } catch (e) { return null; }
}
export async function signedIn() { return !!(await token()); }
export function onAuth(fn) { const c = client(); if (c) try { c.auth.onAuthStateChange(() => fn()); } catch (e) {} }

const API = ((host && host.Native && host.Native.api) || '') + '/api/rocketrun';
async function call(method, op, body) {
  const t = await token();
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
export const answer = (day, q, id) => call('POST', 'answer', { day, q, id });
export const pass = (day, q) => call('POST', 'pass', { day, q });
export const missing = (day, q, text) => call('POST', 'missing', { day, q, text });

export const login = () => { try { host.Cloud.openAuth(); } catch (e) {} };
export const exit = () => { try { host.RocketRunHost.close(); } catch (e) { location.href = '../../'; } };
export const leaderboard = () => { try { host.Boards.open({ game: 'rocketrun', mode: 'daily' }); return true; } catch (e) { return false; } };
export const walletSync = () => { try { host.Wallet.syncAward('rocketrun'); } catch (e) {} };

/* ---- MusicBrainz search ---------------------------------------------------- */

const MB = 'https://musicbrainz.org/ws/2/';
const memo = new Map();
let last = 0, ctl = null;

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

async function fetchMB(url, signal) {
  for (let i = 0; i < 3; i++) {
    const wait = last + 1050 - Date.now();
    if (wait > 0) await new Promise((ok, no) => { const t = setTimeout(ok, wait); signal.addEventListener('abort', () => { clearTimeout(t); no(new DOMException('', 'AbortError')); }, { once: true }); });
    last = Date.now();
    const r = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (r.ok) return r.json();
    if (r.status !== 503 && r.status !== 429) throw new Error('mb ' + r.status);
  }
  throw new Error('mb busy');
}

// -> facts[] best first. Throws AbortError if a newer search replaced it.
export async function search(text, kind) {
  const q = luceneFor(text, kind);
  if (!q) return [];
  const key = kind + '|' + q;
  if (memo.has(key)) return memo.get(key);
  if (ctl) ctl.abort();
  ctl = new AbortController();
  const j = await fetchMB(MB + (kind === 'album' ? 'release-group' : 'artist') + '/?fmt=json&limit=25&query=' + encodeURIComponent(q), ctl.signal);
  let out;
  if (kind === 'album') {
    // A record with many editions is one people know: MusicBrainz's score
    // says how well the words match, the release count breaks the ties.
    out = (j['release-groups'] || []).map((rg) => ({ f: albumFacts(rg), s: (rg.score || 0) + 9 * Math.log2(1 + (rg.count || 0)) }))
      .filter((x) => isAlbum(x.f)).sort((a, b) => b.s - a.s).map((x) => x.f);
  } else {
    out = (j.artists || []).map(artistFacts);
  }
  out = out.slice(0, 7);
  memo.set(key, out);
  return out;
}
