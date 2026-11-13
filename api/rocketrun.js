// /api/rocketrun — the judge for RocketRun's daily five.
//
//   GET  ?op=day                 today's prompts (public; the same five for everybody)
//   GET  ?op=state      (auth)   your run today, for resuming, plus streak and best
//   POST {op:'answer', day, q, id}   (auth)  id = MusicBrainz release-group or artist MBID
//   POST {op:'pass', day, q}         (auth)  skip a prompt for 0 m
//   POST {op:'missing', day, q, text}(auth)  "it isn't in the catalogue"
//
// The browser searches MusicBrainz itself (CORS *, one request a second per
// device). This route never takes a title, a year or a grade from it: it
// looks the MBID up, checks it against the stored prompt with the same rules
// file the game uses, and lets rr_submit (service role only) price the rarity.
// The catalogue is MusicBrainz core data, CC0. No artwork, audio or lyrics.
//
// ponytail: MusicBrainz allows ~1 req/s per IP and every Vercel invocation in
// a region shares one. rr_entities caches each MBID for 30 days so a popular
// answer is fetched once; a busy launch day with mostly new answers would
// queue here. If that happens, mirror the MusicBrainz dump into Postgres.

import { cors } from './_cors.js';
import { questionsFor, evaluate, albumFacts, artistFacts, VERSION } from '../assets/rocketrun-rules.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://obqwjntjlyuawmybkddm.supabase.co';
const SERVICE = () => process.env.SUPABASE_SERVICE_ROLE_KEY;
const UA = 'VINALL/1.0 ( https://vinall-lab.vercel.app )';
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FRESH_MS = 30 * 86400000;

function today() { return Math.floor((Date.now() - Date.UTC(2020, 0, 1)) / 86400000); }

async function rest(path, init = {}) {
  const r = await fetch(SUPABASE_URL + path, {
    ...init,
    headers: { apikey: SERVICE(), Authorization: 'Bearer ' + SERVICE(), 'Content-Type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(8000)
  });
  const text = await r.text();
  if (!r.ok) throw new Error('db ' + r.status + ' ' + text.slice(0, 200));
  return text ? JSON.parse(text) : null;
}
const rpc = (fn, args) => rest('/rest/v1/rpc/' + fn, { method: 'POST', body: JSON.stringify(args) });

async function userId(req) {
  const jwt = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  try {
    const u = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: SERVICE(), Authorization: 'Bearer ' + jwt }, signal: AbortSignal.timeout(8000) });
    if (!u.ok) return null;
    const j = await u.json();
    return j && j.id || null;
  } catch (e) { return null; }
}

// The stored five win over a regenerated five, so a later rules change never
// re-deals a day somebody is half way through.
async function dayQuestions(day) {
  const rows = await rest('/rest/v1/rr_days?select=questions&day=eq.' + day);
  if (rows && rows[0]) return rows[0].questions;
  return rpc('rr_day_put', { p_day: day, p_questions: questionsFor(day), p_version: VERSION });
}

class Transient extends Error {}
async function mb(path) {
  for (let i = 0; i < 3; i++) {
    let r;
    try { r = await fetch('https://musicbrainz.org/ws/2/' + path, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(7000) }); }
    catch (e) { r = null; }
    if (r && r.status === 404) return null;
    if (r && r.ok) return r.json();
    await new Promise((ok) => setTimeout(ok, 1100 * (i + 1)));
  }
  throw new Transient('musicbrainz');
}

async function facts(kind, id) {
  const key = (kind === 'album' ? 'rg:' : 'ar:') + id;
  const hit = await rest('/rest/v1/rr_entities?select=facts,fetched_at&id=eq.' + encodeURIComponent(key));
  if (hit && hit[0] && Date.now() - Date.parse(hit[0].fetched_at) < FRESH_MS) return hit[0].facts;
  const raw = await mb(kind === 'album'
    ? 'release-group/' + id + '?fmt=json&inc=artist-credits+ratings'
    : 'artist/' + id + '?fmt=json&inc=aliases+ratings');
  if (!raw) return null;
  const f = kind === 'album' ? albumFacts(raw) : artistFacts(raw);
  // An album whose artists carry no country in the credit (a city-level area)
  // gets one artist lookup each, so "from the UK" is not unknown for no reason.
  if (kind === 'album') {
    for (const a of f.artists.slice(0, 3)) {
      if (a.country || !MBID.test(a.id)) continue;
      try { const ar = await mb('artist/' + a.id + '?fmt=json'); if (ar) { const af = artistFacts(ar); a.country = af.country; a.type = a.type || af.type; } } catch (e) {}
    }
  }
  await rest('/rest/v1/rr_entities?on_conflict=id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: key, facts: f, fetched_at: new Date().toISOString() })
  });
  return f;
}

