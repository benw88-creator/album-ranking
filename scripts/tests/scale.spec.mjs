// Request-volume guards from the 2026-10-23 scalability audit. Every request is
// mocked; nothing here reaches Supabase or Deezer.
import { test, expect, start } from './fixtures.mjs';

const uid = '11111111-1111-4111-8111-111111111111';
async function signedIn(page) {
  const now = Date.now();
  const user = { id: uid, email: 'fixture@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: { age_band: 'adult' }, created_at: new Date().toISOString() };
  const token = [Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: uid, role: 'authenticated', aud: 'authenticated', exp: Math.floor(now / 1000) + 3600 })).toString('base64url'), 'fixture'].join('.');
  await page.addInitScript(({ user, token }) => {
    localStorage.setItem('sb-cqfxyebejpkyhswolrwi-auth-token', JSON.stringify({ access_token: token, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user }));
    localStorage.setItem('crate_onboard_v1', JSON.stringify({ done: true, step: 5 }));
  }, { user, token });
  const calls = [];
  const libs = { aaaa: { 1: 80, 2: 70 }, bbbb: { 1: 60 }, cccc: { 2: 90 } };
  await page.route('**/auth/v1/user', route => route.fulfill({ json: user }));
  await page.route('**/rest/v1/**', route => {
    const req = route.request(), url = new URL(req.url()), name = url.pathname.split('/').pop();
    calls.push({ name, method: req.method(), url: req.url(), body: req.postData() });
    const single = (req.headers().accept || '').includes('object+json');
    if (name === 'profiles') {
      const ids = (url.searchParams.get('id') || '').replace(/^in\.\(|\)$/g, '').split(',');
      if (ids.length > 1 || !ids[0].startsWith('eq.')) return route.fulfill({ json: ids.map(id => ({ id, ratings_visibility: 'public' })) });
      const p = { id: uid, username: 'Fixture', is_admin: false, discs: 1000, owned_themes: ['classic'], ratings_visibility: 'public' };
      return route.fulfill({ json: single ? p : [p] });
    }
    if (name === 'crate_feed' && url.searchParams.get('user_id')) {
      const ids = url.searchParams.get('user_id').replace(/^in\.\(|\)$/g, '').split(',');
      const rows = ids.flatMap(id => Object.entries(libs[id] || {}).map(([album_id, score]) => ({ user_id: id, album_id, score, album_name: 'Record ' + album_id, album_artist: 'Test Artist', album_art: '' })));
      return route.fulfill({ json: rows });
    }
    if (name === 'notifications') return route.fulfill({ json: [], headers: { 'content-range': '*/0' } });
    return route.fulfill({ json: single ? null : [] });
  });
  await start(page);
  await page.evaluate(() => Cloud.ready);
  return calls;
}

test('Bid Wars opens no Realtime socket; the board still loads', async ({ page }) => {
  const calls = await signedIn(page);
  await page.evaluate(() => goToView('wars'));
  await expect.poll(() => calls.filter(c => c.name === 'bid_wars').length).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => Cloud.client().getChannels().length)).toBe(0);
});

test('taste match fetches each library once, in index order, and only the new person later', async ({ page }) => {
  const calls = await signedIn(page);
  const feed = () => calls.filter(c => c.name === 'crate_feed' && c.url.includes('user_id='));
  const a = await page.evaluate(() => Cloud.fetchScoresByUsers(['aaaa', 'bbbb']));
  expect(a.scores).toEqual({ aaaa: { 1: 80, 2: 70 }, bbbb: { 1: 60 } });
  expect(a.meta['1'].name).toBe('Record 1');
  expect(feed().length).toBe(1);
  expect(feed()[0].url).toContain('order=user_id.asc%2Calbum_id.asc');
  // Same people again: answered from memory.
  const b = await page.evaluate(() => Cloud.fetchScoresByUsers(['bbbb', 'aaaa']));
  expect(b.scores).toEqual(a.scores);
  expect(feed().length).toBe(1);
  // One new person: only they are asked for.
  const c = await page.evaluate(() => Cloud.fetchScoresByUsers(['aaaa', 'cccc']));
  expect(c.scores.cccc).toEqual({ 2: 90 });
  expect(feed().length).toBe(2);
  expect(decodeURIComponent(feed()[1].url)).toContain('in.(cccc)');
  // Two callers at once share one request.
  await page.evaluate(() => Promise.all([Cloud.fetchScoresByUsers(['dddd']), Cloud.fetchScoresByUsers(['dddd'])]));
  expect(feed().length).toBe(3);
});

test('the notification dot is not re-asked within 30s, except when the panel opens', async ({ page }) => {
  const calls = await signedIn(page);
  const asks = () => calls.filter(c => c.name === 'notifications' && c.method === 'HEAD').length;
  await page.waitForTimeout(3200); // past the 2.5s boot timer
  expect(asks()).toBe(1);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(300);
  expect(asks()).toBe(1);
  await page.evaluate(() => refreshNotifDot(true));
  expect(asks()).toBe(2);
});

test('unchanged saved state is not uploaded again; a change is', async ({ page }) => {
  const calls = await signedIn(page);
  const all = () => calls.filter(c => c.name === 'app_state' && c.method === 'POST' && (c.body || '').includes('crate_shortlist_v1')).length;
  await page.waitForTimeout(2500); // the login merge uploads its own defaults first
  const base = all(), ups = () => all() - base;
  await page.evaluate(() => { localStorage.setItem('crate_shortlist_v1', JSON.stringify({ x: { id: 'x' } })); Cloud.push('crate_shortlist_v1'); });
  await expect.poll(ups).toBe(1);
  await page.evaluate(() => Cloud.push('crate_shortlist_v1'));
  await page.waitForTimeout(900);
  expect(ups()).toBe(1);
  await page.evaluate(() => { localStorage.setItem('crate_shortlist_v1', JSON.stringify({ y: { id: 'y' } })); Cloud.push('crate_shortlist_v1'); });
  await expect.poll(ups).toBe(2);
});

test('analytics events are sent in one batch', async ({ page }) => {
  const calls = await signedIn(page);
  const posts = () => calls.filter(c => c.name === 'analytics_events' && c.method === 'POST');
  await page.waitForTimeout(4500);
  const before = posts().length;
  await page.evaluate(() => { track('scale_a'); track('scale_b', { n: 1 }); track('scale_c'); track.flush(); });
  await expect.poll(() => posts().length).toBe(before + 1);
  const rows = JSON.parse(posts().at(-1).body);
  expect(rows.map(r => r.name)).toEqual(['scale_a', 'scale_b', 'scale_c']);
  expect(rows.every(r => r.user_id === uid)).toBe(true);
});
