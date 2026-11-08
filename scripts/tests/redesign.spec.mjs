// The redesign's structure: five places, every old view still reachable and
// lighting the right place, the Rate tab's search -> sheet -> saved rating.
// SHOTS=<dir> also writes phone screenshots of each place.
import { test, expect, start } from './fixtures.mjs';
import path from 'node:path';

const SHOTS = process.env.SHOTS;
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); }
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });

test('five places, and every old view lights the right one', async ({ page }) => {
  await start(page, { seeded: true });
  await expect(page.locator('#modes button[data-mode]')).toHaveCount(5);
  const expectPlace = {
    home: 'home', foryou: 'foryou', crate: 'foryou', choice: 'foryou', people: 'foryou', grooves: 'foryou',
    rate: 'rate', games: 'games', wars: 'games',
    profile: 'profile', albums: 'profile', songs: 'profile', liked: 'profile', collection: 'profile',
    rewards: 'profile', achievements: 'profile', passport: 'profile', about: 'profile', yourmusic: 'profile', replay: 'home'
  };
  for (const [mode, place] of Object.entries(expectPlace)) {
    await page.evaluate(m => goToView(m), mode);
    await expect(page.locator('#view-' + mode)).toBeVisible();
    await expect(page.locator('#modes button.active')).toHaveAttribute('data-mode', place);
    await expect(page.locator('body')).toHaveAttribute('data-place', place);
  }
});

test('segmented bars and back bars move between views', async ({ page }) => {
  await start(page, { seeded: true });
  await page.evaluate(() => goToView('albums'));
  await page.locator('#view-albums .seg-sub [data-seg-go="songs"]').click();
  await expect(page.locator('#view-songs')).toBeVisible();
  await page.locator('#view-songs .seg-main [data-seg-go="collection"]').click();
  await expect(page.locator('#view-collection')).toBeVisible();
  await page.locator('#modes button[data-mode="games"]').click();
  await page.evaluate(() => goToView('wars'));
  await page.locator('#view-wars .back-btn').click();
  await expect(page.locator('#view-games')).toBeVisible();
  // Header and search are gone from every place but Home.
  await expect(page.locator('.wrap > header')).toBeHidden();
  await page.locator('#modes button[data-mode="home"]').click();
  await expect(page.locator('.wrap > header')).toBeVisible();
});

test('Rate: search, sheet, saved rating', async ({ page }) => {
  await start(page);
  await page.locator('#modes button[data-mode="rate"]').click();
  await shot(page, '10-rate-empty');
  await page.locator('#search-input').fill('record');
  await expect(page.locator('#suggestions .suggestion').first()).toBeVisible();
  await shot(page, '11-rate-results');
  await page.locator('#suggestions .suggestion').first().click();
  await expect(page.locator('#rs-modal')).toHaveClass(/open/);
  await page.locator('#rs-range').fill('83');
  await expect(page.locator('#rs-save')).toHaveText('Rate 83');
  await shot(page, '12-rate-sheet');
  await page.locator('#rs-save').click();
  await expect(page.locator('#rs-modal')).not.toHaveClass(/open/);
  const score = await page.evaluate(() => Object.values(loadAlbums())[0].score);
  expect(score).toBe(83);
  await page.locator('#search-input').fill('');
  await page.evaluate(() => RateTab.render());
  await expect(page.locator('#rate-body .score-pill')).toHaveText('83');
  // Re-rating says what it would do.
  await page.locator('#rate-body [data-rate]').first().click();
  await expect(page.locator('#rs-save')).toHaveText('Still 83');
});

test('screenshots of each place', async ({ page }) => {
  test.skip(!SHOTS, 'SHOTS not set');
  await start(page, { seeded: true });
  const places = ['home', 'foryou', 'crate', 'choice', 'people', 'rate', 'games', 'wars', 'profile', 'albums', 'songs', 'collection', 'passport', 'rewards', 'achievements', 'about', 'yourmusic', 'replay', 'grooves'];
  let i = 20;
  for (const m of places) {
    await page.evaluate(v => goToView(v), m);
    await page.waitForTimeout(500);
    await shot(page, (i++) + '-' + m);
  }
  await page.evaluate(() => goToView('games'));
  await page.evaluate(() => window.scrollTo(0, 700));
  await page.waitForTimeout(300);
  await shot(page, '50-games-scrolled');
});

// A signed-in session, faked in storage: every request is still answered by
// the fixtures, so nothing here reaches any Supabase project.
async function signIn(page) {
  const user = { id: '00000000-0000-4000-8000-000000000001', email: 'tester@example.test', aud: 'authenticated', role: 'authenticated', user_metadata: {} };
  await page.route(/supabase\.co\/auth\/v1\/user/, r => r.fulfill({ json: user }));
  await page.route(/supabase\.co\/rest\/v1\/profiles/, r => {
    const row = { id: user.id, username: 'tester', bio: 'Records first.', avatar_url: '', top3: [], discs: 26432, lifetime_xp: 40000, age_band: 'adult', ratings_visibility: 'public' };
    const single = r.request().headers().accept?.includes('object+json');
    return r.fulfill({ json: single ? row : [row] });
  });
  await page.addInitScript(u => {
    const now = Math.floor(Date.now() / 1000);
    const session = { access_token: 'test.' + btoa(JSON.stringify({ sub: u.id, exp: now + 3600 })) + '.x', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'test', user: u };
    for (const k of Object.keys(localStorage)) if (/^sb-.*-auth-token$/.test(k)) localStorage.removeItem(k);
    const ref = 'obqwjntjlyuawmybkddm';
    localStorage.setItem('sb-' + ref + '-auth-token', JSON.stringify(session));
    localStorage.setItem('vinall_local_owner', u.id);
  }, user);
}

test('signed-in profile, shop and settings stay reachable', async ({ page }) => {
  await signIn(page);
  await start(page, { seeded: true });
  await page.evaluate(() => Cloud.ready);
  const gate = page.locator('#age-gate [data-band="adult"]');
  if (await gate.isVisible().catch(() => false)) await gate.click();
  await expect(page.locator('#age-gate')).toHaveCount(0);
  await page.locator('#modes button[data-mode="profile"]').click();
  await expect(page.locator('#pt-settings')).toBeVisible();
  await shot(page, '60-profile-signed-in');
  await page.evaluate(() => window.scrollTo(0, 99999));
  await page.waitForTimeout(300);
  await shot(page, '61-profile-bottom');
  await page.locator('[data-more="rewards"]').click();
  await expect(page.locator('#view-rewards')).toBeVisible();
  await shot(page, '62-shop-signed-in');
  await page.locator('#view-rewards .back-btn').click();
  await expect(page.locator('#view-profile')).toBeVisible();
  await page.locator('#pt-settings').click();
  await expect(page.locator('#settings-modal')).toHaveClass(/open/);
  await expect(page.locator('#set-logout')).toBeVisible();
  await shot(page, '63-settings');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { document.getElementById('settings-modal').classList.remove('open'); goToView('home'); });
  await page.waitForTimeout(600);
  await shot(page, '64-home-signed-in');
  await page.evaluate(() => goToView('games'));
  await page.waitForTimeout(400);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '65-games-full.png'), fullPage: true });
});

test('desktop screenshots', async ({ page }) => {
  test.skip(!SHOTS, 'SHOTS not set');
  await page.setViewportSize({ width: 1280, height: 820 });
  await start(page, { seeded: true });
  for (const m of ['home', 'rate', 'games', 'albums', 'foryou']) {
    await page.evaluate(v => goToView(v), m);
    await page.waitForTimeout(500);
    await shot(page, '70-desk-' + m);
  }
});