const REASONS = {
  closed: 'That day’s run has closed. Today’s five are waiting.',
  finished: 'You’ve flown today’s run already.',
  attempts: 'That’s a lot of tries for one day. Come back tomorrow.',
  order: 'That answer was for a different prompt. Reloading your run.',
  duplicate: 'You’ve used that answer already. Find another.',
  no_day: 'Today’s prompts aren’t ready yet. Try again in a moment.'
};

export default async function handler(req, res) {
  if (cors(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  if (!SERVICE()) return res.status(503).json({ error: 'RocketRun is not switched on here yet.' });
  const body = req.method === 'POST' ? (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})) : {};
  const op = String((req.query && req.query.op) || body.op || '');

  try {
    if (op === 'day') {
      const day = today();
      const qs = await dayQuestions(day);
      res.setHeader('Cache-Control', 'public, s-maxage=60');
      return res.status(200).json({ day, questions: qs, opensIn: Date.UTC(2020, 0, 1) + (day + 1) * 86400000 - Date.now() });
    }

    const uid = await userId(req);
    if (!uid) return res.status(401).json({ error: 'Log in to fly RocketRun.' });

    if (op === 'state') {
      const day = today();
      const [qs, st] = await Promise.all([dayQuestions(day), rpc('rr_state', { p_user: uid, p_day: day })]);
      return res.status(200).json({ ...st, questions: qs });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'POST' });
    const day = Number(body.day), q = Number(body.q);
    if (!Number.isInteger(day) || !Number.isInteger(q) || q < 0 || q > 4) return res.status(400).json({ error: 'Bad request.' });

    if (op === 'missing') {
      const text = String(body.text || '').trim();
      if (!text) return res.status(400).json({ error: 'Nothing to report.' });
      const ok = await rpc('rr_report_missing', { p_user: uid, p_day: day, p_q: q, p_text: text.slice(0, 120) });
      return res.status(200).json({ ok: !!ok });
    }

    if (op === 'pass') {
      const r = await rpc('rr_submit', { p_user: uid, p_day: day, p_q: q, p_key: null, p_label: null, p_sub: null, p_votes: null });
      return res.status(200).json(r.ok ? r : { ...r, message: REASONS[r.reason] });
    }

    if (op !== 'answer') return res.status(400).json({ error: 'Unknown op.' });
    const id = String(body.id || '').toLowerCase();
    if (!MBID.test(id)) return res.status(400).json({ error: 'Pick an answer from the list.' });

    const att = await rpc('rr_attempt', { p_user: uid, p_day: day });
    if (!att.ok) return res.status(200).json({ ok: false, reason: att.reason, message: REASONS[att.reason] });
    if (att.next !== q) return res.status(200).json({ ok: false, reason: 'order', next: att.next, message: REASONS.order });

    const qs = await dayQuestions(day);
    const question = qs && qs[q];
    if (!question) return res.status(200).json({ ok: false, reason: 'no_day', message: REASONS.no_day });

    let f;
    try { f = await facts(question.kind, id); }
    catch (e) {
      if (e instanceof Transient) return res.status(200).json({ ok: false, reason: 'busy', message: 'MusicBrainz is busy. Try that again in a few seconds.' });
      throw e;
    }
    if (!f) return res.status(200).json({ ok: false, reason: 'gone', message: `That isn’t ${question.kind === 'album' ? 'an album' : 'an artist'} MusicBrainz knows. Pick one from the list.` });

    const label = f.kind === 'album' ? f.title : f.name;
    const verdict = evaluate(question, f);
    if (verdict.ok !== true) {
      return res.status(200).json({ ok: false, reason: verdict.ok === null ? 'unknown' : 'nofit', label,
        message: verdict.ok === null ? `We can’t check that one: ${verdict.why}. Try another.` : `${label} ${verdict.why}. Try another.` });
    }

    const sub = f.kind === 'album' ? [f.credit, f.year].filter(Boolean).join(' · ') : [f.disambiguation, f.type].filter(Boolean).join(' · ');
    const r = await rpc('rr_submit', {
      p_user: uid, p_day: day, p_q: q, p_key: (f.kind === 'album' ? 'rg:' : 'ar:') + f.id,
      p_label: label, p_sub: sub, p_votes: f.votes
    });
    return res.status(200).json(r.ok ? { ...r, label, sub } : { ...r, message: REASONS[r.reason] });
  } catch (e) {
    console.error('rocketrun', e && e.message);
    return res.status(502).json({ error: 'RocketRun couldn’t reach its database. Try again.' });
  }
}
