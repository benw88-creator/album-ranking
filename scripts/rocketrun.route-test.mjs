// End-to-end test of /api/rocketrun against the LAB database (never production).
//   SUPABASE_SERVICE_ROLE_KEY=<lab service key> SUPABASE_ANON_KEY=<lab anon key> node scripts/rocketrun.route-test.mjs
// Creates two throwaway accounts, plays today's run as both, checks ordering,
// duplicates, wrong answers, rarity, the leaderboard row and the payout, then
// deletes the accounts (their rr_ rows cascade; game_bests rows are removed).
import assert from 'node:assert/strict';
import handler from '../api/rocketrun.js';
import { findAnswers } from './rocketrun-mb.mjs';

const URL_ = 'https://obqwjntjlyuawmybkddm.supabase.co';
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY, ANON = process.env.SUPABASE_ANON_KEY;
assert.ok(SVC && ANON, 'set the LAB service and anon keys');
assert.ok(SVC.includes('.') && JSON.parse(Buffer.from(SVC.split('.')[1], 'base64url')).ref === 'obqwjntjlyuawmybkddm', 'refusing: not the lab project');

const H = { apikey: SVC, Authorization: 'Bearer ' + SVC, 'Content-Type': 'application/json' };
async function admin(path, init) { const r = await fetch(URL_ + path, { headers: H, ...init }); const t = await r.text(); if (!r.ok) throw new Error(path + ' ' + r.status + ' ' + t); return t ? JSON.parse(t) : null; }

async function call(method, { query = {}, body, jwt } = {}) {
  let status = 0, out = null;
  const res = { setHeader() {}, status(s) { status = s; return this; }, json(j) { out = j; return this; }, end() { return this; } };
  await handler({ method, query, body, headers: jwt ? { authorization: 'Bearer ' + jwt } : {} }, res);
  return { status, ...out };
}

async function makeUser(tag) {
  const email = `rr-test-${tag}-${Date.now()}@example.test`, password = 'rr-' + Math.random().toString(36).slice(2) + 'A1!';
  const u = await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) });
  const t = await fetch(URL_ + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }).then((r) => r.json());
  assert.ok(t.access_token, 'sign in ' + JSON.stringify(t));
  await admin('/rest/v1/profiles', { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: u.id, username: 'rrtest' + tag + Date.now().toString(36) }) });
  return { id: u.id, jwt: t.access_token };
}

