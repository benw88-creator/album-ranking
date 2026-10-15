// Ratings privacy against the REAL Supabase Data API (production by default).
//
//   node verify-ratings-privacy.mjs              read-only: anon reads only public raters
//   node verify-ratings-privacy.mjs --accounts   full matrix with two dedicated test accounts
//
// --accounts WRITES to the database (only the two test accounts' own rows:
// ratings_visibility, one rating, follows) and restores them afterwards.
// Needs VERIFY_A_EMAIL / VERIFY_A_PASSWORD / VERIFY_B_EMAIL / VERIFY_B_PASSWORD.
// Run it only with approval, after 20261015100000_ratings_visibility_policy.sql.
import assert from 'node:assert/strict';

const URL_ = process.env.SUPABASE_URL || 'https://cqfxyebejpkyhswolrwi.supabase.co';
const ANON = process.env.SUPABASE_ANON || (await import('node:fs')).readFileSync(new URL('../index.html', import.meta.url), 'utf8').match(/SUPABASE_ANON='([^']+)'/)[1];

async function rest(path, { token, method = 'GET', body, prefer } = {}) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    method, body: body && JSON.stringify(body),
    headers: { apikey: ANON, Authorization: `Bearer ${token || ANON}`, 'Content-Type': 'application/json', ...(prefer && { Prefer: prefer }) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
async function signIn(email, password) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('sign-in failed for ' + email + ': ' + (j.msg || j.error_description || r.status));
  return { token: j.access_token, id: j.user.id };
}

// Read-only: every rating anon can see must belong to a public profile.
const hidden = await rest('profiles?select=id&ratings_visibility=neq.public');
const pub = await rest('ratings?select=user_id&limit=1');
assert.ok(pub.length > 0, 'anon should read public ratings');
if (hidden.length) {
  const leak = await rest(`ratings?select=user_id&limit=1&user_id=in.(${hidden.map(p => p.id).join(',')})`);
  assert.equal(leak.length, 0, 'anon can read ratings of a non-public profile');
}
console.log(`ok — anon reads public ratings; ${hidden.length} non-public profile(s), none readable by anon`);

if (process.argv.includes('--accounts')) {
  const env = k => process.env[k] || (() => { throw new Error('missing ' + k); })();
  const A = await signIn(env('VERIFY_A_EMAIL'), env('VERIFY_A_PASSWORD'));
  const B = await signIn(env('VERIFY_B_EMAIL'), env('VERIFY_B_PASSWORD'));
  const item = 'vinall-privacy-check';
  const countA = token => rest(`ratings?select=item_id&user_id=eq.${A.id}&item_id=eq.${item}`, { token }).then(r => r.length);
  const setVis = v => rest(`profiles?id=eq.${A.id}`, { token: A.token, method: 'PATCH', body: { ratings_visibility: v } });
  const unfollow = () => Promise.all([
    rest(`follows?follower_id=eq.${A.id}&following_id=eq.${B.id}`, { token: A.token, method: 'DELETE' }),
    rest(`follows?follower_id=eq.${B.id}&following_id=eq.${A.id}`, { token: B.token, method: 'DELETE' }),
  ]);
  // Snapshot exactly what is touched, so cleanup restores it rather than a default.
  const snapshot = async () => ({
    vis: (await rest(`profiles?select=ratings_visibility&id=eq.${A.id}`, { token: A.token }))[0]?.ratings_visibility,
    ab: (await rest(`follows?select=follower_id&follower_id=eq.${A.id}&following_id=eq.${B.id}`, { token: A.token })).length,
    ba: (await rest(`follows?select=follower_id&follower_id=eq.${B.id}&following_id=eq.${A.id}`, { token: B.token })).length,
    rating: await countA(A.token),
  });
  const before = await snapshot();
  assert.equal(before.rating, 0, 'test item already rated on account A; refusing to overwrite it');
  // Leaving public fires unpublish_private_feed_trg, which deletes A's crate_feed
  // posts for good. Restoring visibility would not bring them back.
  const posts = await rest(`crate_feed?select=id&user_id=eq.${A.id}&limit=1`, { token: A.token });
  assert.equal(posts.length, 0, 'account A has Crate feed posts that going private would delete; use an account with none');
  try {
    await unfollow();
    await rest('ratings?on_conflict=user_id,kind,item_id', { token: A.token, method: 'POST', prefer: 'resolution=merge-duplicates',
      body: { user_id: A.id, kind: 'album', item_id: item, data: { score: 50, ratedAt: Date.now() } } });
    await setVis('private');
    assert.equal(await countA(A.token), 1, 'owner reads own private rating');
    assert.equal(await countA(), 0, 'anon cannot read private');
    assert.equal(await countA(B.token), 0, 'stranger cannot read private');
    await setVis('friends');
    assert.equal(await countA(B.token), 0, 'non-follower cannot read friends-only');
    await rest('follows', { token: B.token, method: 'POST', body: { follower_id: B.id, following_id: A.id } });
    assert.equal(await countA(B.token), 0, 'one-way follower cannot read friends-only');
    await rest('follows', { token: A.token, method: 'POST', body: { follower_id: A.id, following_id: B.id } });
    assert.equal(await countA(B.token), 1, 'mutual friend reads friends-only');
    assert.equal(await countA(), 0, 'anon cannot read friends-only');
    await setVis('private');
    assert.equal(await countA(B.token), 0, 'mutual friend cannot read private');
    await setVis('public');
    assert.equal(await countA(), 1, 'anon reads public');
    assert.equal(await countA(B.token), 1, 'signed-in user reads public');
    console.log('ok — owner, anon, stranger, one-way follower, mutual friend and public all behave');
  } finally {
    await unfollow().catch(e => console.error('cleanup follows:', e.message));
    if (before.ab) await rest('follows', { token: A.token, method: 'POST', body: { follower_id: A.id, following_id: B.id } }).catch(e => console.error('restore A→B follow:', e.message));
    if (before.ba) await rest('follows', { token: B.token, method: 'POST', body: { follower_id: B.id, following_id: A.id } }).catch(e => console.error('restore B→A follow:', e.message));
    await setVis(before.vis || 'public').catch(e => console.error('cleanup visibility:', e.message));
    await rest(`ratings?user_id=eq.${A.id}&item_id=eq.${item}`, { token: A.token, method: 'DELETE' }).catch(e => console.error('cleanup rating:', e.message));
    const after = await snapshot();
    assert.deepEqual(after, before, 'accounts not restored: ' + JSON.stringify({ before, after }));
    console.log('ok — restored: A visibility ' + after.vis + ', A→B follow ' + !!after.ab + ', B→A follow ' + !!after.ba + ', test rating removed');
  }
}
