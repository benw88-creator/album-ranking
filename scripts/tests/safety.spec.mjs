import { test, expect, start } from './fixtures.mjs';

// Signs in a fixture account with no age recorded, answers the age question and
// returns what the app sent: the metadata update, profile writes, feed deletes.
async function signedIn(page, answer) {
  const uid = '11111111-1111-4111-8111-111111111111', now = Date.now();
  const user = { id: uid, email: 'fixture@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  const token = [Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: uid, role: 'authenticated', aud: 'authenticated', exp: Math.floor(now / 1000) + 3600 })).toString('base64url'), 'fixture'].join('.');
  const seen = { meta: null, vis: null, feedDeleted: false, signedOut: false };
  await page.addInitScript(({ user, token }) => {
    localStorage.setItem('sb-cqfxyebejpkyhswolrwi-auth-token', JSON.stringify({ access_token: token, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user }));
    localStorage.setItem('crate_onboard_v1', JSON.stringify({ done: true, step: 5 }));
  }, { user, token });
  let profile = { id: uid, username: 'Fixture', is_admin: false, discs: 1000, owned_themes: ['classic'], ratings_visibility: 'public' };
  await page.route('**/auth/v1/user', route => {
    const req = route.request();
    if (req.method() === 'PUT') { seen.meta = req.postDataJSON().data; Object.assign(user.user_metadata, seen.meta); }
    return route.fulfill({ json: user });
  });
  await page.route('**/auth/v1/logout**', route => { seen.signedOut = true; return route.fulfill({ status: 204, body: '' }); });
  await page.route('**/rest/v1/**', route => {
    const req = route.request(), name = new URL(req.url()).pathname.split('/').pop();
    const single = (req.headers().accept || '').includes('object+json');
    if (name === 'profiles') {
      if (req.method() !== 'GET') { const b = req.postDataJSON(); if (b.ratings_visibility) { seen.vis = b.ratings_visibility; profile = { ...profile, ...b }; } }
      return route.fulfill({ json: single ? profile : [profile] });
    }
    if (name === 'crate_feed' && req.method() === 'DELETE') { seen.feedDeleted = true; return route.fulfill({ json: [] }); }
    if (name === 'wallet_state') return route.fulfill({ json: { id: uid, discs: 1000, is_admin: false } });
    return route.fallback();
  });
  await start(page);
  await page.evaluate(() => Cloud.ready);
  await expect(page.locator('#age-gate')).toBeVisible();
  await page.locator(`#age-gate [data-band="${answer}"]`).click();
  return seen;
}

test('13-17 is recorded as a band and starts friends-only, out of the public feed', async ({ page }) => {
  const seen = await signedIn(page, '13-17');
  await expect.poll(() => seen.vis).toBe('friends');
  expect(seen.meta).toEqual({ age_band: '13-17' });
  await expect.poll(() => seen.feedDeleted).toBe(true);
  await expect(page.locator('#age-gate')).toHaveCount(0);
});

test('under 13 is signed out and told why', async ({ page }) => {
  const seen = await signedIn(page, 'under13');
  await expect.poll(() => seen.meta).toEqual({ age_band: 'under13' });
  await expect.poll(() => page.evaluate(() => Cloud.isOn())).toBe(false);
  await expect(page.locator('#ask-title')).toHaveText('VINALL is for 13 and over');
});

test('adults keep their settings', async ({ page }) => {
  const seen = await signedIn(page, 'adult');
  await expect.poll(() => seen.meta).toEqual({ age_band: 'adult' });
  await page.waitForTimeout(300);
  expect(seen.vis).toBe(null);
});