const users = [];
try {
  const d = await call('GET', { query: { op: 'day' } });
  assert.equal(d.status, 200); assert.equal(d.questions.length, 5);
  console.log('day', d.day); d.questions.forEach((q, i) => console.log(' ', i + 1, q.text));
  assert.equal((await call('GET', { query: { op: 'state' } })).status, 401, 'state needs a session');

  // Real answers for each prompt, found by searching MusicBrainz.
  const answers = [];
  for (const q of d.questions) {
    const { count, answers: fs } = await findAnswers(q, 3);
    console.log('  answers available ~', count, '->', fs.map((f) => f.title || f.name).join(' / '));
    assert.ok(fs.length >= 2, 'no answers found for ' + q.text);
    answers.push(fs);
  }

  const A = await makeUser('a'); users.push(A);
  const B = await makeUser('b'); users.push(B);
  let s = await call('GET', { query: { op: 'state' }, jwt: A.jwt });
  assert.equal(s.started, false); assert.equal(s.answers.length, 0); assert.equal(s.questions.length, 5);

  // Like the game: a question is opened (its clock started) before it is answered.
  const post = async (u, body) => {
    if (body.op === 'answer') await call('POST', { body: { day: d.day, op: 'open', q: body.q }, jwt: u.jwt });
    return call('POST', { body: { day: d.day, ...body }, jwt: u.jwt });
  };
  const id = (f) => f.id;

  // Out of order is refused before any lookup is spent on it.
  let r = await post(A, { op: 'answer', q: 1, id: id(answers[1][0]) });
  assert.equal(r.reason, 'order');
  // An answer that does not fit says why, and costs nothing.
  const wrongKind = d.questions[0].kind === 'album' ? 'a74b1b7f-71a5-4011-9441-d0b5e4122711' : 'b1392450-e666-3926-a536-22c65f834433';
  r = await post(A, { op: 'answer', q: 0, id: wrongKind });
  assert.equal(r.ok, false); assert.ok(['nofit', 'gone'].includes(r.reason), JSON.stringify(r));
  assert.ok(r.message);
  // Not a MBID.
  r = await post(A, { op: 'answer', q: 0, id: 'OK Computer' });
  assert.equal(r.status, 400);

  // A plays all five; B gives the same first answer so the rarity moves.
  let total = 0;
  for (let q = 0; q < 5; q++) {
    r = await post(A, { op: 'answer', q, id: id(answers[q][0]) });
    assert.equal(r.ok, true, 'A q' + q + ' ' + JSON.stringify(r));
    assert.ok(r.grade >= 0 && r.grade <= 4); assert.ok(r.sample >= 0);   // others may have played today on lab
    total += r.gain; assert.equal(r.total, total);
    console.log('  A', q + 1, r.label, '·', r.sub, '->', ['COMMON', 'UNCOMMON', 'RARE', 'LEGENDARY', 'MYTHIC'][r.grade], r.pct + '%');
    if (q === 0) {
      const dup = await post(A, { op: 'answer', q: 1, id: id(answers[0][0]) });
      assert.ok(['duplicate', 'nofit', 'gone'].includes(dup.reason), 'reuse ' + JSON.stringify(dup)); console.log('  reuse ->', dup.reason);
    }
  }
  assert.equal(r.finished, true); assert.equal(r.award, 1600); assert.equal(r.streak, 1);
  r = await post(A, { op: 'answer', q: 4, id: id(answers[4][1]) });
  assert.equal(r.reason, 'finished', 'no second run');

  s = await call('GET', { query: { op: 'state' }, jwt: A.jwt });
  assert.equal(s.finished, true); assert.equal(s.total, total); assert.equal(s.answers.length, 5); assert.equal(s.streak, 1);

  const gb = await admin(`/rest/v1/game_bests?game=eq.rocketrun&user_id=eq.${A.id}&select=day,score`);
  assert.deepEqual(gb.map((x) => x.day).sort(), [-1, d.day].sort((a, b) => a - b));
  assert.ok(gb.every((x) => x.score === total));
  const prof = await admin(`/rest/v1/profiles?id=eq.${A.id}&select=discs,game_awards`);
  assert.ok(prof[0], 'profile'); assert.equal(prof[0].game_awards.rocketrun, 1, 'paid through game_awards');

  // B: same first answer (one other player gave it: 100% of a sample of 1,
  // smoothed), a pass, then a missing-report.
  const b0 = await post(B, { op: 'answer', q: 0, id: id(answers[0][0]) });
  assert.equal(b0.ok, true); assert.ok(b0.sample >= 1);
  const bPass = await post(B, { op: 'pass', q: 1 });
  assert.equal(bPass.ok, true); assert.equal(bPass.gain, 0); assert.equal(bPass.grade, -1);
  // The database refuses a repeat even if a check upstream were skipped.
  const rep = await admin('/rest/v1/rpc/rr_submit', { method: 'POST', body: JSON.stringify({ p_user: B.id, p_day: d.day, p_q: 2, p_key: (d.questions[0].kind === 'album' ? 'rg:' : 'ar:') + id(answers[0][0]), p_label: 'x', p_sub: '', p_votes: 0 }) });
  assert.equal(rep.reason, 'duplicate');
  const miss = await post(B, { op: 'missing', q: 2, text: 'Some obscure demo tape' });
  assert.equal(miss.ok, true);

  // A browser cannot call the writer itself.
  const direct = await fetch(URL_ + '/rest/v1/rpc/rr_submit', { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + B.jwt, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_user: B.id, p_day: d.day, p_q: 2, p_key: 'rg:x', p_label: 'x', p_sub: '', p_votes: 0 }) });
  assert.ok(direct.status >= 400, 'rr_submit must not be callable by a user: ' + direct.status);
  const peek = await fetch(URL_ + `/rest/v1/rr_answers?select=user_id&day=eq.${d.day}`, { headers: { apikey: ANON, Authorization: 'Bearer ' + B.jwt } }).then((x) => x.json());
  assert.ok(peek.every((x) => x.user_id === B.id), 'answers are private');
  console.log('rocketrun.route-test: ok · A flew', total, 'm · B rarity sample', b0.sample, b0.pct + '%');
} finally {
  for (const u of users) {
    await admin(`/rest/v1/game_bests?game=eq.rocketrun&user_id=eq.${u.id}`, { method: 'DELETE' }).catch((e) => console.error(e.message));
    await admin('/auth/v1/admin/users/' + u.id, { method: 'DELETE' }).catch((e) => console.error(e.message));
  }
}
